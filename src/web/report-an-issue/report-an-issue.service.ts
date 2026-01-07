import { HttpStatus, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ReportAnIssue, ReportAnIssueDocument } from 'src/schemas/report-an-issue.schema';
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
}
