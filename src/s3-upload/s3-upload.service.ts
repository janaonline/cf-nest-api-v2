import { BadRequestException, Injectable } from '@nestjs/common';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { S3Service } from 'src/core/s3/s3.service';
import { S3UrlItemDto, S3UrlResult } from './dto/s3-url-item.dto';

const SPECIAL_CHARS = /[`^*?"&'@{},$=!#+<>]/;
const WEB_EXECUTABLES = /\.(aspx|asp|css|swf|xhtml|rhtml|shtml|jsp|js|pl|php|cgi|zip|exe)$/i;
const UPLOAD_EXPIRES_IN = 60 * 60 * 60; // 60 hours

@Injectable()
export class S3UploadService {
  constructor(private readonly s3: S3Service) {}

  async generatePutSignedUrl(item: S3UrlItemDto): Promise<S3UrlResult> {
    const sanitized = encodeURIComponent(item.fileName.replace(/([^a-z0-9_.-]+)/gi, ''));

    const lastDot = sanitized.lastIndexOf('.');
    const nameWithoutExt = lastDot !== -1 ? sanitized.substring(0, lastDot) : sanitized;
    const ext = lastDot !== -1 ? sanitized.substring(lastDot) : '';

    if (SPECIAL_CHARS.test(nameWithoutExt)) {
      throw new BadRequestException(
        'File name should not contain ` ^ * ? "  & \' @ { } , $ = ! # + < > : special characters',
      );
    }
    if (WEB_EXECUTABLES.test(sanitized)) {
      throw new BadRequestException(
        'aspx, asp, css, swf, xhtml, rhtml, shtml, jsp, js, pl, php, cgi, zip, exe file types not allowed',
      );
    }

    const fileAlias = `${nameWithoutExt}_${randomUUID()}${ext}`;
    const key = item.folder ? `${item.folder}/${fileAlias}` : fileAlias;

    // ContentType and Metadata are intentionally omitted here.
    // Including them causes SDK v3 to add x-amz-meta-* to X-Amz-SignedHeaders,
    // forcing the browser to send those as request headers — which it cannot do
    // without explicit coordination. S3 will store the Content-Type from the
    // actual PUT request headers instead.
    const command = new PutObjectCommand({
      Bucket: this.s3.bucket,
      Key: key,
    });

    const url = await getSignedUrl(this.s3.client, command, { expiresIn: UPLOAD_EXPIRES_IN });
    const fileUrl = url.split('?')[0];
    const path = this.s3.getKeyFromS3Url(fileUrl);

    return { url, fileAlias, fileUrl, path, fileSize: item.fileSize, pages: item.pages };
  }
}
