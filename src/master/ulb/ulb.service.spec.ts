import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { EmailQueueService } from 'src/core/queue/email-queue/email-queue.service';
import { FormJsonService } from 'src/form-json/form-json.service';
import { DynamicFormValidationService } from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.service';
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
    db?: unknown;
  };
  let stateModel: { findById: jest.Mock; find: jest.Mock };
  let userModel: { create: jest.Mock; findOne: jest.Mock };
  let formJsonService: { findByType: jest.Mock };
  let dynamicFormValidation: { validateFinalSubmitAndBuildPayload: jest.Mock; validateDraftAndBuildPayload: jest.Mock };
  let emailQueueService: { addEmailJob: jest.Mock };
  let configService: { get: jest.Mock };
  let fileTokenService: { signFileUrl: jest.Mock };

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
    };
    formJsonService = { findByType: jest.fn().mockRejectedValue(new NotFoundException()) };
    dynamicFormValidation = {
      validateFinalSubmitAndBuildPayload: jest.fn(),
      validateDraftAndBuildPayload: jest.fn(),
    };
    emailQueueService = { addEmailJob: jest.fn().mockResolvedValue(undefined) };
    configService = { get: jest.fn().mockReturnValue('https://cityfinance.in') };
    fileTokenService = { signFileUrl: jest.fn((url: string) => `signed::${url}`) };

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
      ulbModel.countDocuments.mockResolvedValue(3);
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

      await service.create({ data: {} }, stateUser);

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
      const ulbRow = { _id: new Types.ObjectId(), name: 'Vizag', state: new Types.ObjectId(stateId), ulbType: new Types.ObjectId(ulbTypeId) };
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
      expect(allFields.find((f) => f.key === 'sbCode')).toBeTruthy();
    });

    it('embeds live states into the `state` field, in addition to live ULB types', async () => {
      mockUlbTypes(ulbModel, [{ _id: ulbTypeId, name: 'Municipal Corporation' }]);
      mockStates(stateModel, [{ _id: stateId, name: 'Andhra Pradesh' }]);
      formJsonService.findByType = jest.fn().mockImplementation((type: string) =>
        type === ULB_EDIT_SECTIONS_FORM_JSON_TYPE
          ? Promise.resolve({
              data: [
                {
                  title: 'Identity',
                  icon: 'bi-bank',
                  fields: [
                    { key: 'state', grid: 'col-md-6' },
                    { key: 'ulbType', grid: 'col-md-6' },
                  ],
                },
              ],
            })
          : Promise.reject(new NotFoundException()),
      );

      const sections = await service.getEditSections();

      const [stateField, ulbTypeField] = sections[0].fields;
      expect(stateField).toMatchObject({ key: 'state', options: [{ id: stateId, label: 'Andhra Pradesh' }] });
      expect(ulbTypeField).toMatchObject({
        key: 'ulbType',
        options: [{ id: ulbTypeId, label: 'Municipal Corporation' }],
      });
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
        lean: jest.fn().mockResolvedValue({ _id: 'x', approval: { status: 'APPROVED' } }),
      });
      const id = new Types.ObjectId().toString();

      const result = await service.approve(id, adminUser);

      const [, updateArg] = ulbModel.findByIdAndUpdate.mock.calls[0] as [string, { $set: Record<string, unknown> }];
      expect(updateArg.$set['approval.status']).toBe('APPROVED');
      expect(updateArg.$set['approval.reviewedBy']).toBeInstanceOf(Types.ObjectId);
      expect(result).toEqual({ _id: 'x', approval: { status: 'APPROVED' } });
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
