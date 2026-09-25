import { Body, Controller, Get, Post, StreamableFile, UseGuards } from '@nestjs/common';
import { ReportAnIssueDto } from './dto/report-an-issue.dto';
import { ReportAnIssueService } from './report-an-issue.service';
import { getTimeStamp } from 'src/shared/utils/date.utils';
import { Public } from 'src/module/auth/decorators/public.decorator';
import { Roles } from 'src/module/auth/decorators/roles.decorator';
import { Role } from 'src/module/auth/enum/role.enum';
import { RolesGuard } from 'src/module/auth/guards/roles.guard';

@Controller('report-an-issue')
export class ReportAnIssueController {
  constructor(private reportIssueService: ReportAnIssueService) {}

  @Public()
  @Post()
  uploadIssue(@Body() payload: ReportAnIssueDto) {
    return this.reportIssueService.uploadIssue(payload);
  }

  @Roles([Role.ADMIN])
  @UseGuards(RolesGuard)
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
