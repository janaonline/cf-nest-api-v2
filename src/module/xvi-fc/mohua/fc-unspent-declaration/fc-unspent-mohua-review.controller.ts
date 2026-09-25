import { Body, Controller, Get, Headers, Ip, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { FcUnspentMohuaReviewService } from './services/fc-unspent-mohua-review.service';
import { FcUnspentMohuaRowsService } from './services/fc-unspent-mohua-rows.service';
import { GetFcUnspentMohuaRowsQueryDto } from './dto/get-fc-unspent-mohua-rows-query.dto';
import { BulkApproveFcUnspentRowsDto } from './dto/bulk-approve-fc-unspent-rows.dto';
import { BulkRejectFcUnspentRowsDto } from './dto/bulk-reject-fc-unspent-rows.dto';
import { RejectFcUnspentFormDto } from './dto/reject-fc-unspent-form.dto';

@ApiTags('XVI-FC - MoHUA Review - FC Unspent Declaration')
@ApiBearerAuth()
@Controller('xvi-fc/mohua/fc-unspent-declaration')
export class FcUnspentMohuaReviewController {
  constructor(
    private readonly reviewService: FcUnspentMohuaReviewService,
    private readonly rowsService: FcUnspentMohuaRowsService,
  ) {}

  @ApiOperation({ summary: 'Bulk-approve selected FC Unspent Declaration rows' })
  @ApiBody({ type: BulkApproveFcUnspentRowsDto })
  @Post('rows/approve')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.APPROVE_STATE_SUBMISSIONS)
  bulkApproveRows(
    @Body() dto: BulkApproveFcUnspentRowsDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.rowsService.bulkApproveRows(dto, user, ip, userAgent);
  }

  @ApiOperation({ summary: 'Bulk-reject selected FC Unspent Declaration rows' })
  @ApiBody({ type: BulkRejectFcUnspentRowsDto })
  @Post('rows/reject')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.APPROVE_STATE_SUBMISSIONS)
  bulkRejectRows(
    @Body() dto: BulkRejectFcUnspentRowsDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.rowsService.bulkRejectRows(dto, user, ip, userAgent);
  }

  @ApiOperation({ summary: 'Get FC Unspent Declaration MoHUA review metadata' })
  @Get(':stateId/:yearId')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.REVIEW_STATE_SUBMISSIONS)
  getReview(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reviewService.getReviewMetadata(stateId, yearId, user);
  }

  @ApiOperation({ summary: 'Get paginated FC Unspent Declaration rows for MoHUA review' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'rowStatus', required: false })
  @ApiQuery({ name: 'eligibility', required: false })
  @Get(':stateId/:yearId/rows')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.REVIEW_STATE_SUBMISSIONS)
  getRows(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Query() query: GetFcUnspentMohuaRowsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.rowsService.getRows(stateId, yearId, query, user);
  }

  @ApiOperation({ summary: 'Approve the complete FC Unspent Declaration form' })
  @Post(':stateId/:yearId/approve')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.APPROVE_STATE_SUBMISSIONS)
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
  @ApiBody({ type: RejectFcUnspentFormDto })
  @Post(':stateId/:yearId/reject')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.APPROVE_STATE_SUBMISSIONS)
  rejectForm(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Body() dto: RejectFcUnspentFormDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.reviewService.rejectCompleteForm(stateId, yearId, dto.mohuaRemarks, user, ip, userAgent);
  }
}
