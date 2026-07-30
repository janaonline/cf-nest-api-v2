import { Body, Controller, Get, Param, Post, Put, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { Role } from '../../../auth/enum/role.enum';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import type { AuthUser } from '../../../auth/auth-user.interface';
import { ParseObjectIdPipe } from '../../../../common/pipes/parse-object-id.pipe';
import { ConfirmReviewUploadDto } from './dto/confirm-review-upload.dto';
import { PresignReviewUploadDto } from './dto/presign-review-upload.dto';
import { XvFcSaveDraftDto } from './dto/save-draft.dto';
import { SubmitReviewDto } from './dto/submit-review.dto';
import { XvFcReviewPdfService } from './xv-fc-review-pdf.service';
import type { XvFcCurrency } from './xv-fc-review-pdf.service';
import { XvFcReviewService } from './xv-fc-review.service';

@ApiTags('XV-FC Review (ULB)')
@UseGuards(RolesGuard)
@Roles([Role.ULB])
@ApiBearerAuth()
@Controller('xv-fc-review')
export class XvFcReviewController {
  constructor(
    private readonly xvFcReviewService: XvFcReviewService,
    private readonly pdfService: XvFcReviewPdfService,
  ) {}

  @ApiOperation({ summary: 'List financial-year tabs (with yearId) with review status for this ULB' })
  @ApiParam({ name: 'ulbId', description: 'ULB ObjectId' })
  @Get(':ulbId/summary')
  getSummary(@Param('ulbId', ParseObjectIdPipe) ulbId: string, @CurrentUser() user: AuthUser) {
    return this.xvFcReviewService.getSummary(ulbId, user);
  }

  @ApiOperation({
    summary: 'Full line-item detail for one financial year (also used for the preview screen)',
  })
  @ApiParam({ name: 'ulbId', description: 'ULB ObjectId' })
  @ApiParam({ name: 'yearId', description: 'Year ObjectId, from the summary response' })
  @Get(':ulbId/:yearId')
  getDetail(
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.xvFcReviewService.getDetail(ulbId, yearId, user);
  }

  @ApiOperation({ summary: 'Save flagged items / comments as a draft, without submitting' })
  @ApiParam({ name: 'ulbId', description: 'ULB ObjectId' })
  @ApiParam({ name: 'yearId', description: 'Year ObjectId' })
  @Put(':ulbId/:yearId/draft')
  saveDraft(
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Body() dto: XvFcSaveDraftDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.xvFcReviewService.saveDraft(ulbId, yearId, dto, user);
  }

  @ApiOperation({ summary: 'Get a presigned S3 PUT URL for a supporting document or the declaration' })
  @ApiParam({ name: 'ulbId', description: 'ULB ObjectId' })
  @ApiParam({ name: 'yearId', description: 'Year ObjectId' })
  @Post(':ulbId/:yearId/documents/presign')
  presignUpload(
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Body() dto: PresignReviewUploadDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.xvFcReviewService.presignUpload(ulbId, yearId, dto, user);
  }

  @ApiOperation({ summary: 'Confirm a completed S3 upload and attach it to the line item or declaration' })
  @ApiParam({ name: 'ulbId', description: 'ULB ObjectId' })
  @ApiParam({ name: 'yearId', description: 'Year ObjectId' })
  @Post(':ulbId/:yearId/documents/confirm')
  confirmUpload(
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Body() dto: ConfirmReviewUploadDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.xvFcReviewService.confirmUpload(ulbId, yearId, dto, user);
  }

  @ApiOperation({ summary: 'Get a signed GET URL to view/download an uploaded document or the declaration' })
  @ApiParam({ name: 'ulbId', description: 'ULB ObjectId' })
  @ApiParam({ name: 'yearId', description: 'Year ObjectId' })
  @ApiParam({
    name: 'targetCode',
    description: '"DECLARATION" or "SUPPORTING_DOCUMENT" — there is no per-line-item upload',
  })
  @Get(':ulbId/:yearId/documents/:targetCode/signed-url')
  getSignedUrl(
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Param('targetCode') targetCode: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.xvFcReviewService.getSignedUrl(ulbId, yearId, targetCode, user);
  }

  @ApiOperation({
    summary: 'Final submit — locks the financial year. Requires a confirmed declaration upload first',
  })
  @ApiParam({ name: 'ulbId', description: 'ULB ObjectId' })
  @ApiParam({ name: 'yearId', description: 'Year ObjectId' })
  @Post(':ulbId/:yearId/submit')
  submit(
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Body() dto: SubmitReviewDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.xvFcReviewService.submit(ulbId, yearId, dto, user);
  }

  @ApiOperation({ summary: 'Download all line items for this financial year as a PDF' })
  @ApiParam({ name: 'ulbId', description: 'ULB ObjectId' })
  @ApiParam({ name: 'yearId', description: 'Year ObjectId' })
  @ApiQuery({ name: 'currency', enum: ['INR', 'LAKH', 'CRORE'], required: false })
  @Get(':ulbId/:yearId/pdf')
  async downloadPdf(
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Query('currency') currency: XvFcCurrency = 'INR',
    @CurrentUser() user: AuthUser,
  ): Promise<StreamableFile> {
    const detail = await this.xvFcReviewService.getDetail(ulbId, yearId, user);
    const buffer = await this.pdfService.buildLineItemsPdf(
      { ulbName: detail.ulbName ?? ulbId, financialYear: detail.financialYear, lineItems: detail.lineItems },
      currency,
    );
    return new StreamableFile(buffer as unknown as Uint8Array, {
      type: 'application/pdf',
      disposition: `attachment; filename="xv-fc-review-${ulbId}-${detail.financialYear}.pdf"`,
    });
  }
}
