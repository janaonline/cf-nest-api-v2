/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { StreamableFile } from '@nestjs/common';
import { Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Permission, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { REQUIRED_PERMISSIONS_KEY } from 'src/module/auth/require-permissions.decorator';
import { SfcStatusController } from './sfc-status.controller';
import { SfcStatusService } from './sfc-status.service';
import type { SaveSfcStatusDto } from './dto/save-sfc-status.dto';
import type { DumpSfcStatusQueryDto } from './dto/dump-sfc-status-query.dto';

describe('SfcStatusController', () => {
  const stateId = new Types.ObjectId().toString();
  const yearId = new Types.ObjectId().toString();
  const user: AuthUser = {
    _id: new Types.ObjectId().toString(),
    role: UserRole.ADMIN,
    scope: Scope.ADMIN,
    accessLevel: AccessLevel.ADMIN,
    state: null,
  };

  let controller: SfcStatusController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      getQuestions: jest.fn().mockResolvedValue({ success: true, data: [] }),
      dumpToExcel: jest.fn().mockResolvedValue(Buffer.from('xlsx')),
      getForm: jest.fn().mockResolvedValue({ success: true }),
      saveDraft: jest.fn().mockResolvedValue({ success: true }),
      finalSubmit: jest.fn().mockResolvedValue({ success: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SfcStatusController],
      providers: [{ provide: SfcStatusService, useValue: service }],
    }).compile();

    controller = module.get(SfcStatusController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  // ─── GET questions ────────────────────────────────────────────────────────

  it('getQuestions delegates to SfcStatusService.getQuestions', async () => {
    await controller.getQuestions();
    expect(service['getQuestions']).toHaveBeenCalledWith();
  });

  it('getQuestions retains the VIEW_STATE_FORMS permission', () => {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controller.getQuestions)).toEqual([
      Permission.VIEW_STATE_FORMS,
    ]);
  });

  // ─── GET dump ─────────────────────────────────────────────────────────────

  describe('dump', () => {
    it('parses a numeric status filter and calls SfcStatusService.dumpToExcel with stateId/yearId/status', async () => {
      const query = { stateId, yearId, status: '2' } as DumpSfcStatusQueryDto;
      const result = await controller.dump(query, user);
      expect(service['dumpToExcel']).toHaveBeenCalledWith({ stateId, yearId, status: 2 }, user);
      expect(result).toBeInstanceOf(StreamableFile);
    });

    it('leaves status undefined when not provided in the query', async () => {
      const query = { stateId, yearId } as DumpSfcStatusQueryDto;
      await controller.dump(query, user);
      expect(service['dumpToExcel']).toHaveBeenCalledWith({ stateId, yearId, status: undefined }, user);
    });

    it('parses status "0" to numeric 0 (falsy but defined)', async () => {
      const query = { stateId, yearId, status: '0' } as DumpSfcStatusQueryDto;
      await controller.dump(query, user);
      expect(service['dumpToExcel']).toHaveBeenCalledWith({ stateId, yearId, status: 0 }, user);
    });

    it('retains the VIEW_STATUS_REPORTS permission', () => {
      expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controller.dump)).toEqual([
        Permission.VIEW_STATUS_REPORTS,
      ]);
    });
  });

  // ─── GET :stateId/:yearId ────────────────────────────────────────────────

  it('getForm delegates stateId/yearId/user to SfcStatusService.getForm', async () => {
    await controller.getForm(stateId, yearId, user);
    expect(service['getForm']).toHaveBeenCalledWith(stateId, yearId, user);
  });

  it('getForm retains the VIEW_STATE_FORMS permission', () => {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controller.getForm)).toEqual([
      Permission.VIEW_STATE_FORMS,
    ]);
  });

  // ─── POST save-draft ──────────────────────────────────────────────────────

  describe('saveDraft', () => {
    const dto = { stateId, yearId, data: { sfcStatus: 'active' } } as SaveSfcStatusDto;

    it('delegates dto/user/ip/userAgent to SfcStatusService.saveDraft', async () => {
      await controller.saveDraft(dto, user, '127.0.0.1', 'jest-agent');
      expect(service['saveDraft']).toHaveBeenCalledWith(dto, user, '127.0.0.1', 'jest-agent');
    });

    it('defaults ip to empty string when not provided', async () => {
      await controller.saveDraft(dto, user, undefined as unknown as string, 'jest-agent');
      expect(service['saveDraft']).toHaveBeenCalledWith(dto, user, '', 'jest-agent');
    });

    it('defaults userAgent to empty string when not provided', async () => {
      await controller.saveDraft(dto, user, '127.0.0.1', undefined as unknown as string);
      expect(service['saveDraft']).toHaveBeenCalledWith(dto, user, '127.0.0.1', '');
    });

    it('retains the EDIT_STATE_FORMS permission', () => {
      expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controller.saveDraft)).toEqual([
        Permission.EDIT_STATE_FORMS,
      ]);
    });
  });

  // ─── POST final-submit ────────────────────────────────────────────────────

  describe('finalSubmit', () => {
    const dto = { stateId, yearId, data: { sfcStatus: 'active' } } as SaveSfcStatusDto;

    it('delegates dto/user/ip/userAgent to SfcStatusService.finalSubmit', async () => {
      await controller.finalSubmit(dto, user, '127.0.0.1', 'jest-agent');
      expect(service['finalSubmit']).toHaveBeenCalledWith(dto, user, '127.0.0.1', 'jest-agent');
    });

    it('defaults ip and userAgent to empty string when not provided', async () => {
      await controller.finalSubmit(dto, user, undefined as unknown as string, undefined as unknown as string);
      expect(service['finalSubmit']).toHaveBeenCalledWith(dto, user, '', '');
    });

    it('retains the FINAL_SUBMIT_STATE_FORMS permission', () => {
      expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controller.finalSubmit)).toEqual([
        Permission.FINAL_SUBMIT_STATE_FORMS,
      ]);
    });
  });

  // ─── Propagation of service failures ─────────────────────────────────────

  it('propagates errors thrown by the delegated service without translation', async () => {
    const err = new Error('downstream failure');
    service['getForm'].mockRejectedValue(err);
    await expect(controller.getForm(stateId, yearId, user)).rejects.toBe(err);
  });
});
