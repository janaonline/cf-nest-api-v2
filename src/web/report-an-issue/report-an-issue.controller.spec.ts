import { Test, TestingModule } from '@nestjs/testing';
import { ReportAnIssueController } from './report-an-issue.controller';

describe('ReportAnIssueController', () => {
  let controller: ReportAnIssueController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ReportAnIssueController],
    }).compile();

    controller = module.get<ReportAnIssueController>(ReportAnIssueController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
