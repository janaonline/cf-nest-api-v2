import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import mongoose, { Types } from 'mongoose';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { EmailQueueService } from 'src/core/queue/email-queue/email-queue.service';
import { FormJsonService } from 'src/master/form-json/form-json.service';
import { DynamicFormValidationService } from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.service';
import { FileInfoNormalizerService } from 'src/module/xvi-fc/common/services/file-info-normalizer.service';
import type { IAuthUser } from 'src/common/interfaces/auth-user.interface';
import { Role } from 'src/module/auth/enum/role.enum';
import { State } from 'src/schemas/state.schema';
import { Ulb } from 'src/schemas/ulb.schema';
import { User } from 'src/schemas/user/user.schema';
import { ULB_EDIT_SECTIONS_FORM_JSON_TYPE, ULB_REGISTER_SECTIONS_FORM_JSON_TYPE } from './constants/ulb-form.constants';
import { UlbService } from './ulb.service';

/** Mocks `ulbModel.db.collection('ulbtypes').find().sort().toArray()`, used by `findTypes()`. */
function mockUlbTypes(ulbModel: { db?: unknown }, types: { _id: string; name: string }[]): void {
  ulbModel.db = {
    collection: jest.fn().mockReturnValue({
      find: jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue(types) }),
      }),
    }),
  };
}

/** Mocks `stateModel.find().sort().lean()`, used by `findStates()`. */
function mockStates(stateModel: { find: jest.Mock }, states: { _id: string; name: string }[]): void {
  stateModel.find = jest.fn().mockReturnValue({
    sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(states) }),
  });
}

describe('UlbService', () => {
  let service: UlbService;
  let ulbModel: {
    create: jest.Mock;
    find: jest.Mock;
    countDocuments: jest.Mock;
    findById: jest.Mock;
    findByIdAndUpdate: jest.Mock;
    exists: jest.Mock;
    aggregate: jest.Mock;
    db?: unknown;
  };
  let stateModel: { findById: jest.Mock; find: jest.Mock };
  let userModel: { create: jest.Mock; findOne: jest.Mock; find: jest.Mock };
  let formJsonService: { findByType: jest.Mock };
  let dynamicFormValidation: { validateFinalSubmitAndBuildPayload: jest.Mock; validateDraftAndBuildPayload: jest.Mock };
  let emailQueueService: { addEmailJob: jest.Mock };
  let configService: { get: jest.Mock };
  let fileTokenService: { signFileUrl: jest.Mock };
  let fileInfoNormalizer: { normalizeInboundFileInfo: jest.Mock };

  const stateId = new Types.ObjectId().toString();
  const ulbTypeId = new Types.ObjectId().toString();

  const adminUser: IAuthUser = {
    _id: new Types.ObjectId().toString(),
    role: Role.ADMIN,
  };
  const stateUser: IAuthUser = {
    _id: new Types.ObjectId().toString(),
    role: Role.STATE,
    state: stateId,
  };

  beforeEach(async () => {
    ulbModel = {
      create: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      exists: jest.fn(),
      aggregate: jest.fn().mockResolvedValue([]),
    };
    stateModel = { findById: jest.fn(), find: jest.fn() };
    mockStates(stateModel, []);
    userModel = {
      create: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(null),
      }),
      find: jest.fn().mockReturnValue({ exec: jest.fn().mockResolvedValue([]) }),
    };
    formJsonService = { findByType: jest.fn().mockRejectedValue(new NotFoundException()) };
    dynamicFormValidation = {
      validateFinalSubmitAndBuildPayload: jest.fn(),
      validateDraftAndBuildPayload: jest.fn(),
    };
    emailQueueService = { addEmailJob: jest.fn().mockResolvedValue(undefined) };
    configService = { get: jest.fn().mockReturnValue('https://cityfinance.in') };
    fileTokenService = { signFileUrl: jest.fn((url: string) => `signed::${url}`) };
    fileInfoNormalizer = { normalizeInboundFileInfo: jest.fn().mockReturnValue({ file: undefined, errors: [] }) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UlbService,
        { provide: getModelToken(Ulb.name), useValue: ulbModel },
        { provide: getModelToken(State.name), useValue: stateModel },
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: FormJsonService, useValue: formJsonService },
        { provide: DynamicFormValidationService, useValue: dynamicFormValidation },
        { provide: EmailQueueService, useValue: emailQueueService },
        { provide: ConfigService, useValue: configService },
        { provide: FileTokenService, useValue: fileTokenService },
        { provide: FileInfoNormalizerService, useValue: fileInfoNormalizer },
      ],
    }).compile();

    service = module.get<UlbService>(UlbService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('create', () => {
    it('throws BadRequestException when validation fails', async () => {
      dynamicFormValidation.validateFinalSubmitAndBuildPayload.mockReturnValue({
        isValid: false,
        errors: { name: [{ field: 'name', message: 'ULB name is required.' }] },
        sanitizedPayload: {},
      });

      await expect(service.create({ data: {} }, adminUser)).rejects.toThrow(BadRequestException);
      expect(ulbModel.create).not.toHaveBeenCalled();
    });

    it('auto-approves ULBs created by ADMIN', async () => {
      dynamicFormValidation.validateFinalSubmitAndBuildPayload.mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: {
          code: 'AP001',
          name: 'Vizianagaram Municipal Corporation',
          state: stateId,
          ulbType: ulbTypeId,
        },
      });
      const created = { toObject: () => ({ code: 'AP001', name: 'Vizianagaram Municipal Corporation' }) };
      ulbModel.create.mockResolvedValue(created);

      const result = await service.create({ data: {} }, adminUser);

      const [patch] = ulbModel.create.mock.calls[0] as [Record<string, unknown>];
      expect(patch.code).toBe('AP001');
      expect(patch.name).toBe('Vizianagaram Municipal Corporation');
      expect(patch.slug).toBe('vizianagaram-municipal-corporation');
      expect(patch.state).toBeInstanceOf(Types.ObjectId);
      expect(patch.ulbType).toBeInstanceOf(Types.ObjectId);
      const approval = patch.approval as { status: string; reviewedBy: Types.ObjectId };
      expect(approval.status).toBe('APPROVED');
      expect(approval.reviewedBy).toBeInstanceOf(Types.ObjectId);
      expect(result).toEqual({ code: 'AP001', name: 'Vizianagaram Municipal Corporation' });
    });

    it('scopes STATE-submitted ULBs to the requester state and marks them PENDING', async () => {
      const otherStateId = new Types.ObjectId().toString();
      dynamicFormValidation.validateFinalSubmitAndBuildPayload.mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: {
          code: 'AP002',
          name: 'Vizag Municipal Corporation',
          state: otherStateId,
          ulbType: ulbTypeId,
        },
      });
      const created = { toObject: () => ({ code: 'AP002' }) };
      ulbModel.create.mockResolvedValue(created);

      await service.create({ data: {} }, stateUser);

      const [patch] = ulbModel.create.mock.calls[0] as [Record<string, unknown>];
      expect((patch.state as Types.ObjectId).toString()).toBe(stateId);
      const approval = patch.approval as { status: string; submittedBy: Types.ObjectId };
      expect(approval.status).toBe('PENDING');
      expect(approval.submittedBy).toBeInstanceOf(Types.ObjectId);
    });

    it('throws ForbiddenException when a STATE user has no state assigned', async () => {
      dynamicFormValidation.validateFinalSubmitAndBuildPayload.mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: { code: 'AP003', name: 'No State ULB' },
      });

      await expect(service.create({ data: {} }, { ...stateUser, state: undefined })).rejects.toThrow(
        ForbiddenException,
      );
      expect(ulbModel.create).not.toHaveBeenCalled();
    });

    it('auto-generates a ULB code from the state when the submitted data omits one', async () => {
      stateModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue({ code: 'AP' }) });
      ulbModel.aggregate.mockResolvedValueOnce([{ num: 3 }]);
      ulbModel.exists.mockResolvedValue(null);
      dynamicFormValidation.validateFinalSubmitAndBuildPayload.mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: { code: 'AP004', name: 'New ULB', state: stateId, ulbType: ulbTypeId },
      });
      const created = { toObject: () => ({ code: 'AP004' }) };
      ulbModel.create.mockResolvedValue(created);

      await service.create({ data: { name: 'New ULB', state: stateId, ulbType: ulbTypeId } }, stateUser);

      expect(dynamicFormValidation.validateFinalSubmitAndBuildPayload).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ code: 'AP004' }),
      );
    });

    it('scopes the auto-generated code lookup to the same state, matching only that state prefix', async () => {
      stateModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue({ code: 'AP' }) });
      ulbModel.exists.mockResolvedValue(null);
      dynamicFormValidation.validateFinalSubmitAndBuildPayload.mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: { name: 'New ULB', state: stateId, ulbType: ulbTypeId },
      });
      ulbModel.create.mockResolvedValue({ toObject: () => ({ code: 'AP001' }) });

      await service.create({ data: { name: 'New ULB', state: stateId, ulbType: ulbTypeId } }, stateUser);

      const [pipeline] = ulbModel.aggregate.mock.calls[0] as [{ $match?: Record<string, unknown> }[]];
      const match = pipeline[0].$match as { state: Types.ObjectId; code: { $regex: string } };
      expect(match.state.toString()).toBe(stateId);
      expect(match.code.$regex).toBe('^AP\\d{1,6}$');
    });

    it('ignores a legacy Date.now()-fallback code (long numeric suffix) when computing the next code', async () => {
      // Regression test: a prior collision-retry fallback (`${prefix}${Date.now()}`) can leave a
      // code like "AP1784539349047" in the DB. $match must exclude a suffix that long — matching
      // it would overflow $toInt (32-bit) and crash the real aggregation with a MongoServerError.
      stateModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue({ code: 'AP' }) });
      ulbModel.aggregate.mockResolvedValueOnce([]); // simulates Mongo's $match excluding the 13-digit suffix
      ulbModel.exists.mockResolvedValue(null);
      dynamicFormValidation.validateFinalSubmitAndBuildPayload.mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: { name: 'New ULB', state: stateId, ulbType: ulbTypeId },
      });
      ulbModel.create.mockResolvedValue({ toObject: () => ({ code: 'AP001' }) });

      await service.create({ data: { name: 'New ULB', state: stateId, ulbType: ulbTypeId } }, stateUser);

      expect(dynamicFormValidation.validateFinalSubmitAndBuildPayload).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ code: 'AP001' }),
      );
    });

    it('auto-generates the next sbCode when censusCode is omitted', async () => {
      ulbModel.aggregate.mockResolvedValue([{ num: 900098 }]);
      dynamicFormValidation.validateFinalSubmitAndBuildPayload.mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: { code: 'AP014', name: 'No Census ULB', state: stateId, ulbType: ulbTypeId },
      });
      const created = { toObject: () => ({ code: 'AP014' }) };
      ulbModel.create.mockResolvedValue(created);

      await service.create({ data: {} }, stateUser);

      const [patch] = ulbModel.create.mock.calls[0] as [Record<string, unknown>];
      expect(patch.sbCode).toBe('900099');
    });

    it('seeds sbCode at 900001 when no ULB has one yet', async () => {
      dynamicFormValidation.validateFinalSubmitAndBuildPayload.mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: { code: 'AP016', name: 'First Synthetic Code ULB', state: stateId, ulbType: ulbTypeId },
      });
      const created = { toObject: () => ({ code: 'AP016' }) };
      ulbModel.create.mockResolvedValue(created);

      await service.create({ data: {} }, stateUser);

      const [patch] = ulbModel.create.mock.calls[0] as [Record<string, unknown>];
      expect(patch.sbCode).toBe('900001');
    });

    it('does not generate an sbCode when censusCode is submitted', async () => {
      dynamicFormValidation.validateFinalSubmitAndBuildPayload.mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: {
          code: 'AP015',
          name: 'Has Census ULB',
          state: stateId,
          ulbType: ulbTypeId,
          censusCode: '800011',
        },
      });
      const created = { toObject: () => ({ code: 'AP015' }) };
      ulbModel.create.mockResolvedValue(created);

      await service.create({ data: {} }, stateUser);

      expect(ulbModel.aggregate).not.toHaveBeenCalled();
      const [patch] = ulbModel.create.mock.calls[0] as [Record<string, unknown>];
      expect(patch).not.toHaveProperty('sbCode');
    });

    it('does not override a code that was already submitted', async () => {
      dynamicFormValidation.validateFinalSubmitAndBuildPayload.mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: { code: 'AP009', name: 'Existing Code ULB', state: stateId, ulbType: ulbTypeId },
      });
      const created = { toObject: () => ({ code: 'AP009' }) };
      ulbModel.create.mockResolvedValue(created);

      await service.create({ data: { code: 'AP009', name: 'Existing Code ULB', state: stateId } }, stateUser);

      expect(stateModel.findById).not.toHaveBeenCalled();
      expect(dynamicFormValidation.validateFinalSubmitAndBuildPayload).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ code: 'AP009' }),
      );
    });

    it('throws BadRequestException when another ULB already has this name (case-insensitive)', async () => {
      ulbModel.exists.mockResolvedValue({ _id: new Types.ObjectId() });
      dynamicFormValidation.validateFinalSubmitAndBuildPayload.mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: { code: 'AP011', name: 'vizag municipal corporation', state: stateId, ulbType: ulbTypeId },
      });

      await expect(service.create({ data: {} }, adminUser)).rejects.toThrow(BadRequestException);
      expect(ulbModel.create).not.toHaveBeenCalled();
    });

    it('provisions a Role.ULB login for the submitted primary contact and strips those fields from the ULB patch', async () => {
      const ulbId = new Types.ObjectId();
      dynamicFormValidation.validateFinalSubmitAndBuildPayload.mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: {
          code: 'AP010',
          name: 'Contact ULB',
          state: stateId,
          ulbType: ulbTypeId,
          primaryContactName: 'K. Suresh Babu',
          primaryContactDesignation: 'Commissioner',
          primaryContactEmail: 'commissioner@ulb.gov.in',
          primaryContactMobile: '9849001234',
        },
      });
      ulbModel.create.mockResolvedValue({ _id: ulbId, toObject: () => ({ _id: ulbId, code: 'AP010' }) });

      // ADMIN submissions are auto-approved, so the invite email goes out immediately — a STATE
      // (PENDING) submission defers it to approve() instead (see 'creates the primary contact
      // login inactive for a STATE (PENDING) submission' and the 'approve' describe block below).
      await service.create({ data: {} }, adminUser);

      const [patch] = ulbModel.create.mock.calls[0] as [Record<string, unknown>];
      expect(patch).not.toHaveProperty('primaryContactName');
      expect(patch).not.toHaveProperty('primaryContactEmail');
      expect(patch).not.toHaveProperty('primaryContactMobile');
      expect(patch).not.toHaveProperty('primaryContactDesignation');

      expect(userModel.findOne).toHaveBeenCalledWith(
        expect.objectContaining({ $or: [{ email: 'commissioner@ulb.gov.in' }, { mobile: '9849001234' }] }),
      );
      expect(userModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'K. Suresh Babu',
          email: 'commissioner@ulb.gov.in',
          mobile: '9849001234',
          designation: 'Commissioner',
          role: Role.ULB,
          ulb: ulbId,
        }),
      );
      expect(emailQueueService.addEmailJob).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'commissioner@ulb.gov.in', templateName: './ulb-member-invite' }),
      );
    });

    it('copies the auto-generated sbCode onto the primary-contact login and invite email (no censusCode submitted)', async () => {
      const ulbId = new Types.ObjectId();
      ulbModel.aggregate.mockResolvedValueOnce([]); // no prior sbCode -> seeds at 900001
      dynamicFormValidation.validateFinalSubmitAndBuildPayload.mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: {
          code: 'AP017',
          name: 'No Census Contact ULB',
          state: stateId,
          ulbType: ulbTypeId,
          primaryContactName: 'K. Suresh Babu',
          primaryContactEmail: 'sbcode-contact@ulb.gov.in',
          primaryContactMobile: '9849001238',
        },
      });
      ulbModel.create.mockResolvedValue({ _id: ulbId, toObject: () => ({ _id: ulbId, code: 'AP017' }) });

      await service.create({ data: {} }, adminUser);

      expect(userModel.create).toHaveBeenCalledWith(expect.objectContaining({ censusCode: null, sbCode: '900001' }));
      const [emailJob] = emailQueueService.addEmailJob.mock.calls[0] as [{ mailData: Record<string, unknown> }];
      expect(emailJob.mailData).toMatchObject({ loginCode: '900001', loginCodeLabel: 'Login ID' });
    });

    it('copies a submitted censusCode onto the primary-contact login and invite email', async () => {
      const ulbId = new Types.ObjectId();
      dynamicFormValidation.validateFinalSubmitAndBuildPayload.mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: {
          code: 'AP018',
          name: 'Has Census Contact ULB',
          state: stateId,
          ulbType: ulbTypeId,
          censusCode: '800011',
          primaryContactName: 'K. Suresh Babu',
          primaryContactEmail: 'census-contact@ulb.gov.in',
          primaryContactMobile: '9849001239',
        },
      });
      ulbModel.create.mockResolvedValue({ _id: ulbId, toObject: () => ({ _id: ulbId, code: 'AP018' }) });

      await service.create({ data: {} }, adminUser);

      expect(userModel.create).toHaveBeenCalledWith(expect.objectContaining({ censusCode: '800011', sbCode: null }));
      const [emailJob] = emailQueueService.addEmailJob.mock.calls[0] as [{ mailData: Record<string, unknown> }];
      expect(emailJob.mailData).toMatchObject({ loginCode: '800011', loginCodeLabel: 'Login ID' });
    });

    it('creates the primary contact login inactive for a STATE (PENDING) submission', async () => {
      const ulbId = new Types.ObjectId();
      dynamicFormValidation.validateFinalSubmitAndBuildPayload.mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: {
          code: 'AP012',
          name: 'Pending ULB',
          state: stateId,
          ulbType: ulbTypeId,
          primaryContactName: 'K. Suresh Babu',
          primaryContactEmail: 'pending-contact@ulb.gov.in',
          primaryContactMobile: '9849001236',
        },
      });
      ulbModel.create.mockResolvedValue({ _id: ulbId, toObject: () => ({ _id: ulbId, code: 'AP012' }) });

      await service.create({ data: {} }, stateUser);

      expect(userModel.create).toHaveBeenCalledWith(expect.objectContaining({ isActive: false, status: 'APPROVED' }));
      // The login isn't usable yet (PENDING ULB) — the invite is deferred to approve() instead
      // of being emailed now with credentials that won't work until an ADMIN approves the ULB.
      expect(emailQueueService.addEmailJob).not.toHaveBeenCalled();
    });

    it('creates the primary contact login active for an ADMIN (auto-approved) submission', async () => {
      const ulbId = new Types.ObjectId();
      dynamicFormValidation.validateFinalSubmitAndBuildPayload.mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: {
          code: 'AP013',
          name: 'Approved ULB',
          state: stateId,
          ulbType: ulbTypeId,
          primaryContactName: 'K. Suresh Babu',
          primaryContactEmail: 'approved-contact@ulb.gov.in',
          primaryContactMobile: '9849001237',
        },
      });
      ulbModel.create.mockResolvedValue({ _id: ulbId, toObject: () => ({ _id: ulbId, code: 'AP013' }) });

      await service.create({ data: {} }, adminUser);

      expect(userModel.create).toHaveBeenCalledWith(expect.objectContaining({ isActive: true, status: 'APPROVED' }));
    });

    it('rejects when the primary contact email/mobile is already registered to an active account', async () => {
      userModel.findOne.mockReturnValue({
        select: jest.fn().mockReturnThis(),
        lean: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
      });
      dynamicFormValidation.validateFinalSubmitAndBuildPayload.mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: {
          code: 'AP011',
          name: 'Dup Contact ULB',
          state: stateId,
          ulbType: ulbTypeId,
          primaryContactName: 'Existing Contact',
          primaryContactEmail: 'existing@ulb.gov.in',
          primaryContactMobile: '9849001235',
        },
      });

      await expect(service.create({ data: {} }, stateUser)).rejects.toThrow(BadRequestException);
      expect(ulbModel.create).not.toHaveBeenCalled();
    });

    it('normalizes gazetteNotificationFile through FileInfoNormalizerService — new file, existing=null', async () => {
      const rawFile = { fileName: 'gazette.pdf', fileUrl: 'ulb/gazette-notifications/gazette.pdf' };
      const derivedFile = {
        originalName: 'gazette.pdf',
        name: '',
        path: 'ulb/gazette-notifications/gazette.pdf',
        mimeType: 'application/pdf',
        extension: 'pdf',
        sizeKb: 120,
        pageCount: null,
        sha256: '',
      };
      fileInfoNormalizer.normalizeInboundFileInfo.mockReturnValue({ file: derivedFile, errors: [] });
      dynamicFormValidation.validateFinalSubmitAndBuildPayload.mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: {
          code: 'AP014',
          name: 'Gazette ULB',
          state: stateId,
          ulbType: ulbTypeId,
          gazetteNotificationFile: rawFile,
        },
      });
      ulbModel.create.mockResolvedValue({ toObject: () => ({ code: 'AP014' }) });

      await service.create({ data: {} }, adminUser);

      expect(fileInfoNormalizer.normalizeInboundFileInfo).toHaveBeenCalledWith(
        rawFile,
        null,
        expect.objectContaining({
          fieldKey: 'gazetteNotificationFile',
          allowedExtensions: ['pdf'],
          allowedMimeTypes: ['application/pdf'],
        }),
      );
      const [patch] = ulbModel.create.mock.calls[0] as [Record<string, unknown>];
      expect(patch.gazetteNotificationFile).toBe(derivedFile);
    });

    it('rejects a legacy-shaped gazetteNotificationFile with a field-keyed 400 instead of an opaque Mongoose failure', async () => {
      fileInfoNormalizer.normalizeInboundFileInfo.mockReturnValue({
        file: null,
        errors: [{ field: 'gazetteNotificationFile', code: 'required', message: 'path is required.' }],
      });
      dynamicFormValidation.validateFinalSubmitAndBuildPayload.mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: {
          code: 'AP015',
          name: 'Legacy Shape ULB',
          state: stateId,
          ulbType: ulbTypeId,
          gazetteNotificationFile: { fileName: 'gazette.pdf', fileUrl: 'x', fileSize: 1000 },
        },
      });

      await expect(service.create({ data: {} }, adminUser)).rejects.toThrow(BadRequestException);
      expect(ulbModel.create).not.toHaveBeenCalled();
    });

    it('maps a Mongoose ValidationError from ulbModel.create into a field-keyed 400', async () => {
      dynamicFormValidation.validateFinalSubmitAndBuildPayload.mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: { code: 'AP016', name: 'Schema Fail ULB', state: stateId, ulbType: ulbTypeId },
      });
      const validationError = new mongoose.Error.ValidationError();
      validationError.errors = {
        'gazetteNotificationFile.path': {
          message: 'Path `path` is required.',
        } as unknown as mongoose.Error.ValidatorError,
      };
      ulbModel.create.mockRejectedValue(validationError);

      await expect(service.create({ data: {} }, adminUser)).rejects.toThrow(BadRequestException);
      try {
        await service.create({ data: {} }, adminUser);
      } catch (err) {
        const response = (err as BadRequestException).getResponse() as { errors: Record<string, unknown> };
        expect(response.errors).toHaveProperty('gazetteNotificationFile');
      }
    });
  });

  describe('findAll', () => {
    it('forces the state filter for STATE users regardless of the query', async () => {
      const find = jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      ulbModel.find = find;
      ulbModel.countDocuments.mockResolvedValue(0);

      const otherStateId = new Types.ObjectId().toString();
      await service.findAll({ state: otherStateId, page: 1, limit: 10 }, stateUser);

      const [filter] = find.mock.calls[0] as [{ state: Types.ObjectId }];
      expect(filter.state.toString()).toBe(stateId);
    });

    it('throws ForbiddenException when a STATE user has no state assigned', async () => {
      await expect(service.findAll({ page: 1, limit: 10 }, { ...stateUser, state: undefined })).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('attaches stateName and ulbTypeName resolved from the ids on each row', async () => {
      const ulbRow = {
        _id: new Types.ObjectId(),
        name: 'Vizag',
        state: new Types.ObjectId(stateId),
        ulbType: new Types.ObjectId(ulbTypeId),
      };
      ulbModel.find = jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([ulbRow]),
      });
      ulbModel.countDocuments.mockResolvedValue(1);
      stateModel.find = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ _id: stateId, name: 'Andhra Pradesh' }]),
      });
      ulbModel.db = {
        collection: jest.fn().mockReturnValue({
          find: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([{ _id: ulbTypeId, name: 'Municipal Corporation' }]),
          }),
        }),
      };

      const result = await service.findAll({ page: 1, limit: 10 }, adminUser);

      expect(result.data[0].stateName).toBe('Andhra Pradesh');
      expect(result.data[0].ulbTypeName).toBe('Municipal Corporation');
    });

    it("filters by presence of 'approval', not its status, when approvalStatus is 'EXISTING'", async () => {
      const find = jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([]),
      });
      ulbModel.find = find;
      ulbModel.countDocuments.mockResolvedValue(0);

      await service.findAll({ approvalStatus: 'EXISTING', page: 1, limit: 10 }, adminUser);

      const [filter] = find.mock.calls[0] as [{ approval?: unknown; 'approval.status'?: unknown }];
      expect(filter.approval).toEqual({ $exists: false });
      expect(filter['approval.status']).toBeUndefined();
    });

    it('flags a legacy row with no stored approval as isExistingUser and backfills a synthetic APPROVED block', async () => {
      const legacyRow = {
        _id: new Types.ObjectId(),
        name: 'Legacy ULB',
        state: new Types.ObjectId(stateId),
        ulbType: new Types.ObjectId(ulbTypeId),
      };
      ulbModel.find = jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([legacyRow]),
      });
      ulbModel.countDocuments.mockResolvedValue(1);
      stateModel.find = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ _id: stateId, name: 'Andhra Pradesh' }]),
      });
      ulbModel.db = {
        collection: jest.fn().mockReturnValue({
          find: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([{ _id: ulbTypeId, name: 'Municipal Corporation' }]),
          }),
        }),
      };

      const result = await service.findAll({ page: 1, limit: 10 }, adminUser);

      expect(result.data[0].isExistingUser).toBe(true);
      expect(result.data[0].approval).toMatchObject({ status: 'APPROVED', submittedBy: null, reviewedBy: null });
    });

    it('marks a row that already has a stored approval as isExistingUser: false', async () => {
      const reviewedRow = {
        _id: new Types.ObjectId(),
        name: 'Reviewed ULB',
        state: new Types.ObjectId(stateId),
        ulbType: new Types.ObjectId(ulbTypeId),
        approval: { status: 'APPROVED', reviewedBy: new Types.ObjectId(), reviewedAt: new Date() },
      };
      ulbModel.find = jest.fn().mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        lean: jest.fn().mockResolvedValue([reviewedRow]),
      });
      ulbModel.countDocuments.mockResolvedValue(1);
      stateModel.find = jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([{ _id: stateId, name: 'Andhra Pradesh' }]),
      });
      ulbModel.db = {
        collection: jest.fn().mockReturnValue({
          find: jest.fn().mockReturnValue({
            toArray: jest.fn().mockResolvedValue([{ _id: ulbTypeId, name: 'Municipal Corporation' }]),
          }),
        }),
      };

      const result = await service.findAll({ page: 1, limit: 10 }, adminUser);

      expect(result.data[0].isExistingUser).toBe(false);
    });
  });

  describe('getRegisterSections', () => {
    it('falls back to the built-in layout and fields when no FormJson override exists', async () => {
      mockUlbTypes(ulbModel, []);

      const sections = await service.getRegisterSections();

      expect(sections.length).toBeGreaterThan(0);
      expect(sections[0].fields.length).toBeGreaterThan(0);
      // Merged from DEFAULT_ULB_FIELDS, not just the layout skeleton's {key, grid}.
      const nameField = sections[0].fields.find((f) => f.key === 'name');
      expect(nameField?.label).toBe('ULB Name');
    });

    it('merges an admin-configured layout skeleton with real field definitions and live ULB types', async () => {
      mockUlbTypes(ulbModel, [{ _id: ulbTypeId, name: 'Municipal Corporation' }]);
      const customLayout = [
        {
          title: 'Custom',
          icon: 'bi-star',
          fields: [
            { key: 'name', grid: 'col-12' },
            { key: 'ulbType', grid: 'col-md-6' },
          ],
        },
      ];
      formJsonService.findByType = jest
        .fn()
        .mockImplementation((type: string) =>
          type === ULB_REGISTER_SECTIONS_FORM_JSON_TYPE
            ? Promise.resolve({ data: customLayout })
            : Promise.reject(new NotFoundException()),
        );

      const sections = await service.getRegisterSections();

      expect(sections).toHaveLength(1);
      expect(sections[0].title).toBe('Custom');
      const [nameField, ulbTypeField] = sections[0].fields;
      expect(nameField).toMatchObject({ key: 'name', label: 'ULB Name', grid: 'col-12' });
      expect(ulbTypeField).toMatchObject({
        key: 'ulbType',
        grid: 'col-md-6',
        options: [{ id: ulbTypeId, label: 'Municipal Corporation' }],
      });
    });

    it('drops layout entries whose field key has no matching field definition', async () => {
      mockUlbTypes(ulbModel, []);
      formJsonService.findByType = jest.fn().mockImplementation((type: string) =>
        type === ULB_REGISTER_SECTIONS_FORM_JSON_TYPE
          ? Promise.resolve({
              data: [{ title: 'Custom', icon: 'bi-star', fields: [{ key: 'doesNotExist', grid: 'col-12' }] }],
            })
          : Promise.reject(new NotFoundException()),
      );

      const sections = await service.getRegisterSections();

      expect(sections[0].fields).toHaveLength(0);
    });
  });

  describe('getEditSections', () => {
    it('falls back to the built-in edit layout, covering fields the Register page omits (e.g. code)', async () => {
      mockUlbTypes(ulbModel, []);

      const sections = await service.getEditSections();
      const allFields = sections.flatMap((s) => s.fields);

      expect(allFields.find((f) => f.key === 'code')).toBeTruthy();
    });

    it('embeds live ULB types into the `ulbType` field', async () => {
      mockUlbTypes(ulbModel, [{ _id: ulbTypeId, name: 'Municipal Corporation' }]);
      formJsonService.findByType = jest.fn().mockImplementation((type: string) =>
        type === ULB_EDIT_SECTIONS_FORM_JSON_TYPE
          ? Promise.resolve({
              data: [
                {
                  title: 'Identity',
                  icon: 'bi-bank',
                  fields: [{ key: 'ulbType', grid: 'col-md-6' }],
                },
              ],
            })
          : Promise.reject(new NotFoundException()),
      );

      const sections = await service.getEditSections();

      const [ulbTypeField] = sections[0].fields;
      expect(ulbTypeField).toMatchObject({
        key: 'ulbType',
        options: [{ id: ulbTypeId, label: 'Municipal Corporation' }],
      });
    });

    it('drops the `state` layout entry — no matching field definition exists for it', async () => {
      mockUlbTypes(ulbModel, []);
      formJsonService.findByType = jest.fn().mockImplementation((type: string) =>
        type === ULB_EDIT_SECTIONS_FORM_JSON_TYPE
          ? Promise.resolve({
              data: [{ title: 'Identity', icon: 'bi-bank', fields: [{ key: 'state', grid: 'col-md-6' }] }],
            })
          : Promise.reject(new NotFoundException()),
      );

      const sections = await service.getEditSections();

      expect(sections[0].fields).toHaveLength(0);
    });
  });

  describe('findOne', () => {
    it('throws BadRequestException for an invalid id', async () => {
      await expect(service.findOne('not-an-id')).rejects.toThrow(BadRequestException);
    });

    it('throws NotFoundException when the ULB does not exist', async () => {
      ulbModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      await expect(service.findOne(new Types.ObjectId().toString())).rejects.toThrow(NotFoundException);
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the ULB does not exist', async () => {
      ulbModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      await expect(service.update(new Types.ObjectId().toString(), { data: {} }, adminUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws BadRequestException when no fields are provided', async () => {
      ulbModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'x' }) });
      dynamicFormValidation.validateDraftAndBuildPayload.mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: {},
      });
      await expect(service.update(new Types.ObjectId().toString(), { data: {} }, adminUser)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('strips primary-contact fields from the update patch and never provisions/touches a user', async () => {
      ulbModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'x', name: 'Old Name' }) });
      dynamicFormValidation.validateDraftAndBuildPayload.mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: {
          district: 'New District',
          primaryContactName: 'Someone',
          primaryContactDesignation: 'Commissioner',
          primaryContactEmail: 'someone@ulb.gov.in',
          primaryContactMobile: '9849001234',
        },
      });
      ulbModel.findByIdAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'x' }) });

      await service.update(new Types.ObjectId().toString(), { data: {} }, adminUser);

      const [, updateArg] = ulbModel.findByIdAndUpdate.mock.calls[0] as [string, { $set: Record<string, unknown> }];
      expect(updateArg.$set).not.toHaveProperty('primaryContactName');
      expect(updateArg.$set).not.toHaveProperty('primaryContactDesignation');
      expect(updateArg.$set).not.toHaveProperty('primaryContactEmail');
      expect(updateArg.$set).not.toHaveProperty('primaryContactMobile');
      expect(updateArg.$set.district).toBe('New District');
      expect(userModel.create).not.toHaveBeenCalled();
    });

    it('throws BadRequestException when renaming to a name already used by another ULB', async () => {
      ulbModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'x' }) });
      ulbModel.exists.mockResolvedValue({ _id: new Types.ObjectId() });
      dynamicFormValidation.validateDraftAndBuildPayload.mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: { name: 'Existing Name' },
      });

      await expect(service.update(new Types.ObjectId().toString(), { data: {} }, adminUser)).rejects.toThrow(
        BadRequestException,
      );
      expect(ulbModel.findByIdAndUpdate).not.toHaveBeenCalled();
    });

    it('does not check name uniqueness when the name is unchanged (case/whitespace-insensitive)', async () => {
      ulbModel.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: 'x', name: 'Vizag Municipal Corporation' }),
      });
      dynamicFormValidation.validateDraftAndBuildPayload.mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: { name: '  vizag municipal corporation  ' },
      });
      ulbModel.findByIdAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'x' }) });

      await service.update(new Types.ObjectId().toString(), { data: {} }, adminUser);

      expect(ulbModel.exists).not.toHaveBeenCalled();
      expect(ulbModel.findByIdAndUpdate).toHaveBeenCalled();
    });

    it("throws ForbiddenException when a STATE user edits another state's ULB", async () => {
      const otherStateId = new Types.ObjectId().toString();
      ulbModel.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: 'x', state: otherStateId, approval: { status: 'REJECTED' } }),
      });

      await expect(service.update(new Types.ObjectId().toString(), { data: {} }, stateUser)).rejects.toThrow(
        ForbiddenException,
      );
      expect(dynamicFormValidation.validateDraftAndBuildPayload).not.toHaveBeenCalled();
    });

    it('throws ForbiddenException when a STATE user edits a ULB that is not REJECTED', async () => {
      ulbModel.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: 'x', state: stateId, approval: { status: 'PENDING' } }),
      });

      await expect(service.update(new Types.ObjectId().toString(), { data: {} }, stateUser)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('resets a STATE resubmission back to PENDING', async () => {
      ulbModel.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: 'x', state: stateId, approval: { status: 'REJECTED' } }),
      });
      dynamicFormValidation.validateDraftAndBuildPayload.mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: { name: 'Fixed Name' },
      });
      ulbModel.findByIdAndUpdate.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: 'x', name: 'Fixed Name', approval: { status: 'PENDING' } }),
      });

      await service.update(new Types.ObjectId().toString(), { data: {} }, stateUser);

      const [, updateArg] = ulbModel.findByIdAndUpdate.mock.calls[0] as [string, { $set: Record<string, unknown> }];
      const approval = updateArg.$set.approval as { status: string; submittedBy: Types.ObjectId };
      expect(approval.status).toBe('PENDING');
      expect(approval.submittedBy).toBeInstanceOf(Types.ObjectId);
    });

    it('omits gazetteNotificationFile from $set when unchanged, so Mongoose does not re-stamp its timestamps', async () => {
      const existingFile = { path: 'ulb/gazette-notifications/gazette.pdf', mimeType: 'application/pdf' };
      ulbModel.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: 'x', gazetteNotificationFile: existingFile }),
      });
      fileInfoNormalizer.normalizeInboundFileInfo.mockReturnValue({ file: undefined, errors: [] });
      dynamicFormValidation.validateDraftAndBuildPayload.mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: {
          district: 'New District',
          gazetteNotificationFile: { originalName: 'gazette.pdf', path: 'ulb/gazette-notifications/gazette.pdf' },
        },
      });
      ulbModel.findByIdAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'x' }) });

      await service.update(new Types.ObjectId().toString(), { data: {} }, adminUser);

      expect(fileInfoNormalizer.normalizeInboundFileInfo).toHaveBeenCalledWith(
        expect.objectContaining({ path: 'ulb/gazette-notifications/gazette.pdf' }),
        existingFile,
        expect.anything(),
      );
      const [, updateArg] = ulbModel.findByIdAndUpdate.mock.calls[0] as [string, { $set: Record<string, unknown> }];
      expect(updateArg.$set).not.toHaveProperty('gazetteNotificationFile');
      expect(updateArg.$set.district).toBe('New District');
    });

    it('replaces gazetteNotificationFile in $set with the normalized value when it changed', async () => {
      const derivedFile = { path: 'ulb/gazette-notifications/new-gazette.pdf', extension: 'pdf' };
      ulbModel.findById.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: 'x', gazetteNotificationFile: { path: 'old.pdf' } }),
      });
      fileInfoNormalizer.normalizeInboundFileInfo.mockReturnValue({ file: derivedFile, errors: [] });
      dynamicFormValidation.validateDraftAndBuildPayload.mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: { gazetteNotificationFile: { originalName: 'new-gazette.pdf', path: 'new-gazette.pdf' } },
      });
      ulbModel.findByIdAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'x' }) });

      await service.update(new Types.ObjectId().toString(), { data: {} }, adminUser);

      const [, updateArg] = ulbModel.findByIdAndUpdate.mock.calls[0] as [string, { $set: Record<string, unknown> }];
      expect(updateArg.$set.gazetteNotificationFile).toBe(derivedFile);
    });
  });

  describe('remove', () => {
    it('deactivates a ULB', async () => {
      ulbModel.findByIdAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'x' }) });
      const id = new Types.ObjectId().toString();

      const result = await service.remove(id);

      expect(ulbModel.findByIdAndUpdate).toHaveBeenCalledWith(id, { $set: { isActive: false } });
      expect(result).toEqual({ message: 'ULB deactivated successfully' });
    });
  });

  describe('approve', () => {
    it('marks a ULB APPROVED and records the reviewer', async () => {
      ulbModel.findByIdAndUpdate.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: 'x', name: 'Some ULB', approval: { status: 'APPROVED' } }),
      });
      const id = new Types.ObjectId().toString();

      const result = await service.approve(id, adminUser);

      const [, updateArg] = ulbModel.findByIdAndUpdate.mock.calls[0] as [string, { $set: Record<string, unknown> }];
      expect(updateArg.$set['approval.status']).toBe('APPROVED');
      expect(updateArg.$set['approval.reviewedBy']).toBeInstanceOf(Types.ObjectId);
      expect(result).toEqual({ _id: 'x', name: 'Some ULB', approval: { status: 'APPROVED' } });
      expect(userModel.find).toHaveBeenCalledWith({
        ulb: new Types.ObjectId(id),
        isDeleted: false,
        isActive: false,
      });
    });

    it('activates a still-pending primary-contact login and sends its first invite email, with a freshly generated temp password', async () => {
      ulbModel.findByIdAndUpdate.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: 'x', name: 'Pending ULB', approval: { status: 'APPROVED' } }),
      });
      const contact = {
        _id: new Types.ObjectId(),
        email: 'commissioner@ulb.gov.in',
        name: 'K. Suresh Babu',
        mobile: '9849001234',
        censusCode: '',
        sbCode: '900001',
        isNewUser: true,
        isActive: false,
        password: 'old-hash',
        tempPasswordExpiresAt: new Date('2020-01-01'),
        save: jest.fn().mockResolvedValue(undefined),
      };
      userModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([contact]) });

      await service.approve(new Types.ObjectId().toString(), adminUser);

      expect(contact.isActive).toBe(true);
      expect(contact.password).not.toBe('old-hash');
      expect(contact.tempPasswordExpiresAt.getTime()).toBeGreaterThan(Date.now());
      expect(contact.save).toHaveBeenCalled();
      const [emailJob] = emailQueueService.addEmailJob.mock.calls[0] as [
        { to: string; templateName: string; mailData: Record<string, unknown> },
      ];
      expect(emailJob).toMatchObject({ to: 'commissioner@ulb.gov.in', templateName: './ulb-member-invite' });
      expect(emailJob.mailData).toMatchObject({ loginCode: '900001', loginCodeLabel: 'Login ID' });
    });

    it('reactivates a non-new-user login tied to the ULB without re-sending an invite', async () => {
      ulbModel.findByIdAndUpdate.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: 'x', name: 'Some ULB', approval: { status: 'APPROVED' } }),
      });
      const contact = {
        _id: new Types.ObjectId(),
        email: 'already-claimed@ulb.gov.in',
        isNewUser: false,
        isActive: false,
        save: jest.fn().mockResolvedValue(undefined),
      };
      userModel.find.mockReturnValue({ exec: jest.fn().mockResolvedValue([contact]) });

      await service.approve(new Types.ObjectId().toString(), adminUser);

      expect(contact.isActive).toBe(true);
      expect(contact.save).toHaveBeenCalled();
      expect(emailQueueService.addEmailJob).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the ULB does not exist', async () => {
      ulbModel.findByIdAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      await expect(service.approve(new Types.ObjectId().toString(), adminUser)).rejects.toThrow(NotFoundException);
    });
  });

  describe('reject', () => {
    it('marks a ULB REJECTED with the given reason', async () => {
      ulbModel.findByIdAndUpdate.mockReturnValue({
        lean: jest.fn().mockResolvedValue({ _id: 'x', approval: { status: 'REJECTED' } }),
      });
      const id = new Types.ObjectId().toString();

      await service.reject(id, { reason: 'Duplicate code' }, adminUser);

      const [, updateArg] = ulbModel.findByIdAndUpdate.mock.calls[0] as [string, { $set: Record<string, unknown> }];
      expect(updateArg.$set['approval.status']).toBe('REJECTED');
      expect(updateArg.$set['approval.rejectReason']).toBe('Duplicate code');
    });
  });
});
