import { Body, Controller, Get, Param, Post, UploadedFile, UseInterceptors, HttpCode } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth } from '@nestjs/swagger/dist/decorators';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { ParseObjectIdPipe } from '../../../../common/pipes/parse-object-id.pipe';
import { AnnualAccountsService } from './annual_accounts.service';
import { UploadDocumentDto } from './dto/upload-document.dto';

@ApiBearerAuth()
@Controller('xvi-fc/annual-account')
export class AnnualAccountsController {
  constructor(private readonly annualAccountsService: AnnualAccountsService) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  uploadDocument(
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: UploadDocumentDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.annualAccountsService.uploadDocument(file, dto, user);
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
