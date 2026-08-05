import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { DevolutionFormulaRowService } from 'src/module/xvi-fc/state/devolution-formula/services/row/devolution-formula-row.service';
import { DevolutionFormulaForm } from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import { DevolutionFormulaRow } from 'src/schemas/xvi-fc/state/devolution-formula-row.schema';
import { DevolutionFormulaValidator } from 'src/module/xvi-fc/state/devolution-formula/validators/devolution-formula.validator';
import { DfFormJsonConfigService } from 'src/module/xvi-fc/state/devolution-formula/services/form-json/devolution-formula-form-json.service';
import { ExcelService } from 'src/services/excel/excel.service';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { Scope, UserRole, AccessLevel } from 'src/module/auth/enum/roles-xvi-fc.enum';
import type { AuthUser } from 'src/module/auth/auth-user.interface';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Creates a chainable Mongoose Query-like mock that resolves to `value`. */
function q<T>(value: T) {
  const chain: Record<string, unknown> = {};
  for (const m of ['lean', 'select', 'sort', 'skip', 'limit', 'populate']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain['exec'] = jest.fn().mockResolvedValue(value);
  chain['then'] = (onFulfilled: (v: T) => unknown, onRejected?: (e: unknown) => unknown) =>
    Promise.resolve(value).then(onFulfilled, onRejected);
  chain['catch'] = (onRejected: (e: unknown) => unknown) => Promise.resolve(value).catch(onRejected);
  chain['finally'] = (onFinally: () => void) => Promise.resolve(value).finally(onFinally);
  return chain;
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

const stateOid = new Types.ObjectId();
const yearOid = new Types.ObjectId();
const formOid = new Types.ObjectId();

const adminUser: AuthUser = {
  _id: new Types.ObjectId().toString(),
  role: UserRole.ADMIN,
  scope: Scope.ADMIN,
  accessLevel: AccessLevel.ADMIN,
  state: null,
};

const mockForm = {
  _id: formOid,
  state: stateOid,
  year: yearOid,
  installment: 1,
  currentFormStatus: FORM_STATUS.IN_PROGRESS,
  activeDatasetVersion: 1,
  excludedRows: [] as unknown[],
};

const mockDbRow = {
  _id: new Types.ObjectId(),
  rowNumber: 1,
  censusCode: 'C001',
  ulbName: 'Alpha City',
  totalGrantAllocation: 300_000,
  installment1Amount: 200_000,
  installment2Amount: 100_000,
  devolutionFormula: 'population',
  errors: [],
};

const excludedRow = {
  rowNumber: 2,
  censusCode: 'ZZZZ',
  ulbName: 'New Town',
  totalGrantAllocation: 500_000,
  installment1Amount: 300_000,
  installment2Amount: 200_000,
  devolutionFormula: 'population',
  errors: [{ field: 'censusCode', code: 'unknownUlb', message: 'Unknown ULB.' }],
};

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('DevolutionFormulaRowService', () => {
  let service: DevolutionFormulaRowService;
  let formModel: Record<string, jest.Mock>;
  let rowModel: Record<string, jest.Mock>;
  let excelService: { generateExcel: jest.Mock };

  beforeEach(async () => {
    formModel = {
      findOne: jest.fn().mockReturnValue(q(mockForm)),
      findByIdAndUpdate: jest.fn().mockReturnValue(q(mockForm)),
    };
    rowModel = {
      find: jest.fn().mockReturnValue(q([])),
      updateMany: jest.fn().mockReturnValue(q({ modifiedCount: 0 })),
      deleteMany: jest.fn().mockReturnValue(q({ deletedCount: 0 })),
    };
    excelService = { generateExcel: jest.fn().mockResolvedValue(new ArrayBuffer(0)) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DevolutionFormulaRowService,
        { provide: getModelToken(DevolutionFormulaForm.name), useValue: formModel },
        { provide: getModelToken(DevolutionFormulaRow.name), useValue: rowModel },
        { provide: DevolutionFormulaValidator, useValue: {} },
        { provide: ExcelService, useValue: excelService },
        { provide: DfFormJsonConfigService, useValue: { loadFields: jest.fn().mockResolvedValue([]) } },
      ],
    }).compile();

    service = module.get(DevolutionFormulaRowService);
  });

  // ─── getErrorSheet ────────────────────────────────────────────────────────

  describe('getErrorSheet', () => {
    it('merges live DB rows with the excludedRows snapshot, sorted by rowNumber', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q({ ...mockForm, excludedRows: [excludedRow] }));
      rowModel['find'] = jest.fn().mockReturnValue(q([mockDbRow]));

      await service.getErrorSheet(stateOid.toString(), yearOid.toString(), 1, adminUser);

      expect(excelService.generateExcel).toHaveBeenCalledTimes(1);
      const [, rows] = excelService.generateExcel.mock.calls[0] as [unknown, Array<{ rowNumber: number }>];
      expect(rows.map((r) => r.rowNumber)).toEqual([1, 2]);
    });

    it('includes the excluded row error message even though it has no persisted row', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q({ ...mockForm, excludedRows: [excludedRow] }));
      rowModel['find'] = jest.fn().mockReturnValue(q([mockDbRow]));

      await service.getErrorSheet(stateOid.toString(), yearOid.toString(), 1, adminUser);

      const [, rows] = excelService.generateExcel.mock.calls[0] as [
        unknown,
        Array<{ censusCode: string; errors: string }>,
      ];
      const excludedEntry = rows.find((r) => r.censusCode === 'ZZZZ');
      expect(excludedEntry?.errors).toContain('Unknown ULB.');
    });

    it('throws when no dataset has ever been validated', async () => {
      formModel['findOne'] = jest.fn().mockReturnValue(q({ ...mockForm, activeDatasetVersion: 0 }));

      await expect(service.getErrorSheet(stateOid.toString(), yearOid.toString(), 1, adminUser)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  // ─── deleteUploadedExcel ──────────────────────────────────────────────────

  describe('deleteUploadedExcel', () => {
    it('clears the excludedRows snapshot alongside excelFile/errorExcelFile', async () => {
      await service.deleteUploadedExcel(stateOid.toString(), yearOid.toString(), 1, adminUser);

      const [, update] = formModel['findByIdAndUpdate'].mock.calls[0] as [unknown, Record<string, unknown>];
      expect((update['$set'] as Record<string, unknown>)['excludedRows']).toEqual([]);
      expect(update['$unset']).toMatchObject({ excelFile: 1, errorExcelFile: 1 });
    });
  });
});
