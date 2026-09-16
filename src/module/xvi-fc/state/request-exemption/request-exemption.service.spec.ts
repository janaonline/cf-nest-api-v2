import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { FileInfoNormalizerService } from 'src/module/xvi-fc/common/services/file-info-normalizer.service';
import { State } from 'src/schemas/state.schema';
import { Ulb } from 'src/schemas/ulb.schema';
import { XviFcEligibilityExemption } from 'src/schemas/xvi-fc/state/xvi-fc-eligibility-exemption.schema';
import { XviFcEligibilityExemptionFormLog } from 'src/schemas/xvi-fc/state/xvi-fc-eligibility-exemption-form-log.schema';
import { XviFcAnnualAccount } from 'src/schemas/xvi-fc/annual-account.schema';
import { RequestExemptionService } from './request-exemption.service';
import { SaveRequestExemptionDto } from './dto/save-request-exemption.dto';

function q<T>(value: T) {
  return {
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

/** Chainable mock for `.find(...).sort(...).lean().exec()` (the `list` query) - no skip/limit at
 *  the Mongo level, since pagination happens after flattening, in memory. */
function findChain<T>(value: T) {
  return {
    sort: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(value),
  };
}

function makeSession() {
  return {
    startTransaction: jest.fn(),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    abortTransaction: jest.fn().mockResolvedValue(undefined),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
}

const stateOid = new Types.ObjectId();
const yearOid = new Types.ObjectId();
const ulbOid = new Types.ObjectId();

const stateReviewer: AuthUser = {
  _id: new Types.ObjectId().toString(),
  role: 'state-reviewer',
  scope: Scope.STATE,
  state: stateOid,
  xviFcSubrole: 'reviewer',
} as unknown as AuthUser;

const otherStateUser: AuthUser = {
  _id: new Types.ObjectId().toString(),
  role: 'state-reviewer',
  scope: Scope.STATE,
  state: new Types.ObjectId(),
  xviFcSubrole: 'reviewer',
} as unknown as AuthUser;

const adminUser: AuthUser = {
  _id: new Types.ObjectId().toString(),
  role: UserRole.ADMIN,
  scope: Scope.ADMIN,
} as unknown as AuthUser;

const validData = {
  ulb: ulbOid.toString(),
  reasonForExemption: [23, 30],
  supportingDetails: 'The ULB has no elected body yet.',
};

/** A plain `data[]` entry fixture, matching what `.lean()` would return. */
function entry(overrides: Record<string, unknown> = {}) {
  return {
    formId: 23,
    currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
    supportingDetails: 'Existing details',
    supportingFile: null,
    submittedBy: new Types.ObjectId(),
    submittedAt: new Date('2026-01-01T00:00:00.000Z'),
    decidedBy: null,
    decidedAt: null,
    mohuaRemarks: null,
    ...overrides,
  };
}

describe('RequestExemptionService', () => {
  let service: RequestExemptionService;
  let model: { findOne: jest.Mock; findOneAndUpdate: jest.Mock; create: jest.Mock; find: jest.Mock };
  let formLogModel: { insertMany: jest.Mock };
  let stateModel: { findById: jest.Mock };
  let ulbModel: { find: jest.Mock };
  let annualAccountModel: { find: jest.Mock };
  let fileInfoNormalizer: { normalizeInboundFileInfo: jest.Mock };
  let connection: { startSession: jest.Mock };
  let session: ReturnType<typeof makeSession>;

  beforeEach(async () => {
    session = makeSession();
    model = {
      findOne: jest.fn().mockReturnValue(q(null)),
      findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue(undefined) }),
      create: jest.fn(),
      find: jest.fn().mockReturnValue(findChain([])),
    };
    formLogModel = {
      insertMany: jest.fn().mockResolvedValue([]),
    };
    stateModel = {
      findById: jest.fn().mockReturnValue(q({ name: 'Test State' })),
    };
    ulbModel = {
      find: jest.fn().mockReturnValue(q([])),
    };
    // Empty by default - no existing Annual Accounts section documents means every formId 30/31
    // reason is eligible (no-document = NOT_STARTED-equivalent). Individual tests override this to
    // exercise assertTargetFormsEligible's blocking path.
    annualAccountModel = {
      find: jest.fn().mockReturnValue(findChain([])),
    };
    fileInfoNormalizer = {
      normalizeInboundFileInfo: jest.fn().mockReturnValue({ file: null, errors: [] }),
    };
    connection = {
      startSession: jest.fn().mockResolvedValue(session),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestExemptionService,
        { provide: getModelToken(XviFcEligibilityExemption.name), useValue: model },
        { provide: getModelToken(XviFcEligibilityExemptionFormLog.name), useValue: formLogModel },
        { provide: getModelToken(State.name), useValue: stateModel },
        { provide: getModelToken(Ulb.name), useValue: ulbModel },
        { provide: getModelToken(XviFcAnnualAccount.name), useValue: annualAccountModel },
        { provide: getConnectionToken(), useValue: connection },
        { provide: FileInfoNormalizerService, useValue: fileInfoNormalizer },
      ],
    }).compile();

    service = module.get(RequestExemptionService);
  });

  const makeDto = (overrides: Partial<SaveRequestExemptionDto> = {}): SaveRequestExemptionDto =>
    ({
      stateId: stateOid.toString(),
      yearId: yearOid.toString(),
      data: validData,
      ...overrides,
    }) as SaveRequestExemptionDto;

  describe('getForm', () => {
    it('returns the field config, permissions, and resolved stateName for a state user with access', async () => {
      const result = await service.getForm(stateOid.toString(), yearOid.toString(), stateReviewer);

      expect(result.data?.fields.length).toBeGreaterThan(0);
      expect(result.data?.permissions).toEqual({ canView: true, canEdit: true, canFinalSubmit: true });
      expect(result.data?.stateName).toBe('Test State');
    });

    it('rejects a state user requesting a different state', async () => {
      await expect(service.getForm(stateOid.toString(), yearOid.toString(), otherStateUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('allows ADMIN regardless of state', async () => {
      const result = await service.getForm(stateOid.toString(), yearOid.toString(), adminUser);
      expect(result.data?.permissions.canEdit).toBe(true);
    });
  });

  describe('finalSubmit', () => {
    it('requires ulb, reasonForExemption, and supportingDetails', async () => {
      await expect(service.finalSubmit(makeDto({ data: {} }), stateReviewer, '127.0.0.1', 'jest')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects an invalid reasonForExemption id', async () => {
      await expect(
        service.finalSubmit(
          makeDto({ data: { ...validData, reasonForExemption: [22] } }),
          stateReviewer,
          '127.0.0.1',
          'jest',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects SFC (formId 22) specifically, alongside any other id outside {23,30,31}', async () => {
      await expect(
        service.finalSubmit(
          makeDto({ data: { ...validData, reasonForExemption: [22, 23] } }),
          stateReviewer,
          '127.0.0.1',
          'jest',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('enforces supportingDetails length bounds', async () => {
      await expect(
        service.finalSubmit(
          makeDto({ data: { ...validData, supportingDetails: 'no' } }),
          stateReviewer,
          '127.0.0.1',
          'jest',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows final-submit without a supportingFile (it stays optional even at final-submit)', async () => {
      model.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

      await expect(service.finalSubmit(makeDto(), stateReviewer, '127.0.0.1', 'jest')).resolves.toBeDefined();
    });

    it('creates a new document with one data[] entry per formId when the ULB has no prior request this year', async () => {
      model.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

      const result = await service.finalSubmit(makeDto(), stateReviewer, '127.0.0.1', 'jest');

      expect(model.create).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            state: stateOid,
            year: yearOid,
            ulb: ulbOid,
            data: [
              expect.objectContaining({ formId: 23, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }),
              expect.objectContaining({ formId: 30, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }),
            ],
          }),
        ],
        { session },
      );
      expect(formLogModel.insertMany).toHaveBeenCalledWith(
        [
          expect.objectContaining({ formId: 23, action: 'SUBMITTED', actorStage: 'STATE' }),
          expect.objectContaining({ formId: 30, action: 'SUBMITTED', actorStage: 'STATE' }),
        ],
        { session },
      );
      expect(session.commitTransaction).toHaveBeenCalled();
      expect(result.data?.currentFormStatus).toBe(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
    });

    it('wholesale-replaces a RETURNED_BY_MOHUA entry in place when the same formId is resubmitted, clearing decision fields', async () => {
      const requestOid = new Types.ObjectId();
      const existingEntry = entry({
        formId: 23,
        currentFormStatus: FORM_STATUS.RETURNED_BY_MOHUA,
        decidedBy: new Types.ObjectId(),
        decidedAt: new Date('2026-02-01T00:00:00.000Z'),
        mohuaRemarks: 'Please attach the election notice.',
      });
      model.findOne.mockReturnValue(
        q({ _id: requestOid, state: stateOid, year: yearOid, ulb: ulbOid, data: [existingEntry] }),
      );

      const result = await service.finalSubmit(
        makeDto({ data: { ...validData, reasonForExemption: [23] } }),
        stateReviewer,
        '127.0.0.1',
        'jest',
      );

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: requestOid },
        {
          $set: {
            data: [
              expect.objectContaining({
                formId: 23,
                currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
                decidedBy: null,
                decidedAt: null,
                mohuaRemarks: null,
              }),
            ],
            updatedBy: expect.any(Types.ObjectId),
          },
        },
        { session },
      );
      expect(model.create).not.toHaveBeenCalled();
      expect(result.data?.currentFormStatus).toBe(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
    });

    it('allows a second, non-overlapping formId onto the same ULB+year document, preserving the existing entry untouched', async () => {
      const requestOid = new Types.ObjectId();
      const existingEntry = entry({ formId: 23 });
      model.findOne.mockReturnValue(
        q({ _id: requestOid, state: stateOid, year: yearOid, ulb: ulbOid, data: [existingEntry] }),
      );

      await service.finalSubmit(
        makeDto({ data: { ...validData, reasonForExemption: [30] } }),
        stateReviewer,
        '127.0.0.1',
        'jest',
      );

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: requestOid },
        {
          $set: {
            data: [
              existingEntry,
              expect.objectContaining({ formId: 30, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }),
            ],
            updatedBy: expect.any(Types.ObjectId),
          },
        },
        { session },
      );
    });

    it('blocks resubmitting a formId that already has an entry still under MoHUA review', async () => {
      const requestOid = new Types.ObjectId();
      model.findOne.mockReturnValue(
        q({
          _id: requestOid,
          state: stateOid,
          year: yearOid,
          ulb: ulbOid,
          data: [entry({ formId: 23, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA })],
        }),
      );

      await expect(
        service.finalSubmit(
          makeDto({ data: { ...validData, reasonForExemption: [23] } }),
          stateReviewer,
          '127.0.0.1',
          'jest',
        ),
      ).rejects.toThrow(ConflictException);
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
      expect(model.create).not.toHaveBeenCalled();
    });

    it('blocks resubmitting a formId that has already been approved', async () => {
      const requestOid = new Types.ObjectId();
      model.findOne.mockReturnValue(
        q({
          _id: requestOid,
          state: stateOid,
          year: yearOid,
          ulb: ulbOid,
          data: [entry({ formId: 23, currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA })],
        }),
      );

      await expect(
        service.finalSubmit(
          makeDto({ data: { ...validData, reasonForExemption: [23] } }),
          stateReviewer,
          '127.0.0.1',
          'jest',
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('blocks (409) filing for a formId whose target Annual Accounts section already has real progress', async () => {
      annualAccountModel.find.mockReturnValue(
        findChain([{ sectionType: 'audited', form_status_id: FORM_STATUS.UNDER_REVIEW_BY_STATE }]),
      );

      await expect(
        service.finalSubmit(
          makeDto({ data: { ...validData, reasonForExemption: [30] } }),
          stateReviewer,
          '127.0.0.1',
          'jest',
        ),
      ).rejects.toThrow(ConflictException);
      expect(model.findOneAndUpdate).not.toHaveBeenCalled();
      expect(model.create).not.toHaveBeenCalled();
    });

    it('allows filing for formId 30/31 when the target section has no document yet (NOT_STARTED-equivalent)', async () => {
      annualAccountModel.find.mockReturnValue(findChain([]));
      model.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

      await service.finalSubmit(
        makeDto({ data: { ...validData, reasonForExemption: [30] } }),
        stateReviewer,
        '127.0.0.1',
        'jest',
      );

      expect(model.create).toHaveBeenCalled();
    });

    it('allows filing for formId 30/31 when the target section is still ULB-editable (e.g. IN_PROGRESS)', async () => {
      annualAccountModel.find.mockReturnValue(
        findChain([{ sectionType: 'audited', form_status_id: FORM_STATUS.IN_PROGRESS }]),
      );
      model.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

      await service.finalSubmit(
        makeDto({ data: { ...validData, reasonForExemption: [30] } }),
        stateReviewer,
        '127.0.0.1',
        'jest',
      );

      expect(model.create).toHaveBeenCalled();
    });

    it('never checks Annual Accounts at all for formId 23 (Elected Body has no per-ULB status)', async () => {
      model.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

      await service.finalSubmit(
        makeDto({ data: { ...validData, reasonForExemption: [23] } }),
        stateReviewer,
        '127.0.0.1',
        'jest',
      );

      expect(annualAccountModel.find).not.toHaveBeenCalled();
    });

    it('rejects a state user submitting a request under another state', async () => {
      await expect(service.finalSubmit(makeDto(), otherStateUser, '127.0.0.1', 'jest')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('aborts the transaction and rethrows if the write fails', async () => {
      model.create.mockRejectedValue(new Error('mongo exploded'));

      await expect(service.finalSubmit(makeDto(), stateReviewer, '127.0.0.1', 'jest')).rejects.toThrow(
        'mongo exploded',
      );
      expect(session.abortTransaction).toHaveBeenCalled();
      expect(session.commitTransaction).not.toHaveBeenCalled();
      expect(session.endSession).toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('flattens each document into one row per data[] entry, with resolved ULB names and status labels', async () => {
      const requestOid = new Types.ObjectId();
      model.find.mockReturnValue(
        findChain([
          {
            _id: requestOid,
            ulb: ulbOid,
            data: [entry({ formId: 23, submittedAt: new Date('2026-09-01T00:00:00.000Z') })],
            createdAt: new Date('2026-09-01T00:00:00.000Z'),
          },
        ]),
      );
      ulbModel.find.mockReturnValue(q([{ _id: ulbOid, name: 'Agra' }]));

      const result = await service.list(stateOid.toString(), yearOid.toString(), { page: 1, limit: 10 }, stateReviewer);

      expect(result.data?.items).toEqual([
        expect.objectContaining({
          _id: `${String(requestOid)}_23`,
          requestId: String(requestOid),
          formId: 23,
          ulb: { _id: ulbOid.toString(), name: 'Agra' },
          reasonForExemptionLabel: 'Election / duly constituted ULB exemption',
          currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        }),
      ]);
      expect(result.data?.total).toBe(1);
      expect(result.data?.canCreate).toBe(true);
    });

    it('flattens multiple entries from one document into separate rows', async () => {
      const requestOid = new Types.ObjectId();
      model.find.mockReturnValue(
        findChain([
          {
            _id: requestOid,
            ulb: ulbOid,
            data: [
              entry({ formId: 23 }),
              entry({ formId: 30, currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA }),
            ],
            createdAt: new Date(),
          },
        ]),
      );
      ulbModel.find.mockReturnValue(q([{ _id: ulbOid, name: 'Agra' }]));

      const result = await service.list(stateOid.toString(), yearOid.toString(), { page: 1, limit: 10 }, stateReviewer);

      expect(result.data?.items).toHaveLength(2);
      expect(result.data?.items.map((item) => item.formId)).toEqual([23, 30]);
      expect(result.data?.total).toBe(2);
    });

    it('paginates flattened rows in memory, not documents', async () => {
      const requestOid = new Types.ObjectId();
      model.find.mockReturnValue(
        findChain([
          {
            _id: requestOid,
            ulb: ulbOid,
            data: [entry({ formId: 23 }), entry({ formId: 30 })],
            createdAt: new Date(),
          },
        ]),
      );
      ulbModel.find.mockReturnValue(q([{ _id: ulbOid, name: 'Agra' }]));

      const result = await service.list(stateOid.toString(), yearOid.toString(), { page: 1, limit: 1 }, stateReviewer);

      expect(result.data?.items).toHaveLength(1);
      expect(result.data?.total).toBe(2);
      expect(result.data?.pages).toBe(2);
    });

    it("rejects a state user listing another state's requests", async () => {
      await expect(
        service.list(stateOid.toString(), yearOid.toString(), { page: 1, limit: 10 }, otherStateUser),
      ).rejects.toThrow(ForbiddenException);
    });

    it('returns an empty page when the state has no requests yet', async () => {
      const result = await service.list(stateOid.toString(), yearOid.toString(), { page: 1, limit: 10 }, stateReviewer);

      expect(result.data?.items).toEqual([]);
      expect(result.data?.total).toBe(0);
      expect(result.data?.pages).toBe(0);
    });
  });
});
