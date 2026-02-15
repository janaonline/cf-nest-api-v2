import { HttpService } from '@nestjs/axios';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { delay, firstValueFrom, of } from 'rxjs';
import { AFS_DIGITIZATION_QUEUE } from 'src/core/constants/queues';
import { DigitizationJobDto } from '../dto/digitization-job.dto';
import { AuditorsReportOcrQueueService } from './auditors-report-ocr-queue/auditors-report-ocr-queue.service';

@Processor(AFS_DIGITIZATION_QUEUE, { concurrency: 1 })
export class AuditorsReportOcrProcessor extends WorkerHost {
  private readonly logger = new Logger(AuditorsReportOcrProcessor.name);

  constructor(
    private readonly http: HttpService,
    private readonly ocrService: AuditorsReportOcrQueueService,
  ) {
    super();
  }

  // BullMQ entry point
  async process(job: Job<DigitizationJobDto>): Promise<void> {
    const data = job.data;
    // this.logger.log(`Processing `, data);

    await this.ocrService.handleAuditorsReportOcrJob(data);
    // await this.handleDigitizationJob(job);
    // await this.handleDigitizationJob_test();
    this.logger.log(`✅ Auditors Report OCR job ${job.id} completed`);
  }

  async handleDigitizationJob_test() {
    this.logger.log(`Inside handleDigitizationJob_test`);
    const delayedObservable$ = of('A', 'B', 'C').pipe(
      delay(5000), // Delay all emissions by 5 seconds (5000ms)
    );

    console.log('Subscription started at:', new Date().toLocaleTimeString());

    delayedObservable$.subscribe((value) => {
      console.log(`Received value: ${value} at ${new Date().toLocaleTimeString()}`);
    });
    const pdfResp = await firstValueFrom(delayedObservable$);
    return pdfResp;
  }
}
