import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { Roles } from '../../../auth/decorators/roles.decorator';
import { Role } from '../../../auth/enum/role.enum';
import { RolesGuard } from '../../../auth/guards/roles.guard';
import type { AuthUser } from '../../../auth/auth-user.interface';
import { ParseObjectIdPipe } from '../../../../common/pipes/parse-object-id.pipe';
import { AdminReviewListQueryDto } from './dto/admin-review-list-query.dto';
import { LineItemDecisionDto } from './dto/line-item-decision.dto';
import { ReopenReviewDto } from './dto/reopen-review.dto';
import { XvFcReviewAdminService } from './xv-fc-review-admin.service';

@ApiTags('XV-FC Review (Admin)')
@UseGuards(RolesGuard)
@Roles([Role.ADMIN])
@ApiBearerAuth()
@Controller('admin/xv-fc-review')
export class XvFcReviewAdminController {
  constructor(private readonly xvFcReviewAdminService: XvFcReviewAdminService) {}

  @ApiOperation({ summary: 'Paginated list of all ULB submissions, filterable by state/status/financial year' })
  @Get()
  list(@Query() query: AdminReviewListQueryDto) {
    return this.xvFcReviewAdminService.list(query);
  }

  @ApiOperation({ summary: "This ULB's status across every reviewable financial year — powers the year tabs" })
  @ApiParam({ name: 'ulbId', description: 'ULB ObjectId' })
  @Get(':ulbId/years')
  getYearsSummary(@Param('ulbId', ParseObjectIdPipe) ulbId: string) {
    return this.xvFcReviewAdminService.getYearsSummary(ulbId);
  }

  @ApiOperation({ summary: 'Full detail for one ULB + financial year, including admin decision state' })
  @ApiParam({ name: 'ulbId', description: 'ULB ObjectId' })
  @ApiParam({ name: 'yearId', description: 'Year ObjectId' })
  @Get(':ulbId/:yearId')
  getDetail(@Param('ulbId', ParseObjectIdPipe) ulbId: string, @Param('yearId', ParseObjectIdPipe) yearId: string) {
    return this.xvFcReviewAdminService.getDetail(ulbId, yearId);
  }

  @ApiOperation({
    summary: 'Accept or reject a flagged line item. ACCEPTED overwrites the source-of-truth value',
  })
  @ApiParam({ name: 'ulbId', description: 'ULB ObjectId' })
  @ApiParam({ name: 'yearId', description: 'Year ObjectId' })
  @ApiParam({ name: 'code', description: 'Line-item code' })
  @Post(':ulbId/:yearId/line-items/:code/decision')
  decideLineItem(
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Param('code') code: string,
    @Body() dto: LineItemDecisionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.xvFcReviewAdminService.decideLineItem(ulbId, yearId, code, dto, user);
  }

  @ApiOperation({ summary: "Bulk-accept every pending flagged line item, using each one's proposed value" })
  @ApiParam({ name: 'ulbId', description: 'ULB ObjectId' })
  @ApiParam({ name: 'yearId', description: 'Year ObjectId' })
  @Post(':ulbId/:yearId/accept-all')
  acceptAll(
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.xvFcReviewAdminService.acceptAll(ulbId, yearId, user);
  }

  @ApiOperation({
    summary: 'Finalize the submission — every flagged item must already be decided (with a reason on any reject)',
  })
  @ApiParam({ name: 'ulbId', description: 'ULB ObjectId' })
  @ApiParam({ name: 'yearId', description: 'Year ObjectId' })
  @Post(':ulbId/:yearId/finalize')
  finalize(
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.xvFcReviewAdminService.finalize(ulbId, yearId, user);
  }

  @ApiOperation({ summary: 'Reopen a finalized submission back to DRAFT so the ULB can edit and resubmit' })
  @ApiParam({ name: 'ulbId', description: 'ULB ObjectId' })
  @ApiParam({ name: 'yearId', description: 'Year ObjectId' })
  @Post(':ulbId/:yearId/reopen')
  reopen(
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Body() dto: ReopenReviewDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.xvFcReviewAdminService.reopen(ulbId, yearId, dto, user);
  }

  @ApiOperation({ summary: 'Get a signed GET URL to view a ULB-uploaded document or declaration' })
  @ApiParam({ name: 'ulbId', description: 'ULB ObjectId' })
  @ApiParam({ name: 'yearId', description: 'Year ObjectId' })
  @ApiParam({ name: 'targetCode', description: '"DECLARATION" or "SUPPORTING_DOCUMENT"' })
  @Get(':ulbId/:yearId/documents/:targetCode/signed-url')
  getSignedUrl(
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Param('targetCode') targetCode: string,
  ) {
    return this.xvFcReviewAdminService.getSignedUrl(ulbId, yearId, targetCode);
  }
}
