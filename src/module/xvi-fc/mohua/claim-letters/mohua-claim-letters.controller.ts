import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Ip,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Permission, Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import { assertReviewerAccess } from 'src/module/xvi-fc/common/utils/xvi-fc-reviewer-access.util';
import { isMohuaViewScope } from 'src/module/xvi-fc/common/utils/xvi-fc-scope.util';
import { ApproveMohuaClaimLetterDto } from './mohua-claim-letters-approve.dto';
import { ReturnMohuaClaimLetterDto } from './mohua-claim-letters-return.dto';
import { DecideMohuaClaimLetterUlbDto } from './mohua-claim-letters-ulb-decision.dto';
import { MOHUA_CLAIM_LETTER_REVIEWER_FORBIDDEN_MESSAGE } from './mohua-claim-letters.constants';
import { GetMohuaClaimLetterUlbsQueryDto } from './mohua-claim-letters-query.dto';
import { MohuaClaimLettersService } from './mohua-claim-letters.service';

/** Claim letter screens for MoHUA (and DoE, a read-only copy). Only the SO's approve and return decide a letter. */
@ApiTags('XVI-FC - MoHUA Claim Letters')
@ApiBearerAuth()
@Controller('xvi-fc/mohua/claim-letters')
@UseGuards(PermissionGuard)
@RequirePermissions(Permission.VIEW_STATUS_REPORTS)
export class MohuaClaimLettersController {
  constructor(private readonly service: MohuaClaimLettersService) {}

  @ApiOperation({ summary: 'One claim letter: its State-signed file and headline numbers' })
  @Get('letter/:claimLetterId')
  async getClaimLetter(
    @Param('claimLetterId', ParseObjectIdPipe) claimLetterId: string,
    @CurrentUser() user: AuthUser,
  ) {
    this.assertViewScope(user);
    return xviFcSuccess('Claim letter fetched.', await this.service.getClaimLetter(claimLetterId));
  }

  @ApiOperation({
    summary: 'Approve a claim letter under review: it moves to Approved by SO and its ULB locks are acknowledged',
  })
  @Post('letter/:claimLetterId/approve')
  @RequirePermissions(Permission.APPROVE_STATE_SUBMISSIONS)
  async approve(
    @Param('claimLetterId', ParseObjectIdPipe) claimLetterId: string,
    @Body() dto: ApproveMohuaClaimLetterDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    assertReviewerAccess(user, Scope.MOHUA, MOHUA_CLAIM_LETTER_REVIEWER_FORBIDDEN_MESSAGE);
    return xviFcSuccess(
      'Claim letter approved.',
      await this.service.approve(claimLetterId, dto.expectedRevision, dto.remark, user, ip, userAgent),
    );
  }

  @ApiOperation({
    summary:
      "SO return of a claim letter under SO review: the letter goes to Returned for Correction and closes (its batch slot and ULB locks are freed); only the ULBs marked RETURNED (their picked forms and rows) and the State-wide items in the body reopen",
  })
  @Post('letter/:claimLetterId/return')
  @RequirePermissions(Permission.APPROVE_STATE_SUBMISSIONS)
  async returnForCorrection(
    @Param('claimLetterId', ParseObjectIdPipe) claimLetterId: string,
    @Body() dto: ReturnMohuaClaimLetterDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    assertReviewerAccess(user, Scope.MOHUA, MOHUA_CLAIM_LETTER_REVIEWER_FORBIDDEN_MESSAGE);
    return xviFcSuccess(
      'Claim letter returned for correction.',
      await this.service.returnForCorrection(claimLetterId, dto, user, ip, userAgent),
    );
  }

  @ApiOperation({
    summary:
      "The SO's mark on one ULB of a letter under SO review: APPROVED, RETURNED (forms, rows, remark) or PENDING (clears it). Nothing moves until the letter is approved or returned",
  })
  @Put('letter/:claimLetterId/ulb/:ulbId/decision')
  @RequirePermissions(Permission.APPROVE_STATE_SUBMISSIONS)
  async decideUlb(
    @Param('claimLetterId', ParseObjectIdPipe) claimLetterId: string,
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Body() dto: DecideMohuaClaimLetterUlbDto,
    @CurrentUser() user: AuthUser,
  ) {
    assertReviewerAccess(user, Scope.MOHUA, MOHUA_CLAIM_LETTER_REVIEWER_FORBIDDEN_MESSAGE);
    return xviFcSuccess('ULB decision saved.', await this.service.decideUlb(claimLetterId, ulbId, dto, user));
  }

  @ApiOperation({ summary: 'The ULBs in one claim letter (search by name or census code, paged)' })
  @Get('letter/:claimLetterId/ulbs')
  async getClaimLetterUlbs(
    @Param('claimLetterId', ParseObjectIdPipe) claimLetterId: string,
    @Query() query: GetMohuaClaimLetterUlbsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    this.assertViewScope(user);
    return xviFcSuccess('Claim letter ULBs fetched.', await this.service.getClaimLetterUlbs(claimLetterId, query));
  }

  @ApiOperation({ summary: "One state's claim letters waiting on MoHUA" })
  @Get('state/:stateId/:yearId/:installment')
  async listStateClaimLetters(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Param('installment', ParseIntPipe) installment: number,
    @CurrentUser() user: AuthUser,
  ) {
    this.assertViewScope(user);
    return xviFcSuccess(
      'State claim letters fetched.',
      await this.service.listStateClaimLetters(stateId, yearId, installment),
    );
  }

  @ApiOperation({ summary: 'Every state with its first-claim status, Installment allocation and amount claimed' })
  @Get(':yearId/:installment')
  async listStates(
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Param('installment', ParseIntPipe) installment: number,
    @CurrentUser() user: AuthUser,
  ) {
    this.assertViewScope(user);
    return xviFcSuccess('Claim letters by state fetched.', await this.service.listStates(yearId, installment));
  }

  /** STATE users also hold VIEW_STATUS_REPORTS, but these screens span every state — MoHUA/DoE (read-only)/ADMIN only. */
  private assertViewScope(user: AuthUser): void {
    if (!isMohuaViewScope(user) && user.scope !== Scope.ADMIN) throw new ForbiddenException('Access denied');
  }
}
