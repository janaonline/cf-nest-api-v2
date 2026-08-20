/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, StreamableFile } from '@nestjs/common';
import { Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { REQUIRED_PERMISSIONS_KEY } from 'src/module/auth/require-permissions.decorator';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { DevolutionFormulaController } from './devolution-formula.controller';
import { DevolutionFormulaService } from './services/main/devolution-formula.service';
import { DevolutionFormulaExcelService } from './services/excel/devolution-formula-excel.service';
import { DevolutionFormulaRowService } from './services/row/devolution-formula-row.service';
import { XviFcService } from 'src/module/xvi-fc/xvi-fc.service';
import type { SaveDraftDevolutionFormulaDto } from './dto/save-draft-devolution-formula.dto';
import type { ValidateExcelDevolutionFormulaDto } from './dto/validate-excel-devolution-formula.dto';
import type { FinalSubmitDevolutionFormulaDto } from './dto/final-submit-devolution-formula.dto';
import type { UpdateRowDevolutionFormulaDto } from './dto/update-row-devolution-formula.dto';
import type { RowsQueryDevolutionFormulaDto } from './dto/rows-query-devolution-formula.dto';
import type { DumpDevolutionFormulaQueryDto } from './dto/dump-devolution-formula-query.dto';

describe('DevolutionFormulaController', () => {
  const stateId = new Types.ObjectId().toString();
  const yearId = new Types.ObjectId().toString();
  const rowId = new Types.ObjectId().toString();
  const user: AuthUser = {
    _id: new Types.ObjectId().toString(),
    role: UserRole.ADMIN,
    scope: Scope.ADMIN,
    accessLevel: AccessLevel.ADMIN,
    state: null,
  };

  let controller: DevolutionFormulaController;
  let dfService: Record<string, jest.Mock>;
  let dfExcelService: Record<string, jest.Mock>;
  let dfRowService: Record<string, jest.Mock>;
  let xviFcService: Record<string, jest.Mock>;

  beforeEach(async () => {
    dfService = {
      dumpToExcel: jest.fn().mockResolvedValue(Buffer.from('xlsx')),
      saveDraft: jest.fn().mockResolvedValue({ success: true }),
      finalSubmit: jest.fn().mockResolvedValue({ success: true }),
      getForm: jest.fn().mockResolvedValue({ success: true }),
    };
    dfExcelService = {
      validateExcel: jest.fn().mockResolvedValue({ success: true }),
      generateTemplate: jest.fn().mockResolvedValue(Buffer.from('template')),
      revalidateExcel: jest.fn().mockResolvedValue({ success: true }),
    };
    dfRowService = {
      getRows: jest.fn().mockResolvedValue({ success: true, data: [] }),
      getErrorSheet: jest.fn().mockResolvedValue(Buffer.from('errors')),
      updateRow: jest.fn().mockResolvedValue({ success: true }),
      deleteUploadedExcel: jest.fn().mockResolvedValue({ success: true }),
    };
    xviFcService = {
      getStateById: jest.fn().mockResolvedValue({ stateName: 'Andhra Pradesh' }),
      getYearLabelById: jest.fn().mockResolvedValue({ yearLabel: '2026-27' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [DevolutionFormulaController],
      providers: [
        { provide: DevolutionFormulaService, useValue: dfService },
        { provide: DevolutionFormulaExcelService, useValue: dfExcelService },
        { provide: DevolutionFormulaRowService, useValue: dfRowService },
        { provide: XviFcService, useValue: xviFcService },
      ],
    }).compile();

    controller = module.get(DevolutionFormulaController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  // ─── GET dump ────────────────────────────────────────────────────────────

  describe('dump', () => {
    it('delegates the query and user to DevolutionFormulaService.dumpToExcel and returns a StreamableFile', async () => {
      const query = { stateId, yearId, installment: 1 } as unknown as DumpDevolutionFormulaQueryDto;
      const result = await controller.dump(query, user);
      expect(dfService['dumpToExcel']).toHaveBeenCalledWith(query, user);
      expect(result).toBeInstanceOf(StreamableFile);
    });

    it('retains the VIEW_STATUS_REPORTS permission', () => {
      expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controller.dump)).toEqual([Permission.VIEW_STATUS_REPORTS]);
    });
  });

  // ─── POST save-draft ─────────────────────────────────────────────────────

  it('saveDraft delegates dto and user to DevolutionFormulaService.saveDraft', () => {
    const dto = { stateId, yearId, installment: 1 } as unknown as SaveDraftDevolutionFormulaDto;
    controller.saveDraft(dto, user);
    expect(dfService['saveDraft']).toHaveBeenCalledWith(dto, user);
  });

  it('saveDraft retains the EDIT_STATE_FORMS permission', () => {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controller.saveDraft)).toEqual([Permission.EDIT_STATE_FORMS]);
  });

  // ─── POST validate-excel ─────────────────────────────────────────────────

  it('validateExcel delegates dto and user to DevolutionFormulaExcelService.validateExcel', () => {
    const dto = { stateId, yearId, installment: 1 } as unknown as ValidateExcelDevolutionFormulaDto;
    controller.validateExcel(dto, user);
    expect(dfExcelService['validateExcel']).toHaveBeenCalledWith(dto, user);
  });

  // ─── POST final-submit ───────────────────────────────────────────────────

  it('finalSubmit delegates dto and user to DevolutionFormulaService.finalSubmit', () => {
    const dto = { stateId, yearId, installment: 1 } as unknown as FinalSubmitDevolutionFormulaDto;
    controller.finalSubmit(dto, user);
    expect(dfService['finalSubmit']).toHaveBeenCalledWith(dto, user);
  });

  it('finalSubmit retains the FINAL_SUBMIT_STATE_FORMS permission', () => {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controller.finalSubmit)).toEqual([
      Permission.FINAL_SUBMIT_STATE_FORMS,
    ]);
  });

  // ─── GET :stateId/:yearId/:installment ───────────────────────────────────

  describe('getForm / installment parsing', () => {
    it('parses installment "1" and delegates to DevolutionFormulaService.getForm', () => {
      controller.getForm(stateId, yearId, '1', user);
      expect(dfService['getForm']).toHaveBeenCalledWith(stateId, yearId, 1, user);
    });

    it('parses installment "2" and delegates to DevolutionFormulaService.getForm', () => {
      controller.getForm(stateId, yearId, '2', user);
      expect(dfService['getForm']).toHaveBeenCalledWith(stateId, yearId, 2, user);
    });

    it('throws BadRequestException for an invalid installment value (e.g. "3")', () => {
      expect(() => controller.getForm(stateId, yearId, '3', user)).toThrow(BadRequestException);
      expect(dfService['getForm']).not.toHaveBeenCalled();
    });

    it('invalid installment error body matches the XVI-FC validation error shape', () => {
      try {
        controller.getForm(stateId, yearId, '3', user);
        throw new Error('expected BadRequestException');
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        expect((e as BadRequestException).getResponse()).toMatchObject({
          message: 'Validation failed.',
          errors: { installment: [{ field: 'installment', code: 'invalid' }] },
        });
      }
    });

    it('throws BadRequestException for a non-numeric installment value', () => {
      expect(() => controller.getForm(stateId, yearId, 'abc', user)).toThrow(BadRequestException);
    });
  });

  // ─── GET :stateId/:yearId/:installment/template ──────────────────────────

  it('getTemplate parses installment and delegates to DevolutionFormulaExcelService.generateTemplate, returning a StreamableFile', async () => {
    const result = await controller.getTemplate(stateId, yearId, '1', user);
    expect(dfExcelService['generateTemplate']).toHaveBeenCalledWith(stateId, yearId, 1, user);
    expect(result).toBeInstanceOf(StreamableFile);
  });

  it('getTemplate resolves state/year via XviFcService and builds the CF_ filename', async () => {
    const result = await controller.getTemplate(stateId, yearId, '1', user);
    expect(xviFcService['getStateById']).toHaveBeenCalledWith(stateId);
    expect(xviFcService['getYearLabelById']).toHaveBeenCalledWith(yearId);
    expect(result.getHeaders().disposition).toBe(
      'attachment; filename="CF_Andhra-Pradesh_Devolution-formula-template_2026-27.xlsx"',
    );
  });

  it('getTemplate rejects an invalid installment before calling the service', async () => {
    await expect(controller.getTemplate(stateId, yearId, '3', user)).rejects.toThrow(BadRequestException);
    expect(dfExcelService['generateTemplate']).not.toHaveBeenCalled();
  });

  // ─── GET :stateId/:yearId/:installment/rows ──────────────────────────────

  it('getRows parses installment and delegates query/user to DevolutionFormulaRowService.getRows', () => {
    const query = { page: 1, limit: 20 } as unknown as RowsQueryDevolutionFormulaDto;
    controller.getRows(stateId, yearId, '2', query, user);
    expect(dfRowService['getRows']).toHaveBeenCalledWith(stateId, yearId, 2, query, user);
  });

  // ─── GET :stateId/:yearId/:installment/error-sheet ───────────────────────

  it('getErrorSheet parses installment and delegates to DevolutionFormulaRowService.getErrorSheet, returning a StreamableFile', async () => {
    const result = await controller.getErrorSheet(stateId, yearId, '1', user);
    expect(dfRowService['getErrorSheet']).toHaveBeenCalledWith(stateId, yearId, 1, user);
    expect(result).toBeInstanceOf(StreamableFile);
  });

  it('getErrorSheet resolves state/year via XviFcService and builds the CF_ filename', async () => {
    const result = await controller.getErrorSheet(stateId, yearId, '1', user);
    expect(result.getHeaders().disposition).toBe(
      'attachment; filename="CF_Andhra-Pradesh_Devolution-formula-error-sheet_2026-27.xlsx"',
    );
  });

  // ─── POST :stateId/:yearId/:installment/revalidate-excel ─────────────────

  it('revalidateExcel parses installment and delegates to DevolutionFormulaExcelService.revalidateExcel', () => {
    controller.revalidateExcel(stateId, yearId, '2', user);
    expect(dfExcelService['revalidateExcel']).toHaveBeenCalledWith(stateId, yearId, 2, user);
  });

  // ─── PATCH :stateId/:yearId/:installment/rows/:rowId ─────────────────────

  it('updateRow parses installment and delegates to DevolutionFormulaRowService.updateRow', () => {
    const dto = { totalGrantAllocation: 100 } as unknown as UpdateRowDevolutionFormulaDto;
    controller.updateRow(stateId, yearId, '1', rowId, dto, user);
    expect(dfRowService['updateRow']).toHaveBeenCalledWith(stateId, yearId, 1, rowId, dto, user);
  });

  // ─── DELETE :stateId/:yearId/:installment/uploaded-excel ─────────────────

  it('deleteUploadedExcel parses installment and delegates to DevolutionFormulaRowService.deleteUploadedExcel', () => {
    controller.deleteUploadedExcel(stateId, yearId, '2', user);
    expect(dfRowService['deleteUploadedExcel']).toHaveBeenCalledWith(stateId, yearId, 2, user);
  });

  // ─── Propagation of service failures ─────────────────────────────────────

  it('propagates errors thrown by the delegated service without translation', async () => {
    const err = new Error('downstream failure');
    dfService['getForm'].mockImplementation(() => {
      throw err;
    });
    expect(() => controller.getForm(stateId, yearId, '1', user)).toThrow(err);
  });
});
