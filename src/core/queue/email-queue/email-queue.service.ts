import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { EmailJob } from '../../aws-ses/email-job.type';
import { EMAIL_QUEUE } from './email-queue.constant';

@Injectable()
export class EmailQueueService {
  logger = new Logger(EmailQueueService.name);

  constructor(@InjectQueue(EMAIL_QUEUE) private readonly queue: Queue<EmailJob>) {}

  async addEmailJob(payload: EmailJob): Promise<void> {
    const job = await this.queue.add('emailJob', payload);
    this.logger.log(`JOB: ${job.id} Added job to emailQueue: ${JSON.stringify(payload)}`, job.id);
    // this.queue.on('completed', (job) => {
    //   console.log(`Job with ID ${job.id} has been completed`);
    // });
    // this.queue.on('failed', (job, err) => {
    //   console.log(`Job with ID ${job.id} has failed with error ${err.message}`);
    // });
  }
}
