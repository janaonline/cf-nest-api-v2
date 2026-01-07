import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ReportAnIssue, ReportAnIssueSchema } from 'src/schemas/report-an-issue.schema';
import { ReportAnIssueController } from './report-an-issue.controller';
import { ReportAnIssueService } from './report-an-issue.service';

@Module({
  imports: [MongooseModule.forFeature([{ name: ReportAnIssue.name, schema: ReportAnIssueSchema }])],
  controllers: [ReportAnIssueController],
  providers: [ReportAnIssueService],
})
export class ReportAnIssueModule {}
