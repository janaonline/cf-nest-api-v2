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
