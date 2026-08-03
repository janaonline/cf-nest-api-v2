import { Body, Controller, Get, Headers, Ip, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { throwXviFcValidationError } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import { XviFcFileRefDto } from 'src/module/xvi-fc/common/dto/xvi-fc-file-ref.dto';
import { ClaimLetterService } from './services/main/claim-letter.service';
import { ClaimLetterUlbOptionsService } from './services/ulb-options/claim-letter-ulb-options.service';
import { ClaimLetterUlbRowsService } from './services/ulb-rows/claim-letter-ulb-rows.service';
import { ClaimLetterAssemblyService } from './services/assembly/claim-letter-assembly.service';
import { ClaimLetterDocumentService } from './services/document/claim-letter-document.service';
import { GetClaimLetterUlbOptionsQueryDto } from './dto/get-claim-letter-ulb-options-query.dto';
import { GetClaimLetterUlbRowsQueryDto } from './dto/get-claim-letter-ulb-rows-query.dto';
import { GetClaimLetterHistoryQueryDto } from './dto/get-claim-letter-history-query.dto';
import { CreateClaimLetterDraftDto } from './dto/create-claim-letter-draft.dto';
import { UpdateClaimLetterDraftDto } from './dto/update-claim-letter-draft.dto';

@ApiTags('XVI-FC - State Forms - Claim Letter')
@ApiBearerAuth()
@Controller('xvi-fc/state/claim-letter')
export class ClaimLetterController {
  constructor(
    private readonly claimLetterService: ClaimLetterService,
    private readonly ulbOptionsService: ClaimLetterUlbOptionsService,
    private readonly ulbRowsService: ClaimLetterUlbRowsService,
    private readonly assemblyService: ClaimLetterAssemblyService,
    private readonly documentService: ClaimLetterDocumentService,
  ) {}

  @ApiOperation({ summary: 'Get claim eligibility summary (state-level gate, expected ULBs, batch-slot usage)' })
  @Get(':stateId/:yearId/:installment/eligibility-summary')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  getEligibilitySummary(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Param('installment') installment: string,
    @CurrentUser() user: AuthUser,
  ) {
    const inst = this.parseInstallment(installment);
    return this.claimLetterService.getEligibilitySummary(stateId, yearId, inst, user);
  }

  @ApiOperation({
    summary:
      'Get lightweight claim context (financial overview, batch-slot/ULB counts) for the create/edit page — no eligibility checklist evaluation',
  })
  @Get(':stateId/:yearId/:installment/claim-context')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  getClaimContext(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Param('installment') installment: string,
    @CurrentUser() user: AuthUser,
  ) {
    const inst = this.parseInstallment(installment);
    return this.claimLetterService.getClaimContext(stateId, yearId, inst, user);
  }

  @ApiOperation({ summary: 'Get paginated/searchable ULB options for the claim-letter select dialog' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'eligibilityFilter', required: false, enum: ['ELIGIBLE', 'INELIGIBLE'] })
  @ApiQuery({ name: 'claimLetterId', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @Get(':stateId/:yearId/:installment/ulb-options')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  getUlbOptions(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Param('installment') installment: string,
    @Query() query: GetClaimLetterUlbOptionsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    const inst = this.parseInstallment(installment);
    return this.ulbOptionsService.getOptions(stateId, yearId, inst, query, user);
  }

  @ApiOperation({ summary: 'Create a claim-letter draft (select ULBs and claimed amounts)' })
  @ApiBody({ type: CreateClaimLetterDraftDto })
  @Post(':stateId/:yearId/:installment/draft')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.PREPARE_GRANT_LETTERS)
  createDraft(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Param('installment') installment: string,
    @Body() dto: CreateClaimLetterDraftDto,
    @CurrentUser() user: AuthUser,
  ) {
    const inst = this.parseInstallment(installment);
    return this.assemblyService.createDraft({
      stateId,
      yearId,
      installment: inst,
      ulbSelections: dto.ulbSelections,
      buildRequestId: dto.idempotencyKey,
      user,
    });
  }

  @ApiOperation({ summary: 'Edit a claim-letter draft (resync selected ULBs/amounts while IN_PROGRESS)' })
  @ApiBody({ type: UpdateClaimLetterDraftDto })
  @Patch(':claimLetterId/draft')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.PREPARE_GRANT_LETTERS)
  updateDraft(
    @Param('claimLetterId', ParseObjectIdPipe) claimLetterId: string,
    @Body() dto: UpdateClaimLetterDraftDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assemblyService.updateDraft(claimLetterId, dto.ulbSelections, dto.expectedRevision, user);
  }

  @ApiOperation({ summary: 'Abandon a claim-letter draft, releasing its locked ULBs' })
  @Post(':claimLetterId/abandon')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.PREPARE_GRANT_LETTERS)
  abandonDraft(@Param('claimLetterId', ParseObjectIdPipe) claimLetterId: string, @CurrentUser() user: AuthUser) {
    return this.assemblyService.abandonDraft(claimLetterId, user);
  }

  @ApiOperation({ summary: 'Upload the signed claim-letter PDF' })
  @ApiBody({ type: XviFcFileRefDto })
  @Post(':claimLetterId/signed-file')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.PREPARE_GRANT_LETTERS)
  uploadSignedFile(
    @Param('claimLetterId', ParseObjectIdPipe) claimLetterId: string,
    @Body() fileRef: XviFcFileRefDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.claimLetterService.uploadSignedFile(claimLetterId, fileRef, user);
  }

  @ApiOperation({ summary: 'Submit the claim letter to MoHUA' })
  @Post(':claimLetterId/submit')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.FINAL_SUBMIT_TO_MOHUA)
  submit(
    @Param('claimLetterId', ParseObjectIdPipe) claimLetterId: string,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.claimLetterService.submit(claimLetterId, user, ip, userAgent);
  }

  @ApiOperation({ summary: "List the State's claim letters (batch/version/status history)" })
  @ApiQuery({ name: 'installment', required: false, enum: [1, 2] })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @Get(':stateId/:yearId/history')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  listHistory(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Query() query: GetClaimLetterHistoryQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.claimLetterService.listHistory(stateId, yearId, query, user);
  }

  @ApiOperation({ summary: 'Get a single claim letter (parent detail)' })
  @Get(':claimLetterId')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  getDetail(@Param('claimLetterId', ParseObjectIdPipe) claimLetterId: string, @CurrentUser() user: AuthUser) {
    return this.claimLetterService.getDetail(claimLetterId, user);
  }

  @ApiOperation({ summary: 'Get paginated/searchable selected-ULB rows for a claim letter' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @Get(':claimLetterId/ulbs')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  getUlbs(
    @Param('claimLetterId', ParseObjectIdPipe) claimLetterId: string,
    @Query() query: GetClaimLetterUlbRowsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.ulbRowsService.getUlbs(claimLetterId, query, user);
  }

  @ApiOperation({
    summary:
      'Get the claim letter document (covering letter + Annexure 1 FC Disclosures + Annexure 2 City Conditions) for Preview Template / Download Template',
  })
  @Get(':claimLetterId/document')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  getDocument(@Param('claimLetterId', ParseObjectIdPipe) claimLetterId: string, @CurrentUser() user: AuthUser) {
    return this.documentService.getDocumentData(claimLetterId, user);
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private parseInstallment(raw: string): number {
    const n = Number(raw);
    if (n !== 1 && n !== 2) {
      throwXviFcValidationError({
        installment: [{ field: 'installment', code: 'invalid', message: 'Installment must be 1 or 2.' }],
      });
    }
    return n;
  }
}
