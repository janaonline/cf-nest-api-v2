import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { getModelToken } from '@nestjs/mongoose';
import { InternalServerErrorException, HttpStatus } from '@nestjs/common';
import { EmailQueueService } from 'src/core/queue/email-queue/email-queue.service';
import { ReportAnIssue } from 'src/schemas/report-an-issue.schema';
import { ExcelService } from 'src/services/excel/excel.service';
import { ReportAnIssueService } from './report-an-issue.service';

describe('ReportAnIssueService', () => {
  let service: ReportAnIssueService;
  let mockModel: {
    insertOne: jest.Mock;
    find: jest.Mock;
  };
  let mockExcelService: { generateExcel: jest.Mock };
  let mockEmailQueueService: { addEmailJob: jest.Mock };
  let mockConfigService: { get: jest.Mock };

  beforeEach(async () => {
    mockModel = {
      insertOne: jest.fn(),
      find: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue([]) }),
    };
    mockExcelService = { generateExcel: jest.fn() };
    mockEmailQueueService = { addEmailJob: jest.fn().mockResolvedValue(undefined) };
    mockConfigService = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportAnIssueService,
        { provide: getModelToken(ReportAnIssue.name), useValue: mockModel },
        { provide: ExcelService, useValue: mockExcelService },
        { provide: EmailQueueService, useValue: mockEmailQueueService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<ReportAnIssueService>(ReportAnIssueService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  // ─── uploadIssue ──────────────────────────────────────────────────────────

  describe('uploadIssue', () => {
    const payload = {
      issueKind: 'Bug',
      desc: 'Something broken',
      email: 'user@test.com',
    } as any;

    it('should insert record and return success response', async () => {
      mockModel.insertOne.mockResolvedValue({ _id: 'abc123' });
      mockConfigService.get.mockReturnValue(undefined); // no emails configured

      const result = await service.uploadIssue(payload);
      expect(mockModel.insertOne).toHaveBeenCalledWith(payload);
      expect(result.statusCode).toBe(HttpStatus.CREATED);
      expect(result.message).toContain('Feedback sent successfully!');
    });

    it('should send emails when USER_FEEDBACKS_TO_EMAILS is set', async () => {
      mockModel.insertOne.mockResolvedValue({ _id: 'abc123' });
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'USER_FEEDBACKS_TO_EMAILS') return 'a@test.com,b@test.com';
        if (key === 'AWS_STORAGE_URL') return 'https://s3.example.com/';
        return undefined;
      });

      await service.uploadIssue(payload);
      expect(mockEmailQueueService.addEmailJob).toHaveBeenCalledTimes(2);
    });

    it('should return error response when insert fails', async () => {
      mockModel.insertOne.mockRejectedValue(new Error('DB error'));
      const result = await service.uploadIssue(payload);
      expect(result.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      expect(result.message).toContain('Failed to submit feedback');
    });

    it('should return error when insertOne returns no _id', async () => {
      mockModel.insertOne.mockResolvedValue({ _id: null });
      const result = await service.uploadIssue(payload);
      expect(result.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    });

    it('should prepend AWS_STORAGE_URL to issueScreenshotUrl in email', async () => {
      const payloadWithScreenshot = { ...payload, issueScreenshotUrl: 'uploads/screenshot.png' };
      mockModel.insertOne.mockResolvedValue({ _id: 'abc123' });
      mockConfigService.get.mockImplementation((key: string) => {
        if (key === 'USER_FEEDBACKS_TO_EMAILS') return 'admin@test.com';
        if (key === 'AWS_STORAGE_URL') return 'https://s3.example.com/';
        return undefined;
      });

      await service.uploadIssue(payloadWithScreenshot);
      const emailJobCall = mockEmailQueueService.addEmailJob.mock.calls[0][0];
      expect(JSON.stringify(emailJobCall)).toContain('https://s3.example.com/');
    });
  });

  // ─── dumpIssueReported ────────────────────────────────────────────────────

  describe('dumpIssueReported', () => {
    it('should return excel buffer', async () => {
      const fakeBuffer = Buffer.from('PK fake-excel');
      mockModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue([]) });
      mockExcelService.generateExcel.mockResolvedValue(fakeBuffer);

      const result = await service.dumpIssueReported();
      expect(result).toEqual(fakeBuffer);
      expect(mockExcelService.generateExcel).toHaveBeenCalledTimes(1);
    });

    it('should prepend AWS_STORAGE_URL to screenshot URLs in data', async () => {
      const data = [{ issueScreenshotUrl: 'uploads/file.png', email: 'u@test.com' }];
      mockModel.find.mockReturnValue({ lean: jest.fn().mockResolvedValue(data) });
      mockConfigService.get.mockReturnValue('https://s3.example.com/');
      mockExcelService.generateExcel.mockResolvedValue(Buffer.from(''));

      await service.dumpIssueReported();
      expect(data[0].issueScreenshotUrl).toContain('https://s3.example.com/');
    });

    it('should throw InternalServerErrorException on error', async () => {
      mockModel.find.mockReturnValue({ lean: jest.fn().mockRejectedValue(new Error('DB error')) });
      await expect(service.dumpIssueReported()).rejects.toThrow(InternalServerErrorException);
    });
  });
});
