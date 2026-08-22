import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq/dist/esm/classes';
import { NodeMailerService } from 'src/core/node-mailer/node-mailer.service';
import { EmailJob } from '../../aws-ses/email-job.type';
import { EMAIL_QUEUE } from './email-queue.constant';

@Processor(EMAIL_QUEUE, { concurrency: 5 })
export class EmailQueueProcessor extends WorkerHost {
  private readonly logger = new Logger(EmailQueueProcessor.name);

  constructor(private readonly mailService: NodeMailerService) {
    super();
  }

  async process(job: Job<EmailJob>): Promise<void> {
    const { to, subject, html, templateName, mailData } = job.data;
    const recipient = Array.isArray(to) ? `${to.length} recipients` : to;
    this.logger.log(`Processing job ${job.id}: "${subject}" → ${recipient}`);

    if (html) {
      await this.mailService.sendHtml(to, subject, html);
    } else if (templateName) {
      const singleTo = typeof to === 'string' ? to : to[0];
      await this.mailService.sendEmailWithTemplate(singleTo, subject, templateName, mailData);
    } else {
      throw new Error(`Job ${job.id}: neither html nor templateName provided`);
    }
  }
}
