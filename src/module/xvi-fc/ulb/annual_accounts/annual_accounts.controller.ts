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
import { DocumentDecisionDto } from './dto/document-decision.dto';
import { SectionDecisionDto } from './dto/section-decision.dto';
import { BulkSectionDecisionDto } from './dto/bulk-section-decision.dto';
import { UlbSubmissionsQueryDto } from './dto/ulb-submissions-query.dto';
import { ManualReviewDecisionDto } from './dto/manual-review-decision.dto';
import { ManualReviewQueueQueryDto } from './dto/manual-review-queue-query.dto';
import { extractIpAndUserAgent } from 'src/module/xvi-fc/common/utils/xvi-fc-request-meta.util';

@ApiBearerAuth()
@Controller('xvi-fc/annual-account')
export class AnnualAccountsController {
  constructor(private readonly annualAccountsService: AnnualAccountsService) {}

  // @Get('presign-upload')
  // @ApiOperation({ summary: 'Generate a presigned S3 PUT URL for direct browser-to-S3 upload' })
  // presignUpload(
  //   @Query() dto: PresignUploadDto,
  //   @CurrentUser() user: AuthUser,
  // ) {
  //   return this.annualAccountsService.presignUpload(dto, user);
  // }

  @Post('confirm-upload')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm a direct S3 upload and trigger OCR processing' })
  confirmUpload(@Body() dto: ConfirmUploadDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const { ipAddress, userAgent } = extractIpAndUserAgent(req);
    return this.annualAccountsService.confirmUpload(dto, user, ipAddress, userAgent);
  }

  @Get('upload-config/:type')
  @ApiOperation({ summary: 'Get document upload config (audited or provisional) for a given design year' })
  getUploadConfig(@Param('type') type: string, @Query('yearId') yearId: string) {
    return this.annualAccountsService.getUploadConfig(type as 'audited' | 'provisional', yearId);
  }

  @Get('by-ulb/:ulbId/:designYearId')
  findByUlbAndYear(
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Param('designYearId', ParseObjectIdPipe) designYearId: string,
    @Query('section') section: string,
    @CurrentUser() user: AuthUser,
  ) {
    if (section !== 'auditedData' && section !== 'unauditedData') {
      throw new BadRequestException('section must be "auditedData" or "unauditedData"');
    }
    return this.annualAccountsService.findByUlbAndYear(ulbId, designYearId, section, user);
  }

  @Get('state/ulb-submissions')
  @ApiOperation({
    summary: "STATE reviewer's paginated list of ULBs and their Annual Account status for a design year",
  })
  listUlbSubmissions(@Query() dto: UlbSubmissionsQueryDto, @CurrentUser() user: AuthUser) {
    return this.annualAccountsService.listUlbSubmissions(dto, user);
  }

  @Get('manual-review-queue')
  @ApiOperation({ summary: "ADMIN's global queue of documents awaiting a manual-review decision, across all ULBs" })
  getManualReviewQueue(@Query() dto: ManualReviewQueueQueryDto, @CurrentUser() user: AuthUser) {
    return this.annualAccountsService.getManualReviewQueue(dto, user);
  }

  @Get(':id')
  getDetails(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query('section') section: string,
    @CurrentUser() user: AuthUser,
  ) {
    if (section !== 'auditedData' && section !== 'unauditedData') {
      throw new BadRequestException('section must be "auditedData" or "unauditedData"');
    }
    return this.annualAccountsService.getDetails(id, section, user);
  }

  @Get(':id/status')
  getProcessingStatus(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query('section') section: string,
    @CurrentUser() user: AuthUser,
  ) {
    if (section !== 'auditedData' && section !== 'unauditedData') {
      throw new BadRequestException('section must be "auditedData" or "unauditedData"');
    }
    return this.annualAccountsService.getProcessingStatus(id, section, user);
  }

  @Get(':id/logs')
  getFormLogs(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query('section') section: string | undefined,
    @CurrentUser() user: AuthUser,
  ) {
    if (section !== undefined && section !== 'auditedData' && section !== 'unauditedData') {
      throw new BadRequestException('section must be "auditedData" or "unauditedData"');
    }
    return this.annualAccountsService.getFormLogs(id, section, user);
  }

  @Post(':id/submit')
  @HttpCode(200)
  submitSection(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: SubmitSectionDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const { ipAddress, userAgent } = extractIpAndUserAgent(req);
    return this.annualAccountsService.submitSection(id, dto.section, user, ipAddress, userAgent);
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

  @Post(':id/documents/:docId/manual-review')
  @HttpCode(200)
  @ApiOperation({ summary: 'ULB requests manual review of a document whose OCR validation failed' })
  requestManualReview(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('docId') docId: string,
    @Query('section') section: string,
    @CurrentUser() user: AuthUser,
  ) {
    if (section !== 'auditedData' && section !== 'unauditedData') {
      throw new BadRequestException('section must be "auditedData" or "unauditedData"');
    }
    return this.annualAccountsService.requestManualReview(id, section, docId, user);
  }

  @Post(':id/documents/:docId/manual-review/decision')
  @HttpCode(200)
  @ApiOperation({ summary: "ADMIN approves or rejects a document's manual-review request" })
  decideManualReview(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('docId') docId: string,
    @Query('section') section: string,
    @Body() dto: ManualReviewDecisionDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    if (section !== 'auditedData' && section !== 'unauditedData') {
      throw new BadRequestException('section must be "auditedData" or "unauditedData"');
    }
    const { ipAddress, userAgent } = extractIpAndUserAgent(req);
    return this.annualAccountsService.decideManualReview(id, section, docId, dto, user, ipAddress, userAgent);
  }

  @Delete(':id/documents/:docId')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Remove a document from an annual account section (clears currentUpload and resets status)',
  })
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

  @Post(':id/documents/:docId/decision')
  @HttpCode(200)
  @ApiOperation({ summary: 'State reviewer approves or returns a single document (informational only)' })
  decideDocument(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('docId') docId: string,
    @Body() dto: DocumentDecisionDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const { ipAddress, userAgent } = extractIpAndUserAgent(req);
    return this.annualAccountsService.decideDocument(id, docId, dto, user, ipAddress, userAgent);
  }

  @Delete(':id/documents/:docId/decision')
  @HttpCode(200)
  @ApiOperation({ summary: 'State reviewer undoes their own approve/return decision on a single document' })
  undoDocumentDecision(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('docId') docId: string,
    @Query('section') section: string,
    @CurrentUser() user: AuthUser,
  ) {
    if (section !== 'auditedData' && section !== 'unauditedData') {
      throw new BadRequestException('section must be "auditedData" or "unauditedData"');
    }
    return this.annualAccountsService.undoDocumentDecision(id, section, docId, user);
  }

  @Post(':id/decision')
  @HttpCode(200)
  @ApiOperation({ summary: 'State reviewer approves or returns a whole section, transitioning its status' })
  decideSection(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: SectionDecisionDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const { ipAddress, userAgent } = extractIpAndUserAgent(req);
    return this.annualAccountsService.decideSection(id, dto, user, ipAddress, userAgent);
  }

  @Post(':id/undo-approval')
  @HttpCode(200)
  @ApiOperation({ summary: 'State reviewer undoes their own Approve Section decision (only while status is APPROVED_BY_STATE)' })
  undoSectionApproval(
    @Param('id', ParseObjectIdPipe) id: string,
    @Query('section') section: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    if (section !== 'auditedData' && section !== 'unauditedData') {
      throw new BadRequestException('section must be "auditedData" or "unauditedData"');
    }
    const { ipAddress, userAgent } = extractIpAndUserAgent(req);
    return this.annualAccountsService.undoSectionApproval(id, section, user, ipAddress, userAgent);
  }

  @Post('bulk-decision')
  @HttpCode(200)
  @ApiOperation({ summary: 'State reviewer bulk approves or returns a section across many ULB submissions' })
  bulkDecideSection(@Body() dto: BulkSectionDecisionDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const { ipAddress, userAgent } = extractIpAndUserAgent(req);
    return this.annualAccountsService.bulkDecideSection(dto, user, ipAddress, userAgent);
  }

  // @Post(':id/mohua-decision')
  // @HttpCode(200)
  // @ApiOperation({ summary: 'MOHUA approves or returns a whole section handed off by state, transitioning its status' })
  // decideMohuaSection(
  //   @Param('id', ParseObjectIdPipe) id: string,
  //   @Body() dto: SectionDecisionDto,
  //   @CurrentUser() user: AuthUser,
  //   @Req() req: Request,
  // ) {
  //   const ipAddress =
  //     (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ?? req.socket?.remoteAddress ?? null;
  //   const userAgent = (req.headers['user-agent'] as string) ?? null;
  //   return this.annualAccountsService.decideMohuaSection(id, dto, user, ipAddress, userAgent);
  // }
}
