import { HttpStatus, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Buffer } from 'exceljs';
import { Model } from 'mongoose';
import { EmailQueueService } from 'src/core/queue/email-queue/email-queue.service';
import { ReportAnIssue, ReportAnIssueDocument } from 'src/schemas/report-an-issue.schema';
import { ExcelService, RowHeader } from 'src/services/excel/excel.service';
import { ReportAnIssueDto } from './dto/report-an-issue.dto';
const HEADERS = {
  issueKind: 'What kind of issues are you facing?',
  desc: 'Description',
  email: 'Email Address',
  issueScreenshotUrl: 'Include screenshot',
  autoCaptureContext: 'Auto Capture Context',
  createdAt: 'Creation date',
};
type HeaderKey = keyof typeof HEADERS;
type HeaderValue = (typeof HEADERS)[HeaderKey];

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

      // Restructure payload to send email.
      const emailContent: Partial<Record<HeaderValue, string>> = {};
      for (const [key, value] of Object.entries(payload) as [keyof typeof payload, string][]) {
        if (key in HEADERS) {
          const newKey = HEADERS[key];

          if (key === 'issueScreenshotUrl') emailContent[newKey] = process.env.AWS_STORAGE_URL + value;
          else emailContent[newKey] = value;
        }
      }

      // Send mail - when user sends feedback
      const toEmails: string | undefined = process.env.USER_FEEDBACKS_TO_EMAILS;
      if (!toEmails) {
        this.logger.warn('No email found!');
      } else {
        const emails = toEmails.split(',').map((e) => e.trim());

        await Promise.all(
          emails.map((email) =>
            this.emailQueueService.addEmailJob({
              to: email,
              subject: 'New user gave a feedback!',
              templateName: 'report-an-isssue',
              mailData: { emailContent, baseUrl: process.env.URL },
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
        { label: HEADERS.issueKind, key: 'issueKind', width: 30 },
        { label: HEADERS.desc, key: 'desc', width: 30 },
        { label: HEADERS.email, key: 'email', width: 20 },
        { label: HEADERS.issueScreenshotUrl, key: 'issueScreenshotUrl', width: 30 },
        { label: HEADERS.autoCaptureContext, key: 'autoCaptureContext', width: 30 },
        { label: HEADERS.createdAt, key: 'createdAt', width: 15 },
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
