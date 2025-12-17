import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
// import { DigitizationJobData } from './dto/digitization-job-data';
import { HttpService } from '@nestjs/axios';
import { delay, firstValueFrom, of } from 'rxjs';
import { DigitizationJobDto } from '../dto/digitization-job.dto';

@Processor('afsDigitization', { concurrency: 2 })
export class DigitizationProcessor extends WorkerHost {
  private readonly logger = new Logger(DigitizationProcessor.name);

  constructor(private readonly http: HttpService) {
    super();
  }

  // BullMQ entry point
  async process(job: Job<DigitizationJobDto>): Promise<void> {
    const data = job.data;
    this.logger.log(`Processing job ${job.id} | ULB: ${data.ulb} | ${data.year} | ${data.uploadedBy}`);

    try {
      // await this.handleDigitizationJob(job);
      // await this.handleDigitizationJob_test();
      this.logger.log(`✅ Digitization job ${job.id} completed`);
    } catch (err: any) {
      // this.logger.error(`❌ Digitization job ${job.id} failed: ${err?.message || err}`);
      // rethrow so BullMQ can handle retries
      throw err;
    }
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
