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
import { S3Service } from '../../../../core/s3/s3.service';
import { S3UploadService } from '../../../../s3-upload/s3-upload.service';
import { FormJsonService } from '../../../../master/form-json/form-json.service';
import { ANNUAL_ACCOUNT_PROCESSING_QUEUE } from '../../../../core/constants/queues';
import type { AuthUser } from '../../../auth/auth-user.interface';

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

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnnualAccountsController],
      providers: [
        AnnualAccountsService,
        { provide: getModelToken(XviFcAnnualAccount.name), useValue: mockAnnualAccountModel },
        { provide: getModelToken(XviFcAnnualAccountUploadHistory.name), useValue: mockUploadHistoryModel },
        { provide: getModelToken(XviFcAnnualAccountFormLog.name), useValue: mockFormLogModel },
        { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
        { provide: getModelToken(XviFcDocumentActionGate.name), useValue: mockActionGateModel },
        { provide: S3Service, useValue: mockS3Service },
        { provide: S3UploadService, useValue: mockS3UploadService },
        { provide: getQueueToken(ANNUAL_ACCOUNT_PROCESSING_QUEUE), useValue: mockOcrQueue },
        { provide: FormJsonService, useValue: mockFormJsonService },
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
});
