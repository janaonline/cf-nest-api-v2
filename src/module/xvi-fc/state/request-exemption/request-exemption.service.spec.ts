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
import {
  REASON_FIELD_KEY_STATE,
  REASON_FIELD_KEY_ULB,
  XviFcEligibilityExemption,
} from 'src/schemas/xvi-fc/state/xvi-fc-eligibility-exemption.schema';
import { XviFcEligibilityExemptionFormLog } from 'src/schemas/xvi-fc/state/xvi-fc-eligibility-exemption-form-log.schema';
import { XviFcAnnualAccount } from 'src/schemas/xvi-fc/annual-account.schema';
import { XviFcSfcStatus } from 'src/schemas/xvi-fc/state/sfc-status.schema';
import { RequestExemptionService } from './request-exemption.service';
import { SaveRequestExemptionDto } from './dto/save-request-exemption.dto';
import { RequestExemptionFormJsonConfigService } from './services/form-json/request-exemption-form-json.service';

const REASON_OPTIONS_FIXTURE = [
  { id: 23, label: 'Election / duly constituted ULB exemption' },
  { id: 30, label: 'Audited Financial Statement' },
  { id: 31, label: 'Provisional Financial Statement' },
];

const STATE_REASON_OPTIONS_FIXTURE = [{ id: 22, label: 'State Finance Commission extension/compliance' }];

/** `loadReasonOptions` is called once per field key (`REASON_FIELD_KEY_ULB` /
 *  `REASON_FIELD_KEY_STATE`) in every method that reads it — a plain `mockResolvedValue` can't
 *  distinguish which key was asked for, so the default mock branches on the (real) 2nd argument.
 *  Individual tests override one branch via `mockImplementation` when they need to. */
function defaultLoadReasonOptionsImpl(
  ulbOptions: typeof REASON_OPTIONS_FIXTURE = REASON_OPTIONS_FIXTURE,
  stateOptions: typeof STATE_REASON_OPTIONS_FIXTURE = STATE_REASON_OPTIONS_FIXTURE,
) {
  return (_yearId: string, fieldKey: string) =>
    Promise.resolve(fieldKey === REASON_FIELD_KEY_STATE ? stateOptions : ulbOptions);
}

const REQUEST_EXEMPTION_FIELDS_FIXTURE = [
  { fieldTypes: ['RE_MAIN_FORM_FIELDS'], formFieldType: 'autocomplete', key: 'ulb', label: 'ULB' },
  {
    fieldTypes: ['RE_MAIN_FORM_FIELDS'],
    formFieldType: 'select',
    key: 'reasonForExemption',
    label: 'Reason for Exemption',
    options: REASON_OPTIONS_FIXTURE.map((o) => ({ id: String(o.id), label: o.label })),
  },
  {
    fieldTypes: ['RE_MAIN_FORM_FIELDS'],
    formFieldType: 'textarea',
    key: 'supportingDetails',
    label: 'Supporting Details',
  },
  { fieldTypes: ['RE_MAIN_FORM_FIELDS'], formFieldType: 'file', key: 'supportingFile', label: 'Supporting Document' },
];

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
  exemptionFor: 'ULB' as const,
  ulb: ulbOid.toString(),
  reasonForExemption: [23, 30],
  supportingDetails: 'The ULB has no elected body yet.',
};

const validStateData = {
  exemptionFor: 'STATE' as const,
  reasonForExemptionState: [22],
  supportingDetails: 'The state needs more time for its SFC award period.',
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
  let sfcStatusModel: { findOne: jest.Mock };
  let fileInfoNormalizer: { normalizeInboundFileInfo: jest.Mock };
  let formJsonConfig: { loadFields: jest.Mock; loadReasonOptions: jest.Mock };
  let connection: { startSession: jest.Mock };
  let session: ReturnType<typeof makeSession>;

  beforeEach(async () => {
    session = makeSession();
    model = {
      findOne: jest.fn().mockReturnValue(q(null)),
      findOneAndUpdate: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue({}) }),
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
    // No document by default - no existing SFC Status document means formId 22 is eligible
    // (no-document = NOT_STARTED-equivalent). Individual tests override this to exercise
    // assertTargetStateFormsEligible's blocking path.
    sfcStatusModel = {
      findOne: jest.fn().mockReturnValue(q(null)),
    };
    fileInfoNormalizer = {
      normalizeInboundFileInfo: jest.fn().mockReturnValue({ file: null, errors: [] }),
    };
    formJsonConfig = {
      loadFields: jest.fn().mockResolvedValue(REQUEST_EXEMPTION_FIELDS_FIXTURE),
      loadReasonOptions: jest.fn().mockImplementation(defaultLoadReasonOptionsImpl()),
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
        { provide: getModelToken(XviFcSfcStatus.name), useValue: sfcStatusModel },
        { provide: getConnectionToken(), useValue: connection },
        { provide: FileInfoNormalizerService, useValue: fileInfoNormalizer },
        { provide: RequestExemptionFormJsonConfigService, useValue: formJsonConfig },
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

  describe('getReasonOptions', () => {
    it("returns the union of this year's ULB and whole-state reason options for a state user with access", async () => {
      const result = await service.getReasonOptions(stateOid.toString(), yearOid.toString(), stateReviewer);
      expect(result.data).toEqual([...REASON_OPTIONS_FIXTURE, ...STATE_REASON_OPTIONS_FIXTURE]);
    });

    it('rejects a state user requesting a different state', async () => {
      await expect(service.getReasonOptions(stateOid.toString(), yearOid.toString(), otherStateUser)).rejects.toThrow(
        ForbiddenException,
      );
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

    it('validates reasonForExemption against whatever loadReasonOptions returns for the year, not a fixed set', async () => {
      // This year's formjson no longer offers formId 23 - a formerly-valid id must now be rejected.
      formJsonConfig.loadReasonOptions.mockImplementation(
        defaultLoadReasonOptionsImpl([
          { id: 30, label: 'Audited Financial Statement' },
          { id: 31, label: 'Provisional Financial Statement' },
        ]),
      );

      await expect(
        service.finalSubmit(
          makeDto({ data: { ...validData, reasonForExemption: [23] } }),
          stateReviewer,
          '127.0.0.1',
          'jest',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts a brand-new reason formId once this year’s formjson offers it', async () => {
      formJsonConfig.loadReasonOptions.mockImplementation(
        defaultLoadReasonOptionsImpl([...REASON_OPTIONS_FIXTURE, { id: 99, label: 'A brand new next-year reason' }]),
      );
      model.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

      await expect(
        service.finalSubmit(
          makeDto({ data: { ...validData, reasonForExemption: [99] } }),
          stateReviewer,
          '127.0.0.1',
          'jest',
        ),
      ).resolves.toBeDefined();
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
      const existingUpdatedAt = new Date('2026-01-15T00:00:00.000Z');
      model.findOne.mockReturnValue(
        q({
          _id: requestOid,
          state: stateOid,
          year: yearOid,
          ulb: ulbOid,
          data: [existingEntry],
          updatedAt: existingUpdatedAt,
        }),
      );

      const result = await service.finalSubmit(
        makeDto({ data: { ...validData, reasonForExemption: [23] } }),
        stateReviewer,
        '127.0.0.1',
        'jest',
      );

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: requestOid, updatedAt: existingUpdatedAt },
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
            updatedBy: expect.any(Types.ObjectId) as Types.ObjectId,
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
      const existingUpdatedAt = new Date('2026-01-15T00:00:00.000Z');
      model.findOne.mockReturnValue(
        q({
          _id: requestOid,
          state: stateOid,
          year: yearOid,
          ulb: ulbOid,
          data: [existingEntry],
          updatedAt: existingUpdatedAt,
        }),
      );

      await service.finalSubmit(
        makeDto({ data: { ...validData, reasonForExemption: [30] } }),
        stateReviewer,
        '127.0.0.1',
        'jest',
      );

      expect(model.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: requestOid, updatedAt: existingUpdatedAt },
        {
          $set: {
            data: [
              existingEntry,
              expect.objectContaining({ formId: 30, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }),
            ],
            updatedBy: expect.any(Types.ObjectId) as Types.ObjectId,
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

    it('defaults exemptionFor to ULB when the field is absent entirely (rollout-sequencing default)', async () => {
      model.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);
      const { exemptionFor: _omit, ...dataWithoutExemptionFor } = validData;

      await service.finalSubmit(makeDto({ data: dataWithoutExemptionFor }), stateReviewer, '127.0.0.1', 'jest');

      expect(model.create).toHaveBeenCalledWith(
        [expect.objectContaining({ ulb: ulbOid })],
        { session },
      );
    });

    describe('whole-state branch (exemptionFor: STATE)', () => {
      it('requires reasonForExemptionState, not reasonForExemption', async () => {
        const { reasonForExemptionState: _omit, ...missingReason } = validStateData;
        await expect(
          service.finalSubmit(makeDto({ data: missingReason }), stateReviewer, '127.0.0.1', 'jest'),
        ).rejects.toThrow(BadRequestException);
      });

      it('succeeds with valid whole-state data', async () => {
        model.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);
        await expect(
          service.finalSubmit(makeDto({ data: validStateData }), stateReviewer, '127.0.0.1', 'jest'),
        ).resolves.toBeDefined();
      });

      it('rejects a ULB-only formId (e.g. 23) submitted under reasonForExemptionState', async () => {
        await expect(
          service.finalSubmit(
            makeDto({ data: { ...validStateData, reasonForExemptionState: [23] } }),
            stateReviewer,
            '127.0.0.1',
            'jest',
          ),
        ).rejects.toThrow(BadRequestException);
      });

      it('ignores any client-sent ulb and creates a document with ulb: null', async () => {
        model.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

        await service.finalSubmit(
          makeDto({ data: { ...validStateData, ulb: ulbOid.toString() } }),
          stateReviewer,
          '127.0.0.1',
          'jest',
        );

        expect(model.findOne).toHaveBeenCalledWith(
          { state: stateOid, year: yearOid, ulb: null },
          { state: 1, year: 1, ulb: 1, data: 1, updatedAt: 1 },
        );
        expect(model.create).toHaveBeenCalledWith(
          [expect.objectContaining({ state: stateOid, year: yearOid, ulb: null })],
          { session },
        );
      });

      it('merges a second whole-state reason into the same document rather than creating a duplicate', async () => {
        const requestOid = new Types.ObjectId();
        const existingEntry = entry({ formId: 22 });
        const existingUpdatedAt = new Date('2026-01-15T00:00:00.000Z');
        model.findOne.mockReturnValue(
          q({
            _id: requestOid,
            state: stateOid,
            year: yearOid,
            ulb: null,
            data: [existingEntry],
            updatedAt: existingUpdatedAt,
          }),
        );
        formJsonConfig.loadReasonOptions.mockImplementation(
          defaultLoadReasonOptionsImpl(REASON_OPTIONS_FIXTURE, [
            ...STATE_REASON_OPTIONS_FIXTURE,
            { id: 40, label: 'A second whole-state reason' },
          ]),
        );

        await service.finalSubmit(
          makeDto({ data: { ...validStateData, reasonForExemptionState: [40] } }),
          stateReviewer,
          '127.0.0.1',
          'jest',
        );

        expect(model.findOneAndUpdate).toHaveBeenCalledWith(
          { _id: requestOid, updatedAt: existingUpdatedAt },
          {
            $set: {
              data: [existingEntry, expect.objectContaining({ formId: 40 })],
              updatedBy: expect.any(Types.ObjectId) as Types.ObjectId,
            },
          },
          { session },
        );
        expect(model.create).not.toHaveBeenCalled();
      });

      it('blocks resubmitting a whole-state formId still under MoHUA review, with a state-worded message', async () => {
        const requestOid = new Types.ObjectId();
        model.findOne.mockReturnValue(
          q({
            _id: requestOid,
            state: stateOid,
            year: yearOid,
            ulb: null,
            data: [entry({ formId: 22, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA })],
          }),
        );

        await expect(
          service.finalSubmit(makeDto({ data: validStateData }), stateReviewer, '127.0.0.1', 'jest'),
        ).rejects.toThrow(/^This state already has a request for/);
      });

      it('allows resubmitting a whole-state formId that was previously rejected', async () => {
        const requestOid = new Types.ObjectId();
        model.findOne.mockReturnValue(
          q({
            _id: requestOid,
            state: stateOid,
            year: yearOid,
            ulb: null,
            data: [entry({ formId: 22, currentFormStatus: FORM_STATUS.RETURNED_BY_MOHUA })],
          }),
        );

        await service.finalSubmit(makeDto({ data: validStateData }), stateReviewer, '127.0.0.1', 'jest');

        expect(model.findOneAndUpdate).toHaveBeenCalled();
      });

      it('never checks Annual Accounts eligibility for the whole-state branch', async () => {
        model.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

        await service.finalSubmit(makeDto({ data: validStateData }), stateReviewer, '127.0.0.1', 'jest');

        expect(annualAccountModel.find).not.toHaveBeenCalled();
      });

      describe('target state form eligibility (formId 22 / SFC Status)', () => {
        it('allows filing when no SFC Status document exists yet (NOT_STARTED-equivalent)', async () => {
          model.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

          await service.finalSubmit(makeDto({ data: validStateData }), stateReviewer, '127.0.0.1', 'jest');

          expect(sfcStatusModel.findOne).toHaveBeenCalledWith(
            { state: stateOid, year: yearOid, formType: 'SFC_STATUS', isDeleted: false },
            { currentFormStatus: 1 },
          );
          expect(model.create).toHaveBeenCalled();
        });

        it.each([FORM_STATUS.NOT_STARTED, FORM_STATUS.IN_PROGRESS, FORM_STATUS.RETURNED_BY_MOHUA])(
          'allows filing when SFC Status is in an editable status (%i)',
          async (statusId) => {
            sfcStatusModel.findOne.mockReturnValue(q({ currentFormStatus: statusId }));
            model.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

            await expect(
              service.finalSubmit(makeDto({ data: validStateData }), stateReviewer, '127.0.0.1', 'jest'),
            ).resolves.toBeDefined();
          },
        );

        it.each([
          FORM_STATUS.UNDER_REVIEW_BY_STATE,
          FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
          FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
        ])('blocks filing when SFC Status already has real progress (%i)', async (statusId) => {
          sfcStatusModel.findOne.mockReturnValue(q({ currentFormStatus: statusId }));

          await expect(
            service.finalSubmit(makeDto({ data: validStateData }), stateReviewer, '127.0.0.1', 'jest'),
          ).rejects.toThrow(/This state already has real progress on/);
          expect(model.create).not.toHaveBeenCalled();
        });

        it('does not check SFC Status eligibility for a whole-state reason with no real target form mapped', async () => {
          formJsonConfig.loadReasonOptions.mockImplementation(
            defaultLoadReasonOptionsImpl(REASON_OPTIONS_FIXTURE, [
              ...STATE_REASON_OPTIONS_FIXTURE,
              { id: 40, label: 'A second whole-state reason with no real target form' },
            ]),
          );
          model.create.mockResolvedValue([{ _id: new Types.ObjectId() }]);

          await service.finalSubmit(
            makeDto({ data: { ...validStateData, reasonForExemptionState: [40] } }),
            stateReviewer,
            '127.0.0.1',
            'jest',
          );

          expect(sfcStatusModel.findOne).not.toHaveBeenCalled();
        });
      });
    });

    it('blocks with ConflictException when the document changed since it was read (race with another writer)', async () => {
      const requestOid = new Types.ObjectId();
      model.findOne.mockReturnValue(
        q({
          _id: requestOid,
          state: stateOid,
          year: yearOid,
          ulb: ulbOid,
          data: [entry({ formId: 30 })],
          updatedAt: new Date('2026-01-15T00:00:00.000Z'),
        }),
      );
      model.findOneAndUpdate.mockReturnValue({ exec: jest.fn().mockResolvedValue(null) });

      await expect(
        service.finalSubmit(
          makeDto({ data: { ...validData, reasonForExemption: [23] } }),
          stateReviewer,
          '127.0.0.1',
          'jest',
        ),
      ).rejects.toThrow(ConflictException);
      expect(formLogModel.insertMany).not.toHaveBeenCalled();
      expect(session.abortTransaction).toHaveBeenCalled();
      expect(session.commitTransaction).not.toHaveBeenCalled();
    });

    it('blocks with ConflictException, not a raw error, when two first-time submissions for the same ULB race on create', async () => {
      model.create.mockRejectedValue(Object.assign(new Error('E11000 duplicate key'), { code: 11000 }));

      await expect(service.finalSubmit(makeDto(), stateReviewer, '127.0.0.1', 'jest')).rejects.toThrow(
        ConflictException,
      );
      expect(session.abortTransaction).toHaveBeenCalled();
      expect(session.commitTransaction).not.toHaveBeenCalled();
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
          ulb: { _id: ulbOid.toString(), name: 'Agra', censusCode: null },
          reasonForExemptionLabel: 'Election / duly constituted ULB exemption',
          currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        }),
      ]);
      expect(result.data?.total).toBe(1);
      expect(result.data?.canCreate).toBe(true);
    });

    it('labels each row from loadReasonOptions for the year, not a fixed map', async () => {
      const requestOid = new Types.ObjectId();
      model.find.mockReturnValue(
        findChain([{ _id: requestOid, ulb: ulbOid, data: [entry({ formId: 99 })], createdAt: new Date() }]),
      );
      ulbModel.find.mockReturnValue(q([{ _id: ulbOid, name: 'Agra' }]));
      formJsonConfig.loadReasonOptions.mockImplementation(
        defaultLoadReasonOptionsImpl([{ id: 99, label: 'A brand new next-year reason' }]),
      );

      const result = await service.list(stateOid.toString(), yearOid.toString(), { page: 1, limit: 10 }, stateReviewer);

      expect(result.data?.items[0]?.reasonForExemptionLabel).toBe('A brand new next-year reason');
    });

    it('falls back to a generic "Reason #<id>" label when a row\'s formId is no longer offered this year', async () => {
      const requestOid = new Types.ObjectId();
      model.find.mockReturnValue(
        findChain([{ _id: requestOid, ulb: ulbOid, data: [entry({ formId: 23 })], createdAt: new Date() }]),
      );
      ulbModel.find.mockReturnValue(q([{ _id: ulbOid, name: 'Agra' }]));
      formJsonConfig.loadReasonOptions.mockImplementation(
        defaultLoadReasonOptionsImpl([{ id: 30, label: 'Audited Financial Statement' }]),
      );

      const result = await service.list(stateOid.toString(), yearOid.toString(), { page: 1, limit: 10 }, stateReviewer);

      expect(result.data?.items[0]?.reasonForExemptionLabel).toBe('Reason #23');
    });

    it('resolves censusCode, falling back to sbCode when censusCode is not set', async () => {
      const requestOid = new Types.ObjectId();
      model.find.mockReturnValue(
        findChain([{ _id: requestOid, ulb: ulbOid, data: [entry({ formId: 23 })], createdAt: new Date() }]),
      );
      ulbModel.find.mockReturnValue(q([{ _id: ulbOid, name: 'Agra', censusCode: null, sbCode: 'SB-1' }]));

      const result = await service.list(stateOid.toString(), yearOid.toString(), { page: 1, limit: 10 }, stateReviewer);

      expect(result.data?.items[0]?.ulb).toEqual({ _id: ulbOid.toString(), name: 'Agra', censusCode: 'SB-1' });
    });

    it('prefers censusCode over sbCode when both are set', async () => {
      const requestOid = new Types.ObjectId();
      model.find.mockReturnValue(
        findChain([{ _id: requestOid, ulb: ulbOid, data: [entry({ formId: 23 })], createdAt: new Date() }]),
      );
      ulbModel.find.mockReturnValue(q([{ _id: ulbOid, name: 'Agra', censusCode: 'CC-1', sbCode: 'SB-1' }]));

      const result = await service.list(stateOid.toString(), yearOid.toString(), { page: 1, limit: 10 }, stateReviewer);

      expect(result.data?.items[0]?.ulb).toEqual({ _id: ulbOid.toString(), name: 'Agra', censusCode: 'CC-1' });
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

    describe('filters', () => {
      const twoUlbDoc = (overrides: Record<string, unknown> = {}) => ({
        _id: new Types.ObjectId(),
        ulb: ulbOid,
        data: [
          entry({ formId: 23, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }),
          entry({ formId: 30, currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA }),
        ],
        createdAt: new Date(),
        ...overrides,
      });

      beforeEach(() => {
        model.find.mockReturnValue(findChain([twoUlbDoc()]));
        ulbModel.find.mockReturnValue(q([{ _id: ulbOid, name: 'Agra', censusCode: 'CC-9', sbCode: null }]));
      });

      it('filters by reasonForExemption', async () => {
        const result = await service.list(
          stateOid.toString(),
          yearOid.toString(),
          { page: 1, limit: 10, reasonForExemption: 30 },
          stateReviewer,
        );

        expect(result.data?.items.map((i) => i.formId)).toEqual([30]);
        expect(result.data?.total).toBe(1);
      });

      it('filters by status', async () => {
        const result = await service.list(
          stateOid.toString(),
          yearOid.toString(),
          { page: 1, limit: 10, status: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA },
          stateReviewer,
        );

        expect(result.data?.items.map((i) => i.formId)).toEqual([30]);
        expect(result.data?.total).toBe(1);
      });

      it('searches case-insensitively by ULB name', async () => {
        const result = await service.list(
          stateOid.toString(),
          yearOid.toString(),
          { page: 1, limit: 10, search: 'agr' },
          stateReviewer,
        );

        expect(result.data?.total).toBe(2);
      });

      it('searches by the resolved censusCode (sbCode fallback included)', async () => {
        const result = await service.list(
          stateOid.toString(),
          yearOid.toString(),
          { page: 1, limit: 10, search: 'CC-9' },
          stateReviewer,
        );

        expect(result.data?.total).toBe(2);
      });

      it('returns nothing when the search matches neither name nor censusCode', async () => {
        const result = await service.list(
          stateOid.toString(),
          yearOid.toString(),
          { page: 1, limit: 10, search: 'no-such-ulb' },
          stateReviewer,
        );

        expect(result.data?.items).toEqual([]);
        expect(result.data?.total).toBe(0);
      });

      it('combines reasonForExemption, status, and search with AND semantics', async () => {
        const result = await service.list(
          stateOid.toString(),
          yearOid.toString(),
          {
            page: 1,
            limit: 10,
            reasonForExemption: 23,
            status: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
            search: 'agra',
          },
          stateReviewer,
        );

        // formId 23 is UNDER_REVIEW_BY_MOHUA in the fixture, not SUBMISSION_ACKNOWLEDGED_BY_MOHUA - no row satisfies all three.
        expect(result.data?.items).toEqual([]);
        expect(result.data?.total).toBe(0);
      });
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
