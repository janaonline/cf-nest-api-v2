import { Controller, Get, Query } from '@nestjs/common';
import { FilesService } from './files.service';

@Controller('files')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  /**
   * Step 1: Query DB and return matching file list
   * Example: GET /files/list?filter=report
   */
  @Get('list')
  listFiles(@Query('filter') filter: string) {
    // return this.filesService.listFiles(filter);
    return [{'key': 'test'}];
  }

  /**
   * Step 2: Zip matching files, upload to S3, return pre-signed URL
   * Example: GET /files/download?filter=report
   */
  @Get('download')
  async downloadFiles(@Query('filter') filter: string) {
    return this.filesService.downloadFiles(filter);
  }
}
