import { Controller, Get, HttpException, HttpStatus, Logger, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from 'src/module/auth/decorators/public.decorator';
import { FileTokenService, TokenError } from 'src/core/file-token/file-token.service';
import { S3Service } from 'src/core/s3/s3.service';

@Controller('file')
export class FileDownloadController {

  logger = new Logger(FileDownloadController.name);

  constructor(
    private readonly fileTokenService: FileTokenService,
    private readonly s3Service: S3Service,
  ) { }

  @Public()
  @Get('download')
  async download(@Query('signature') signature: string, @Res() res: Response) {
    let payload: ReturnType<FileTokenService['parseToken']>;
    try {
      payload = this.fileTokenService.parseToken(signature);
    } catch (err: unknown) {
      const e = err as TokenError;
      const status = e.type === 'expired' ? HttpStatus.GONE : HttpStatus.BAD_REQUEST;
      throw new HttpException(e.type ?? 'invalid_token', status);
    }
    try {
      const key = this.s3Service.getKeyFromS3Url(payload.path);
      this.logger.log(`Download requested for S3 key: ${key}`);
      const stream = await this.s3Service.getObjectStream(key);

      const filename = key.split('/').pop() ?? 'download';
      const disposition = payload.disposition ?? 'attachment';
      res.setHeader('Content-Disposition', `${disposition}; filename="${filename}"`);
      res.setHeader('Content-Type', 'application/octet-stream');

      stream.pipe(res);
    } catch (err) {
      this.logger.error(`Error during file download: ${(err as Error).message}`);
      throw new HttpException('File download failed', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
