import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../module/auth/decorators/current-user.decorator';
import { Roles } from '../../../module/auth/decorators/roles.decorator';
import { Role } from '../../../module/auth/enum/role.enum';
import { RolesGuard } from '../../../module/auth/guards/roles.guard';
import type { AuthUser } from '../../../module/auth/auth-user.interface';
import { ParseObjectIdPipe } from '../../../common/pipes/parse-object-id.pipe';
import { ConfirmPtaxUploadDto } from './dto/confirm-ptax-upload.dto';
import { PresignPtaxUploadDto } from './dto/presign-ptax-upload.dto';
import { SavePtaxDraftDto } from './dto/save-ptax-draft.dto';
import { SubmitPtaxReviewDto } from './dto/submit-ptax-review.dto';
import { PtaxReviewService } from './ptax-review.service';

@ApiTags('XV-FC Review — Ptax (ULB)')
@UseGuards(RolesGuard)
@Roles([Role.ULB])
@ApiBearerAuth()
@Controller('xv-fc-review/ptax')
export class PtaxReviewController {
  constructor(private readonly ptaxReviewService: PtaxReviewService) {}

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
}
