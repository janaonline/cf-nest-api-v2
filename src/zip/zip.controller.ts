// zip-jobs.controller.ts
import { InjectQueue } from '@nestjs/bullmq';
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { JobsOptions, Queue } from 'bullmq';
import type { ZipJobRequest, ZipJobResult } from './zip.types';
import { responseJsonUlb } from './responseJsonUlb';
import { MailerService } from './mailer.service';

@Controller('zip-jobs')
export class ZipController {
  constructor(
    @InjectQueue('zip') private readonly queue: Queue,
    private readonly mailer: MailerService,
  ) {}

  @Post()
  async create(@Body() body1: ZipJobRequest) {
    const body = {} as ZipJobRequest;
    body.email = 'jeevanantham.d@janaagraha.org';
    body.ulbData = responseJsonUlb.data;
    console.log('body', body);
    // Add job to queue
    const opts: JobsOptions = {
      removeOnComplete: { age: 86400, count: 2000 },
      removeOnFail: 1000,
    };
    const job = await this.queue.add('zip-build', body, opts);
    return {
      jobId: job.id,
      statusUrl: `/zip-jobs/${job.id}`,
      poll: true, // hint to client to poll this endpoint
    };
  }

  @Get('test')
  getHello1(): string {
    return 'test';
  }

  @Get('mail')
  async sendmail() {
    console.log('Sending mail');
    await this.mailer.sendDataReadyEmail('jeevanantham.d@janaagraha.org', 'Jeeva', 'http://example.com/download.zip');
    return { message: 'HTML Template Mail sent!' };
  }

  @Get(':id')
  async status1(@Param('id') id: string) {
    const job = await this.queue.getJob(id);
    if (!job) return { status: 'not_found' };

    const state = await job.getState(); // waiting | active | completed | failed | delayed
    const progress = job.progress || 0;

    if (state === 'completed') {
      const result = (await job.returnvalue) as ZipJobResult & { url: string };
      return { status: 'completed', progress: 100, result };
    }

    if (state === 'failed') {
      return { status: 'failed', progress, reason: job.failedReason };
    }

    return { status: state, progress };
  }

  @Get('test1')
  getHello12(): string {
    return 'test';
  }
}
