import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
// import { DigitizationJobData } from './dto/digitization-job-data';
import { HttpService } from '@nestjs/axios';
import { delay, firstValueFrom, of } from 'rxjs';
import { DigitizationJobDto } from '../dto/digitization-job.dto';
import { DigitizationQueueService } from './digitization-queue/digitization-queue.service';

@Processor('afsDigitization', { concurrency: 1 })
export class DigitizationProcessor extends WorkerHost {
  private readonly logger = new Logger(DigitizationProcessor.name);

  constructor(
    private readonly http: HttpService,
    private readonly digitizationQueueService: DigitizationQueueService,
  ) {
    super();
  }

  // BullMQ entry point
  async process(job: Job<DigitizationJobDto>): Promise<void> {
    const data = job.data;
    // this.logger.log(`Processing `, data);

    await this.digitizationQueueService.handleDigitizationJob(data);
    // await this.handleDigitizationJob(job);
    // await this.handleDigitizationJob_test();
    this.logger.log(`✅ Digitization job ${job.id} completed`);
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
