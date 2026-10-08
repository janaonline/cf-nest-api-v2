import { Body, Controller, Get, Headers, Ip, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { throwXviFcValidationError } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import { GTC_INSTALLMENTS, type GtcInstallment } from 'src/module/xvi-fc/state/gtc/constants/gtc.constants';
import { GtcPmuReviewService } from './services/gtc-pmu-review.service';
import { RejectPmuFormDto } from 'src/module/xvi-fc/common/dto/reject-pmu-form.dto';

/** PMU-side review for GTC (PMU Review feature) — form-level only, no rows, installment-scoped.
 *  No MoHUA review module exists for this form, same situation as SFC Status/Elected Body. */
@ApiTags('XVI-FC - PMU Review - GTC')
@ApiBearerAuth()
@Controller('xvi-fc/pmu/gtc')
export class GtcPmuReviewController {
  constructor(private readonly reviewService: GtcPmuReviewService) {}

  // Declared before `getReview` for consistency with the other PMU controllers, though there's no
  // actual collision risk here — `getReview`'s route is 3-segment vs this route's 2-segment.
  @ApiOperation({ summary: 'Get GTC PMU worklist across states for a year' })
  @Get('worklist/:yearId')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.REVIEW_STATE_SUBMISSIONS_PMU)
  getWorklist(@Param('yearId', ParseObjectIdPipe) yearId: string, @CurrentUser() user: AuthUser) {
    return this.reviewService.getWorklist(yearId, user);
  }

  @ApiOperation({ summary: 'Get GTC PMU review metadata' })
  @Get(':stateId/:yearId/:installment')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.REVIEW_STATE_SUBMISSIONS_PMU)
  getReview(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Param('installment') installment: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reviewService.getReviewMetadata(stateId, yearId, this.parseInstallment(installment), user);
  }

  @ApiOperation({ summary: 'Approve the GTC form' })
  @Post(':stateId/:yearId/:installment/approve')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.APPROVE_STATE_SUBMISSIONS_PMU)
  approveForm(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Param('installment') installment: string,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.reviewService.approveCompleteForm(
      stateId,
      yearId,
      this.parseInstallment(installment),
      user,
      ip,
      userAgent,
    );
  }

  @ApiOperation({ summary: 'Reject the GTC form' })
  @ApiBody({ type: RejectPmuFormDto })
  @Post(':stateId/:yearId/:installment/reject')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.APPROVE_STATE_SUBMISSIONS_PMU)
  rejectForm(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Param('installment') installment: string,
    @Body() dto: RejectPmuFormDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.reviewService.rejectCompleteForm(
      stateId,
      yearId,
      this.parseInstallment(installment),
      dto.pmuRemarks,
      user,
      ip,
      userAgent,
    );
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  /** Mirrors `GtcController`'s own `parseInstallment` — duplicated rather than shared; see this
   *  folder's CLAUDE.md "Why `parseInstallment` is duplicated here". */
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
