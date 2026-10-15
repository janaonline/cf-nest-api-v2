import { Body, Controller, Get, Headers, Ip, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { SfcStatusPmuReviewService } from './services/sfc-status-pmu-review.service';
import { RejectPmuFormDto } from 'src/module/xvi-fc/common/dto/reject-pmu-form.dto';
import { GetPmuWorklistQueryDto } from 'src/module/xvi-fc/common/dto/get-pmu-worklist-query.dto';

/** PMU-side review for SFC Status — form-level only, no rows. See this folder's CLAUDE.md for why
 *  no MoHUA module or domain-service layer exists for this form. */
@ApiTags('XVI-FC - PMU Review - SFC Status')
@ApiBearerAuth()
@Controller('xvi-fc/pmu/sfc-status')
export class SfcStatusPmuReviewController {
  constructor(private readonly reviewService: SfcStatusPmuReviewService) {}

  // Must stay declared before `getReview` — see CLAUDE.md's "Route ordering" section.
  @ApiOperation({ summary: 'Get SFC Status PMU worklist across states for a year' })
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

  @ApiOperation({ summary: 'Get SFC Status PMU review metadata' })
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

  @ApiOperation({ summary: 'Approve the SFC Status form' })
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

  @ApiOperation({ summary: 'Reject the SFC Status form' })
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
