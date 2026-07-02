import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FormJsonService } from 'src/form-json/form-json.service';
import { DynamicFormValidationService } from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.service';
import { Ulb } from 'src/schemas/ulb.schema';
import { UlbService } from './ulb.service';

describe('UlbService', () => {
  let service: UlbService;
  let ulbModel: {
    create: jest.Mock;
    find: jest.Mock;
    countDocuments: jest.Mock;
    findById: jest.Mock;
    findByIdAndUpdate: jest.Mock;
  };
  let formJsonService: { findByType: jest.Mock };
  let dynamicFormValidation: { validateFinalSubmitAndBuildPayload: jest.Mock; validateDraftAndBuildPayload: jest.Mock };

  const stateId = new Types.ObjectId().toString();
  const ulbTypeId = new Types.ObjectId().toString();

  beforeEach(async () => {
    ulbModel = {
      create: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
    };
    formJsonService = { findByType: jest.fn().mockRejectedValue(new NotFoundException()) };
    dynamicFormValidation = {
      validateFinalSubmitAndBuildPayload: jest.fn(),
      validateDraftAndBuildPayload: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UlbService,
        { provide: getModelToken(Ulb.name), useValue: ulbModel },
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

      await expect(service.create({ data: {} })).rejects.toThrow(BadRequestException);
      expect(ulbModel.create).not.toHaveBeenCalled();
    });

    it('creates a ULB with a generated slug and ObjectId-coerced refs', async () => {
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

      const result = await service.create({ data: {} });

      const [patch] = ulbModel.create.mock.calls[0] as [Record<string, unknown>];
      expect(patch.code).toBe('AP001');
      expect(patch.name).toBe('Vizianagaram Municipal Corporation');
      expect(patch.slug).toBe('vizianagaram-municipal-corporation');
      expect(patch.state).toBeInstanceOf(Types.ObjectId);
      expect(patch.ulbType).toBeInstanceOf(Types.ObjectId);
      expect(result).toEqual({ code: 'AP001', name: 'Vizianagaram Municipal Corporation' });
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
});
