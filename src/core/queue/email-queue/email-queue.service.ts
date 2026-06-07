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
    const to = Array.isArray(payload.to) ? `[${payload.to.join(', ')}]` : payload.to;
    this.logger.log(`Queued job ${job.id}: "${payload.subject}" → ${to}`);
  }
}
