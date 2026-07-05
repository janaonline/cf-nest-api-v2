import { BadRequestException, Body, Controller, Delete, Get, Param, Post, Query, Req, HttpCode } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger/dist/decorators';
import type { Request } from 'express';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { ParseObjectIdPipe } from '../../../../common/pipes/parse-object-id.pipe';
import { AnnualAccountsService } from './annual_accounts.service';
import { PresignUploadDto } from './dto/presign-upload.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';
import { SubmitSectionDto } from './dto/submit-section.dto';

@ApiBearerAuth()
@Controller('xvi-fc/annual-account')
export class AnnualAccountsController {
  constructor(private readonly annualAccountsService: AnnualAccountsService) {}

  @Get('presign-upload')
  @ApiOperation({ summary: 'Generate a presigned S3 PUT URL for direct browser-to-S3 upload' })
  presignUpload(
    @Query() dto: PresignUploadDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.annualAccountsService.presignUpload(dto, user);
  }

  @Post('confirm-upload')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm a direct S3 upload and trigger OCR processing' })
  confirmUpload(
    @Body() dto: ConfirmUploadDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const ipAddress =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket?.remoteAddress ?? null;
    const userAgent = (req.headers['user-agent'] as string) ?? null;
    return this.annualAccountsService.confirmUpload(dto, user, ipAddress, userAgent);
  }

  @Get('upload-config/:type')
  @ApiOperation({ summary: 'Get document upload config (audited or provisional) for a given design year' })
  getUploadConfig(
    @Param('type') type: string,
    @Query('yearId') yearId: string,
  ) {
    return this.annualAccountsService.getUploadConfig(type as 'audited' | 'provisional', yearId);
  }

  @Get('by-ulb/:ulbId/:designYearId')
  findByUlbAndYear(
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Param('designYearId', ParseObjectIdPipe) designYearId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.annualAccountsService.findByUlbAndYear(ulbId, designYearId, user);
  }

  @Get(':id')
  getDetails(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.annualAccountsService.getDetails(id, user);
  }

  @Get(':id/status')
  getProcessingStatus(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.annualAccountsService.getProcessingStatus(id, user);
  }

  @Get(':id/documents/:uploadId/signed-url')
  getSignedUrl(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('uploadId') uploadId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.annualAccountsService.getSignedUrl(id, uploadId, user);
  }

  @Post(':id/submit')
  @HttpCode(200)
  submitSection(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: SubmitSectionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.annualAccountsService.submitSection(id, dto.section, user);
  }

  @Post(':id/documents/:uploadId/retry')
  @HttpCode(200)
  retryUpload(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('uploadId') uploadId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.annualAccountsService.retryUpload(id, uploadId, user);
  }

  @Delete(':id/documents/:docId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove a document from an annual account section (clears currentUpload and resets status)' })
  removeDocument(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('docId') docId: string,
    @Query('section') section: string,
    @CurrentUser() user: AuthUser,
  ) {
    if (section !== 'auditedData' && section !== 'unauditedData') {
      throw new BadRequestException('section must be "auditedData" or "unauditedData"');
    }
    return this.annualAccountsService.removeDocument(id, section, docId, user);
  }
}
