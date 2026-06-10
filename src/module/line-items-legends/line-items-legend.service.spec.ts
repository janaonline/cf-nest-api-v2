import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { LineItemsLegend } from './entities/line-items-legend.schema';
import { LineItemsLegendService } from './line-items-legend.service';

const makeLegend = (overrides: Partial<LineItemsLegend> = {}): LineItemsLegend => ({
  nmamCode: '110',
  accountHead: 'INCOME',
  majorCode: '110',
  parentCode: null,
  segmentCode: '110',
  segmentPath: ['110'],
  codePath: ['110'],
  name: 'Tax Revenue',
  desc: '',
  level: 1,
  sortOrder: 100001,
  templateVersion: '2026.1',
  isActive: true,
  rules: [],
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

const validRawItem = {
  nmamCode: '110',
  accountHead: 'INCOME',
  majorCode: '110',
  parentCode: null,
  segmentCode: '110',
  segmentPath: ['110'],
  codePath: ['110'],
  name: 'Tax Revenue',
  level: 1,
  sortOrder: 100001,
  isActive: true,
  rules: [],
};

// mockSave is the .save() on a model instance created via `new Model(dto)`
const mockSave = jest.fn();

// mockLegendModel must be both callable as a constructor and have static Mongoose methods.
const mockLegendModel = Object.assign(
  jest.fn().mockImplementation(() => ({ save: mockSave })),
  {
    find: jest.fn(),
    findOne: jest.fn(),
    countDocuments: jest.fn(),
    findOneAndUpdate: jest.fn(),
    findOneAndDelete: jest.fn(),
    deleteMany: jest.fn(),
    bulkWrite: jest.fn(),
    exists: jest.fn(),
  },
);

describe('LineItemsLegendService', () => {
  let service: LineItemsLegendService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [LineItemsLegendService, { provide: getModelToken(LineItemsLegend.name), useValue: mockLegendModel }],
    }).compile();

    service = module.get<LineItemsLegendService>(LineItemsLegendService);
  });

  it('should be defined', () => expect(service).toBeDefined());

  describe('getFinancialDataTemplate', () => {
    const items = [makeLegend(), makeLegend({ nmamCode: '11001', accountHead: 'EXPENDITURE' })];

    beforeEach(() => {
      mockLegendModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(items) }),
      });
    });

    it('queries active items for the default templateVersion', async () => {
      await service.getFinancialDataTemplate();
      expect(mockLegendModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ templateVersion: '2026.1', isActive: true }),
        expect.any(String),
      );
    });

    it('applies accountHead filter when provided', async () => {
      await service.getFinancialDataTemplate({ accountHead: 'INCOME' });
      expect(mockLegendModel.find).toHaveBeenCalledWith(
        expect.objectContaining({ accountHead: 'INCOME' }),
        expect.any(String),
      );
    });

    it('returns templateVersion, accountHeads, lineItems, codes', async () => {
      const result = await service.getFinancialDataTemplate({ templateVersion: '2026.1' });
      expect(result.templateVersion).toBe('2026.1');
      expect(result.lineItems).toEqual(items);
      expect(result.codes).toEqual(items.map((i) => i.nmamCode));
      expect(result.accountHeads).toContain('INCOME');
    });
  });

  describe('getLegend', () => {
    it('returns legend when found', async () => {
      const legend = makeLegend();
      mockLegendModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(legend) });
      const result = await service.getLegend('110');
      expect(result).toEqual(legend);
    });

    it('throws NotFoundException when not found', async () => {
      mockLegendModel.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      await expect(service.getLegend('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('listLegends', () => {
    it('returns paginated results', async () => {
      const items = [makeLegend()];
      mockLegendModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({
          skip: jest
            .fn()
            .mockReturnValue({ limit: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(items) }) }),
        }),
      });
      mockLegendModel.countDocuments.mockResolvedValue(1);

      const result = await service.listLegends({ templateVersion: '2026.1', page: 1, limit: 50 });
      expect(result.data).toEqual(items);
      expect(result.total).toBe(1);
      expect(result.page).toBe(1);
    });
  });

  describe('createLegend', () => {
    const dto = {
      nmamCode: '110',
      accountHead: 'INCOME' as const,
      majorCode: '110',
      segmentCode: '110',
      segmentPath: ['110'],
      codePath: ['110'],
      name: 'Tax Revenue',
      level: 1,
      sortOrder: 100001,
      templateVersion: '2026.1',
    };

    it('creates and returns the legend when no duplicate exists', async () => {
      const saved = makeLegend();
      mockLegendModel.exists.mockResolvedValue(null);
      mockSave.mockResolvedValue(saved);
      const result = await service.createLegend(dto);
      expect(mockLegendModel.exists).toHaveBeenCalledWith({ nmamCode: '110', templateVersion: '2026.1' });
      expect(mockSave).toHaveBeenCalled();
      expect(result).toEqual(saved);
    });

    it('throws ConflictException when exists() finds a duplicate', async () => {
      mockLegendModel.exists.mockResolvedValue({ _id: 'some-id' });
      await expect(service.createLegend(dto)).rejects.toThrow(ConflictException);
      expect(mockSave).not.toHaveBeenCalled();
    });

    it('converts Mongo 11000 error from save() into ConflictException', async () => {
      mockLegendModel.exists.mockResolvedValue(null);
      mockSave.mockRejectedValue({ code: 11000 });
      await expect(service.createLegend(dto)).rejects.toThrow(ConflictException);
    });

    it('does not leak raw Mongo duplicate error to caller', async () => {
      mockLegendModel.exists.mockResolvedValue(null);
      mockSave.mockRejectedValue({ code: 11000, errmsg: 'raw mongo error' });
      const err = await service.createLegend(dto).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).message).not.toContain('raw mongo error');
    });

    it('re-throws non-duplicate errors from save()', async () => {
      mockLegendModel.exists.mockResolvedValue(null);
      const dbError = new Error('network error');
      mockSave.mockRejectedValue(dbError);
      await expect(service.createLegend(dto)).rejects.toThrow('network error');
    });

    it('sanitizes comparison rule before passing to model constructor', async () => {
      mockLegendModel.exists.mockResolvedValue(null);
      mockSave.mockResolvedValue(makeLegend());
      await service.createLegend({
        ...dto,
        rules: [
          { type: 'comparison', operator: '>' as const, value: 0, operation: undefined, operands: undefined } as never,
        ],
      });
      const constructorArg = (mockLegendModel.mock.calls[0] as unknown[])[0] as { rules: Record<string, unknown>[] };
      expect(constructorArg.rules[0]).toEqual({ type: 'comparison', operator: '>', value: 0 });
      expect(constructorArg.rules[0]).not.toHaveProperty('operation');
      expect(constructorArg.rules[0]).not.toHaveProperty('operands');
    });
  });

  describe('updateLegend', () => {
    it('returns updated legend', async () => {
      const updated = makeLegend({ name: 'Updated' });
      mockLegendModel.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue(updated) });
      const result = await service.updateLegend('110', '2026.1', { name: 'Updated' });
      expect(result.name).toBe('Updated');
    });

    it('throws NotFoundException when legend does not exist', async () => {
      mockLegendModel.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      await expect(service.updateLegend('nonexistent', '2026.1', {})).rejects.toThrow(NotFoundException);
    });

    describe('rule storage sanitization', () => {
      const setupUpdate = () =>
        mockLegendModel.findOneAndUpdate.mockReturnValue({ lean: jest.fn().mockResolvedValue(makeLegend()) });

      const getStoredRules = () => {
        const call = (mockLegendModel.findOneAndUpdate.mock.calls[0] as unknown[])[1] as {
          $set: { rules: Record<string, unknown>[] };
        };
        return call.$set['rules'];
      };

      it('comparison rule stores only type, operator, value', async () => {
        setupUpdate();
        await service.updateLegend('110', '2026.1', {
          rules: [{ type: 'comparison', operator: '>', value: 0 } as never],
        });
        expect(getStoredRules()[0]).toEqual({ type: 'comparison', operator: '>', value: 0 });
      });

      it('comparison rule does not store operation or operands', async () => {
        setupUpdate();
        await service.updateLegend('110', '2026.1', {
          rules: [{ type: 'comparison', operator: '>', value: 0, operation: undefined, operands: undefined } as never],
        });
        const rule = getStoredRules()[0];
        expect(rule).not.toHaveProperty('operation');
        expect(rule).not.toHaveProperty('operands');
      });

      it('formula sum rule stores only type, operation, operands', async () => {
        setupUpdate();
        await service.updateLegend('110', '2026.1', {
          rules: [{ type: 'formula', operation: 'sum', operands: ['111', '112'] } as never],
        });
        const rule = getStoredRules()[0];
        expect(rule).toEqual({ type: 'formula', operation: 'sum', operands: ['111', '112'] });
        expect(rule).not.toHaveProperty('operator');
        expect(rule).not.toHaveProperty('value');
      });

      it('formula diff rule stores only type, operation, operands', async () => {
        setupUpdate();
        await service.updateLegend('110', '2026.1', {
          rules: [{ type: 'formula', operation: 'diff', operands: ['111', '112'] } as never],
        });
        const rule = getStoredRules()[0];
        expect(rule).toEqual({ type: 'formula', operation: 'diff', operands: ['111', '112'] });
        expect(rule).not.toHaveProperty('operator');
        expect(rule).not.toHaveProperty('value');
      });

      it('linear formula stores correctly shaped { code, sign } operands', async () => {
        setupUpdate();
        await service.updateLegend('110', '2026.1', {
          rules: [
            {
              type: 'formula',
              operation: 'linear',
              operands: [
                { code: 'A', sign: 1 },
                { code: 'B', sign: -1 },
              ],
            } as never,
          ],
        });
        expect(getStoredRules()[0]).toEqual({
          type: 'formula',
          operation: 'linear',
          operands: [
            { code: 'A', sign: 1 },
            { code: 'B', sign: -1 },
          ],
        });
      });

      it('throws BadRequestException for unsupported rule type before calling the DB', async () => {
        await expect(service.updateLegend('110', '2026.1', { rules: [{ type: 'INVALID' } as never] })).rejects.toThrow(
          BadRequestException,
        );
        expect(mockLegendModel.findOneAndUpdate).not.toHaveBeenCalled();
      });

      it('throws BadRequestException for unsupported formula operation before calling the DB', async () => {
        await expect(
          service.updateLegend('110', '2026.1', {
            rules: [{ type: 'formula', operation: 'INVALID', operands: ['111'] } as never],
          }),
        ).rejects.toThrow(BadRequestException);
        expect(mockLegendModel.findOneAndUpdate).not.toHaveBeenCalled();
      });
    });
  });

  describe('deleteLegend', () => {
    const legend = makeLegend();

    beforeEach(() => {
      mockLegendModel.exists.mockResolvedValue(null);
      mockLegendModel.findOneAndDelete.mockReturnValue({ lean: jest.fn().mockResolvedValue(legend) });
    });

    it('deletes and returns the deleted document with a message', async () => {
      const result = await service.deleteLegend('110', '2026.1');
      expect(mockLegendModel.findOneAndDelete).toHaveBeenCalledWith(
        { nmamCode: '110', templateVersion: '2026.1' },
        { projection: { __v: 0 } },
      );
      expect(result.message).toBe('Line item legend deleted successfully.');
      expect(result.deleted).toEqual(legend);
    });

    it('uses default templateVersion when not provided', async () => {
      await service.deleteLegend('110');
      expect(mockLegendModel.findOneAndDelete).toHaveBeenCalledWith(
        { nmamCode: '110', templateVersion: '2026.1' },
        expect.anything(),
      );
    });

    it('throws NotFoundException when the legend does not exist', async () => {
      mockLegendModel.findOneAndDelete.mockReturnValue({ lean: jest.fn().mockResolvedValue(null) });
      await expect(service.deleteLegend('nonexistent', '2026.1')).rejects.toThrow(NotFoundException);
    });

    it('throws ConflictException when child items exist', async () => {
      mockLegendModel.exists.mockResolvedValue({ _id: 'child-id' });
      await expect(service.deleteLegend('110', '2026.1')).rejects.toThrow(ConflictException);
      expect(mockLegendModel.findOneAndDelete).not.toHaveBeenCalled();
    });
  });

  describe('deleteLegendSubtree', () => {
    const legends = [makeLegend(), makeLegend({ nmamCode: '11001', sortOrder: 100002 })];

    beforeEach(() => {
      mockLegendModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(legends) }),
      });
      mockLegendModel.deleteMany.mockResolvedValue({ deletedCount: legends.length });
    });

    it('finds records by templateVersion and codePath containing nmamCode', async () => {
      await service.deleteLegendSubtree('110', '2026.1');
      expect(mockLegendModel.find).toHaveBeenCalledWith({ templateVersion: '2026.1', codePath: '110' }, { __v: 0 });
    });

    it('deletes matched records and returns count and deleted data', async () => {
      const result = await service.deleteLegendSubtree('110', '2026.1');
      expect(mockLegendModel.deleteMany).toHaveBeenCalledWith({ templateVersion: '2026.1', codePath: '110' });
      expect(result.message).toBe('Line item legend subtree deleted successfully.');
      expect(result.deletedCount).toBe(2);
      expect(result.deleted).toEqual(legends);
    });

    it('uses default templateVersion when not provided', async () => {
      await service.deleteLegendSubtree('110');
      expect(mockLegendModel.find).toHaveBeenCalledWith(
        { templateVersion: '2026.1', codePath: '110' },
        expect.anything(),
      );
    });

    it('throws NotFoundException when no records match', async () => {
      mockLegendModel.find.mockReturnValue({
        sort: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
      });
      await expect(service.deleteLegendSubtree('nonexistent', '2026.1')).rejects.toThrow(NotFoundException);
      expect(mockLegendModel.deleteMany).not.toHaveBeenCalled();
    });

    it('does not include __v in the returned deleted records', async () => {
      const result = await service.deleteLegendSubtree('110', '2026.1');
      for (const item of result.deleted) {
        expect(item).not.toHaveProperty('__v');
      }
    });
  });

  describe('importFromJson', () => {
    it('dry run returns summary without calling bulkWrite', async () => {
      const result = await service.importFromJson({ dryRun: true, lineItems: [{ ...validRawItem }] });
      expect(result.dryRun).toBe(true);
      if (result.dryRun) {
        expect(result.valid).toBe(true);
        expect(result.total).toBe(1);
        expect(result.wouldUpsert).toBe(1);
        expect(result.templateVersion).toBe('2026.1');
      }
      expect(mockLegendModel.bulkWrite).not.toHaveBeenCalled();
    });

    it('non-dry run calls bulkWrite and returns write result', async () => {
      mockLegendModel.bulkWrite.mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 });
      const result = await service.importFromJson({ dryRun: false, lineItems: [{ ...validRawItem }] });
      expect(mockLegendModel.bulkWrite).toHaveBeenCalled();
      expect(result.dryRun).toBe(false);
      if (!result.dryRun) {
        expect(result.upserted).toBe(1);
        expect(result.modified).toBe(0);
        expect(result.total).toBe(1);
      }
    });

    it('uses default templateVersion when not provided', async () => {
      mockLegendModel.bulkWrite.mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 });
      const result = await service.importFromJson({ lineItems: [{ ...validRawItem }] });
      expect(result.templateVersion).toBe('2026.1');
    });

    it('throws BadRequestException when validation fails', async () => {
      const badItem = { ...validRawItem, accountHead: 'INVALID' };
      await expect(service.importFromJson({ lineItems: [badItem] })).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException for duplicate nmamCode', async () => {
      await expect(service.importFromJson({ lineItems: [{ ...validRawItem }, { ...validRawItem }] })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('ignores extra/source fields and passes validation', async () => {
      mockLegendModel.bulkWrite.mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 });
      const itemWithExtras = {
        ...validRawItem,
        sourceSerial: 1,
        sourceRowNumber: 42,
        metadata: { sheet: 'Income' },
        validationReport: 'ok',
        cfCode: 'CF-110',
        remarks: 'debug field',
      };
      await expect(service.importFromJson({ lineItems: [itemWithExtras] })).resolves.not.toThrow();
    });

    it('does not persist extra fields in bulkWrite $set', async () => {
      mockLegendModel.bulkWrite.mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 });
      const itemWithExtras = { ...validRawItem, sourceSerial: 1, cfCode: 'CF-110', remarks: 'debug' };
      await service.importFromJson({ lineItems: [itemWithExtras] });

      type BulkOp = { updateOne: { update: { $set: Record<string, unknown> } } };
      const calls = mockLegendModel.bulkWrite.mock.calls as unknown as [BulkOp[], unknown][];
      const setPayload = calls[0][0][0].updateOne.update.$set;
      expect(setPayload).not.toHaveProperty('sourceSerial');
      expect(setPayload).not.toHaveProperty('cfCode');
      expect(setPayload).not.toHaveProperty('remarks');
      expect(setPayload).toHaveProperty('nmamCode', '110');
    });

    it('validates parentCode references within batch', async () => {
      const parent = { ...validRawItem, nmamCode: '100', codePath: ['100'], parentCode: null };
      const child = { ...validRawItem, nmamCode: '110', codePath: ['100', '110'], parentCode: '100' };
      mockLegendModel.bulkWrite.mockResolvedValue({ upsertedCount: 2, modifiedCount: 0 });
      const result = await service.importFromJson({ lineItems: [parent, child] });
      expect(result.dryRun).toBe(false);
    });

    it('throws when parentCode references a code not in the batch', async () => {
      const item = { ...validRawItem, parentCode: '999' };
      await expect(service.importFromJson({ lineItems: [item] })).rejects.toThrow(BadRequestException);
    });

    it('throws when templateVersion in item mismatches dto templateVersion', async () => {
      const item = { ...validRawItem, templateVersion: '2025.0' };
      await expect(service.importFromJson({ templateVersion: '2026.1', lineItems: [item] })).rejects.toThrow(
        BadRequestException,
      );
    });

    it('converts bulkWrite Mongo 11000 error into ConflictException', async () => {
      mockLegendModel.bulkWrite.mockRejectedValue({ code: 11000 });
      await expect(service.importFromJson({ lineItems: [{ ...validRawItem }] })).rejects.toThrow(ConflictException);
    });

    it('re-throws non-duplicate bulkWrite errors', async () => {
      mockLegendModel.bulkWrite.mockRejectedValue(new Error('db timeout'));
      await expect(service.importFromJson({ lineItems: [{ ...validRawItem }] })).rejects.toThrow('db timeout');
    });

    it('import path sanitizes comparison rules before bulkWrite', async () => {
      mockLegendModel.bulkWrite.mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 });
      const item = { ...validRawItem, rules: [{ type: 'comparison', operator: '>', value: 0 }] };
      await service.importFromJson({ lineItems: [item] });

      type BulkOp = { updateOne: { update: { $set: { rules: Record<string, unknown>[] } } } };
      const calls = mockLegendModel.bulkWrite.mock.calls as unknown as [BulkOp[], unknown][];
      const rule = calls[0][0][0].updateOne.update.$set.rules[0];
      expect(rule).toEqual({ type: 'comparison', operator: '>', value: 0 });
      expect(rule).not.toHaveProperty('operation');
      expect(rule).not.toHaveProperty('operands');
    });

    it('import path sanitizes formula sum rules before bulkWrite', async () => {
      mockLegendModel.bulkWrite.mockResolvedValue({ upsertedCount: 1, modifiedCount: 0 });
      const item = { ...validRawItem, rules: [{ type: 'formula', operation: 'sum', operands: ['111', '112'] }] };
      await service.importFromJson({ lineItems: [item] });

      type BulkOp = { updateOne: { update: { $set: { rules: Record<string, unknown>[] } } } };
      const calls = mockLegendModel.bulkWrite.mock.calls as unknown as [BulkOp[], unknown][];
      const rule = calls[0][0][0].updateOne.update.$set.rules[0];
      expect(rule).toEqual({ type: 'formula', operation: 'sum', operands: ['111', '112'] });
      expect(rule).not.toHaveProperty('operator');
      expect(rule).not.toHaveProperty('value');
    });
  });
});
