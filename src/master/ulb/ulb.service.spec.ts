import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FormJsonService } from 'src/form-json/form-json.service';
import { DynamicFormValidationService } from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.service';
import type { IAuthUser } from 'src/common/interfaces/auth-user.interface';
import { Role } from 'src/module/auth/enum/role.enum';
import { State } from 'src/schemas/state.schema';
import { Ulb } from 'src/schemas/ulb.schema';
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
  let formJsonService: { findByType: jest.Mock };
  let dynamicFormValidation: { validateFinalSubmitAndBuildPayload: jest.Mock; validateDraftAndBuildPayload: jest.Mock };

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
    formJsonService = { findByType: jest.fn().mockRejectedValue(new NotFoundException()) };
    dynamicFormValidation = {
      validateFinalSubmitAndBuildPayload: jest.fn(),
      validateDraftAndBuildPayload: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UlbService,
        { provide: getModelToken(Ulb.name), useValue: ulbModel },
        { provide: getModelToken(State.name), useValue: stateModel },
        { provide: FormJsonService, useValue: formJsonService },
        { provide: DynamicFormValidationService, useValue: dynamicFormValidation },
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
      formJsonService.findByType = jest.fn().mockImplementation((type: string) =>
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
          ? Promise.resolve({ data: [{ title: 'Custom', icon: 'bi-star', fields: [{ key: 'doesNotExist', grid: 'col-12' }] }] })
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
      expect(ulbTypeField).toMatchObject({ key: 'ulbType', options: [{ id: ulbTypeId, label: 'Municipal Corporation' }] });
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
      await expect(service.update(new Types.ObjectId().toString(), { data: {} })).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException when no fields are provided', async () => {
      ulbModel.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: 'x' }) });
      dynamicFormValidation.validateDraftAndBuildPayload.mockReturnValue({
        isValid: true,
        errors: {},
        sanitizedPayload: {},
      });
      await expect(service.update(new Types.ObjectId().toString(), { data: {} })).rejects.toThrow(BadRequestException);
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
