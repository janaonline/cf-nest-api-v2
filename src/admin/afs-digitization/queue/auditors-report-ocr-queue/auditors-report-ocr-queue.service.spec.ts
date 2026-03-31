import { Test, TestingModule } from '@nestjs/testing';
import { AuditorsReportOcrQueueService } from './auditors-report-ocr-queue.service';

describe('AuditorsReportOcrQueueService', () => {
  let service: AuditorsReportOcrQueueService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditorsReportOcrQueueService],
    }).compile();

    service = module.get<AuditorsReportOcrQueueService>(AuditorsReportOcrQueueService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
