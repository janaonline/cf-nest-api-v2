import { Test, TestingModule } from '@nestjs/testing';
import { ReportAnIssueController } from './report-an-issue.controller';
import { ReportAnIssueService } from './report-an-issue.service';

describe('ReportAnIssueController', () => {
  let controller: ReportAnIssueController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportAnIssueController],
      providers: [
        {
          provide: ReportAnIssueService,
          useValue: {
            uploadIssue: jest.fn(),
            dumpIssueReported: jest.fn(),
          },
        },
      ],
    }).compile();

    controller = module.get<ReportAnIssueController>(ReportAnIssueController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
