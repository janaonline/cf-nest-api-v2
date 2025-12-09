import { Body, Controller, Get, Logger, Param, Post, Query, Res, UsePipes, ValidationPipe } from '@nestjs/common';
import type { Response } from 'express';
import { AfsDigitizationService } from './afs-digitization.service';
import { AfsDumpService } from './afs-dump.service';
import { DigitizationReportQueryDto } from './dto/digitization-report-query.dto';
import { Types } from 'mongoose';
import { YearIdToLabel } from 'src/core/constants/years';
import type { DigitizationJobData } from './dto/digitization-job-data';
import { DigitizationJobBatchDto } from './dto/digitization-job.dto';
import { ApiBody } from '@nestjs/swagger';
import { DigitizationQueueService } from './queue/digitization-queue/digitization-queue.service';

@Controller('afs-digitization')
export class AfsDigitizationController {
  logger = new Logger(AfsDigitizationController.name);

  constructor(
    // @InjectModel(AfsMetric.name, 'CONNECTION_2')
    // private afsMetricModel: Model<AfsMetricDocument>,

    private afsService: AfsDigitizationService,
    private afsDumpService: AfsDumpService,
    private digitizationQueueService: DigitizationQueueService,
  ) {}

  @Get('afs-list')
  async afsList(@Query() query: DigitizationReportQueryDto) {
    // query.yearId = new Types.ObjectId(query.yearId);
    // query.ulbId = query.ulbId ? new Types.ObjectId(query.ulbId) : undefined;
    // this.logger.log(`Received afs-list request with query: ${JSON.stringify(query)}`);
    return await this.afsService.afsList(query);
  }

  @Get('request-log/:requestId')
  async getRequestLog(@Param('requestId') requestId: string) {
    return { data: await this.afsService.getRequestLog(requestId) };
  }

  @Get('afsexcelfiles')
  // async downloadAfsExcelFiles(@Query('yearId') yearId: string, @Query('ulbId') ulbId?: string, @Res() res: Response) {
  async downloadAfsExcelFiles(@Query() query: DigitizationReportQueryDto, @Res() res: Response) {
    // query.yearId = new Types.ObjectId(query.yearId);
    // query.ulbId = query.ulbId ? new Types.ObjectId(query.ulbId) : undefined;
    const buffer = await this.afsDumpService.exportAfsExcelFiles(query);

    const filename = `afs-dump-${YearIdToLabel[query.yearId.toString()]}-${query.docType}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    return res.send(buffer);
  }

  @Get('with-afs')
  async getWithAfs(@Query() query: DigitizationReportQueryDto) {
    // query.yearId = new Types.ObjectId(query.yearId);
    // query.ulbId = query.ulbId ? new Types.ObjectId(query.ulbId) : undefined;
    return await this.afsDumpService.getAnnualWithAfsExcel(query);
  }

  @Post('digitize')
  async digitize(@Body() body: DigitizationJobData) {
    body = {
      annualAccountsId: '630085be29ef916762354bdc',
      ulb: '5dd24729437ba31f7eb42f46',
      year: '606aadac4dff55e6c075c507',
      auditType: 'audited',
      docType: 'bal_sheet_schedules',
      fileUrl:
        'https://jana-cityfinance-stg.s3.ap-south-1.amazonaws.com/objects/c908edc2-1b41-47e9-9a1e-62bc827d80c1.pdf',
      sourceType: 'ULB',
    };
    const result = await this.digitizationQueueService.handleDigitizationJob(body);
    // HTTP 202 semantics: accepted for processing
    return {
      status: 'queued',
      // ...result,
    };
  }

  @Post('enqueue-batch')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiBody({ type: DigitizationJobBatchDto })
  async enqueueBatch(@Body() body: DigitizationJobBatchDto) {
    const { jobs } = body;

    const result = await this.digitizationQueueService.enqueueBatch(jobs);
    return {
      status: 'queued',
      // ...result,
    };
  }

  @Get('status/:id')
  async status(@Param('id') id: string) {
    const result = await this.digitizationQueueService.jobStatus(id);
    return result;
  }
}
