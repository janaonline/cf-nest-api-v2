import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Ip,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { getTimeStamp } from 'src/shared/utils/date.utils';
import { ElectedUrbanLocalBodiesService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/main/elected-urban-local-bodies.service';
import { ElectedUrbanLocalBodiesExcelService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/excel/elected-urban-local-bodies-excel.service';
import { ElectedUrbanLocalBodiesRowService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/row/elected-urban-local-bodies-row.service';
import { EulbPostSubmissionUpdateService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/post-submission-update/elected-urban-local-bodies-post-submission-update.service';
import { SaveElectedUrbanLocalBodiesDraftDto } from 'src/module/xvi-fc/state/elected-urban-local-bodies/dto/save-elected-urban-local-bodies-draft.dto';
import { FinalSubmitElectedUrbanLocalBodiesDto } from 'src/module/xvi-fc/state/elected-urban-local-bodies/dto/final-submit-elected-urban-local-bodies.dto';
import { ValidateElectedUrbanLocalBodiesExcelDto } from 'src/module/xvi-fc/state/elected-urban-local-bodies/dto/validate-elected-urban-local-bodies-excel.dto';
import { UpdateElectedUrbanLocalBodiesRowDto } from 'src/module/xvi-fc/state/elected-urban-local-bodies/dto/update-elected-urban-local-bodies-row.dto';
import { GetElectedUrbanLocalBodiesRowsQueryDto } from 'src/module/xvi-fc/state/elected-urban-local-bodies/dto/get-elected-urban-local-bodies-rows-query.dto';
import { RevalidateEulbExcelDto } from 'src/module/xvi-fc/state/elected-urban-local-bodies/dto/revalidate-eulb-excel.dto';
import { GetEulbPostSubmissionUpdateRowsQueryDto } from 'src/module/xvi-fc/state/elected-urban-local-bodies/dto/get-eulb-post-submission-update-rows-query.dto';
import { ValidateEulbPostSubmissionUpdateDto } from 'src/module/xvi-fc/state/elected-urban-local-bodies/dto/validate-eulb-post-submission-update.dto';
import { SubmitEulbPostSubmissionUpdateDto } from 'src/module/xvi-fc/state/elected-urban-local-bodies/dto/submit-eulb-post-submission-update.dto';

@ApiTags('XVI-FC - State Forms - Elected Urban Local Bodies')
@ApiBearerAuth()
@Controller('xvi-fc/state/elected-urban-local-bodies')
export class ElectedUrbanLocalBodiesController {
  constructor(
    private readonly eulbService: ElectedUrbanLocalBodiesService,
    private readonly eulbExcelService: ElectedUrbanLocalBodiesExcelService,
    private readonly eulbRowService: ElectedUrbanLocalBodiesRowService,
    private readonly eulbPostSubmissionUpdateService: EulbPostSubmissionUpdateService,
  ) {}

  @ApiOperation({
    summary: 'Get Elected Urban Local Bodies form questions',
    description:
      'Returns the static question config for the EULB form. Used by the frontend to render the dynamic form.',
  })
  @Get('questions')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  async getQuestions(@CurrentUser() _user: AuthUser) {
    void _user;
    return this.eulbService.getQuestions();
  }

  @ApiOperation({
    summary: 'Save Elected Urban Local Bodies form as draft',
    description:
      'Creates or updates a EULB draft for the given state and year. Allows incomplete required fields (except requiredTrue). Upserts only the main form document — no rows are created. Sets status to IN_PROGRESS.',
  })
  @ApiBody({ type: SaveElectedUrbanLocalBodiesDraftDto })
  @Post('save-draft')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.EDIT_STATE_FORMS)
  saveDraft(
    @Body() dto: SaveElectedUrbanLocalBodiesDraftDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.eulbService.saveDraft(dto, user, ip ?? '', userAgent ?? '');
  }

  @ApiOperation({
    summary: 'Validate uploaded Elected Bodies Excel file',
    description:
      'Reads the uploaded Excel from S3, parses rows, validates DB and extra ULB rows, stores the latest row dataset, and updates the form validation summary. Returns the validation summary including error counts.',
  })
  @ApiBody({ type: ValidateElectedUrbanLocalBodiesExcelDto })
  @Post('validate-excel')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.EDIT_STATE_FORMS)
  validateExcel(@Body() dto: ValidateElectedUrbanLocalBodiesExcelDto, @CurrentUser() user: AuthUser) {
    return this.eulbExcelService.validateExcel(dto, user);
  }

  @ApiOperation({
    summary: 'Final submit Elected Urban Local Bodies form',
    description:
      'Final-submits the EULB form. Requires full form validation to pass, Excel to be validated, all DB ULBs present, and no row errors. Transitions status to SUBMISSION_ACKNOWLEDGED_BY_MOHUA.',
  })
  @ApiBody({ type: FinalSubmitElectedUrbanLocalBodiesDto })
  @Post('final-submit')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.FINAL_SUBMIT_STATE_FORMS)
  finalSubmit(
    @Body() dto: FinalSubmitElectedUrbanLocalBodiesDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.eulbService.finalSubmit(dto, user, ip ?? '', userAgent ?? '');
  }

  @ApiOperation({
    summary: 'Download Elected Bodies Excel template',
    description:
      'Generates a downloadable Excel template pre-filled with active DB ULBs for the given state. ULB data columns are included; status and date columns are left empty for the user to fill in.',
  })
  @Get(':stateId/:yearId/template')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.EDIT_STATE_FORMS)
  async getTemplate(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<StreamableFile> {
    const buffer = await this.eulbService.getTemplate(stateId, yearId, user);
    return new StreamableFile(new Uint8Array(buffer as ArrayBuffer), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="elected-bodies-template_${getTimeStamp(false)}.xlsx"`,
    });
  }

  @ApiOperation({
    summary: 'Get Elected Urban Local Bodies rows (paginated)',
    description:
      'Returns rows from the active dataset for the given state and year. Supports pagination, search by censusCode/ulbName, and filtering by validationStatus, rowType, and errorField.',
  })
  @ApiQuery({ name: 'page', required: false, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Rows per page (default: 50, max: 200)' })
  @ApiQuery({ name: 'search', required: false, description: 'Search by censusCode or ulbName' })
  @ApiQuery({
    name: 'validationStatus',
    required: false,
    enum: ['VALID', 'INVALID'],
    description: 'Filter by row validation status',
  })
  @ApiQuery({ name: 'rowType', required: false, enum: ['DB_ULB', 'EXTRA_ULB'], description: 'Filter by row type' })
  @ApiQuery({ name: 'errorField', required: false, description: 'Filter rows where errors.field equals this value' })
  @Get(':stateId/:yearId/rows')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  getRows(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Query() query: GetElectedUrbanLocalBodiesRowsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.eulbRowService.getRows(stateId, yearId, query, user);
  }

  @ApiOperation({
    summary: 'Download Elected Bodies error sheet',
    description:
      'Generates an Excel error sheet from the latest active EULB row dataset. Includes all uploaded rows and appends an errors column with row-level validation messages. Portal row edits are reflected immediately.',
  })
  @Get(':stateId/:yearId/error-sheet')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  async getErrorSheet(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<StreamableFile> {
    const buffer = await this.eulbRowService.getErrorSheet(stateId, yearId, user);
    return new StreamableFile(new Uint8Array(buffer), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="elected-bodies-error-sheet_${getTimeStamp(false)}.xlsx"`,
    });
  }

  @ApiOperation({
    summary: 'Download Elected Body Data dump',
    description:
      'Generates an Excel dump of only the latest active EULB row dataset for the given state and year. Excludes row histories, post-submission update history, inactive rows, and older dataset versions.',
  })
  @Get(':stateId/:yearId/dump')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  async dump(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<StreamableFile> {
    const buffer = await this.eulbService.dumpToExcel(stateId, yearId, user);
    return new StreamableFile(new Uint8Array(buffer as ArrayBuffer), {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="elected-body-data-dump_${getTimeStamp(false)}.xlsx"`,
    });
  }

  @ApiOperation({
    summary: 'Delete uploaded Elected Bodies Excel',
    description:
      'Hard-deletes all current EULB row data and clears the uploaded file reference. Resets validation summary to NOT_VALIDATED. Blocked when the form status does not allow editing.',
  })
  @Delete(':stateId/:yearId/uploaded-excel')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.EDIT_STATE_FORMS)
  deleteUploadedExcel(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.eulbRowService.deleteUploadedExcel(stateId, yearId, user, ip ?? '', userAgent ?? '');
  }

  @ApiOperation({
    summary: 'Revalidates the already uploaded EULB Excel data after form values such as ULB count are corrected.',
  })
  @ApiBody({ type: RevalidateEulbExcelDto })
  @Post(':stateId/:yearId/revalidate-excel')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.EDIT_STATE_FORMS)
  revalidateExcel(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Body() _dto: RevalidateEulbExcelDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.eulbExcelService.revalidateExcel(stateId, yearId, user);
  }

  @ApiOperation({
    summary: 'Get post-submission update page metadata',
    description:
      'Returns metadata for the EULB post-submission update page: form status, canUpdate flag, permissions, eligible row count, and row edit field config. Available only when form status is UNDER_REVIEW_BY_MOHUA (5) or SUBMISSION_ACKNOWLEDGED_BY_MOHUA (7); returns canUpdate:false otherwise.',
  })
  @Get(':stateId/:yearId/post-submission-update')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  getPostSubmissionUpdateMetadata(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.eulbPostSubmissionUpdateService.getMetadata(stateId, yearId, user);
  }

  @ApiOperation({
    summary: 'Get eligible rows for post-submission update (paginated)',
    description:
      'Returns rows eligible for post-submission update: rows with electedBodyStatus Not Constituted, or Constituted rows whose dateOfExpiry is after today. Blocked when form status is not 5 or 7.',
  })
  @ApiQuery({ name: 'page', required: false, description: 'Page number (default: 1)' })
  @ApiQuery({ name: 'limit', required: false, description: 'Rows per page (default: 50, max: 200)' })
  @ApiQuery({ name: 'search', required: false, description: 'Search by censusCode or ulbName' })
  @ApiQuery({
    name: 'electedBodyStatus',
    required: false,
    enum: ['Constituted', 'Not Constituted', 'Exempt'],
    description: 'Filter by elected body status',
  })
  @ApiQuery({
    name: 'validationStatus',
    required: false,
    enum: ['VALID', 'INVALID'],
    description: 'Filter by row validation status',
  })
  @Get(':stateId/:yearId/post-submission-update/rows')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  getPostSubmissionUpdateRows(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Query() query: GetEulbPostSubmissionUpdateRowsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.eulbPostSubmissionUpdateService.getEligibleRows(stateId, yearId, query, user);
  }

  @ApiOperation({
    summary: 'Validate proposed row changes for post-submission update',
    description:
      'Validates a batch of proposed row field changes without persisting anything. Returns per-row validation results and an overall VALID/INVALID status. Business-invalid rows yield success:true with row-level errors; structural or permission failures yield success:false.',
  })
  @ApiBody({ type: ValidateEulbPostSubmissionUpdateDto })
  @Post(':stateId/:yearId/post-submission-update/validate')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  validatePostSubmissionUpdateBatch(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Body() dto: ValidateEulbPostSubmissionUpdateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.eulbPostSubmissionUpdateService.validateBatch(stateId, yearId, dto, user);
  }

  @ApiOperation({
    summary: 'Submit post-submission update batch with pre-uploaded document',
    description:
      'Accepts a JSON body containing row changes and metadata of a PDF already uploaded by the client. Validates all rows, then applies all changes in a single MongoDB transaction. Stores the document reference once on the form batch. Any business-invalid row causes success:false — no partial writes.',
  })
  @ApiBody({ type: SubmitEulbPostSubmissionUpdateDto })
  @Post(':stateId/:yearId/post-submission-update/submit')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  submitPostSubmissionUpdateBatch(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Body() dto: SubmitEulbPostSubmissionUpdateDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.eulbPostSubmissionUpdateService.submitBatch(stateId, yearId, dto, user);
  }

  @ApiOperation({
    summary: 'Get Elected Urban Local Bodies form (hydrated)',
    description:
      'Returns the EULB form for the given state and year with saved data merged into question defaults, current status, permissions, actors, and validation summary.',
  })
  @Get(':stateId/:yearId')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  getForm(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.eulbService.getForm(stateId, yearId, user);
  }

  @ApiOperation({
    summary: 'Update a single Elected Bodies row (portal edit)',
    description:
      'Updates allowed fields on a single row in the active dataset. Re-validates the row after update and recalculates the form-level validation summary. Only electedBodyStatus, dateOfConstitution, dateOfExpiry, and remarks may be changed.',
  })
  @Patch(':stateId/:yearId/rows/:rowId')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.EDIT_STATE_FORMS)
  updateRow(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Param('rowId', ParseObjectIdPipe) rowId: string,
    @Body() dto: UpdateElectedUrbanLocalBodiesRowDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.eulbRowService.updateRow(stateId, yearId, rowId, dto, user);
  }
}
