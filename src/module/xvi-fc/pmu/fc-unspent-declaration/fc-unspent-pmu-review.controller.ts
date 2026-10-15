import { Body, Controller, Get, Headers, Ip, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { FcUnspentPmuReviewService } from './services/fc-unspent-pmu-review.service';
import { FcUnspentPmuRowsService } from './services/fc-unspent-pmu-rows.service';
import { GetFcUnspentPmuRowsQueryDto } from './dto/get-fc-unspent-pmu-rows-query.dto';
import { BulkApprovePmuRowsDto } from 'src/module/xvi-fc/common/dto/bulk-approve-pmu-rows.dto';
import { BulkRejectPmuRowsDto } from 'src/module/xvi-fc/common/dto/bulk-reject-pmu-rows.dto';
import { RejectPmuFormDto } from 'src/module/xvi-fc/common/dto/reject-pmu-form.dto';
import { GetPmuWorklistQueryDto } from 'src/module/xvi-fc/common/dto/get-pmu-worklist-query.dto';

/** PMU-side review for FC Unspent Declaration — a new stage ahead of the existing, untouched MoHUA
 *  review (`mohua/fc-unspent-declaration`). See this module's CLAUDE.md "PMU vs MoHUA" section for
 *  how the two relate. */
@ApiTags('XVI-FC - PMU Review - FC Unspent Declaration')
@ApiBearerAuth()
@Controller('xvi-fc/pmu/fc-unspent-declaration')
export class FcUnspentPmuReviewController {
  constructor(
    private readonly reviewService: FcUnspentPmuReviewService,
    private readonly rowsService: FcUnspentPmuRowsService,
  ) {}

  @ApiOperation({ summary: 'Bulk-approve selected FC Unspent Declaration rows' })
  @ApiBody({ type: BulkApprovePmuRowsDto })
  @Post('rows/approve')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.APPROVE_STATE_SUBMISSIONS_PMU)
  bulkApproveRows(
    @Body() dto: BulkApprovePmuRowsDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.rowsService.bulkApproveRows(dto, user, ip, userAgent);
  }

  @ApiOperation({ summary: 'Bulk-reject selected FC Unspent Declaration rows' })
  @ApiBody({ type: BulkRejectPmuRowsDto })
  @Post('rows/reject')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.APPROVE_STATE_SUBMISSIONS_PMU)
  bulkRejectRows(
    @Body() dto: BulkRejectPmuRowsDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.rowsService.bulkRejectRows(dto, user, ip, userAgent);
  }

  // Must stay declared before getReview's :stateId/:yearId route — see CLAUDE.md's "Layout" section.
  @ApiOperation({ summary: 'Get FC Unspent Declaration PMU worklist across states for a year' })
  @ApiQuery({ name: 'stateId', required: false })
  @ApiQuery({ name: 'status', required: false })
  @ApiQuery({ name: 'sortBy', required: false })
  @ApiQuery({ name: 'sortDir', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @Get('worklist/:yearId')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.REVIEW_STATE_SUBMISSIONS_PMU)
  getWorklist(
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Query() query: GetPmuWorklistQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reviewService.getWorklist(yearId, query, user);
  }

  @ApiOperation({ summary: 'Get FC Unspent Declaration PMU review metadata' })
  @Get(':stateId/:yearId')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.REVIEW_STATE_SUBMISSIONS_PMU)
  getReview(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reviewService.getReviewMetadata(stateId, yearId, user);
  }

  @ApiOperation({ summary: 'Get paginated FC Unspent Declaration rows for PMU review' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'rowStatus', required: false, description: 'Single value or comma-separated list' })
  @ApiQuery({ name: 'eligibility', required: false })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['ulbName', 'rowStatus'] })
  @ApiQuery({ name: 'sortDir', required: false, enum: ['asc', 'desc'] })
  @Get(':stateId/:yearId/rows')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.REVIEW_STATE_SUBMISSIONS_PMU)
  getRows(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Query() query: GetFcUnspentPmuRowsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.rowsService.getRows(stateId, yearId, query, user);
  }

  @ApiOperation({ summary: 'Approve the complete FC Unspent Declaration form' })
  @Post(':stateId/:yearId/approve')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.APPROVE_STATE_SUBMISSIONS_PMU)
  approveForm(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.reviewService.approveCompleteForm(stateId, yearId, user, ip, userAgent);
  }

  @ApiOperation({ summary: 'Reject the complete FC Unspent Declaration form' })
  @ApiBody({ type: RejectPmuFormDto })
  @Post(':stateId/:yearId/reject')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.APPROVE_STATE_SUBMISSIONS_PMU)
  rejectForm(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Body() dto: RejectPmuFormDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.reviewService.rejectCompleteForm(stateId, yearId, dto.pmuRemarks, user, ip, userAgent);
  }
}
