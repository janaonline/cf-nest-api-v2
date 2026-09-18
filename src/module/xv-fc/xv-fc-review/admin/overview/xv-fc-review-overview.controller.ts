import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Roles } from '../../../../auth/decorators/roles.decorator';
import { Role } from '../../../../auth/enum/role.enum';
import { RolesGuard } from '../../../../auth/guards/roles.guard';
import { OverviewAnalyticsQueryDto } from './dto/overview-analytics-query.dto';
import { OverviewExportQueryDto } from './dto/overview-export-query.dto';
import { OverviewListQueryDto } from './dto/overview-list-query.dto';
import { XvFcReviewOverviewService } from './xv-fc-review-overview.service';

@ApiTags('XV-FC Review — Overview (Admin)')
@UseGuards(RolesGuard)
@Roles([Role.ADMIN])
@ApiBearerAuth()
@Controller('admin/xv-fc-review/overview')
export class XvFcReviewOverviewController {
  constructor(private readonly overviewService: XvFcReviewOverviewService) {}

  @ApiOperation({
    summary: 'Paginated, one-row-per-ULB list combining AFS + Ptax status — the dashboard home screen',
  })
  @Get()
  list(@Query() query: OverviewListQueryDto) {
    return this.overviewService.list(query);
  }

  @ApiOperation({ summary: 'KPI counts (total ULBs, awaiting verification, approved, rejected)' })
  @Get('analytics')
  analytics(@Query() query: OverviewAnalyticsQueryDto) {
    return this.overviewService.analytics(query);
  }

  @ApiOperation({ summary: 'CSV export, one row per ULB per form, same filters as the list (no pagination)' })
  @Get('export')
  async export(@Query() query: OverviewExportQueryDto, @Res() res: Response) {
    const { csv, rowCount } = await this.overviewService.exportCsv(query);
    const today = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="xv-fc-review-summary-${today}.csv"`);
    res.setHeader('X-Row-Count', String(rowCount));
    res.send(csv);
  }
}
