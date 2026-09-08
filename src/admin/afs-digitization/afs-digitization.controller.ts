import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes , ApiBearerAuth } from '@nestjs/swagger';
import type { Response } from 'express';
import { YearIdToLabel } from 'src/core/constants/years';
import { AfsDigitizationService } from './afs-digitization.service';
import { AfsDumpService } from './afs-dump.service';
import { AuditorReportDto } from './dto/auditor-report.dto';
import { DigitizationJobBatchDto, DigitizationJobDto } from './dto/digitization-job.dto';
import { DigitizationReportQueryDto } from './dto/digitization-report-query.dto';
import { AfsFileList, AfsFileReport } from './dto/interface';
import { ResourcesSectionExcelListDto } from './dto/resources-section-excel-list.dto';
import { ResourcesSectionExcelReportDto } from './dto/resources-section-excel-report.dto';
import { SubmitARDecisionDto } from './dto/submit-ar-decision.dto';
import { AuditorsReportOcrQueueService } from './queue/auditors-report-ocr-queue/auditors-report-ocr-queue.service';
import { DigitizationQueueService } from './queue/digitization-queue/digitization-queue.service';
import { Public } from 'src/module/auth/decorators/public.decorator';

@Controller('afs-digitization')
export class AfsDigitizationController {
  logger = new Logger(AfsDigitizationController.name);

  constructor(
    // @InjectModel(AfsMetric.name, 'CONNECTION_2')
    // private afsMetricModel: Model<AfsMetricDocument>,

    private afsService: AfsDigitizationService,
    private afsDumpService: AfsDumpService,
    private digitizationQueueService: DigitizationQueueService,
    private ocrQueueService: AuditorsReportOcrQueueService,
  ) {}

  @Get('filters')
  async getAfsFilters() {
    return await this.afsService.getAfsFilters();
  }

  @Get('ulbs')
  async getUlbs(@Query() query: { populationCategory: string }) {
    return await this.afsService.getUlbs(query);
  }

  @Post('afs-list')
  async afsList(@Body() body: DigitizationReportQueryDto): Promise<any> {
    // query.yearId = new Types.ObjectId(query.yearId);
    // query.ulbId = query.ulbId ? new Types.ObjectId(query.ulbId) : undefined;
    // this.logger.log(`Received afs-list request with query: ${JSON.stringify(query)}`);
    return await this.afsService.afsList(body);
  }

  @Public()
  @Get('afs-list')
  async getAfsList(@Query() query: ResourcesSectionExcelListDto): Promise<AfsFileList> {
    return await this.afsService.getAfsList(query);
  }

  @Public()
  @Get('afs-excel-report')
  async getAfsReport(@Query() query: ResourcesSectionExcelReportDto): Promise<AfsFileReport> {
    return await this.afsService.getAfsReport(query);
  }

  @Get('request-log/:requestId')
  async getRequestLog(@Param('requestId') requestId: string) {
    return await this.afsService.getRequestLog(requestId);
  }
  /**
   * Updates PDF metadata for a specific annual account
   * @param id 
   * @returns 
   */
  @ApiBearerAuth()
  @Post('annual-account/:id/pdf-metadata')
  async updateAnnualAccountPdfMetadata(@Param('id') id: string) {
    return {
      status: 'success',
      data: await this.afsService.updatePdfMetadataForAnnualAccount(id),
    };
  }

  @ApiBearerAuth()
  @Get('annual-accounts/pdf-metadata/status')
  async getAnnualAccountPdfMetadataStatus() {
    return {
      status: 'success',
      data: await this.afsService.getPdfMetadataBackfillStatus(),
    };
  }

  /**
   * Backfills PDF metadata for annual account documents.
   */
  @ApiBearerAuth()
  @Post('annual-accounts/pdf-metadata/backfill')
  async backfillAnnualAccountPdfMetadata(
    @Query('batchSize') batchSize?: string,
    @Query('limit') limit?: string,
    @Query('onlyMissing') onlyMissing?: string,
  ) {
    return {
      status: 'success',
      data: await this.afsService.backfillPdfMetadataForAnnualAccounts({
        batchSize: batchSize ? Number(batchSize) : undefined,
        limit: limit ? Number(limit) : undefined,
        onlyMissing: onlyMissing === undefined ? true : onlyMissing !== 'false',
      }),
    };
  }

  @Get('dump/afs-excel')
  // async downloadAfsExcelFiles(@Query('yearId') yearId: string, @Query('ulbId') ulbId?: string, @Res() res: Response) {
  async downloadAfsExcelFiles(@Query() query: DigitizationReportQueryDto, @Res() res: Response) {
    // query.yearId = new Types.ObjectId(query.yearId);
    // query.ulbId = query.ulbId ? new Types.ObjectId(query.ulbId) : undefined;
    const buffer = await this.afsDumpService.exportAfsExcelFiles(query);

    const filename = `afs-dump-${YearIdToLabel[query.yearId.toString()]}-${query.docType}-${query.auditType}-${new Date().toISOString().split('T')[0]}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    return res.send(buffer);
  }

  @Post('upload-afs-file')
  async uploadAFSFile(@Body() body: DigitizationJobDto) {
    return await this.digitizationQueueService.upsertAfsExcelFile(body);
  }

  @Public()
  @Post('upload-ulb-keywords')
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
      required: ['file'],
    },
  })
  async uploadUlbKeywords(@UploadedFile() file: Express.Multer.File) {
    const result = await this.afsService.uploadUlbKeywords(file);
    return {
      status: 'success',
      data: result,
    };
  }

  // @Post('digitize')
  // async digitize(@Body() body: DigitizationJobDto) {
  //   const result = await this.digitizationQueueService.handleDigitizationJob(body);
  //   // HTTP 202 semantics: accepted for processing
  //   return {
  //     status: 'queued',
  //     result,
  //   };
  // }

  @Post('enqueue-batch')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiBody({ type: DigitizationJobBatchDto })
  async enqueueBatch(@Body() body: DigitizationJobBatchDto) {
    const { jobs } = body;
    if (jobs[0].docType === 'auditor_report') {
      const result = await this.ocrQueueService.enqueueBatch(jobs);
      return {
        status: 'queued',
        ...result,
      };
    } else {
      const result = await this.digitizationQueueService.enqueueBatch(jobs);
      return {
        status: 'queued',
        ...result,
      };
    }
  }

  @Post('auditors-report-ocr-queue')
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @ApiBody({ type: DigitizationJobBatchDto })
  async enqueueAuditorsReportOcrBatch(@Body() body: DigitizationJobBatchDto) {
    const { jobs } = body;

    // For now, we can use the same queue method since both jobs have the same structure.
    // If needed, we can create a separate method in the queue service for auditors report OCR jobs.
    const result = await this.ocrQueueService.enqueueBatch(jobs);
    return {
      status: 'queued',
      ...result,
    };
  }

  @Get('metrics')
  async getMetrics() {
    return await this.afsService.getMetrics();
  }

  @Get('metrics-afs')
  async getMetricsAfs() {
    return await this.afsService.getMetricsAfs();
  }

  @Get('status/:id')
  async status(@Param('id') id: string) {
    return await this.digitizationQueueService.jobStatus(id);
  }

  @Post('remove-job')
  async removeJob(@Body() job: DigitizationJobDto) {
    return await this.digitizationQueueService.markJobRemoved(job);
  }

  @Get('file/:id')
  async getFile(@Param('id') id: string) {
    return await this.afsService.getFile(id);
  }

  @Get('get-auditors-report')
  async getAuditorsReport(@Query() query: AuditorReportDto) {
    return await this.afsService.getAuditorsReport(query);
  }

  @Get('get-ar-item/:id')
  async getAuditorsReportItem(@Param('id') id: string) {
    return await this.afsService.getAuditorsReportItem(id);
  }

  @Post('submit-ar-decision')
  async submitARDecision(@Body() body: SubmitARDecisionDto) {
    return await this.afsService.submitARDecision(body);
  }
}
