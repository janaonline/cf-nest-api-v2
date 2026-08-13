import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { SlbService } from './slb.service';
import { SaveSlbDto } from './dto/save-slb.dto';
import { SlbUlbSubmissionsQueryDto } from './dto/slb-ulb-submissions-query.dto';

@ApiTags('XVI-FC - ULB Forms - Service Level Benchmarks')
@ApiBearerAuth()
@Controller('xvi-fc/ulb/slb')
export class SlbController {
  constructor(private readonly slbService: SlbService) {}

  @ApiOperation({
    summary: 'Get SLB question config',
    description:
      'Returns the static question config array for the SLB form. Used by the frontend to render the dynamic form.',
  })
  @Get('questions')
  @UseGuards(PermissionGuard)
  getQuestions() {
    return this.slbService.getQuestions();
  }

  @ApiOperation({
    summary: 'List ULB SLB submissions for STATE review',
    description:
      'Paginated list of every ULB in the requester\'s state for a given design year, with SLB ' +
      'form status and counts per status. STATE-scoped read-only — SLB has no approve/return ' +
      'workflow, so this exists purely to power the same stat-tile/table UI every other form uses.',
  })
  @Get('state/ulb-submissions')
  @UseGuards(PermissionGuard)
  listUlbSubmissions(@Query() dto: SlbUlbSubmissionsQueryDto, @CurrentUser() user: AuthUser) {
    return this.slbService.listUlbSlbForms(dto, user);
  }

  @ApiOperation({
    summary: 'Get SLB form (hydrated)',
    description:
      'Returns the SLB form for the given ULB and year with saved data, defaults, status, and allowed actions. ' +
      "ULB users may only fetch their own ULB's form; STATE users may fetch any ULB within their own state.",
  })
  @Get(':ulbId/:yearId')
  @UseGuards(PermissionGuard)
  getForm(
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.slbService.getForm(ulbId, yearId, user);
  }

  @ApiOperation({
    summary: 'Save SLB form as draft',
    description:
      'Creates or updates an SLB draft for the given ULB and year. Allows incomplete required fields, validates provided values, upserts the draft, and sets status to `IN_PROGRESS`.',
  })
  @ApiBody({ type: SaveSlbDto })
  @Post('save-draft')
  @UseGuards(PermissionGuard)
  saveDraft(@Body() dto: SaveSlbDto, @CurrentUser() user: AuthUser) {
    return this.slbService.saveDraft(dto, user);
  }

  @ApiOperation({
    summary: 'Final submit SLB form to State DMA',
    description:
      'Final-submits the SLB form for the given ULB and year. Runs full validation and transitions status to `UNDER_REVIEW_BY_STATE`.',
  })
  @ApiBody({ type: SaveSlbDto })
  @Post('final-submit')
  @UseGuards(PermissionGuard)
  finalSubmit(@Body() dto: SaveSlbDto, @CurrentUser() user: AuthUser) {
    return this.slbService.finalSubmit(dto, user);
  }
}
