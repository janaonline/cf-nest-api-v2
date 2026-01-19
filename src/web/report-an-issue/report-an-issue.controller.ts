import { Body, Controller, Get, Post, StreamableFile } from '@nestjs/common';
import { ReportAnIssueDto } from './dto/report-an-issue.dto';
import { ReportAnIssueService } from './report-an-issue.service';
import { getTimeStamp } from 'src/shared/utils/date.utils';

@Controller('report-an-issue')
export class ReportAnIssueController {
  constructor(private reportIssueService: ReportAnIssueService) {}

  @Post()
  uploadIssue(@Body() payload: ReportAnIssueDto) {
    return this.reportIssueService.uploadIssue(payload);
  }

  @Get('get-dump')
  async dumpIssueReported(): Promise<StreamableFile> {
    const buffer = await this.reportIssueService.dumpIssueReported();
    // const stream = Readable.from(buffer);

    return new StreamableFile(new Uint8Array(buffer), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="User_Feedback_${getTimeStamp(false)}.xlsx"`,
    });
  }
}
