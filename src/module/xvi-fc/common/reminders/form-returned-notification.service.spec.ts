import { Types } from 'mongoose';
import { Role } from 'src/module/auth/enum/role.enum';
import { FormReturnedNotificationService } from './form-returned-notification.service';

/** Mimics a Mongoose query chain — every builder method returns the same chain, `.exec()` resolves. */
function q<T>(result: T) {
  const chain: Record<string, unknown> = { exec: () => Promise.resolve(result) };
  chain.select = () => chain;
  chain.lean = () => chain;
  return chain;
}

describe('FormReturnedNotificationService.notifyStateFormReturned', () => {
  const stateId = new Types.ObjectId();
  const template = { subject: 'Returned: {{formName}}', body: '{{stateName}}|{{formName}}|{{returnReasonBlock}}|{{loginLink}}' };

  let userModel: { find: jest.Mock };
  let stateModel: { findById: jest.Mock };
  let emailTemplates: { findBySlug: jest.Mock };
  let emailQueue: { addEmailJob: jest.Mock };
  let service: FormReturnedNotificationService;

  beforeEach(() => {
    userModel = { find: jest.fn().mockReturnValue(q([{ email: 'a@state.gov' }, { email: 'b@state.gov' }])) };
    stateModel = { findById: jest.fn().mockReturnValue(q({ name: 'Tripura' })) };
    emailTemplates = { findBySlug: jest.fn().mockResolvedValue(template) };
    emailQueue = { addEmailJob: jest.fn().mockResolvedValue(undefined) };
    const config = { get: jest.fn((key: string) => (key === 'CLIENT_URL' ? 'https://app.test' : undefined)) };

    service = new FormReturnedNotificationService(
      userModel as never,
      {} as never,
      {} as never,
      emailTemplates as never,
      emailQueue as never,
      config as never,
      stateModel as never,
    );
  });

  it('queues one email per verified State user, escaping and quoting the remark', async () => {
    await service.notifyStateFormReturned({ stateId, formName: 'SFC Status', remarks: '<b>Fix</b>' });

    expect(userModel.find).toHaveBeenCalledWith(
      expect.objectContaining({ state: stateId, role: Role.STATE, isActive: true, isXVIFCProfileVerified: true }),
    );
    expect(emailQueue.addEmailJob).toHaveBeenCalledTimes(2);
    const first = emailQueue.addEmailJob.mock.calls[0][0] as { to: string; subject: string; html: string };
    expect(first.to).toBe('a@state.gov');
    expect(first.subject).toBe('Returned: SFC Status');
    expect(first.html).toContain('Tripura|SFC Status|');
    expect(first.html).toContain('&lt;b&gt;Fix&lt;/b&gt;');
    expect(first.html).not.toContain('<b>Fix</b>');
    expect(first.html).toContain('https://app.test/');
  });

  it('omits the remarks block when there is no single remark (row-level return)', async () => {
    await service.notifyStateFormReturned({ stateId, formName: 'Elected Body Status', remarks: null });

    const html = (emailQueue.addEmailJob.mock.calls[0][0] as { html: string }).html;
    expect(html).not.toContain('reason-box');
  });

  it('keeps queueing the other recipients when one enqueue fails', async () => {
    emailQueue.addEmailJob.mockRejectedValueOnce(new Error('queue down')).mockResolvedValueOnce(undefined);

    await expect(
      service.notifyStateFormReturned({ stateId, formName: 'SFC Status', remarks: null }),
    ).resolves.toBeUndefined();
    expect(emailQueue.addEmailJob).toHaveBeenCalledTimes(2);
    expect((emailQueue.addEmailJob.mock.calls[1][0] as { to: string }).to).toBe('b@state.gov');
  });

  it('sends nothing, and never throws, when the State has no verified users', async () => {
    userModel.find.mockReturnValue(q([]));

    await expect(
      service.notifyStateFormReturned({ stateId, formName: 'SFC Status', remarks: null }),
    ).resolves.toBeUndefined();
    expect(emailQueue.addEmailJob).not.toHaveBeenCalled();
  });

  it('swallows a missing template instead of failing the caller', async () => {
    emailTemplates.findBySlug.mockRejectedValue(new Error('template not found'));

    await expect(
      service.notifyStateFormReturned({ stateId, formName: 'SFC Status', remarks: null }),
    ).resolves.toBeUndefined();
    expect(emailQueue.addEmailJob).not.toHaveBeenCalled();
  });
});

describe('FormReturnedNotificationService.seedTemplate', () => {
  const build = (existingSlugs: string[]) => {
    const templateModel = {
      findOne: jest.fn(({ slug }: { slug: string }) => ({
        exec: () => Promise.resolve(existingSlugs.includes(slug) ? { slug } : null),
      })),
      create: jest.fn().mockResolvedValue({}),
    };
    const service = new FormReturnedNotificationService(
      {} as never,
      {} as never,
      templateModel as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    return { service, templateModel };
  };

  it('creates every template when none exists', async () => {
    const { service, templateModel } = build([]);

    await expect(service.seedTemplate()).resolves.toMatchObject({ created: true });
    const slugs = (templateModel.create.mock.calls as [{ slug: string }][]).map(([doc]) => doc.slug).sort();
    expect(slugs).toEqual(['claim-letter-returned-state', 'claim-letter-returned-ulb', 'form-returned-notification', 'state-form-returned-notification']);
  });

  it('creates only the missing templates on an environment that already has the older ones', async () => {
    const { service, templateModel } = build(['form-returned-notification', 'state-form-returned-notification']);

    await expect(service.seedTemplate()).resolves.toMatchObject({ created: true });
    const slugs = (templateModel.create.mock.calls as [{ slug: string }][]).map(([doc]) => doc.slug).sort();
    expect(slugs).toEqual(['claim-letter-returned-state', 'claim-letter-returned-ulb']);
  });

  it('is a no-op when all already exist', async () => {
    const { service, templateModel } = build(['claim-letter-returned-state', 'claim-letter-returned-ulb', 'form-returned-notification', 'state-form-returned-notification']);

    await expect(service.seedTemplate()).resolves.toMatchObject({ created: false });
    expect(templateModel.create).not.toHaveBeenCalled();
  });
});

describe('FormReturnedNotificationService.notifyClaimLetterReturned', () => {
  const stateId = new Types.ObjectId();
  const ulbA = new Types.ObjectId();
  const ulbB = new Types.ObjectId();
  const templates: Record<string, { subject: string; body: string }> = {
    'claim-letter-returned-state': { subject: 'Returned {{refNo}}', body: '{{stateName}}|{{returnReasonBlock}}|{{returnedItemsBlock}}' },
    'claim-letter-returned-ulb': { subject: 'Returned {{formName}}', body: '{{ulbName}}|{{formName}}|{{returnReasonBlock}}' },
  };

  let userModel: { find: jest.Mock; findOne: jest.Mock };
  let emailQueue: { addEmailJob: jest.Mock };
  let emailTemplates: { findBySlug: jest.Mock };
  let service: FormReturnedNotificationService;

  const params = () => ({
    stateId,
    refNo: 'CL/TR/2026-27/1-2',
    stateRemark: 'Fix the SFC status',
    stateItems: ['SFC Status'],
    ulbs: [
      { ulbId: ulbA, items: ['Bank Account'], ownForms: ['Bank Account'], remark: 'Wrong IFSC' },
      { ulbId: ulbB, items: ['Elected Body Status'], ownForms: [], remark: '<i>ward</i>' },
    ],
  });
  const sent = () => emailQueue.addEmailJob.mock.calls.map(([job]) => job as { to: string; subject: string; html: string });

  beforeEach(() => {
    userModel = {
      find: jest.fn().mockReturnValue(q([{ email: 'a@state.gov' }])),
      findOne: jest.fn().mockReturnValue(q({ email: 'nodal@ulb.gov' })),
    };
    const ulbModel = {
      find: jest.fn().mockReturnValue(
        q([
          { _id: ulbA, name: 'Khowai' },
          { _id: ulbB, name: 'Melaghar' },
        ]),
      ),
    };
    const stateModel = { findById: jest.fn().mockReturnValue(q({ name: 'Tripura' })) };
    emailTemplates = { findBySlug: jest.fn((slug: string) => Promise.resolve(templates[slug])) };
    emailQueue = { addEmailJob: jest.fn().mockResolvedValue(undefined) };
    const config = { get: jest.fn((key: string) => (key === 'CLIENT_URL' ? 'https://app.test' : undefined)) };

    service = new FormReturnedNotificationService(
      userModel as never,
      ulbModel as never,
      {} as never,
      emailTemplates as never,
      emailQueue as never,
      config as never,
      stateModel as never,
    );
  });

  it('sends the State one email listing every returned item, and each ULB with its own forms one email', async () => {
    await service.notifyClaimLetterReturned(params());

    const [state, ulb] = sent();
    expect(sent()).toHaveLength(2);
    expect(state.to).toBe('a@state.gov');
    expect(state.subject).toBe('Returned CL/TR/2026-27/1-2');
    expect(state.html).toContain('<li>SFC Status</li>');
    expect(state.html).toContain('<strong>Khowai</strong>: Bank Account &mdash; Wrong IFSC');
    expect(state.html).toContain('<strong>Melaghar</strong>: Elected Body Status &mdash; &lt;i&gt;ward&lt;/i&gt;');
    expect(state.html).toContain('Fix the SFC status');
    // Melaghar was returned only through a State-form row: the State fixes it, so the ULB gets no email.
    expect(ulb).toMatchObject({ to: 'nodal@ulb.gov', subject: 'Returned Bank Account' });
    expect(ulb.html).toContain('Khowai|Bank Account|');
  });

  it('still emails the ULBs when the State email fails, and never throws', async () => {
    userModel.find.mockImplementation(() => {
      throw new Error('db down');
    });

    await expect(service.notifyClaimLetterReturned(params())).resolves.toBeUndefined();
    expect(sent().map((m) => m.to)).toEqual(['nodal@ulb.gov']);
  });

  it('skips a ULB with neither a Nodal Officer nor an accountant email', async () => {
    userModel.findOne.mockReturnValue(q(null));

    await service.notifyClaimLetterReturned(params());

    expect(sent().map((m) => m.to)).toEqual(['a@state.gov']);
  });
});
