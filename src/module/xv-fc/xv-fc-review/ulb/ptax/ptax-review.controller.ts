import { Body, Controller, Get, Param, Post, Put, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../../auth/decorators/current-user.decorator';
import { Roles } from '../../../../auth/decorators/roles.decorator';
import { Role } from '../../../../auth/enum/role.enum';
import { RolesGuard } from '../../../../auth/guards/roles.guard';
import type { AuthUser } from '../../../../auth/auth-user.interface';
import { ParseObjectIdPipe } from '../../../../../common/pipes/parse-object-id.pipe';
import { ConfirmPtaxUploadDto } from './dto/confirm-ptax-upload.dto';
import { PresignPtaxUploadDto } from './dto/presign-ptax-upload.dto';
import { SavePtaxDraftDto } from './dto/save-ptax-draft.dto';
import { SubmitPtaxReviewDto } from './dto/submit-ptax-review.dto';
import { PtaxReviewPdfService } from './ptax-review-pdf.service';
import type { PtaxCurrency } from './ptax-review-pdf.service';
import { PtaxReviewService } from './ptax-review.service';

@ApiTags('XV-FC Review — Ptax (ULB)')
@UseGuards(RolesGuard)
@Roles([Role.ULB])
@ApiBearerAuth()
@Controller('xv-fc-review/ptax')
export class PtaxReviewController {
  constructor(
    private readonly ptaxReviewService: PtaxReviewService,
    private readonly pdfService: PtaxReviewPdfService,
  ) {}

  @ApiOperation({ summary: 'List the 6 reviewable financial-year tabs (with yearId) with review status for this ULB' })
  @ApiParam({ name: 'ulbId', description: 'ULB ObjectId' })
  @Get(':ulbId/summary')
  getSummary(@Param('ulbId', ParseObjectIdPipe) ulbId: string, @CurrentUser() user: AuthUser) {
    return this.ptaxReviewService.getSummary(ulbId, user);
  }

  @ApiOperation({ summary: 'Full metric detail for one financial year (also used for the preview screen)' })
  @ApiParam({ name: 'ulbId', description: 'ULB ObjectId' })
  @ApiParam({ name: 'yearId', description: 'Year ObjectId, from the summary response' })
  @Get(':ulbId/:yearId')
  getDetail(
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ptaxReviewService.getDetail(ulbId, yearId, user);
  }

  @ApiOperation({ summary: 'Save flagged metrics / comments as a draft, without submitting' })
  @ApiParam({ name: 'ulbId', description: 'ULB ObjectId' })
  @ApiParam({ name: 'yearId', description: 'Year ObjectId' })
  @Put(':ulbId/:yearId/draft')
  saveDraft(
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Body() dto: SavePtaxDraftDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ptaxReviewService.saveDraft(ulbId, yearId, dto, user);
  }

  @ApiOperation({ summary: 'Get a presigned S3 PUT URL for the declaration or the shared supporting document' })
  @ApiParam({ name: 'ulbId', description: 'ULB ObjectId' })
  @ApiParam({ name: 'yearId', description: 'Year ObjectId' })
  @Post(':ulbId/:yearId/documents/presign')
  presignUpload(
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Body() dto: PresignPtaxUploadDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ptaxReviewService.presignUpload(ulbId, yearId, dto, user);
  }

  @ApiOperation({ summary: 'Confirm the completed S3 upload of the declaration or the shared supporting document' })
  @ApiParam({ name: 'ulbId', description: 'ULB ObjectId' })
  @ApiParam({ name: 'yearId', description: 'Year ObjectId' })
  @Post(':ulbId/:yearId/documents/confirm')
  confirmUpload(
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Body() dto: ConfirmPtaxUploadDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ptaxReviewService.confirmUpload(ulbId, yearId, dto, user);
  }

  @ApiOperation({ summary: 'Get a signed GET URL to view/download the declaration or the supporting document' })
  @ApiParam({ name: 'ulbId', description: 'ULB ObjectId' })
  @ApiParam({ name: 'yearId', description: 'Year ObjectId' })
  @ApiParam({ name: 'targetCode', description: '"DECLARATION" or "SUPPORTING_DOCUMENT"' })
  @Get(':ulbId/:yearId/documents/:targetCode/signed-url')
  getSignedUrl(
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Param('targetCode') targetCode: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ptaxReviewService.getSignedUrl(ulbId, yearId, targetCode, user);
  }

  @ApiOperation({
    summary:
      'Submit (or resubmit after rejection). ACCEPT_NO_CHANGES auto-approves; SUBMIT_WITH_COMMENTS enters admin review',
  })
  @ApiParam({ name: 'ulbId', description: 'ULB ObjectId' })
  @ApiParam({ name: 'yearId', description: 'Year ObjectId' })
  @Post(':ulbId/:yearId/submit')
  submit(
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Body() dto: SubmitPtaxReviewDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ptaxReviewService.submit(ulbId, yearId, dto, user);
  }

  @ApiOperation({ summary: 'Download all Ptax metrics for this financial year as a PDF' })
  @ApiParam({ name: 'ulbId', description: 'ULB ObjectId' })
  @ApiParam({ name: 'yearId', description: 'Year ObjectId' })
  @ApiQuery({ name: 'currency', enum: ['INR', 'LAKH', 'CRORE'], required: false })
  @Get(':ulbId/:yearId/pdf')
  async downloadPdf(
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Query('currency') currency: PtaxCurrency = 'INR',
    @CurrentUser() user: AuthUser,
  ): Promise<StreamableFile> {
    const detail = await this.ptaxReviewService.getDetail(ulbId, yearId, user);
    const buffer = await this.pdfService.buildMetricsPdf(
      {
        ulbName: detail.ulbName ?? ulbId,
        financialYear: detail.financialYear,
        status: detail.status,
        finalAction: detail.finalAction,
        submittedAt: detail.submittedAt,
        metrics: detail.metrics,
      },
      currency,
    );
    return new StreamableFile(buffer as unknown as Uint8Array, {
      type: 'application/pdf',
      disposition: `attachment; filename="xv-fc-review-ptax-${ulbId}-${detail.financialYear}.pdf"`,
    });
  }
}
