import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { EmailQueueService } from 'src/core/queue/email-queue/email-queue.service';
import { ReportAnIssue } from 'src/schemas/report-an-issue.schema';
import { ExcelService } from 'src/services/excel/excel.service';
import { ReportAnIssueService } from './report-an-issue.service';

describe('ReportAnIssueService', () => {
  let service: ReportAnIssueService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportAnIssueService,
        {
          provide: getModelToken(ReportAnIssue.name),
          useValue: {
            insertOne: jest.fn(),
            find: jest.fn().mockReturnValue({ lean: jest.fn() }),
          },
        },
        {
          provide: ExcelService,
          useValue: {
            generateExcel: jest.fn(),
          },
        },
        {
          provide: EmailQueueService,
          useValue: {
            addEmailJob: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<ReportAnIssueService>(ReportAnIssueService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
