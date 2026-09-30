import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../../../auth/decorators/current-user.decorator';
import { Roles } from '../../../../auth/decorators/roles.decorator';
import { Role } from '../../../../auth/enum/role.enum';
import { RolesGuard } from '../../../../auth/guards/roles.guard';
import type { AuthUser } from '../../../../auth/auth-user.interface';
import { ParseObjectIdPipe } from '../../../../../common/pipes/parse-object-id.pipe';
import { PtaxAdminListQueryDto } from './dto/ptax-admin-list-query.dto';
import { PtaxMetricDecisionDto } from './dto/ptax-metric-decision.dto';
import { PtaxReviewAdminService } from './ptax-review-admin.service';

@ApiTags('XV-FC Review — Ptax (Admin)')
@UseGuards(RolesGuard)
@Roles([Role.ADMIN])
@ApiBearerAuth()
@Controller('admin/xv-fc-review/ptax')
export class PtaxReviewAdminController {
  constructor(private readonly ptaxReviewAdminService: PtaxReviewAdminService) {}

  @ApiOperation({ summary: 'Paginated list of Ptax submissions, filterable by state/status/financial year' })
  @Get()
  list(@Query() query: PtaxAdminListQueryDto) {
    return this.ptaxReviewAdminService.list(query);
  }

  @ApiOperation({ summary: 'Full detail for one ULB + financial year, including the full decision history' })
  @ApiParam({ name: 'ulbId', description: 'ULB ObjectId' })
  @ApiParam({ name: 'yearId', description: 'Year ObjectId' })
  @Get(':ulbId/:yearId')
  getDetail(@Param('ulbId', ParseObjectIdPipe) ulbId: string, @Param('yearId', ParseObjectIdPipe) yearId: string) {
    return this.ptaxReviewAdminService.getDetail(ulbId, yearId);
  }

  @ApiOperation({
    summary:
      'Accept or reject a flagged metric. Any rejection sends the whole submission back to the ULB to fix and resubmit',
  })
  @ApiParam({ name: 'ulbId', description: 'ULB ObjectId' })
  @ApiParam({ name: 'yearId', description: 'Year ObjectId' })
  @ApiParam({ name: 'code', description: 'Metric code' })
  @Post(':ulbId/:yearId/metrics/:code/decision')
  decideMetric(
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Param('code') code: string,
    @Body() dto: PtaxMetricDecisionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ptaxReviewAdminService.decideMetric(ulbId, yearId, code, dto, user);
  }

  @ApiOperation({ summary: 'Get a signed GET URL to view the ULB-uploaded declaration or supporting document' })
  @ApiParam({ name: 'ulbId', description: 'ULB ObjectId' })
  @ApiParam({ name: 'yearId', description: 'Year ObjectId' })
  @ApiParam({ name: 'targetCode', description: '"DECLARATION" or "SUPPORTING_DOCUMENT"' })
  @Get(':ulbId/:yearId/documents/:targetCode/signed-url')
  getSignedUrl(
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Param('targetCode') targetCode: string,
  ) {
    return this.ptaxReviewAdminService.getSignedUrl(ulbId, yearId, targetCode);
  }
}
