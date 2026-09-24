import { Body, Controller, Get, Headers, Ip, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { throwXviFcValidationError } from '../../common/response/xvi-fc-response.util';
import { GtcService } from './gtc.service';
import { SaveGtcDto } from './dto/save-gtc.dto';
import { GTC_INSTALLMENTS, type GtcInstallment } from './constants/gtc.constants';

@ApiTags('XVI-FC - State Forms - GTC')
@ApiBearerAuth()
@Controller('xvi-fc/state/gtc')
export class GtcController {
  constructor(private readonly gtcService: GtcService) {}

  @ApiOperation({
    summary: 'Get GTC questions',
    description:
      'Returns the static question config array for the GTC form. Used by the frontend to render the dynamic form.',
  })
  @Get('questions')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  getQuestions() {
    return this.gtcService.getQuestions();
  }

  @ApiOperation({
    summary: 'Get GTC form (hydrated)',
    description:
      'Returns the GTC form for the given state, year, and installment with saved data, defaults, status, and allowed actions.',
  })
  @Get(':stateId/:yearId/:installment')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  getForm(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Param('installment') installment: string,
    @CurrentUser() user: AuthUser,
  ) {
    const inst = this.parseInstallment(installment);
    return this.gtcService.getForm(stateId, yearId, inst, user);
  }

  @ApiOperation({
    summary: 'Download GTC static template',
    description:
      'Returns a signed download URL for the static GTC template configured on this design year/installment (e.g. 2026-27 installment 1). Fails with templateNotConfigured for a design year/installment with no configured template.',
  })
  @Get(':stateId/:yearId/:installment/gtc-template')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  getTemplate(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Param('installment') installment: string,
    @CurrentUser() user: AuthUser,
  ) {
    const inst = this.parseInstallment(installment);
    return this.gtcService.getTemplate(stateId, yearId, inst, user);
  }

  @ApiOperation({
    summary: 'Save GTC form as draft',
    description:
      'Creates or updates a GTC draft for the given state, year, and installment. Allows incomplete required fields, validates provided values, upserts the draft, sets status to IN_PROGRESS.',
  })
  @ApiBody({ type: SaveGtcDto })
  @Post('save-draft')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.EDIT_STATE_FORMS)
  saveDraft(
    @Body() dto: SaveGtcDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.gtcService.saveDraft(dto, user, ip ?? '', userAgent ?? '');
  }

  @ApiOperation({
    summary: 'Final submit GTC form',
    description:
      'Final-submits the GTC form for the given state, year, and installment. Supports direct submit without an existing draft, runs full validation, and transitions status to UNDER_REVIEW_BY_MOHUA.',
  })
  @ApiBody({ type: SaveGtcDto })
  @Post('final-submit')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.FINAL_SUBMIT_STATE_FORMS)
  finalSubmit(
    @Body() dto: SaveGtcDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.gtcService.finalSubmit(dto, user, ip ?? '', userAgent ?? '');
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private parseInstallment(raw: string): GtcInstallment {
    const n = Number(raw);
    if (!GTC_INSTALLMENTS.includes(n as GtcInstallment)) {
      throwXviFcValidationError({
        installment: [{ field: 'installment', code: 'invalid', message: 'Installment must be 1 or 2.' }],
      });
    }
    return n as GtcInstallment;
  }
}
