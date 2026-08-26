import { Body, Controller, Get, Headers, Ip, Param, Post, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { getTimeStamp } from 'src/shared/utils/date.utils';
import { SfcStatusService } from './sfc-status.service';
import { SaveSfcStatusDto } from './dto/save-sfc-status.dto';
import { DumpSfcStatusQueryDto } from './dto/dump-sfc-status-query.dto';

@ApiTags('XVI-FC - State Forms - SFC Status')
@ApiBearerAuth()
@Controller('xvi-fc/state/sfc-status')
export class SfcStatusController {
  constructor(private readonly sfcStatusService: SfcStatusService) {}

  @ApiOperation({
    summary: 'Get SFC Status questions',
    description:
      'Returns the static question config array for the SFC Status form. Used by the frontend to render the dynamic form.',
  })
  @Get('questions')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  getQuestions() {
    return this.sfcStatusService.getQuestions();
  }

  @ApiOperation({
    summary: 'Export SFC Status data as Excel',
    description:
      'Downloads all SFC Status records as an `.xlsx` file. ' +
      'Supports optional filters: stateId, yearId, status. ' +
      'ADMIN exports all records; STATE-scoped users are restricted to their own state.',
  })
  @ApiQuery({ name: 'stateId', required: false, description: 'Filter by state ObjectId' })
  @ApiQuery({ name: 'yearId', required: false, description: 'Filter by year ObjectId' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by numeric form status (e.g. 1, 2, 7)' })
  @Get('dump')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  async dump(@Query() query: DumpSfcStatusQueryDto, @CurrentUser() user: AuthUser): Promise<StreamableFile> {
    const filters = {
      stateId: query.stateId,
      yearId: query.yearId,
      status: query.status !== undefined ? parseInt(query.status, 10) : undefined,
    };
    const buffer = await this.sfcStatusService.dumpToExcel(filters, user);
    return new StreamableFile(new Uint8Array(buffer as ArrayBuffer), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="sfc-status-dump_${getTimeStamp(false)}.xlsx"`,
    });
  }

  @ApiOperation({
    summary: 'Get SFC Status form (hydrated)',
    description:
      'Returns the SFC Status form for the given state and year with saved data, defaults, status, and allowed actions.',
  })
  @Get(':stateId/:yearId')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  getForm(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.sfcStatusService.getForm(stateId, yearId, user);
  }

  @ApiOperation({
    summary: 'Save SFC Status form as draft',
    description:
      'Creates or updates an SFC Status draft for the given state and year. Allows incomplete required fields, validates provided values, upserts the draft, sets status to `IN_PROGRESS`, and saves only sanitized visible payload fields.',
  })
  @ApiBody({ type: SaveSfcStatusDto })
  @Post('save-draft')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.EDIT_STATE_FORMS)
  saveDraft(
    @Body() dto: SaveSfcStatusDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.sfcStatusService.saveDraft(dto, user, ip ?? '', userAgent ?? '');
  }

  @ApiOperation({
    summary: 'Final submit SFC Status form',
    description:
      'Final-submits the SFC Status form for the given state and year. Supports direct submit without an existing draft, runs full validation, upserts the sanitized visible payload, and transitions status to `SUBMISSION_ACKNOWLEDGED_BY_MOHUA`. Submission is controlled by the centralized status gate and state-level access rules.',
  })
  @ApiBody({ type: SaveSfcStatusDto })
  @Post('final-submit')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.FINAL_SUBMIT_STATE_FORMS)
  finalSubmit(
    @Body() dto: SaveSfcStatusDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.sfcStatusService.finalSubmit(dto, user, ip ?? '', userAgent ?? '');
  }
}
