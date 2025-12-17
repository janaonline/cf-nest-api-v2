import { Body, Controller, Get, Logger, Param, Post, Query, Res, UsePipes, ValidationPipe } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import type { Response } from 'express';
import { YearIdToLabel } from 'src/core/constants/years';
import { AfsDigitizationService } from './afs-digitization.service';
import { AfsDumpService } from './afs-dump.service';
import { DigitizationJobBatchDto, DigitizationJobDto } from './dto/digitization-job.dto';
import { DigitizationReportQueryDto } from './dto/digitization-report-query.dto';
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

  @Get('filters')
  async getAfsFilters() {
    return await this.afsService.getAfsFilters();
  }

  @Get('ulbs')
  async getUlbs(@Query() query: { populationCategory: string }) {
    return await this.afsService.getUlbs(query);
  }

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

  @Get('dump/afs-excel')
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

  @Post('digitize')
  async digitize(@Body() body: DigitizationJobDto) {
    // body = {
    //   annualAccountsId: '630085be29ef916762354bdc',
    //   ulb: '5dd24729437ba31f7eb42f46',
    //   year: '606aadac4dff55e6c075c507',
    //   auditType: 'audited',
    //   docType: 'bal_sheet_schedules',
    //   fileUrl:
    //     'https://jana-cityfinance-stg.s3-12345.ap-south-1.amazonaws.com/objects/c908edc2-1b41-47e9-9a1e-62bc827d80c1.pdf',
    //   uploadedBy: 'AFS',
    // };
    const result = await this.digitizationQueueService.handleDigitizationJob(body);
    // HTTP 202 semantics: accepted for processing
    return {
      status: 'queued',
      ...result,
    };
  }

  // @Post('copy-excel')
  // async copyExcel(@Body() body: DigitizationJobDataDto) {
  //   body = {
  //     annualAccountsId: '630085be29ef916762354bdc',
  //     ulb: '5dd24729437ba31f7eb42f46',
  //     year: '606aadac4dff55e6c075c507',
  //     auditType: 'audited',
  //     docType: 'bal_sheet_schedules',
  //     fileUrl:
  //       'https://jana-cityfinance-stg.s3.ap-south-1.amazonaws.com/objects/c908edc2-1b41-47e9-9a1e-62bc827d80c1.pdf',
  //     uploadedBy: 'ULB',
  //     digitizedExcelUrl:
  //       'afs/5dd24729437ba31f7eb42f46_606aadac4dff55e6c075c507_audited_bal_sheet_schedules_9778ccc5-c775-4369-a3bb-244dfc8240f0.xlsx',
  //   };
  //   const result = await this.digitizationQueueService.copyDigitizedExcel(body, body.digitizedExcelUrl!);
  //   // HTTP 202 semantics: accepted for processing
  //   return {
  //     status: 'queued',
  //     // ...result,
  //   };
  // }

  // @Post('read-excel')
  // async readExcel(@Body() body: DigitizationJobDataDto) {
  //   body = {
  //     annualAccountsId: '630085be29ef916762354bdc',
  //     ulb: '5dd24729437ba31f7eb42f46',
  //     year: '606aadac4dff55e6c075c507',
  //     auditType: 'audited',
  //     docType: 'bal_sheet_schedules',
  //     digitizedExcelUrl:
  //       'afs/5dd24729437ba31f7eb42f46_606aadac4dff55e6c075c507_audited_bal_sheet_schedules_9778ccc5-c775-4369-a3bb-244dfc8240f0.xlsx',
  //     // 'https://jana-cityfinance-stg.s3.ap-south-1.amazonaws.com/afs/5dd24729437ba31f7eb42f46_606aadac4dff55e6c075c507_audited_bal_sheet_schedules_9778ccc5-c775-4369-a3bb-244dfc8240f0.xlsx',
  //     fileUrl:
  //       'https://jana-cityfinance-stg.s3.ap-south-1.amazonaws.com/objects/c908edc2-1b41-47e9-9a1e-62bc827d80c1.pdf',
  //     uploadedBy: 'ULB',
  //   };
  //   const digitResp: DigitizationResponse = {
  //     overall_confidence_score: 95,
  //     request_id: 'req-12345',
  //     error_code: null,
  //     status: 'completed',
  //     message: 'Success',
  //     S3_Excel_Storage_Link: '',
  //     status_code: 200,
  //     processing_mode: 'direct',
  //     total_processing_time_ms: 12345,
  //   };
  //   const result = await this.digitizationQueueService.saveAfsExcelFileRecord(body, digitResp);
  //   // HTTP 202 semantics: accepted for processing
  //   return {
  //     status: 'queued',
  //     // ...result,
  //   };
  // }

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

  @Get('file/:id')
  async getFile(@Param('id') id: string) {
    const result = await this.afsService.getFile(id);
    return result;
  }
}
