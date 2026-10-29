import { StateReviewDigestService } from './state-review-digest.service';

/**
 * Narrow, dependency-light coverage of seedTemplate()'s migration branch — the other
 * StateReviewDigestService methods (sendDueDigests, the STATE-recipient/PDF pipeline) need the
 * full set of Mongoose models + services this constructor takes, which no reminder-cron service
 * in this folder currently has spec coverage for. seedTemplate() only touches `templateModel` and
 * the logger, so it's instantiated here with everything else stubbed out.
 */
describe('StateReviewDigestService.seedTemplate', () => {
  const LEGACY_FOOTER = 'This is an automated message. Please do not reply to this email.';
  const REPLY_TO_FOOTER =
    'This is an automated message. For any information needed, please reply only to 16fc.grant@cityfinance.in.';

  function buildService(templateModel: Record<string, jest.Mock>) {
    return new StateReviewDigestService(
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
      templateModel as any,
      undefined as any,
      undefined as any,
      undefined as any,
      undefined as any,
    );
  }

  it('creates the template when none exists yet', async () => {
    const templateModel = {
      findOne: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(null) }),
      create: jest.fn().mockResolvedValue(undefined),
      updateOne: jest.fn(),
    };
    const service = buildService(templateModel);

    const result = await service.seedTemplate();

    expect(result.created).toBe(true);
    const [[createArg]] = templateModel.create.mock.calls;
    expect(createArg.slug).toBe('state-review-reminder');
    expect(createArg.body).not.toContain(LEGACY_FOOTER);
    expect(createArg.body.replace(/\s+/g, ' ')).toContain(REPLY_TO_FOOTER);
    expect(templateModel.updateOne).not.toHaveBeenCalled();
  });

  it('migrates a persisted template still carrying the legacy "do not reply" footer, preserving the rest of the body', async () => {
    const customBody = `<p>Custom intro the admin wrote.</p><div class="footer">${LEGACY_FOOTER}</div>`;
    const templateModel = {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: 'template-1', body: customBody }),
      }),
      create: jest.fn(),
      updateOne: jest.fn().mockResolvedValue(undefined),
    };
    const service = buildService(templateModel);

    const result = await service.seedTemplate();

    expect(result.created).toBe(false);
    expect(result.message).toContain('migrated');
    expect(templateModel.updateOne).toHaveBeenCalledWith(
      { _id: 'template-1' },
      { $set: { body: `<p>Custom intro the admin wrote.</p><div class="footer">${REPLY_TO_FOOTER}</div>` } },
    );
    expect(templateModel.create).not.toHaveBeenCalled();
  });

  it('leaves an already-migrated (or fully customized) template untouched', async () => {
    const templateModel = {
      findOne: jest.fn().mockReturnValue({
        exec: jest.fn().mockResolvedValue({ _id: 'template-1', body: '<p>Already on the new copy, no legacy phrase here.</p>' }),
      }),
      create: jest.fn(),
      updateOne: jest.fn(),
    };
    const service = buildService(templateModel);

    const result = await service.seedTemplate();

    expect(result.created).toBe(false);
    expect(result.message).toBe('State review reminder template already exists');
    expect(templateModel.updateOne).not.toHaveBeenCalled();
    expect(templateModel.create).not.toHaveBeenCalled();
  });
});

describe('StateReviewDigestService.sendDueDigests — ADC-owned ULBs', () => {
  const chain = <T>(value: T) => {
    const q: Record<string, jest.Mock> = {};
    q.select = jest.fn().mockReturnValue(q);
    q.lean = jest.fn().mockReturnValue(q);
    q.exec = jest.fn().mockResolvedValue(value);
    return q;
  };

  const stateId = '507f1f77bcf86cd799439011';
  const adcUlbId = '507f1f77bcf86cd799439021';
  const stateUlbId = '507f1f77bcf86cd799439022';
  const declaredAt = new Date('2026-01-01T00:00:00Z');

  function buildService(overrides: { dueAnnualAccounts?: unknown[] } = {}) {
    const annualAccountModel = {
      find: jest.fn().mockReturnValue(chain(overrides.dueAnnualAccounts ?? [])),
      updateMany: jest.fn().mockResolvedValue({}),
    };
    const bankAccountModel = { find: jest.fn().mockReturnValue(chain([])), updateMany: jest.fn() };
    const userModel = { find: jest.fn().mockReturnValue(chain([{ email: 'state.admin@example.com' }])) };
    const ulbModel = {
      distinct: jest.fn().mockResolvedValue([adcUlbId]),
      find: jest.fn().mockReturnValue(chain([{ _id: stateUlbId, name: 'State ULB', code: 'AS001' }])),
    };
    const stateModel = { find: jest.fn().mockReturnValue(chain([{ _id: stateId, name: 'Assam' }])) };
    const emailTemplates = { findBySlug: jest.fn().mockResolvedValue({ subject: 'Pending', body: '{{table}}' }) };
    const emailQueue = { addEmailJob: jest.fn().mockResolvedValue(undefined) };
    const pdfService = { generatePdf: jest.fn().mockResolvedValue(Buffer.from('pdf')) };
    const config = { get: jest.fn().mockReturnValue('https://cityfinance.in') };

    const service = new StateReviewDigestService(
      annualAccountModel as any,
      bankAccountModel as any,
      userModel as any,
      ulbModel as any,
      stateModel as any,
      {} as any,
      emailTemplates as any,
      emailQueue as any,
      pdfService as any,
      config as any,
    );
    return { service, annualAccountModel, bankAccountModel, userModel, ulbModel, emailQueue };
  }

  it('leaves ADC-owned ULBs out of both due-form queries, so the State is not nagged about them', async () => {
    const { service, annualAccountModel, bankAccountModel, ulbModel } = buildService();

    await service.sendDueDigests();

    expect(ulbModel.distinct).toHaveBeenCalledWith('_id', { adc: { $ne: null } });
    expect(annualAccountModel.find.mock.calls[0][0].ulb).toEqual({ $nin: [adcUlbId] });
    expect(bankAccountModel.find.mock.calls[0][0].ulb).toEqual({ $nin: [adcUlbId] });
  });

  it('emails only State DMA users — ADC users are never recipients', async () => {
    const { service, userModel, emailQueue } = buildService({
      dueAnnualAccounts: [
        { _id: 'aa1', sectionType: 'audited', state: stateId, ulb: stateUlbId, declaredAt },
      ].map((doc) => ({
        ...doc,
        state: { toString: () => stateId },
        ulb: { toString: () => stateUlbId },
      })),
    });

    await service.sendDueDigests();

    expect(userModel.find).toHaveBeenCalledWith(expect.objectContaining({ role: 'STATE', adc: null }));
    expect(emailQueue.addEmailJob).toHaveBeenCalledWith(expect.objectContaining({ to: ['state.admin@example.com'] }));
  });
});
