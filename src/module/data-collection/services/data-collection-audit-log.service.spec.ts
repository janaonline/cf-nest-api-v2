import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { DATA_COLLECTION_AUDIT_ACTION, DATA_COLLECTION_FAILURE_REASON } from '../constant';
import { DataCollectionAuditLog, DataCollectionAuditLogSchema } from '../entities/data-collection-audit-log.schema';
import { DataCollectionAuditLogService } from './data-collection-audit-log.service';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const ulbId = new Types.ObjectId();
const stateId = new Types.ObjectId();
const yearId = new Types.ObjectId();
const dataCollectionId = new Types.ObjectId();

const baseData = {
  apiClientId: new Types.ObjectId(),
  stateId,
  ulbId,
  yearId,
  templateVersion: '2026.1',
  lineItemCount: 2,
  ip: '127.0.0.1',
  userAgent: 'test-agent/1.0',
};

const adminUserId = new Types.ObjectId();

const mockModel = { create: jest.fn() };
const removedFields = ['clientId', 'actorType', 'ulbCode', 'yearCode', 'submittedLineItemCodes', 'warningCount'];
const requiredFields = ['stateId', 'ulbId', 'yearId', 'templateVersion', 'action', 'success'];

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('DataCollectionAuditLogService', () => {
  let service: DataCollectionAuditLogService;

  beforeEach(async () => {
    mockModel.create.mockResolvedValue({});
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DataCollectionAuditLogService,
        { provide: getModelToken(DataCollectionAuditLog.name), useValue: mockModel },
      ],
    }).compile();
    service = module.get<DataCollectionAuditLogService>(DataCollectionAuditLogService);
    jest.clearAllMocks();
    mockModel.create.mockResolvedValue({});
  });

  it('should be defined', () => expect(service).toBeDefined());

  describe('schema', () => {
    it('does not include removed duplicate fields', () => {
      for (const field of removedFields) {
        expect(DataCollectionAuditLogSchema.path(field)).toBeUndefined();
      }
    });

    it('keeps required audit identifier fields', () => {
      for (const field of requiredFields) {
        expect(DataCollectionAuditLogSchema.path(field)?.isRequired).toBe(true);
      }
    });

    it('keeps only lean audit indexes', () => {
      const indexKeys = DataCollectionAuditLogSchema.indexes().map(([key]) => key);
      expect(indexKeys).toEqual([
        { dataCollectionId: 1, createdAt: -1 },
        { apiClientId: 1, createdAt: -1 },
        { stateId: 1, yearId: 1, createdAt: -1 },
        { ulbId: 1, yearId: 1, createdAt: -1 },
        { action: 1, createdAt: -1 },
        { success: 1, createdAt: -1 },
        { adminUserId: 1, createdAt: -1 },
      ]);
    });
  });

  // ─── logSubmitted ──────────────────────────────────────────────────────────

  describe('logSubmitted', () => {
    it('creates a record with SUBMITTED action and success=true', async () => {
      await service.logSubmitted({ ...baseData, dataCollectionId, validationStatus: 'VALID' });
      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: DATA_COLLECTION_AUDIT_ACTION.SUBMITTED,
          success: true,
          dataCollectionId,
        }),
      );
    });

    it('writes lean payload with lineItemCount and no duplicate public fields', async () => {
      await service.logSubmitted({ ...baseData, dataCollectionId, validationStatus: 'VALID' });
      const arg = (mockModel.create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          lineItemCount: baseData.lineItemCount,
        }),
      );
      for (const field of removedFields) {
        expect(arg).not.toHaveProperty(field);
      }
    });

    it('does not include failureReason', async () => {
      await service.logSubmitted({ ...baseData, dataCollectionId, validationStatus: 'VALID' });
      const arg = (mockModel.create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(arg['failureReason']).toBeUndefined();
    });

    it('does not store secretHash or clientSecret', async () => {
      await service.logSubmitted({ ...baseData, dataCollectionId, validationStatus: 'VALID' });
      const arg = (mockModel.create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(arg['secretHash']).toBeUndefined();
      expect(arg['clientSecret']).toBeUndefined();
    });
  });

  // ─── logModified ───────────────────────────────────────────────────────────

  describe('logModified', () => {
    it('creates a record with MODIFIED action, success=true, and changedLineItemCodes', async () => {
      await service.logModified({
        ...baseData,
        dataCollectionId,
        validationStatus: 'VALID',
        changedLineItemCodes: ['110'],
      });
      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: DATA_COLLECTION_AUDIT_ACTION.MODIFIED,
          success: true,
          changedLineItemCodes: ['110'],
        }),
      );
      const arg = (mockModel.create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      for (const field of removedFields) {
        expect(arg).not.toHaveProperty(field);
      }
    });
  });

  // ─── logValidationFailed ───────────────────────────────────────────────────

  describe('logValidationFailed', () => {
    const validationData = {
      ...baseData,
      errorCount: 2,
      validationSummary: { errors: [{ lineItemCode: '110', message: 'err', severity: 'ERROR' }] },
    };

    it('creates a record with VALIDATION_FAILED action and success=false', async () => {
      await service.logValidationFailed(validationData);
      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: DATA_COLLECTION_AUDIT_ACTION.VALIDATION_FAILED,
          success: false,
          failureReason: DATA_COLLECTION_FAILURE_REASON.VALIDATION_FAILED,
        }),
      );
    });

    it('stores errorCount and validationSummary', async () => {
      await service.logValidationFailed(validationData);
      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          errorCount: 2,
          validationSummary: validationData.validationSummary,
        }),
      );
      const arg = (mockModel.create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      for (const field of removedFields) {
        expect(arg).not.toHaveProperty(field);
      }
    });
  });

  // ─── logDuplicateSubmit ────────────────────────────────────────────────────

  describe('logDuplicateSubmit', () => {
    it('creates a record with SUBMIT_DUPLICATE action and DUPLICATE_SUBMISSION failure reason', async () => {
      await service.logDuplicateSubmit(baseData);
      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: DATA_COLLECTION_AUDIT_ACTION.SUBMIT_DUPLICATE,
          success: false,
          failureReason: DATA_COLLECTION_FAILURE_REASON.DUPLICATE_SUBMISSION,
        }),
      );
    });

    it('stores failure reason and lean identifiers', async () => {
      await service.logDuplicateSubmit(baseData);
      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          apiClientId: baseData.apiClientId,
          stateId,
          ulbId,
          yearId,
          failureReason: DATA_COLLECTION_FAILURE_REASON.DUPLICATE_SUBMISSION,
          lineItemCount: baseData.lineItemCount,
        }),
      );
      const arg = (mockModel.create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      for (const field of removedFields) {
        expect(arg).not.toHaveProperty(field);
      }
    });
  });

  // ─── logModifyNotFound ─────────────────────────────────────────────────────

  describe('logModifyNotFound', () => {
    it('creates a record with NOT_FOUND_FOR_MODIFY action and DATA_COLLECTION_NOT_FOUND failure reason', async () => {
      await service.logModifyNotFound(baseData);
      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: DATA_COLLECTION_AUDIT_ACTION.NOT_FOUND_FOR_MODIFY,
          success: false,
          failureReason: DATA_COLLECTION_FAILURE_REASON.DATA_COLLECTION_NOT_FOUND,
          apiClientId: baseData.apiClientId,
          stateId,
          ulbId,
          yearId,
        }),
      );
      const arg = (mockModel.create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      for (const field of removedFields) {
        expect(arg).not.toHaveProperty(field);
      }
    });
  });

  // ─── logReversed ───────────────────────────────────────────────────────────

  describe('logReversed', () => {
    const reversedData = {
      adminUserId,
      dataCollectionId,
      stateId,
      ulbId,
      yearId,
      templateVersion: '2026.1',
      reason: 'Submitted by wrong state agency.',
      ip: '127.0.0.1',
      userAgent: 'admin-agent/1.0',
    };

    it('creates a record with REVERSED action and success=true', async () => {
      await service.logReversed(reversedData);
      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          action: DATA_COLLECTION_AUDIT_ACTION.REVERSED,
          success: true,
          dataCollectionId,
        }),
      );
    });

    it('stores adminUserId and reason, not apiClientId', async () => {
      await service.logReversed(reversedData);
      const arg = (mockModel.create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(arg['adminUserId']).toEqual(adminUserId);
      expect(arg['reason']).toBe(reversedData.reason);
      expect(arg).not.toHaveProperty('apiClientId');
    });

    it('does not include failureReason', async () => {
      await service.logReversed(reversedData);
      const arg = (mockModel.create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(arg['failureReason']).toBeUndefined();
    });

    it('stores stateId, ulbId, yearId, templateVersion', async () => {
      await service.logReversed(reversedData);
      expect(mockModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ stateId, ulbId, yearId, templateVersion: '2026.1' }),
      );
    });
  });

  // ─── Error handling ────────────────────────────────────────────────────────

  describe('error handling', () => {
    it('does not throw when create fails — logs error and resolves', async () => {
      mockModel.create.mockRejectedValue(new Error('DB write failed'));
      await expect(service.logDuplicateSubmit(baseData)).resolves.toBeUndefined();
    });

    it('does not throw for logModifyNotFound DB failure', async () => {
      mockModel.create.mockRejectedValue(new Error('connection lost'));
      await expect(service.logModifyNotFound(baseData)).resolves.toBeUndefined();
    });
  });
});
