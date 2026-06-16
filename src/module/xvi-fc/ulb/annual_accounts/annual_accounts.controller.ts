import { Body, Controller, Get, Param, Post, Req, UploadedFile, UseInterceptors, HttpCode } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth } from '@nestjs/swagger/dist/decorators';
import type { Request } from 'express';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { ParseObjectIdPipe } from '../../../../common/pipes/parse-object-id.pipe';
import { AnnualAccountsService } from './annual_accounts.service';
import { UploadDocumentDto } from './dto/upload-document.dto';
import { SubmitSectionDto } from './dto/submit-section.dto';

@ApiBearerAuth()
@Controller('xvi-fc/annual-account')
export class AnnualAccountsController {
  constructor(private readonly annualAccountsService: AnnualAccountsService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 50 * 1024 * 1024 },
    }),
  )
  uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDocumentDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const ipAddress =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket?.remoteAddress ?? null;
    const userAgent = (req.headers['user-agent'] as string) ?? null;
    return this.annualAccountsService.uploadDocument(file, dto, user, ipAddress, userAgent);
  }

  @Get('form-status/:ulbId/:designYearId')
  getFormStatus(
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Param('designYearId', ParseObjectIdPipe) designYearId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.annualAccountsService.getFormStatus(ulbId, designYearId, user);
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
}
