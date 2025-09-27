// zip-jobs.processor.ts
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { ZipBuildService } from './zip.service';
import { S3Service } from '../s3/s3.service';
import { MailerService } from './mailer.service';
import { ZipJobRequest, ZipJobResult } from './zip.types';
import * as crypto from 'crypto';
import * as path from 'path';

@Processor('zip', { concurrency: 2 }) // run up to 2 jobs in parallel
export class ZipJobsProcessor extends WorkerHost {
  constructor(
    private readonly zip: ZipBuildService,
    private readonly s3: S3Service,
    private readonly mailer: MailerService,
  ) {
    super();
  }

  async process(job: Job<ZipJobRequest, ZipJobResult>) {
    const { files, outputKey, email, title } = job.data;
    console.log(`Processing job ${job.id} with ${files.length} files`);
    // Make a safe output key if not provided
    const zipKey =
      outputKey ||
      path.posix.join('zips', `${new Date().toISOString().slice(0, 10)}`, `bundle-${crypto.randomUUID()}.zip`);

    await job.updateProgress(5);
    console.log('start');
    const result = await this.zip.buildZipToS3({
      files,
      outputKey: zipKey,
    });
    console.log('job 95-----');
    await job.updateProgress(95);
    console.log('Zip built', result);
    // Generate pre-signed URL
    const url = await this.s3.presignGet(result.zipKey);
    const payload: ZipJobResult & { url: string } = { ...result, url };

    // Optional email
    if (email) {
      await this.mailer.sendDownloadLink({
        to: email,
        subject: title || 'Your ZIP is ready',
        link: url,
        key: result.zipKey,
        counts: {
          total: result.totalFiles,
          skipped: result.skippedFiles,
        },
      });
    }

    await job.updateProgress(100);
    return payload;
  }
}
