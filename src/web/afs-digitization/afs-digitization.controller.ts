import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Res,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
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

  @Post('afs-list')
  async afsList(@Body() body: DigitizationReportQueryDto): Promise<any> {
    // query.yearId = new Types.ObjectId(query.yearId);
    // query.ulbId = query.ulbId ? new Types.ObjectId(query.ulbId) : undefined;
    // this.logger.log(`Received afs-list request with query: ${JSON.stringify(query)}`);
    return await this.afsService.afsList(body);
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

  @Post('upload-afs-file')
  async uploadAFSFile(@Body() body: DigitizationJobDto) {
    const result = await this.digitizationQueueService.upsertAfsExcelFile(body);
    return {
      status: 'success',
      data: result,
    };
  }

  @Post('digitize')
  async digitize(@Body() body: DigitizationJobDto) {
    const result = await this.digitizationQueueService.handleDigitizationJob(body);
    // HTTP 202 semantics: accepted for processing
    return {
      status: 'queued',
      result,
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
      ...result,
    };
  }

  @Get('metrics')
  async getMetrics() {
    return await this.afsService.getMetrics();
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
}
