import { Controller, Get, Query, Res } from '@nestjs/common';
import { FilesService } from './files.service';
import { S3ZipService } from './s3-zip.service';
import { ZipService } from './zip.service';
import { responseJsonUlb } from 'src/resources-section/responseJsonUlb';

@Controller('files')
export class FilesController {
  constructor(
    private readonly filesService: FilesService,
    private readonly s3ZipService: S3ZipService,
    private readonly zip: ZipService,
  ) {}

  /**
   * Step 1: Query DB and return matching file list
   * Example: GET /files/list?filter=report
   */
  @Get('list')
  listFiles(@Query('filter') filter: string) {
    // return this.filesService.listFiles(filter);
    return [{ key: 'test1' }];
  }

  @Get('download')
  async downloadFiles() {
    // const files: string[] = responseJsonUlb.data.flatMap((x) => x.files.map((f) => decodeURIComponent(f.url)));
    const files: string[] = [
      // 'https://jana-cityfinance-stg.s3.ap-south-1.amazonaws.com/objects/cbf4213f-ac2b-4fcf-8e8f-b684a339acf7.pdf',
      'files/cbf4213f-ac2b-4fcf-8e8f-b684a339acf7.pdf',
      // 'files/7c4399f4-1ad1-4a02-a467-f7d7940f5591.pdf',
    ];
    const result = await this.zip.buildZipToS3(files);
    console.log('result', result);
    return { result };
  }

  @Get('download/zip')
  async downloadFilesZip() {
    // const files: string[] = responseJsonUlb.data.flatMap((x) => x.files.map((f) => decodeURIComponent(f.url)));
    const files: string[] = [
      // 'https://jana-cityfinance-stg.s3.ap-south-1.amazonaws.com/objects/cbf4213f-ac2b-4fcf-8e8f-b684a339acf7.pdf',
      // 'files/cbf4213f-ac2b-4fcf-8e8f-b684a339acf7.pdf',
      // 'files/7c4399f4-1ad1-4a02-a467-f7d7940f5591.pdf',
    ];

    responseJsonUlb.data.forEach((element) => {
      element.files.forEach((file) => {
        files.push(decodeURIComponent(file.url));
      });
    });
    console.log('files', files);
    const result = await this.filesService.buildZipAndGetUrl(files);
    console.log('result', result);
    return { result };
  }

  @Get('zip')
  async downloadZip(
    @Res() res,
    // @Query('files') files: string, // e.g., ?files=file1.txt,file2.txt
  ) {
    console.log('tesdt');
    const bucket = process.env.AWS_BUCKET_NAME!;
    // const keys = files.split(',');
    const keys = [
      // 'https://jana-cityfinance-stg.s3.ap-south-1.amazonaws.com/objects/cbf4213f-ac2b-4fcf-8e8f-b684a339acf7.pdf',
      'files/cbf4213f-ac2b-4fcf-8e8f-b684a339acf7.pdf',
      'files/7c4399f4-1ad1-4a02-a467-f7d7940f5591.pdf',
    ];

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename=files.zip');

    const zipStream = await this.s3ZipService.streamZip(keys);
    zipStream.pipe(res);
  }
}
