import { HttpStatus, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Buffer } from 'exceljs';
import { Model } from 'mongoose';
import { EmailQueueService } from 'src/core/queue/email-queue/email-queue.service';
import { ReportAnIssue, ReportAnIssueDocument } from 'src/schemas/report-an-issue.schema';
import { ExcelService, RowHeader } from 'src/services/excel/excel.service';
import { ReportAnIssueDto } from './dto/report-an-issue.dto';
export interface ResponseData {
  message: string[];
  error?: string;
  statusCode: HttpStatus;
}

@Injectable()
export class ReportAnIssueService {
  private logger = new Logger('ReportAnIssueService');

  constructor(
    @InjectModel(ReportAnIssue.name)
    private readonly reportAnIssueModel: Model<ReportAnIssueDocument>,
    private excelService: ExcelService,
    private emailQueueService: EmailQueueService,
  ) {}

  /**
   * Insert user-submitted issue/feedback record to the database.
   *
   * This method:
   * - Inserts a new issue document into the `reportAnIssue` collection
   * - Verifies the insert was successful by checking for a generated `_id`
   * - Returns a standardized API response for both success and failure cases
   *
   * @param payload - Validated DTO containing issue details submitted
   * @returns Promise<ResponseData>: Standardized API response
   */
  public async uploadIssue(payload: ReportAnIssueDto): Promise<ResponseData> {
    try {
      const res = await this.reportAnIssueModel.insertOne(payload);

      if (!res?._id) {
        throw new InternalServerErrorException('Database insert failed');
      }

      // Send mail - when user sends feedback
      const toEmails: string | undefined = process.env.USER_FEEDBACKS_TO_EMAILS;
      if (toEmails) {
        const emails = toEmails.split(',').map((e) => e.trim());

        await Promise.all(
          emails.map((email) =>
            this.emailQueueService.addEmailJob({
              to: email,
              subject: 'New user gave a feedback!',
              templateName: 'report-an-isssue',
              mailData: { payload },
            }),
          ),
        );
      }

      return {
        message: ['Feedback sent successfully!'],
        error: undefined,
        statusCode: HttpStatus.CREATED,
      };
    } catch (error: unknown) {
      let errorMessage = 'Internal server error';

      if (error instanceof Error) {
        errorMessage = error.message;
      }

      this.logger.error(errorMessage);
      return {
        message: ['Failed to submit feedback'],
        error: errorMessage,
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      };
    }
  }

  public async dumpIssueReported(): Promise<Buffer> {
    try {
      const headers: RowHeader[] = [
        { label: 'What kind of issues are you facing?', key: 'issueKind', width: 30 },
        { label: 'Description', key: 'desc', width: 30 },
        { label: 'Email Address', key: 'email' },
        { label: 'Include screenshot', key: 'issueScreenshotUrl', width: 30 },
        { label: 'Auto Capture Context', key: 'autoCaptureContext', width: 30 },
        { label: 'Creation date', key: 'createdAt', width: 15 },
      ];

      const data: any[] = await this.reportAnIssueModel.find({}).lean();
      data.forEach((el: ReportAnIssueDto) => {
        // Add base URL to S3 path.
        if (el.issueScreenshotUrl) {
          el.issueScreenshotUrl = `${process.env.AWS_STORAGE_URL}${el.issueScreenshotUrl}`;
        }
      });
      return await this.excelService.generateExcel(headers, data, 'User_Feedback');
    } catch (error: unknown) {
      this.logger.error(error);
      throw new InternalServerErrorException('Failed to generate Excel file');
    }
  }
}
