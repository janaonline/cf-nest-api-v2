import { Body, Controller, Post } from '@nestjs/common';
import { ReportAnIssueDto } from './dto/report-an-issue.dto';
import { ReportAnIssueService } from './report-an-issue.service';

@Controller('report-an-issue')
export class ReportAnIssueController {
  constructor(private reportIssueService: ReportAnIssueService) {}

  @Post()
  uploadIssue(@Body() payload: ReportAnIssueDto) {
    return this.reportIssueService.uploadIssue(payload);
  }
}
