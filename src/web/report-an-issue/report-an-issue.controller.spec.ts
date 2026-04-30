import { Test, TestingModule } from '@nestjs/testing';
import { StreamableFile } from '@nestjs/common';
import { ReportAnIssueController } from './report-an-issue.controller';
import { ReportAnIssueService } from './report-an-issue.service';
import { HttpStatus } from '@nestjs/common';

describe('ReportAnIssueController', () => {
  let controller: ReportAnIssueController;
  let service: jest.Mocked<ReportAnIssueService>;

  const mockBuffer = Buffer.from('PK fake-excel-content');

  beforeEach(async () => {
    const mockService = {
      uploadIssue: jest.fn(),
      dumpIssueReported: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportAnIssueController],
      providers: [{ provide: ReportAnIssueService, useValue: mockService }],
    }).compile();

    controller = module.get<ReportAnIssueController>(ReportAnIssueController);
    service = module.get(ReportAnIssueService);
  });

  afterEach(() => jest.clearAllMocks());

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('uploadIssue', () => {
    const dto = {
      issueKind: 'Bug',
      desc: 'Something broken',
      email: 'user@test.com',
    } as any;

    it('should call service.uploadIssue and return success response', async () => {
      const serviceResponse = {
        message: ['Feedback sent successfully!'],
        error: undefined,
        statusCode: HttpStatus.CREATED,
      };
      service.uploadIssue.mockResolvedValue(serviceResponse);
      const result = await controller.uploadIssue(dto);
      expect(service.uploadIssue).toHaveBeenCalledWith(dto);
      expect(result).toEqual(serviceResponse);
    });

    it('should return error response from service on failure', async () => {
      const errorResponse = {
        message: ['Failed to submit feedback'],
        error: 'Internal server error',
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      };
      service.uploadIssue.mockResolvedValue(errorResponse);
      const result = await controller.uploadIssue(dto);
      expect(result.statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    });
  });

  describe('dumpIssueReported', () => {
    it('should return a StreamableFile', async () => {
      service.dumpIssueReported.mockResolvedValue(mockBuffer as any);
      const result = await controller.dumpIssueReported();
      expect(result).toBeInstanceOf(StreamableFile);
    });

    it('should call service.dumpIssueReported once', async () => {
      service.dumpIssueReported.mockResolvedValue(mockBuffer as any);
      await controller.dumpIssueReported();
      expect(service.dumpIssueReported).toHaveBeenCalledTimes(1);
    });

    it('should propagate error from service', async () => {
      service.dumpIssueReported.mockRejectedValue(new Error('Excel generation failed'));
      await expect(controller.dumpIssueReported()).rejects.toThrow('Excel generation failed');
    });
  });
});
