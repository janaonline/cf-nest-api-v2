import { Test, TestingModule } from '@nestjs/testing';
import { ReportAnIssueService } from './report-an-issue.service';

describe('ReportAnIssueService', () => {
  let service: ReportAnIssueService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [ReportAnIssueService],
    }).compile();

    service = module.get<ReportAnIssueService>(ReportAnIssueService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
