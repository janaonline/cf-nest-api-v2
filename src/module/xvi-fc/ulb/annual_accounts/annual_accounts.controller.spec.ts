import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { AnnualAccountsController } from './annual_accounts.controller';
import { AnnualAccountsService } from './annual_accounts.service';
import { XviFcAnnualAccount } from '../../../../schemas/xvi-fc/annual-account.schema';
import { XviFcAnnualAccountUploadHistory } from '../../../../schemas/xvi-fc/annual-account-upload-history.schema';
import { Ulb } from '../../../../schemas/ulb.schema';
import { S3Service } from '../../../../core/s3/s3.service';
import { S3UploadService } from '../../../../s3-upload/s3-upload.service';
import { FormJsonService } from '../../../../form-json/form-json.service';
import { ANNUAL_ACCOUNT_PROCESSING_QUEUE } from '../../../../core/constants/queues';

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
    const mockUlbModel = {
      findById: jest.fn(),
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
        { provide: getModelToken(Ulb.name), useValue: mockUlbModel },
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
});
