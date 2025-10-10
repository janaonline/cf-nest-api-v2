import { Controller, Get, Query, Res } from '@nestjs/common';
import { QueryResourcesSectionDto } from './dto/query-resources-section.dto';
import { ResourcesSectionService } from './resources-section.service';
import { responseJsonUlb } from './responseJsonUlb';
import { S3ZipService } from './s3-zip.service';

@Controller('resources-section')
export class ResourcesSectionController {
  constructor(
    private readonly resourcesSectionService: ResourcesSectionService,
    private readonly s3ZipService: S3ZipService,
  ) {}

  @Get('data-sets')
  async getAnnualAccounts(@Query() query: QueryResourcesSectionDto) {
    return this.resourcesSectionService.getFiles(query);
  }

  @Get('data-sets/zip')
  async getAnnualAccountsZip(@Query() query: QueryResourcesSectionDto) {
    return this.resourcesSectionService.zipData(query);
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
