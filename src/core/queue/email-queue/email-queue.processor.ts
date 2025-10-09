import { Processor, WorkerHost } from '@nestjs/bullmq';
// import { MailService } from '../../mail/mail.service';
// import { OtpJobData } from '../otp.types';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq/dist/esm/classes';
import { NodeMailerService } from 'src/core/node-mailer/node-mailer.service';
import { EmailJob } from '../../aws-ses/email-job.type';
import { EMAIL_QUEUE } from './email-queue.constant';

@Processor(EMAIL_QUEUE, {
  concurrency: 5,
})
export class EmailQueueProcessor extends WorkerHost {
  logger = new Logger(EmailQueueProcessor.name);
  constructor(
    // private ses: SESMailService,
    private readonly mailService: NodeMailerService,
  ) {
    super();
  }

  //   async process(job: { name: string; data: OtpJobData }) {
  async process(job: Job<EmailJob>) {
    try {
      // this.logger.log('Processing job:', job.name, 'with data:', job.data);
      this.logger.log(`Processing job ${job.id} of type ${job.name} with data: `, job.data);
      const { from, to, text, subject, templateName, mailData } = job.data;
      // const params = { from?: string; to: string; html: string; text?: string; subject: string }
      // await this.ses.sendEmail({ to, subject, html, text, from });
      await this.mailService.sendEmailWithTemplate(to, subject, templateName, mailData);
    } catch (error) {
      this.logger.error('Error processing job:', error);
    }
  }
}
