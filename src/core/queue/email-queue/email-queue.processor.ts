import { Processor, WorkerHost } from '@nestjs/bullmq';
// import { MailService } from '../../mail/mail.service';
// import { OtpJobData } from '../otp.types';
import { Job } from 'bullmq/dist/esm/classes';
import { SESMailService } from 'src/core/aws-ses/ses.service';
import { EmailJob } from '../../aws-ses/email-job.type';
import { EMAIL_QUEUE } from './email-queue.constant';

@Processor(EMAIL_QUEUE, {
  concurrency: 5,
})
export class EmailQueueProcessor extends WorkerHost {
  constructor(private ses: SESMailService) {
    super();
  }

  //   async process(job: { name: string; data: OtpJobData }) {
  async process(job: Job<EmailJob>) {
    console.log('Processing job:', job.name, 'with data:', job.data);
    const { from, to, html, text, subject } = job.data;
    // const params = { from?: string; to: string; html: string; text?: string; subject: string }
    await this.ses.sendEmail({ to, subject, html, text, from });
    // : `<p>Your OTP code is: <strong>${otp}</strong></p><p>This code will expire in 10 minutes.</p>`
    // await Promise.resolve();
  }
}
