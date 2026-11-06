import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  Ip,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import { Permission, Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { XviFcFileRefDto } from 'src/module/xvi-fc/common/dto/xvi-fc-file-ref.dto';
import { xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import { assertReviewerAccess } from 'src/module/xvi-fc/common/utils/xvi-fc-reviewer-access.util';
import { isMohuaViewScope } from 'src/module/xvi-fc/common/utils/xvi-fc-scope.util';
import { SaveOmDraftDto } from './om-draft.dto';
import { OM_REVIEWER_FORBIDDEN_MESSAGE } from './om.constants';
import { OmService } from './om.service';
import type { OmGeneratedFile } from './om.types';

/** Office Memorandums for verified claim letters. MoHUA issues them; DoE (read-only) and ADMIN can view. */
@ApiTags('XVI-FC - MoHUA Office Memorandum')
@ApiBearerAuth()
@Controller('xvi-fc/mohua/om')
@UseGuards(PermissionGuard)
@RequirePermissions(Permission.VIEW_STATUS_REPORTS)
export class OmController {
  constructor(private readonly service: OmService) {}

  @ApiOperation({ summary: 'One verified claim letter\'s OM: content, editable fields, saved values, Generate counts' })
  @Get('letter/:claimLetterId/document')
  async getEditor(@Param('claimLetterId', ParseObjectIdPipe) claimLetterId: string, @CurrentUser() user: AuthUser) {
    this.assertViewScope(user);
    return xviFcSuccess('Office Memorandum fetched.', await this.service.getEditor(claimLetterId));
  }

  @ApiOperation({ summary: 'Autosave the OM draft\'s boxes (No., Dated)' })
  @ApiBody({ type: SaveOmDraftDto })
  @Patch('letter/:claimLetterId/draft')
  @RequirePermissions(Permission.ISSUE_OFFICE_MEMORANDUM)
  async saveDraft(
    @Param('claimLetterId', ParseObjectIdPipe) claimLetterId: string,
    @Body() dto: SaveOmDraftDto,
    @CurrentUser() user: AuthUser,
  ) {
    assertReviewerAccess(user, Scope.MOHUA, OM_REVIEWER_FORBIDDEN_MESSAGE);
    return xviFcSuccess('Office Memorandum saved.', await this.service.saveDraft(claimLetterId, dto, user));
  }

  @ApiOperation({ summary: "Generate the OM (needs the OM No.); returns the PDF with the claim letter's annexures. A repeat call returns the same OM" })
  @Post('letter/:claimLetterId/generate')
  @RequirePermissions(Permission.ISSUE_OFFICE_MEMORANDUM)
  async generate(
    @Param('claimLetterId', ParseObjectIdPipe) claimLetterId: string,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ): Promise<StreamableFile> {
    assertReviewerAccess(user, Scope.MOHUA, OM_REVIEWER_FORBIDDEN_MESSAGE);
    return toPdf(await this.service.generate(claimLetterId, user, ip, userAgent));
  }

  @ApiOperation({ summary: "Download an issued OM (PDF with the claim letter's annexures) again" })
  @Get(':omId/pdf')
  async downloadPdf(@Param('omId', ParseObjectIdPipe) omId: string, @CurrentUser() user: AuthUser): Promise<StreamableFile> {
    this.assertViewScope(user);
    return toPdf(await this.service.downloadPdf(omId));
  }

  @ApiOperation({ summary: 'Upload the signed OM from e-Office (PDF, max 5 MB)' })
  @ApiBody({ type: XviFcFileRefDto })
  @Put(':omId/signed-file')
  @RequirePermissions(Permission.ISSUE_OFFICE_MEMORANDUM)
  async uploadSignedFile(
    @Param('omId', ParseObjectIdPipe) omId: string,
    @Body() fileRef: XviFcFileRefDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    assertReviewerAccess(user, Scope.MOHUA, OM_REVIEWER_FORBIDDEN_MESSAGE);
    return xviFcSuccess('Signed OM uploaded.', await this.service.uploadSignedFile(omId, fileRef, user, ip, userAgent));
  }

  @ApiOperation({ summary: 'Issued OMs of the year and installment, newest first' })
  @Get('history/:yearId/:installment')
  async history(
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Param('installment', ParseIntPipe) installment: number,
    @CurrentUser() user: AuthUser,
  ) {
    this.assertViewScope(user);
    return xviFcSuccess('OM history fetched.', await this.service.history(yearId, installment));
  }

  @ApiOperation({ summary: 'States with verified claim letters, each letter with its OM status' })
  @Get(':yearId/:installment')
  async listStates(
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Param('installment', ParseIntPipe) installment: number,
    @CurrentUser() user: AuthUser,
  ) {
    this.assertViewScope(user);
    return xviFcSuccess('Verified claim letters fetched.', await this.service.listStates(yearId, installment));
  }

  /** STATE users also hold VIEW_STATUS_REPORTS, but OMs span every state: MoHUA/DoE (read-only)/ADMIN only. */
  private assertViewScope(user: AuthUser): void {
    if (!isMohuaViewScope(user) && user.scope !== Scope.ADMIN) throw new ForbiddenException('Access denied');
  }
}

function toPdf(file: OmGeneratedFile): StreamableFile {
  return new StreamableFile(file.buffer as unknown as Uint8Array, {
    type: 'application/pdf',
    disposition: `attachment; filename="${file.fileName}"`,
  });
}
