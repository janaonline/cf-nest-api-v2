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

  it('creates both the ULB and the State template when neither exists', async () => {
    const { service, templateModel } = build([]);

    await expect(service.seedTemplate()).resolves.toMatchObject({ created: true });
    const slugs = (templateModel.create.mock.calls as [{ slug: string }][]).map(([doc]) => doc.slug).sort();
    expect(slugs).toEqual(['form-returned-notification', 'state-form-returned-notification']);
  });

  it('creates only the missing State template on an environment that already has the ULB one', async () => {
    const { service, templateModel } = build(['form-returned-notification']);

    await expect(service.seedTemplate()).resolves.toMatchObject({ created: true });
    expect(templateModel.create).toHaveBeenCalledTimes(1);
    expect(templateModel.create).toHaveBeenCalledWith(expect.objectContaining({ slug: 'state-form-returned-notification' }));
  });

  it('is a no-op when both already exist', async () => {
    const { service, templateModel } = build(['form-returned-notification', 'state-form-returned-notification']);

    await expect(service.seedTemplate()).resolves.toMatchObject({ created: false });
    expect(templateModel.create).not.toHaveBeenCalled();
  });
});
