/* eslint-disable @typescript-eslint/unbound-method */
import { RequestMethod, StreamableFile } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { Test, type TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Permission, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { REQUIRED_PERMISSIONS_KEY } from 'src/module/auth/require-permissions.decorator';
import { GetStateDashboardParamsDto } from './dto/get-state-dashboard-params.dto';
import { ExportAllFormsQueryDto } from './dto/export-all-forms-query.dto';
import { StateDashboardController } from './state-dashboard.controller';
import { StateDashboardService } from './state-dashboard.service';
import type { StateDashboardApiResponse } from './state-dashboard.types';

describe('StateDashboardController', () => {
  const params: GetStateDashboardParamsDto = {
    stateId: new Types.ObjectId().toHexString(),
    yearId: new Types.ObjectId().toHexString(),
  };
  const user: AuthUser = {
    _id: new Types.ObjectId().toHexString(),
    role: UserRole.STATE,
    scope: Scope.STATE,
    accessLevel: AccessLevel.ADMIN,
    state: params.stateId,
  };
  const response = {
    success: true,
    message: 'State dashboard fetched successfully',
    data: { marker: 'dashboard' },
    timestamp: '2026-07-13T10:00:00.000Z',
  } as unknown as StateDashboardApiResponse;

  const service = { getDashboard: jest.fn(), exportAllFormsCsv: jest.fn() };
  let controller: StateDashboardController;

  beforeEach(async () => {
    jest.clearAllMocks();
    service.getDashboard.mockResolvedValue(response);

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StateDashboardController],
      providers: [{ provide: StateDashboardService, useValue: service }],
    }).compile();

    controller = module.get(StateDashboardController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates the validated DTO and authenticated user to the service', async () => {
    await controller.getDashboard(params, user);
    expect(service.getDashboard).toHaveBeenCalledWith(params, user);
  });

  it('returns the service response without modification', async () => {
    await expect(controller.getDashboard(params, user)).resolves.toBe(response);
  });

  it('retains the VIEW_STATUS_REPORTS permission decorator', () => {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controller.getDashboard)).toEqual([
      Permission.VIEW_STATUS_REPORTS,
    ]);
  });

  it('retains the GET xvi-fc/state/:stateId/:yearId/dashboard route', () => {
    expect(Reflect.getMetadata(PATH_METADATA, StateDashboardController)).toBe('xvi-fc/state');
    expect(Reflect.getMetadata(PATH_METADATA, controller.getDashboard)).toBe(':stateId/:yearId/dashboard');
    expect(Reflect.getMetadata(METHOD_METADATA, controller.getDashboard)).toBe(RequestMethod.GET);
  });

  it('contains no error translation and propagates service failures', async () => {
    const databaseError = new Error('database unavailable');
    service.getDashboard.mockRejectedValue(databaseError);
    await expect(controller.getDashboard(params, user)).rejects.toBe(databaseError);
  });

  it('marks a malformed State ID invalid for the global ValidationPipe', async () => {
    const dto = Object.assign(new GetStateDashboardParamsDto(), params, { stateId: 'invalid-state' });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'stateId')).toBe(true);
  });

  it('marks a malformed year ID invalid for the global ValidationPipe', async () => {
    const dto = Object.assign(new GetStateDashboardParamsDto(), params, { yearId: 'invalid-year' });
    const errors = await validate(dto);
    expect(errors.some((error) => error.property === 'yearId')).toBe(true);
  });

  it('exposes only the dashboard and export-all-forms controller methods', () => {
    expect(Object.getOwnPropertyNames(StateDashboardController.prototype).sort()).toEqual([
      'constructor',
      'exportUlbSubmissionsAllForms',
      'getDashboard',
    ]);
  });

  describe('exportUlbSubmissionsAllForms()', () => {
    const exportQuery: ExportAllFormsQueryDto = { designYearId: params.yearId };

    beforeEach(() => {
      service.exportAllFormsCsv.mockResolvedValue({
        fileName: 'andhra_pradesh_all_ulb_submissions_13_07_2026.xlsx',
        buffer: Buffer.from('xlsx-content', 'utf-8'),
      });
    });

    it('delegates the validated DTO and authenticated user to the service', async () => {
      await controller.exportUlbSubmissionsAllForms(exportQuery, user);
      expect(service.exportAllFormsCsv).toHaveBeenCalledWith(exportQuery, user);
    });

    it('returns an Excel StreamableFile with the service-provided filename', async () => {
      const result = await controller.exportUlbSubmissionsAllForms(exportQuery, user);
      const headers = result.getHeaders();
      expect(result).toBeInstanceOf(StreamableFile);
      expect(headers.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      expect(headers.disposition).toBe(
        'attachment; filename="andhra_pradesh_all_ulb_submissions_13_07_2026.xlsx"',
      );
    });

    it('retains the REVIEW_ULB_SUBMISSIONS permission decorator', () => {
      expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controller.exportUlbSubmissionsAllForms)).toEqual([
        Permission.REVIEW_ULB_SUBMISSIONS,
      ]);
    });

    it('retains the GET xvi-fc/state/ulb-submissions/export route', () => {
      expect(Reflect.getMetadata(PATH_METADATA, controller.exportUlbSubmissionsAllForms)).toBe(
        'ulb-submissions/export',
      );
      expect(Reflect.getMetadata(METHOD_METADATA, controller.exportUlbSubmissionsAllForms)).toBe(RequestMethod.GET);
    });
  });
});
