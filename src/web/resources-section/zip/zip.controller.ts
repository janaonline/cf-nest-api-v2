// zip-jobs.controller.ts
import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Get, Param, Post } from '@nestjs/common';
import { JobsOptions, Queue } from 'bullmq';
import { responseJsonUlb } from './responseJsonUlb';
import { ZipBuildService } from './zip-build.service';
import type { ZipJobRequest, ZipJobResult } from './zip.types';

@Controller('zip-jobs')
export class ZipController {
  constructor(
    @InjectQueue('zip') private readonly queue: Queue,
    private readonly mailer: ZipBuildService,
  ) {}

  @Post()
  async create() {
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
  getHello(): string {
    return 'test';
  }

  @Get('mail')
  async sendmail() {
    console.log('Sending mail');
    const params = {
      to: 'jeevanantham.d@janaagraha.org',
      subject: 'test mail',
      link: 'http://example.com/download.zip',
      counts: { total: 10, skipped: 2 },
      ulbData: responseJsonUlb.data,
      name: 'Jeeva',
      downloadType: 'test',
      // link: string;
      // key: string;
      // ulbData?: ULBData[];
      // counts: { total: number; skipped: number };
    };
    await this.mailer.sendDownloadLink(
      params,
      // 'jeevanantham.d@janaagraha.org', 'Jeeva', 'http://example.com/download.zip'
    );
    return { message: 'HTML Template Mail sent!' };
  }

  @Get('status/:id')
  async status(@Param('id') id: string) {
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
}
