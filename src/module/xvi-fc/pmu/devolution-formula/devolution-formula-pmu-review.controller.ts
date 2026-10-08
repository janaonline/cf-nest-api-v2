import { Body, Controller, Get, Headers, Ip, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { throwXviFcValidationError } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import {
  DF_INSTALLMENTS,
  type DfInstallment,
} from 'src/module/xvi-fc/state/devolution-formula/constants/devolution-formula.constants';
import { DevolutionFormulaPmuReviewService } from './services/devolution-formula-pmu-review.service';
import { RejectPmuFormDto } from 'src/module/xvi-fc/common/dto/reject-pmu-form.dto';

/** PMU-side review for Devolution Formula — form-level only, whole-form reject only, never
 *  per-ULB (see CLAUDE.md's "Read-only row access"), installment-scoped. No MoHUA review module
 *  exists for this form, same situation as SFC Status/GTC/Elected Body. */
@ApiTags('XVI-FC - PMU Review - Devolution Formula')
@ApiBearerAuth()
@Controller('xvi-fc/pmu/devolution-formula')
export class DevolutionFormulaPmuReviewController {
  constructor(private readonly reviewService: DevolutionFormulaPmuReviewService) {}

  // Declared before `getReview` for consistency with the other PMU controllers, though there's no
  // actual collision risk here — `getReview`'s route is 3-segment vs this route's 2-segment.
  @ApiOperation({ summary: 'Get Devolution Formula PMU worklist across states for a year' })
  @Get('worklist/:yearId')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.REVIEW_STATE_SUBMISSIONS_PMU)
  getWorklist(@Param('yearId', ParseObjectIdPipe) yearId: string, @CurrentUser() user: AuthUser) {
    return this.reviewService.getWorklist(yearId, user);
  }

  @ApiOperation({ summary: 'Get Devolution Formula PMU review metadata' })
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

  @ApiOperation({ summary: 'Get ULB-wise Allocation rows for PMU review (read-only)' })
  @Get(':stateId/:yearId/:installment/rows')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.REVIEW_STATE_SUBMISSIONS_PMU)
  getRows(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Param('installment') installment: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.reviewService.getRows(stateId, yearId, this.parseInstallment(installment), user);
  }

  @ApiOperation({ summary: 'Approve the Devolution Formula form' })
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

  @ApiOperation({ summary: 'Reject the Devolution Formula form' })
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

  /** Mirrors `DevolutionFormulaController`'s own installment parsing — duplicated rather than
   *  shared (matches this codebase's established per-module duplication style). */
  private parseInstallment(raw: string): DfInstallment {
    const n = Number(raw);
    if (!DF_INSTALLMENTS.includes(n as DfInstallment)) {
      throwXviFcValidationError({
        installment: [{ field: 'installment', code: 'invalid', message: 'Installment must be 1 or 2.' }],
      });
    }
    return n as DfInstallment;
  }
}
