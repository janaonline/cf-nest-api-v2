import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation } from '@nestjs/swagger/dist/decorators';
import type { Request } from 'express';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { extractIpAndUserAgent } from 'src/module/xvi-fc/common/utils/xvi-fc-request-meta.util';
import { ManualReviewDecisionDto } from 'src/module/xvi-fc/ulb/annual_accounts/dto/manual-review-decision.dto';
import { ManualReviewQueueQueryDto } from 'src/module/xvi-fc/ulb/annual_accounts/dto/manual-review-queue-query.dto';
import { DUR_DOC_IDS, type XviFcDurDocId } from 'src/schemas/xvi-fc/dur.schema';
import { DurService } from './dur.service';
import { DurManualReviewService } from './dur-manual-review.service';
import { ConfirmDurUploadDto } from './dto/confirm-dur-upload.dto';
import { SubmitDurDto } from './dto/submit-dur.dto';

function assertValidDocId(docId: string): asserts docId is XviFcDurDocId {
  if (!DUR_DOC_IDS.includes(docId as XviFcDurDocId)) {
    throw new BadRequestException(`docId must be one of: ${DUR_DOC_IDS.join(', ')}`);
  }
}

@ApiBearerAuth()
@Controller('xvi-fc/dur')
export class DurController {
  constructor(
    private readonly durService: DurService,
    private readonly manualReviewService: DurManualReviewService,
  ) {}

  @Get('action-gates')
  @ApiOperation({ summary: 'UI-visibility gates for DUR document action buttons' })
  getActionGates() {
    return this.durService.getActionGates();
  }

  @Get('manual-review-queue')
  @ApiOperation({ summary: "ADMIN's global queue of DUR documents awaiting a manual-review decision, across all ULBs" })
  getManualReviewQueue(@Query() dto: ManualReviewQueueQueryDto, @CurrentUser() user: AuthUser) {
    return this.manualReviewService.getManualReviewQueue(dto, user);
  }

  @Get('form-config')
  @ApiOperation({ summary: "Document-slot config for the DUR form (labels, file limits, template links), sourced from formjson" })
  getFormConfig(@Query('yearId', ParseObjectIdPipe) yearId: string) {
    return this.durService.getFormConfig(yearId);
  }

  @Post('confirm-upload')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirm a direct S3 upload for a DUR document and trigger validation' })
  confirmUpload(@Body() dto: ConfirmDurUploadDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const { ipAddress, userAgent } = extractIpAndUserAgent(req);
    return this.durService.confirmUpload(dto, user, ipAddress, userAgent);
  }

  @Get('by-ulb/:ulbId/:designYearId')
  findByUlbAndYear(
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Param('designYearId', ParseObjectIdPipe) designYearId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.durService.findByUlbAndYear(ulbId, designYearId, user);
  }

  @Get(':id/status')
  getStatus(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.durService.getProcessingStatus(id, user);
  }

  @Post(':id/documents/:docId/retry')
  @HttpCode(200)
  retryUpload(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('docId') docId: string,
    @CurrentUser() user: AuthUser,
  ) {
    assertValidDocId(docId);
    return this.durService.retryUpload(id, docId, user);
  }

  @Post(':id/submit')
  @HttpCode(200)
  submitToState(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: SubmitDurDto, @CurrentUser() user: AuthUser) {
    return this.durService.submitToState(id, dto, user);
  }

  @Post(':id/documents/:docId/manual-review')
  @HttpCode(200)
  @ApiOperation({ summary: 'ULB requests manual review of a DUR document whose validation failed' })
  requestManualReview(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('docId') docId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    assertValidDocId(docId);
    const { ipAddress, userAgent } = extractIpAndUserAgent(req);
    return this.manualReviewService.requestManualReview(id, docId, user, ipAddress, userAgent);
  }

  @Post(':id/documents/:docId/manual-review/decision')
  @HttpCode(200)
  @ApiOperation({ summary: "ADMIN approves or rejects a DUR document's manual-review request" })
  decideManualReview(
    @Param('id', ParseObjectIdPipe) id: string,
    @Param('docId') docId: string,
    @Body() dto: ManualReviewDecisionDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    assertValidDocId(docId);
    const { ipAddress, userAgent } = extractIpAndUserAgent(req);
    return this.manualReviewService.decideManualReview(id, docId, dto, user, ipAddress, userAgent);
  }
}
