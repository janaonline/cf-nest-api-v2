import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { AnnualAccountsController } from './annual_accounts.controller';
import { AnnualAccountsService } from './annual_accounts.service';
import { XviFcAnnualAccount } from '../../../../schemas/xvi-fc/annual-account.schema';
import { XviFcAnnualAccountUploadHistory } from '../../../../schemas/xvi-fc/annual-account-upload-history.schema';
import { XviFcAnnualAccountFormLog } from '../../../../schemas/xvi-fc/annual-account-form-log.schema';
import { XviFcDocumentActionGate } from '../../../../schemas/xvi-fc/document-action-gate.schema';
import { Ulb } from '../../../../schemas/ulb.schema';
import { User } from '../../../../schemas/user/user.schema';
import { S3Service } from '../../../../core/s3/s3.service';
import { S3UploadService } from '../../../file/s3-upload.service';
import { FormJsonService } from '../../../../master/form-json/form-json.service';
import { FileTokenService } from '../../../../core/file-token/file-token.service';
import { EmailQueueService } from '../../../../core/queue/email-queue/email-queue.service';
import { ConfigService } from '@nestjs/config';
import { ANNUAL_ACCOUNT_PROCESSING_QUEUE } from '../../../../core/constants/queues';
import { UlbEligibilityService } from '../../../ulb-eligibility/ulb-eligibility.service';
import type { AuthUser } from '../../../auth/auth-user.interface';
import type { Request } from 'express';

describe('AnnualAccountsController', () => {
  let controller: AnnualAccountsController;

  beforeEach(async () => {
    const mockAnnualAccountModel = {
      findById: jest.fn(),
      findOne: jest.fn(),
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn(),
    };
    const mockUploadHistoryModel = {
      countDocuments: jest.fn(),
      create: jest.fn(),
      findOne: jest.fn(),
      updateOne: jest.fn(),
      collection: {
        dropIndex: jest.fn().mockResolvedValue(undefined),
      },
    };
    const mockFormLogModel = {
      create: jest.fn(),
    };
    const mockUlbModel = {
      findById: jest.fn(),
    };
    const mockUserModel = {
      findOne: jest.fn().mockReturnValue({ select: () => ({ lean: () => ({ exec: () => Promise.resolve(null) }) }) }),
    };
    const mockActionGateModel = {
      find: jest.fn().mockReturnValue({ lean: () => ({ exec: () => Promise.resolve([]) }) }),
    };
    const mockS3Service = {
      headObject: jest.fn(),
      getPdfBufferFromS3: jest.fn(),
      getPdfPageCountFromBuffer: jest.fn(),
      presignGet: jest.fn(),
    };
    const mockS3UploadService = {
      generatePutSignedUrl: jest.fn(),
    };
    const mockOcrQueue = {
      add: jest.fn(),
    };
    const mockFormJsonService = {
      findActiveByDesignYearAndFormId: jest.fn(),
    };
    const mockFileTokenService = {
      signFileUrl: jest.fn((path: string) => `https://signed.example.com/${path}`),
    };
    const mockEmailQueueService = {
      addEmailJob: jest.fn().mockResolvedValue(undefined),
    };
    const mockConfigService = {
      get: jest.fn(),
    };
    const mockUlbEligibilityService = {
      assertUlbEligibleForGrantCycle: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnnualAccountsController],
      providers: [
        AnnualAccountsService,
        { provide: getModelToken(XviFcAnnualAccount.name), useValue: mockAnnualAccountModel },
        { provide: getModelToken(XviFcAnnualAccountUploadHistory.name), useValue: mockUploadHistoryModel },
        { provide: getModelToken(XviFcAnnualAccountFormLog.name), useValue: mockFormLogModel },
        { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
        { provide: getModelToken(User.name), useValue: mockUserModel },
        { provide: getModelToken(XviFcDocumentActionGate.name), useValue: mockActionGateModel },
        { provide: S3Service, useValue: mockS3Service },
        { provide: S3UploadService, useValue: mockS3UploadService },
        { provide: getQueueToken(ANNUAL_ACCOUNT_PROCESSING_QUEUE), useValue: mockOcrQueue },
        { provide: FormJsonService, useValue: mockFormJsonService },
        { provide: FileTokenService, useValue: mockFileTokenService },
        { provide: EmailQueueService, useValue: mockEmailQueueService },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: UlbEligibilityService, useValue: mockUlbEligibilityService },
      ],
    }).compile();

    controller = module.get<AnnualAccountsController>(AnnualAccountsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  const testUser: AuthUser = { _id: 'user-1', role: 'STATE', scope: null, accessLevel: null };

  it('undoDocumentDecision rejects a section other than auditedData/unauditedData', () => {
    expect(() => controller.undoDocumentDecision('id-1', 'doc-1', 'somethingElse', testUser)).toThrow(
      'section must be "auditedData" or "unauditedData"',
    );
  });

  it('undoDocumentDecision delegates to the service for a valid section', async () => {
    const spy = jest
      .spyOn(controller['annualAccountsService'], 'undoDocumentDecision')
      .mockImplementation(
        () =>
          Promise.resolve({ annualAccountId: 'id-1' }) as unknown as ReturnType<
            AnnualAccountsService['undoDocumentDecision']
          >,
      );

    await controller.undoDocumentDecision('id-1', 'doc-1', 'auditedData', testUser);

    expect(spy).toHaveBeenCalledWith('id-1', 'auditedData', 'doc-1', testUser);
  });

  it('requestManualReview rejects a section other than auditedData/unauditedData', () => {
    expect(() => controller.requestManualReview('id-1', 'doc-1', 'somethingElse', testUser)).toThrow(
      'section must be "auditedData" or "unauditedData"',
    );
  });

  it('requestManualReview delegates to the service for a valid section', async () => {
    const spy = jest
      .spyOn(controller['annualAccountsService'], 'requestManualReview')
      .mockImplementation(
        () =>
          Promise.resolve({ annualAccountId: 'id-1' }) as unknown as ReturnType<
            AnnualAccountsService['requestManualReview']
          >,
      );

    await controller.requestManualReview('id-1', 'doc-1', 'auditedData', testUser);

    expect(spy).toHaveBeenCalledWith('id-1', 'auditedData', 'doc-1', testUser);
  });

  const fakeReq = { headers: {}, socket: {} } as unknown as Request;

  it('decideManualReview rejects a section other than auditedData/unauditedData', () => {
    expect(() =>
      controller.decideManualReview('id-1', 'doc-1', 'somethingElse', { decision: 'APPROVED' }, testUser, fakeReq),
    ).toThrow('section must be "auditedData" or "unauditedData"');
  });

  it('decideManualReview delegates to the service for a valid section', async () => {
    const spy = jest
      .spyOn(controller['annualAccountsService'], 'decideManualReview')
      .mockImplementation(
        () =>
          Promise.resolve({ annualAccountId: 'id-1' }) as unknown as ReturnType<
            AnnualAccountsService['decideManualReview']
          >,
      );

    await controller.decideManualReview('id-1', 'doc-1', 'auditedData', { decision: 'APPROVED' }, testUser, fakeReq);

    expect(spy).toHaveBeenCalledWith('id-1', 'auditedData', 'doc-1', { decision: 'APPROVED' }, testUser, null, null);
  });

  it('getDetails rejects a section other than auditedData/unauditedData', () => {
    expect(() => controller.getDetails('id-1', 'somethingElse', testUser)).toThrow(
      'section must be "auditedData" or "unauditedData"',
    );
  });

  it('getDetails delegates to the service for a valid section', async () => {
    const spy = jest
      .spyOn(controller['annualAccountsService'], 'getDetails')
      .mockImplementation(
        () =>
          Promise.resolve({ annualAccountId: 'id-1', data: null }) as unknown as ReturnType<
            AnnualAccountsService['getDetails']
          >,
      );

    await controller.getDetails('id-1', 'auditedData', testUser);

    expect(spy).toHaveBeenCalledWith('id-1', 'auditedData', testUser);
  });

  it('getProcessingStatus rejects a section other than auditedData/unauditedData', () => {
    expect(() => controller.getProcessingStatus('id-1', 'somethingElse', testUser)).toThrow(
      'section must be "auditedData" or "unauditedData"',
    );
  });

  it('getProcessingStatus delegates to the service for a valid section', async () => {
    const spy = jest
      .spyOn(controller['annualAccountsService'], 'getProcessingStatus')
      .mockImplementation(
        () =>
          Promise.resolve({ annualAccountId: 'id-1', ulbName: null, ulbCode: null, data: null }) as unknown as ReturnType<
            AnnualAccountsService['getProcessingStatus']
          >,
      );

    await controller.getProcessingStatus('id-1', 'unauditedData', testUser);

    expect(spy).toHaveBeenCalledWith('id-1', 'unauditedData', testUser);
  });

  it('findByUlbAndYear rejects a section other than auditedData/unauditedData', () => {
    expect(() => controller.findByUlbAndYear('ulb-1', 'year-1', 'somethingElse', testUser)).toThrow(
      'section must be "auditedData" or "unauditedData"',
    );
  });

  it('findByUlbAndYear delegates to the service for a valid section', async () => {
    const spy = jest
      .spyOn(controller['annualAccountsService'], 'findByUlbAndYear')
      .mockImplementation(() => Promise.resolve(null) as unknown as ReturnType<AnnualAccountsService['findByUlbAndYear']>);

    await controller.findByUlbAndYear('ulb-1', 'year-1', 'auditedData', testUser);

    expect(spy).toHaveBeenCalledWith('ulb-1', 'year-1', 'auditedData', testUser);
  });

  it('getManualReviewQueue delegates to the service', async () => {
    const spy = jest
      .spyOn(controller['annualAccountsService'], 'getManualReviewQueue')
      .mockImplementation(
        () =>
          Promise.resolve({ total: 0, page: 1, pageSize: 20, rows: [] }) as unknown as ReturnType<
            AnnualAccountsService['getManualReviewQueue']
          >,
      );

    const dto = { page: 1, pageSize: 20 };
    await controller.getManualReviewQueue(dto as never, testUser);

    expect(spy).toHaveBeenCalledWith(dto, testUser);
  });
});
