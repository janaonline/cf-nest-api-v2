import { Body, Controller, Delete, Get, Param, Patch, Post, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { getTimeStamp } from 'src/shared/utils/date.utils';
import { buildXviFcDownloadFileName } from 'src/shared/utils/xvi-fc-download-file-name.util';
import { XviFcService } from 'src/module/xvi-fc/xvi-fc.service';
import { DevolutionFormulaService } from './services/main/devolution-formula.service';
import { DevolutionFormulaExcelService } from './services/excel/devolution-formula-excel.service';
import { DevolutionFormulaRowService } from './services/row/devolution-formula-row.service';
import { SaveDraftDevolutionFormulaDto } from './dto/save-draft-devolution-formula.dto';
import { ValidateExcelDevolutionFormulaDto } from './dto/validate-excel-devolution-formula.dto';
import { FinalSubmitDevolutionFormulaDto } from './dto/final-submit-devolution-formula.dto';
import { UpdateRowDevolutionFormulaDto } from './dto/update-row-devolution-formula.dto';
import { RowsQueryDevolutionFormulaDto } from './dto/rows-query-devolution-formula.dto';
import { DumpDevolutionFormulaQueryDto } from './dto/dump-devolution-formula-query.dto';
import { DF_INSTALLMENTS, type DfInstallment } from './constants/devolution-formula.constants';
import { throwXviFcValidationError } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';

@ApiTags('XVI-FC - State Forms - ULB-wise Allocation')
@ApiBearerAuth()
@Controller('xvi-fc/state/devolution-formula')
export class DevolutionFormulaController {
  constructor(
    private readonly dfService: DevolutionFormulaService,
    private readonly dfExcelService: DevolutionFormulaExcelService,
    private readonly dfRowService: DevolutionFormulaRowService,
    private readonly xviFcService: XviFcService,
  ) {}

  private async buildDownloadFileName(
    stateId: string,
    yearId: string,
    formName: string,
    extension: string,
  ): Promise<string> {
    const [{ stateName }, { yearLabel }] = await Promise.all([
      this.xviFcService.getStateById(stateId),
      this.xviFcService.getYearLabelById(yearId),
    ]);
    return buildXviFcDownloadFileName({ entityName: stateName, formName, yearLabel, extension });
  }

  @ApiOperation({ summary: 'Export all ULB-wise Allocation data (admin/state scoped)' })
  @ApiQuery({ name: 'stateId', required: false })
  @ApiQuery({ name: 'yearId', required: false })
  @ApiQuery({ name: 'installment', required: false, enum: [...DF_INSTALLMENTS] })
  @ApiQuery({ name: 'validationStatus', required: false, enum: ['NOT_VALIDATED', 'VALID', 'INVALID'] })
  @ApiQuery({
    name: 'formStatus',
    required: false,
    description: 'Filter by numeric form status (0-7). Admin/MoHUA only.',
  })
  @ApiQuery({ name: 'isActive', required: false, description: 'Filter rows by active status (default: true)' })
  @Get('dump')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  async dump(@Query() query: DumpDevolutionFormulaQueryDto, @CurrentUser() user: AuthUser): Promise<StreamableFile> {
    const buffer = await this.dfService.dumpToExcel(query, user);
    return new StreamableFile(buffer as unknown as Uint8Array, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="ulb-wise-allocation-dump_${getTimeStamp(false)}.xlsx"`,
    });
  }

  @ApiOperation({ summary: 'Save ULB-wise Allocation draft' })
  @ApiBody({ type: SaveDraftDevolutionFormulaDto })
  @Post('save-draft')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.EDIT_STATE_FORMS)
  saveDraft(@Body() dto: SaveDraftDevolutionFormulaDto, @CurrentUser() user: AuthUser) {
    return this.dfService.saveDraft(dto, user);
  }

  @ApiOperation({ summary: 'Validate uploaded ULB-wise Allocation Excel' })
  @ApiBody({ type: ValidateExcelDevolutionFormulaDto })
  @Post('validate-excel')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.EDIT_STATE_FORMS)
  validateExcel(@Body() dto: ValidateExcelDevolutionFormulaDto, @CurrentUser() user: AuthUser) {
    return this.dfExcelService.validateExcel(dto, user);
  }

  @ApiOperation({ summary: 'Final submit ULB-wise Allocation form' })
  @ApiBody({ type: FinalSubmitDevolutionFormulaDto })
  @Post('final-submit')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.FINAL_SUBMIT_STATE_FORMS)
  finalSubmit(@Body() dto: FinalSubmitDevolutionFormulaDto, @CurrentUser() user: AuthUser) {
    return this.dfService.finalSubmit(dto, user);
  }

  @ApiOperation({ summary: 'Get ULB-wise Allocation form (hydrated)' })
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
    return this.dfService.getForm(stateId, yearId, inst, user);
  }

  @ApiOperation({ summary: 'Download ULB-wise Allocation Excel template' })
  @Get(':stateId/:yearId/:installment/template')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  async getTemplate(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Param('installment') installment: string,
    @CurrentUser() user: AuthUser,
  ): Promise<StreamableFile> {
    const inst = this.parseInstallment(installment);
    const [buffer, fileName] = await Promise.all([
      this.dfExcelService.generateTemplate(stateId, yearId, inst, user),
      this.buildDownloadFileName(stateId, yearId, 'ulb-wise-allocation-formula-template', 'xlsx'),
    ]);
    return new StreamableFile(buffer as unknown as Uint8Array, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${fileName}"`,
    });
  }

  @ApiOperation({ summary: 'Get ULB-wise Allocation rows (paginated)' })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'validationStatus', required: false, enum: ['VALID', 'INVALID'] })
  @Get(':stateId/:yearId/:installment/rows')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  getRows(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Param('installment') installment: string,
    @Query() query: RowsQueryDevolutionFormulaDto,
    @CurrentUser() user: AuthUser,
  ) {
    const inst = this.parseInstallment(installment);
    return this.dfRowService.getRows(stateId, yearId, inst, query, user);
  }

  @ApiOperation({ summary: 'Download ULB-wise Allocation error sheet' })
  @Get(':stateId/:yearId/:installment/error-sheet')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  async getErrorSheet(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Param('installment') installment: string,
    @CurrentUser() user: AuthUser,
  ): Promise<StreamableFile> {
    const inst = this.parseInstallment(installment);
    const [buffer, fileName] = await Promise.all([
      this.dfRowService.getErrorSheet(stateId, yearId, inst, user),
      this.buildDownloadFileName(stateId, yearId, 'devolution-formula-error-sheet', 'xlsx'),
    ]);
    return new StreamableFile(buffer as unknown as Uint8Array, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${fileName}"`,
    });
  }

  @ApiOperation({ summary: 'Revalidate ULB-wise Allocation Excel data' })
  @Post(':stateId/:yearId/:installment/revalidate-excel')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.EDIT_STATE_FORMS)
  revalidateExcel(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Param('installment') installment: string,
    @CurrentUser() user: AuthUser,
  ) {
    const inst = this.parseInstallment(installment);
    return this.dfExcelService.revalidateExcel(stateId, yearId, inst, user);
  }

  @ApiOperation({ summary: 'Update a single ULB-wise Allocation row (portal edit)' })
  @Patch(':stateId/:yearId/:installment/rows/:rowId')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.EDIT_STATE_FORMS)
  updateRow(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Param('installment') installment: string,
    @Param('rowId', ParseObjectIdPipe) rowId: string,
    @Body() dto: UpdateRowDevolutionFormulaDto,
    @CurrentUser() user: AuthUser,
  ) {
    const inst = this.parseInstallment(installment);
    return this.dfRowService.updateRow(stateId, yearId, inst, rowId, dto, user);
  }

  @ApiOperation({ summary: 'Delete uploaded ULB-wise Allocation Excel and reset dataset' })
  @Delete(':stateId/:yearId/:installment/uploaded-excel')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.EDIT_STATE_FORMS)
  deleteUploadedExcel(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Param('installment') installment: string,
    @CurrentUser() user: AuthUser,
  ) {
    const inst = this.parseInstallment(installment);
    return this.dfRowService.deleteUploadedExcel(stateId, yearId, inst, user);
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private parseInstallment(raw: string): DfInstallment {
    const n = Number(raw);
    if (n !== 1 && n !== 2) {
      throwInvalidInstallment();
    }
    return n;
  }
}

function throwInvalidInstallment(): never {
  throwXviFcValidationError({
    installment: [{ field: 'installment', code: 'invalid', message: 'Installment must be 1 or 2.' }],
  });
}
