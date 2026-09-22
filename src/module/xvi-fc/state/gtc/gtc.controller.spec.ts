/* eslint-disable @typescript-eslint/unbound-method */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Permission, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { REQUIRED_PERMISSIONS_KEY } from 'src/module/auth/require-permissions.decorator';
import { GtcController } from './gtc.controller';
import { GtcService } from './gtc.service';
import type { SaveGtcDto } from './dto/save-gtc.dto';

describe('GtcController', () => {
  const stateId = new Types.ObjectId().toString();
  const yearId = new Types.ObjectId().toString();
  const user: AuthUser = {
    _id: new Types.ObjectId().toString(),
    role: UserRole.ADMIN,
    scope: Scope.ADMIN,
    accessLevel: AccessLevel.ADMIN,
    state: null,
  };

  let controller: GtcController;
  let service: Record<string, jest.Mock>;

  beforeEach(async () => {
    service = {
      getQuestions: jest.fn().mockResolvedValue({ success: true, data: [] }),
      getForm: jest.fn().mockResolvedValue({ success: true }),
      getTemplate: jest.fn().mockResolvedValue({ success: true }),
      saveDraft: jest.fn().mockResolvedValue({ success: true }),
      finalSubmit: jest.fn().mockResolvedValue({ success: true }),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [GtcController],
      providers: [{ provide: GtcService, useValue: service }],
    }).compile();

    controller = module.get(GtcController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  // ─── GET questions ────────────────────────────────────────────────────────

  it('getQuestions delegates to GtcService.getQuestions', async () => {
    await controller.getQuestions();
    expect(service['getQuestions']).toHaveBeenCalledWith();
  });

  it('getQuestions retains the VIEW_STATE_FORMS permission', () => {
    expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controller.getQuestions)).toEqual([
      Permission.VIEW_STATE_FORMS,
    ]);
  });

  // ─── GET :stateId/:yearId/:installment ───────────────────────────────────

  describe('getForm', () => {
    it('parses a valid installment and delegates stateId/yearId/installment/user to GtcService.getForm', async () => {
      await controller.getForm(stateId, yearId, '2', user);
      expect(service['getForm']).toHaveBeenCalledWith(stateId, yearId, 2, user);
    });

    it('throws a field-keyed validation error for an out-of-range installment', async () => {
      let caught: unknown;
      try {
        await controller.getForm(stateId, yearId, '3', user);
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeInstanceOf(BadRequestException);
      const response = (caught as BadRequestException).getResponse() as Record<string, unknown>;
      const errors = response['errors'] as Record<string, unknown>;
      expect(errors).toHaveProperty('installment');
      expect(service['getForm']).not.toHaveBeenCalled();
    });

    it('retains the VIEW_STATE_FORMS permission', () => {
      expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controller.getForm)).toEqual([Permission.VIEW_STATE_FORMS]);
    });
  });

  // ─── GET :stateId/:yearId/:installment/gtc-template ──────────────────────

  describe('getTemplate', () => {
    it('parses a valid installment and delegates to GtcService.getTemplate', async () => {
      await controller.getTemplate(stateId, yearId, '1', user);
      expect(service['getTemplate']).toHaveBeenCalledWith(stateId, yearId, 1, user);
    });

    it('retains the VIEW_STATE_FORMS permission', () => {
      expect(Reflect.getMetadata(REQUIRED_PERMISSIONS_KEY, controller.getTemplate)).toEqual([
        Permission.VIEW_STATE_FORMS,
      ]);
    });
  });

  // ─── POST save-draft ──────────────────────────────────────────────────────

  describe('saveDraft', () => {
    const dto = { stateId, yearId, installment: 1, data: { i2GtcFile: null } } as SaveGtcDto;

    it('delegates dto/user/ip/userAgent to GtcService.saveDraft', async () => {
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
    const dto = { stateId, yearId, installment: 1, data: { i2GtcFile: null } } as SaveGtcDto;

    it('delegates dto/user/ip/userAgent to GtcService.finalSubmit', async () => {
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
    await expect(controller.getForm(stateId, yearId, '1', user)).rejects.toBe(err);
  });
});
