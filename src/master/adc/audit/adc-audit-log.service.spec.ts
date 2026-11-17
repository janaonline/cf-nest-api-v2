import { Logger } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Types } from 'mongoose';
import { AdcAuditAction, AdcAuditLog } from 'src/schemas/adc-audit-log.schema';
import { AdcAuditLogService } from './adc-audit-log.service';

describe('AdcAuditLogService', () => {
  let service: AdcAuditLogService;
  let auditModel: { create: jest.Mock };

  const adc = new Types.ObjectId();
  const state = new Types.ObjectId();
  const performedBy = new Types.ObjectId().toString();

  beforeEach(async () => {
    auditModel = { create: jest.fn().mockResolvedValue({}) };
    const module: TestingModule = await Test.createTestingModule({
      providers: [AdcAuditLogService, { provide: getModelToken(AdcAuditLog.name), useValue: auditModel }],
    }).compile();
    service = module.get(AdcAuditLogService);
  });

  afterEach(() => jest.restoreAllMocks());

  it('writes exactly one entry per call, with ids as ObjectIds and only the fields given', async () => {
    const user = new Types.ObjectId().toString();

    await service.record({
      action: AdcAuditAction.MEMBER_REMOVED,
      adc,
      adcName: 'BTC',
      state: String(state),
      performedBy,
      actorRole: 'ADC_ADMIN',
      user,
    });

    expect(auditModel.create).toHaveBeenCalledTimes(1);
    expect(auditModel.create).toHaveBeenCalledWith({
      action: 'MEMBER_REMOVED',
      adc,
      adcName: 'BTC',
      state,
      performedBy: new Types.ObjectId(performedBy),
      actorRole: 'ADC_ADMIN',
      user: new Types.ObjectId(user),
    });
  });

  it('never throws when the write fails, it only logs the error', async () => {
    auditModel.create.mockRejectedValue(new Error('db down'));
    const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    await expect(
      service.record({
        action: AdcAuditAction.ADC_DELETED,
        adc,
        adcName: 'BTC',
        state,
        performedBy,
        actorRole: 'PORTAL_ADMIN',
      }),
    ).resolves.toBeUndefined();
    expect(logError).toHaveBeenCalled();
  });
});
