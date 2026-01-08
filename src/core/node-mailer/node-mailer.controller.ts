import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Get, Param } from '@nestjs/common';
import { Queue } from 'bullmq';
import { ZipJobResult } from 'src/web/resources-section/zip/zip.types';
import { EmailJob } from '../aws-ses/email-job.type';
import { EMAIL_QUEUE } from '../queue/email-queue/email-queue.constant';
import { NodeMailerService } from './node-mailer.service';

@Controller('node-mailer')
export class NodeMailerController {
  constructor(
    private readonly nodeMailerService: NodeMailerService,

    @InjectQueue(EMAIL_QUEUE) private readonly queue: Queue<EmailJob>,
  ) {}

  @Get()
  async sendTestMail() {
    await this.nodeMailerService.sendWelcomeEmail('jeevanantham.d@janaagraha.org', 'Jeeva');
    return { message: 'HTML Template Mail sent!' };
  }

  @Get('status/:id')
  async status(@Param('id') id: string) {
    const job = await this.queue.getJob(id);
    if (!job) return { status: 'not_found' };

    const state = await job.getState(); // waiting | active | completed | failed | delayed
    const progress = job.progress || 0;

    if (state === 'completed') {
      return { status: 'completed', progress: 100 };
    }

    if (state === 'failed') {
      return { status: 'failed', progress, reason: job.failedReason };
    }

    return { status: state, progress };
  }
}
