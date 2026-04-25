import { Test, TestingModule } from '@nestjs/testing';
import { HttpService } from '@nestjs/axios';
import { getQueueToken } from '@nestjs/bullmq';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { AFS_AUDITORS_REPORT_QUEUE } from 'src/core/constants/queues';
import { S3Service } from 'src/core/s3/s3.service';
import { AfsAuditorsReport } from 'src/schemas/afs/afs-auditors-report.schema';
import { AfsExcelFile } from 'src/schemas/afs/afs-excel-file.schema';
import { AfsMetric } from 'src/schemas/afs/afs-metrics.schema';
import { AuditorsReportOcrQueueService } from './auditors-report-ocr-queue.service';

describe('AuditorsReportOcrQueueService', () => {
  let service: AuditorsReportOcrQueueService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditorsReportOcrQueueService,
        {
          provide: getQueueToken(AFS_AUDITORS_REPORT_QUEUE),
          useValue: {
            add: jest.fn(),
            getJob: jest.fn(),
          },
        },
        {
          provide: getModelToken(AfsExcelFile.name),
          useValue: {},
        },
        {
          provide: getModelToken(AfsAuditorsReport.name),
          useValue: {
            findOneAndUpdate: jest.fn(),
            updateOne: jest.fn(),
          },
        },
        {
          provide: getModelToken(AfsMetric.name),
          useValue: {
            updateOne: jest.fn(),
          },
        },
        {
          provide: S3Service,
          useValue: {
            getPdfBufferFromS3: jest.fn(),
            getPdfPageCountFromBuffer: jest.fn(),
            copyFileBetweenBuckets: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
        {
          provide: HttpService,
          useValue: {
            post: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuditorsReportOcrQueueService>(AuditorsReportOcrQueueService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
