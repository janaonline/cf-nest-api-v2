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

  // SECURITY: disabled — unauthenticated (@Public()) endpoints that let anyone trigger a real
  // send through the app's mail infrastructure to an arbitrary/hardcoded address, with no
  // rate limiting tailored to email abuse (only the generic global throttle applied). Manual
  // test utilities, not a product feature. Commented out rather than deleted so they're easy
  // to restore for local debugging if needed — do not re-enable in a public/unauthenticated form.
  //
  // @Get()
  // async sendTestMail() {
  //   await this.nodeMailerService.sendWelcomeEmail('jeevanantham.d@janaagraha.org', 'Jeeva');
  //   return { message: 'HTML Template Mail sent!' };
  // }
  //
  // @Public()
  // @Post('ping')
  // async pingEmail(@Body('to') to: string) {
  //   if (!to) return { error: 'Provide a "to" email in the request body' };
  //   try {
  //     await this.nodeMailerService.sendEmailWithTemplate(to, 'Email delivery test', './welcome', { name: 'Test' });
  //     return { ok: true, message: `Test email sent to ${to}` };
  //   } catch (err) {
  //     return { ok: false, error: String((err as Error).message ?? err) };
  //   }
  // }

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
