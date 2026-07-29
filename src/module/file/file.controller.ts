import { Controller, Get, HttpStatus, Logger, Query, Res } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from 'src/module/auth/decorators/public.decorator';
import { FileService } from './file.service';
import { getErrorMessage, isS3NotFoundError } from './file-response.util';

@Controller('file')
export class FileController {
  private readonly logger = new Logger(FileController.name);

  constructor(private readonly fileService: FileService) {}

  @Public()
  @SkipThrottle()
  @Get('download')
  @ApiQuery({ name: 'signature', required: true, type: String })
  async download(@Query('signature') signature: string, @Res() res: Response) {
    const { key, stream, headers } = await this.fileService.prepareDownload(signature);

    stream.on('error', (err: unknown) => {
      this.logger.error(`S3 stream error for key "${key}": ${getErrorMessage(err)}`);

      if (res.headersSent) {
        res.destroy();
        return;
      }

      const is404 = isS3NotFoundError(err);
      res
        .status(is404 ? HttpStatus.NOT_FOUND : HttpStatus.INTERNAL_SERVER_ERROR)
        .json({ success: false, message: is404 ? 'File not found' : 'Failed to stream file' });
    });

    res.setHeader('Content-Type', headers.contentType);
    res.setHeader('Content-Disposition', headers.contentDisposition);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');

    stream.pipe(res);
  }
}
