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
import { ElectedUrbanLocalBodiesService } from './elected-urban-local-bodies.service';
import { ElectedUrbanLocalBodiesExcelService } from './elected-urban-local-bodies-excel.service';
import { ElectedUrbanLocalBodiesRowService } from './elected-urban-local-bodies-row.service';
import { SaveElectedUrbanLocalBodiesDraftDto } from './dto/save-elected-urban-local-bodies-draft.dto';
import { FinalSubmitElectedUrbanLocalBodiesDto } from './dto/final-submit-elected-urban-local-bodies.dto';
import { ValidateElectedUrbanLocalBodiesExcelDto } from './dto/validate-elected-urban-local-bodies-excel.dto';
import { UpdateElectedUrbanLocalBodiesRowDto } from './dto/update-elected-urban-local-bodies-row.dto';
import { GetElectedUrbanLocalBodiesRowsQueryDto } from './dto/get-elected-urban-local-bodies-rows-query.dto';

@ApiTags('XVI-FC - State Forms - Elected Urban Local Bodies')
@ApiBearerAuth()
@Controller('xvi-fc/state/elected-urban-local-bodies')
export class ElectedUrbanLocalBodiesController {
  constructor(
    private readonly eulbService: ElectedUrbanLocalBodiesService,
    private readonly eulbExcelService: ElectedUrbanLocalBodiesExcelService,
    private readonly eulbRowService: ElectedUrbanLocalBodiesRowService,
  ) {}

  @ApiOperation({
    summary: 'Get Elected Urban Local Bodies form questions',
    description:
      'Returns the static question config for the EULB form. Used by the frontend to render the dynamic form.',
  })
  @Get('questions')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  getQuestions(@CurrentUser() _user: AuthUser) {
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
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
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
