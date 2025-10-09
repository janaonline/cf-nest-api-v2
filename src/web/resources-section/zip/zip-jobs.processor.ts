import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import * as path from 'path';
import { S3Service } from 'src/core/s3/s3.service';
import { ZipBuildService } from './zip-build.service';
import { ZipJobRequest, ZipJobResult } from './zip.types';

@Processor('zip', { concurrency: 2 }) // run up to 2 jobs in parallel
export class ZipJobsProcessor extends WorkerHost {
  constructor(
    private readonly zip: ZipBuildService,
    private readonly s3: S3Service,
  ) {
    super();
  }

  async process(job: Job<ZipJobRequest, ZipJobResult>) {
    const { ulbData, outputKey, email, title } = job.data;
    // console.log(`Processing job ${job.id} with ${files.length} files`);
    // Make a safe output key if not provided
    // const zipKey =
    //   outputKey ||
    //   path.posix.join('zips', `${new Date().toISOString().slice(0, 10)}`, `bundle-${crypto.randomUUID()}.zip`);
    const zipKey: string =
      outputKey || path.posix.join('zips', `${ulbData[0].stateName}_${ulbData[0].year}_${new Date().getTime()}.zip`);

    await job.updateProgress(5);
    // console.log('start');
    const result = await this.zip.buildZipToS3({
      ulbData,
      outputKey: zipKey,
    });
    // console.log('job 95-----');
    await job.updateProgress(95);
    // console.log('Zip built', result);
    // Generate pre-signed URL
    const url = await this.s3.presignGet(result.zipKey);
    const payload: ZipJobResult & { url: string } = { ...result, url };
    // console.log('out Sending email ');
    // Optional email
    if (email) {
      // console.log('Sending email');
      const mailData = {
        to: email,
        subject: title || 'Your ZIP is ready',
        link: url,
        ulbData,
        key: result.zipKey,
        counts: {
          total: result.totalFiles,
          skipped: result.skippedFiles,
        },
      };
      // await this.mailer.sendDownloadLink(mailData);
      await this.zip.sendDownloadLink(mailData);
    }

    await job.updateProgress(100);
    return payload;
  }
}
