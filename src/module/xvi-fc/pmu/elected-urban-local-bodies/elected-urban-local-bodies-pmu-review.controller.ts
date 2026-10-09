import { Body, Controller, Get, Headers, Ip, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { ElectedUrbanLocalBodiesPmuReviewService } from './services/elected-urban-local-bodies-pmu-review.service';
import { ElectedUrbanLocalBodiesPmuRowsService } from './services/elected-urban-local-bodies-pmu-rows.service';
import { GetEulbPmuRowsQueryDto } from './dto/get-eulb-pmu-rows-query.dto';
import { BulkApprovePmuRowsDto } from 'src/module/xvi-fc/common/dto/bulk-approve-pmu-rows.dto';
import { BulkRejectPmuRowsDto } from 'src/module/xvi-fc/common/dto/bulk-reject-pmu-rows.dto';
import { RejectPmuFormDto } from 'src/module/xvi-fc/common/dto/reject-pmu-form.dto';
import { GetPmuWorklistQueryDto } from 'src/module/xvi-fc/common/dto/get-pmu-worklist-query.dto';

/** PMU-side review for Elected Urban Local Bodies (PMU Review feature) — a new stage ahead of
 *  MoHUA. No MoHUA review module exists for this form, so unlike FC Unspent's PMU reviewer this
 *  isn't inserted ahead of an existing one — see this module's CLAUDE.md. */
@ApiTags('XVI-FC - PMU Review - Elected Urban Local Bodies')
@ApiBearerAuth()
@Controller('xvi-fc/pmu/elected-urban-local-bodies')
export class ElectedUrbanLocalBodiesPmuReviewController {
  constructor(
    private readonly reviewService: ElectedUrbanLocalBodiesPmuReviewService,
    private readonly rowsService: ElectedUrbanLocalBodiesPmuRowsService,
  ) {}

  @ApiOperation({ summary: 'Bulk-approve selected Elected Urban Local Bodies rows' })
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

  @ApiOperation({ summary: 'Bulk-reject selected Elected Urban Local Bodies rows' })
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

  // Must stay registered before `getReview` — see CLAUDE.md's "GET route declaration order" section.
  @ApiOperation({ summary: 'Get Elected Urban Local Bodies PMU worklist across states for a year' })
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

  @ApiOperation({ summary: 'Get Elected Urban Local Bodies PMU review metadata' })
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

  @ApiOperation({ summary: 'Get paginated Elected Urban Local Bodies rows for PMU review' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'rowStatus', required: false, description: 'Single value or comma-separated list' })
  @ApiQuery({ name: 'sortBy', required: false, enum: ['ulbName', 'rowStatus'] })
  @ApiQuery({ name: 'sortDir', required: false, enum: ['asc', 'desc'] })
  @Get(':stateId/:yearId/rows')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.REVIEW_STATE_SUBMISSIONS_PMU)
  getRows(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Query() query: GetEulbPmuRowsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.rowsService.getRows(stateId, yearId, query, user);
  }

  @ApiOperation({ summary: 'Approve the complete Elected Urban Local Bodies form' })
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

  @ApiOperation({ summary: 'Reject the complete Elected Urban Local Bodies form' })
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
