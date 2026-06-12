import { Body, Controller, ParseArrayPipe, Post } from '@nestjs/common';
import { S3UrlItemDto } from './dto/s3-url-item.dto';
import { S3UploadService } from './s3-upload.service';
import { ApiBearerAuth } from '@nestjs/swagger';

@Controller('s3')
export class S3UploadController {
  constructor(private readonly s3UploadService: S3UploadService) {}

  @ApiBearerAuth()
  @Post('signed-url')
  async getSignedUrls(@Body(new ParseArrayPipe({ items: S3UrlItemDto })) items: S3UrlItemDto[]) {
    return Promise.all(items.map((item) => this.s3UploadService.generatePutSignedUrl(item)));
  }
}
