import { Controller, Get, Query, Res } from '@nestjs/common';
import { QueryResourcesSectionDto } from './dto/query-resources-section.dto';
import { ResourcesSectionService } from './resources-section.service';
import { S3ZipService } from './s3-zip.service';
import { responseJsonUlb } from './responseJsonUlb';
import { JobsOptions, Queue } from 'bullmq';
import { InjectQueue } from '@nestjs/bullmq';
import { ZipJobRequest } from './zip/zip.types';

@Controller('resources-section')
export class ResourcesSectionController {
  constructor(
    private readonly resourcesSectionService: ResourcesSectionService,
    private readonly s3ZipService: S3ZipService,
    @InjectQueue('zip') private readonly queue: Queue,
  ) {}

  @Get('data-sets')
  async getAnnualAccounts(@Query() query: QueryResourcesSectionDto) {
    return this.resourcesSectionService.getFiles(query);
  }

  @Get('data-sets/zip')
  async getAnnualAccountsZip(@Query() query: QueryResourcesSectionDto) {
    const response: any = await this.resourcesSectionService.getFiles(query);

    // this.zipService.buildZipToS3(response);

    const body = {} as ZipJobRequest;
    body.email = query.email;
    body.ulbData = response.data;
    body.userName = query.userName;
    // console.log('body', body);
    // Add job to queue
    const opts: JobsOptions = {
      removeOnComplete: { age: 86400, count: 2000 },
      removeOnFail: 1000,
    };

    const job = await this.queue.add('zip-build', body, opts);
    return {
      message: 'Job submitted',
      jobId: job.id,
      statusUrl: `/zip-jobs/${job.id}`,
      poll: true, // hint to client to poll this endpoint
    };
  }

  @Get('data-sets/download')
  async getAnnualAccountsDownload(@Query() query: QueryResourcesSectionDto, @Res() res) {
    // return this.resourcesSectionService.getFiles(query);
    console.log('tesdt');
    const bucket = process.env.AWS_BUCKET_NAME!;
    // const keys = files.split(',');
    const resp = responseJsonUlb;
    // const resp = response;

    const keys: string[] = [
      // 'https://jana-cityfinance-stg.s3.ap-south-1.amazonaws.com/objects/cbf4213f-ac2b-4fcf-8e8f-b684a339acf7.pdf',
      // 'files/cbf4213f-ac2b-4fcf-8e8f-b684a339acf7.pdf',
      // 'files/7c4399f4-1ad1-4a02-a467-f7d7940f5591.pdf',
    ];
    resp.data.forEach((element) => {
      element.files.forEach((file) => {
        keys.push(decodeURIComponent(file.url));
      });
    });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=files.zip');

    const zipStream = await this.s3ZipService.streamZip(keys);
    zipStream.pipe(res);
  }

  @Get('sizes')
  async getSizes() {
    const keys: string[] = [];
    // const resp = response;
    const resp = responseJsonUlb;
    resp.data.forEach((element) => {
      element.files.forEach((file) => {
        keys.push(decodeURIComponent(file.url));
      });
    });
    console.log('keys', keys);
    return this.s3ZipService.getSizesForFiles(keys);
  }
}
