import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type PipelineStage, Model, Types } from 'mongoose';
import type ExcelJS from 'exceljs';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { ExcelService } from 'src/services/excel/excel.service';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Permission, Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import { FORM_STATUS, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import {
  assertCanStateEditForm,
  assertCanStateFinalSubmitForm,
  canStateEditForm,
  canStateFinalSubmitForm,
} from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
import { toObjectIdString } from 'src/common/utils/objectid.util';
import { DynamicFormValidationService } from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.service';
import { XvifcFormActorsService } from 'src/module/xvi-fc/common/services/xvifc-form-actors.service';
import { FileInfoNormalizerService } from 'src/module/xvi-fc/common/services/file-info-normalizer.service';
import type { FileInfo } from 'src/schemas/common/file.schema';
import type { FormData } from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.types';
import type {
  FieldConfig,
  FieldSupportingContent,
  HydratedFieldConfig,
  SupportingContentTone,
} from 'src/module/xvi-fc/common/types/field-config.type';
import {
  buildXviFcFolderPath,
  type XviFcFolderPathContext,
} from 'src/module/xvi-fc/common/folder-paths/xvi-fc-folder-path.resolver';
import { YearIdToLabel } from 'src/core/constants/years';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { throwXviFcValidationError, xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import {
  DevolutionFormulaForm,
  DevolutionFormulaFormDocument,
} from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import {
  DevolutionFormulaRow,
  DevolutionFormulaRowDocument,
} from 'src/schemas/xvi-fc/state/devolution-formula-row.schema';
import { GrantAllocation, GrantAllocationDocument } from 'src/schemas/xvi-fc/grant-allocation.schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import {
  EULB_FORM_TYPE,
  ElectedUrbanLocalBodiesForm,
  EulbFormDocument,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import {
  DF_ACTION_DOWNLOAD_ERROR_SHEET,
  DF_ACTION_DOWNLOAD_TEMPLATE,
  DF_ACTION_REGISTER_ULB,
  DF_ACTION_REVALIDATE_EXCEL,
  DF_ACTION_VIEW_UPLOADED_DATA,
  DF_ALLOWED_FILE_EXTENSIONS,
  DF_ALLOWED_MIME_TYPES,
  DF_DUMP_HEADERS,
  DF_FORM_NAME,
  DF_MAX_FILE_SIZE_BYTES,
  buildDfRegisterUlbUrl,
} from '../../constants/devolution-formula.constants';
import { DfFormJsonConfigService } from '../form-json/devolution-formula-form-json.service';
import { getDfFieldsByType } from '../../helpers/devolution-formula-form-json.helpers';
import type { SaveDraftDevolutionFormulaDto } from '../../dto/save-draft-devolution-formula.dto';
import type { FinalSubmitDevolutionFormulaDto } from '../../dto/final-submit-devolution-formula.dto';
import type { DumpDevolutionFormulaQueryDto } from '../../dto/dump-devolution-formula-query.dto';
import type {
  DfFormGetResponseData,
  DfFormLeanDoc,
  DfFormPermissions,
  DfGrantAllocationSummary,
  DfDumpRow,
  DfRowError,
  DfInstallmentAccess,
} from '../../types/devolution-formula.types';
import { DevolutionFormulaValidator } from '../../validators/devolution-formula.validator';

function formatINR(amount: number): string {
  const rounded = Math.round(amount);
  const s = String(Math.abs(rounded));
  const prefix = rounded < 0 ? '-' : '';
  if (s.length <= 3) return `${prefix}${s}`;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return `${prefix}${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
}

@Injectable()
export class DevolutionFormulaService {
  private readonly logger = new Logger(DevolutionFormulaService.name);

  private static readonly INSTALLMENT_2_LOCK_REASON =
    'Installment 2 is locked until at least one Installment 1 claim batch is acknowledged by MoHUA.';

  constructor(
    @InjectModel(DevolutionFormulaForm.name)
    private readonly model: Model<DevolutionFormulaFormDocument>,
    @InjectModel(DevolutionFormulaRow.name)
    private readonly rowModel: Model<DevolutionFormulaRowDocument>,
    @InjectModel(GrantAllocation.name)
    private readonly grantAllocationModel: Model<GrantAllocationDocument>,
    @InjectModel(ElectedUrbanLocalBodiesForm.name)
    private readonly eulbModel: Model<EulbFormDocument>,
    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,
    private readonly dfValidator: DevolutionFormulaValidator,
    private readonly xvifcFormActorsService: XvifcFormActorsService,
    private readonly excelService: ExcelService,
    private readonly fileTokenService: FileTokenService,
    private readonly fileInfoNormalizer: FileInfoNormalizerService,
    private readonly dynamicFormValidator: DynamicFormValidationService,
    private readonly dfFormJsonConfig: DfFormJsonConfigService,
  ) {}

  async getForm(
    stateId: string,
    yearId: string,
    installment: number,
    user: AuthUser,
  ): Promise<XviFcApiResponse<DfFormGetResponseData>> {
    // TODO_NS: reuse existing functions - check what is happening in elected body and sfc.
    this.assertStateAccess(user, stateId);

    const stateOid = new Types.ObjectId(stateId);
    const yearOid = new Types.ObjectId(yearId);
    const designYear = YearIdToLabel[yearId];
    if (!designYear) throw new NotFoundException(`Design year not found for yearId: ${yearId}`);

    const folderPathContext: XviFcFolderPathContext = { _id: stateId, designYear, role: 'state' };

    const doc = await this.model
      .findOne({ state: stateOid, year: yearOid, installment })
      .populate('state', 'name')
      .populate('createdBy', 'name')
      .populate('updatedBy', 'name')
      .populate('submittedBy', 'name')
      .lean<DfFormLeanDoc>()
      .exec();

    const currentFormStatus = doc?.currentFormStatus ?? FORM_STATUS.NOT_STARTED;
    // TODO_NS: user common function? see what is happening in elected body and sfc.
    const permissions = this.buildFormPermissions(user, stateId, currentFormStatus);
    const { actors, stateName } = this.xvifcFormActorsService.buildActorsAndStateName(
      doc as unknown as Parameters<typeof this.xvifcFormActorsService.buildActorsAndStateName>[0],
    );

    const [grantAllocationSummary, computedActiveUlbCount] = await Promise.all([
      this.resolveGrantAllocationSummary(stateOid, yearOid),
      this.ulbModel.countDocuments({ state: stateOid, isActive: true }),
    ]);
    const validationSummary = this.buildValidationSummary(doc, grantAllocationSummary?.total ?? 0);

    const savedData: FormData = {};
    if (doc?.excelFile) savedData['excelFile'] = doc.excelFile;
    if (doc?.checkboxConfirmation !== undefined) savedData['checkboxConfirmation'] = doc.checkboxConfirmation;

    const fields = await this.dfFormJsonConfig.loadFields(yearId);
    const questions = this.hydrateQuestions(
      getDfFieldsByType(fields, 'DF_MAIN_FORM_FIELDS'),
      savedData,
      doc,
      permissions,
      folderPathContext,
      yearId,
      computedActiveUlbCount,
    );
    const grantMax = grantAllocationSummary?.total ?? null;
    const rowEditFields = getDfFieldsByType(fields, 'DF_ROW_EDIT_FIELDS').map((field) => {
      if (
        grantMax !== null &&
        ['totalGrantAllocation', 'installment1Amount', 'installment2Amount'].includes(field.key)
      ) {
        return {
          ...field,
          validations: [
            ...(field.validations ?? []),
            { name: 'max', validator: grantMax, message: `Cannot exceed the MoHUA grant allocation (${grantMax}Cr.).` },
          ],
        };
      }
      return field;
    });
    const installmentAccess = this.buildInstallmentAccess();

    const responseData: DfFormGetResponseData = {
      _id: doc ? String(doc._id) : null,
      formName: DF_FORM_NAME,
      stateId,
      yearId,
      installment: installment as 1 | 2,
      stateName,
      currentFormStatus,
      currentFormStatusLabel: getFormStatusLabel(currentFormStatus),
      permissions,
      actors,
      validationSummary,
      grantAllocationSummary,
      questions,
      rowEditFields,
      installmentAccess,
      meta: { version: 1 },
    };

    return xviFcSuccess('Devolution Formula form fetched.', responseData);
  }

  async saveDraft(dto: SaveDraftDevolutionFormulaDto, user: AuthUser): Promise<XviFcApiResponse> {
    this.assertStateAccess(user, dto.stateId);

    const stateOid = new Types.ObjectId(dto.stateId);
    const yearOid = new Types.ObjectId(dto.yearId);
    const userOid = new Types.ObjectId(user._id);

    const existing = await this.model
      .findOne({ state: stateOid, year: yearOid, installment: dto.installment })
      .lean<Pick<DfFormLeanDoc, '_id' | 'currentFormStatus' | 'excelFile'>>()
      .exec();

    if (existing) {
      assertCanStateEditForm(existing.currentFormStatus ?? FORM_STATUS.NOT_STARTED);
    }

    const [grantAlloc, computedActiveUlbCount] = await Promise.all([
      this.resolveGrantAllocation(stateOid, yearOid),
      this.ulbModel.countDocuments({ state: stateOid, isActive: true }),
    ]);

    let normalizedFile: FileInfo | null | undefined;
    if (dto.data?.excelFile !== undefined) {
      const { file, errors: fileErrors } = this.fileInfoNormalizer.normalizeInboundFileInfo(
        dto.data.excelFile as unknown as Record<string, unknown>,
        existing?.excelFile,
        {
          fieldKey: 'excelFile',
          allowedExtensions: [...DF_ALLOWED_FILE_EXTENSIONS],
          allowedMimeTypes: [...DF_ALLOWED_MIME_TYPES],
          maxSizeKb: DF_MAX_FILE_SIZE_BYTES / 1024,
        },
      );
      if (fileErrors.length > 0) throwXviFcValidationError({ excelFile: fileErrors });
      normalizedFile = file;
    }

    const formData: FormData = {};
    if (normalizedFile !== undefined) formData['excelFile'] = normalizedFile;
    if (dto.data?.checkboxConfirmation !== undefined) formData['checkboxConfirmation'] = dto.data.checkboxConfirmation;

    const dfFields = await this.dfFormJsonConfig.loadFields(dto.yearId);
    const validation = this.dynamicFormValidator.validateDraftAndBuildPayload(
      getDfFieldsByType(dfFields, 'DF_MAIN_FORM_FIELDS'),
      formData,
    );
    if (!validation.isValid) throwXviFcValidationError(validation.errors);

    const update: Record<string, unknown> = {
      state: stateOid,
      year: yearOid,
      installment: dto.installment,
      currentFormStatus: FORM_STATUS.IN_PROGRESS,
      isDraft: true,
      totalMoHUAAllocation: grantAlloc.basic + grantAlloc.performance,
      grantAllocationRef: grantAlloc._id,
      updatedBy: userOid,
      ulbCount: computedActiveUlbCount,
    };

    if (normalizedFile !== undefined) update['excelFile'] = normalizedFile;
    if (validation.sanitizedPayload['checkboxConfirmation'] !== undefined) {
      update['checkboxConfirmation'] = validation.sanitizedPayload['checkboxConfirmation'];
    }

    const result = await this.model
      .findOneAndUpdate(
        { state: stateOid, year: yearOid, installment: dto.installment },
        {
          $set: update,
          $setOnInsert: { createdBy: userOid },
        },
        { upsert: true, new: true },
      )
      .lean()
      .exec();

    return xviFcSuccess('Devolution Formula draft saved.', { _id: String(result._id) });
  }

  async finalSubmit(dto: FinalSubmitDevolutionFormulaDto, user: AuthUser): Promise<XviFcApiResponse> {
    this.assertStateAccess(user, dto.stateId);

    const stateOid = new Types.ObjectId(dto.stateId);
    const yearOid = new Types.ObjectId(dto.yearId);
    const userOid = new Types.ObjectId(user._id);

    const form = await this.model
      .findOne({ state: stateOid, year: yearOid, installment: dto.installment })
      .lean<DfFormLeanDoc>()
      .exec();

    if (!form) {
      throwXviFcValidationError({
        excelFile: [{ field: 'excelFile', code: 'notFound', message: 'Form not found. Please save a draft first.' }],
      });
    }

    assertCanStateFinalSubmitForm(form.currentFormStatus ?? FORM_STATUS.NOT_STARTED);

    const { file: normalizedFile, errors: fileErrors } = this.fileInfoNormalizer.normalizeInboundFileInfo(
      dto.data.excelFile as unknown as Record<string, unknown>,
      form.excelFile,
      {
        fieldKey: 'excelFile',
        allowedExtensions: [...DF_ALLOWED_FILE_EXTENSIONS],
        allowedMimeTypes: [...DF_ALLOWED_MIME_TYPES],
        maxSizeKb: DF_MAX_FILE_SIZE_BYTES / 1024,
      },
    );
    if (fileErrors.length > 0) throwXviFcValidationError({ excelFile: fileErrors });

    // `normalizedFile` is `undefined` when the excel file is unchanged from what's already
    // stored (see FileInfoNormalizerService) — that must stay out of the Mongo $set (below)
    // so Mongoose doesn't re-stamp the stored file's timestamps, but the required-field
    // validator below still needs to see the (unchanged) file as present.
    const formData: FormData = {
      excelFile: normalizedFile !== undefined ? normalizedFile : form.excelFile,
      checkboxConfirmation: dto.data.checkboxConfirmation,
    };

    const dfFields = await this.dfFormJsonConfig.loadFields(dto.yearId);
    const validation = this.dynamicFormValidator.validateFinalSubmitAndBuildPayload(
      getDfFieldsByType(dfFields, 'DF_MAIN_FORM_FIELDS'),
      formData,
    );
    if (!validation.isValid) throwXviFcValidationError(validation.errors);

    // Prerequisite gate for installment 1
    if (dto.installment === 1) {
      await this.checkInstallment1Prereq(stateOid, yearOid);
    }

    // Prerequisite gate for installment 2
    if (dto.installment === 2) {
      this.checkInstallment2Prereq();
    }

    // Grant allocation must still exist, and its total must match what was validated.
    // Also compute the current active ULB count to validate row count consistency.
    const [currentAlloc, computedActiveUlbCount] = await Promise.all([
      this.resolveGrantAllocation(stateOid, yearOid),
      this.ulbModel.countDocuments({ state: stateOid, isActive: true }),
    ]);
    const currentTotal = currentAlloc.basic + currentAlloc.performance;

    if (!form.excelRowCount || form.excelRowCount === 0) {
      throwXviFcValidationError({
        excelFile: [
          {
            field: 'excelFile',
            code: 'noData',
            message:
              'No Excel data has been uploaded and validated. Please upload and validate the Excel file before submitting.',
          },
        ],
      });
    }

    if (Math.abs((form.totalMoHUAAllocation ?? 0) - currentTotal) > 0.001) {
      throwXviFcValidationError({
        excelFile: [
          {
            field: 'excelFile',
            code: 'staleAllocation',
            message:
              'The grant allocation has changed since the last validation. Please revalidate the Excel file before submitting.',
          },
        ],
      });
    }

    // Specific, actionable gates — checked before the generic notValid gate below so the
    // user is shown precisely what to fix rather than a generic "not valid" message.
    const excelFileBlockingErrors: DfRowError[] = [];

    const persistedNewUlbCount = form.newUlbCount ?? 0;
    if (persistedNewUlbCount > 0) {
      excelFileBlockingErrors.push({
        field: 'excelFile',
        code: 'newUlbsAdded',
        message: `You have added ${persistedNewUlbCount} ULB(s). Please register before proceeding.`,
      });
    }

    const activeVersion = form.activeDatasetVersion ?? 0;
    if (activeVersion > 0) {
      const identityModifiedRow = await this.rowModel
        .findOne({
          form: form._id as Types.ObjectId,
          datasetVersion: activeVersion,
          isActive: true,
          'errors.code': 'identityModified',
        })
        .select('_id')
        .lean()
        .exec();

      if (identityModifiedRow) {
        excelFileBlockingErrors.push({
          field: 'excelFile',
          code: 'identityModified',
          message: 'Some ULB identity fields were modified. Please correct the uploaded data before proceeding.',
        });
      }
    }

    if (excelFileBlockingErrors.length > 0) {
      throwXviFcValidationError({ excelFile: excelFileBlockingErrors });
    }

    if (!form.validationStatus || form.validationStatus !== 'VALID') {
      throwXviFcValidationError({
        excelFile: [
          {
            field: 'excelFile',
            code: 'notValid',
            message:
              'Excel validation must pass (all ULBs covered, no row errors, allocation balanced) before final submit.',
          },
        ],
      });
    }

    if ((form.excelRowCount ?? 0) > 0 && form.excelRowCount !== computedActiveUlbCount) {
      throwXviFcValidationError({
        excelFile: [
          {
            field: 'excelFile',
            code: 'excelInvalid',
            message: `The uploaded Excel has ${form.excelRowCount} row(s) but there are ${computedActiveUlbCount} active ULB(s) registered. Please re-upload with all active ULBs.`,
          },
        ],
      });
    }

    const finalSubmitSet: Record<string, unknown> = {
      currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
      isDraft: false,
      submittedAt: new Date(),
      submittedBy: userOid,
      updatedBy: userOid,
      checkboxConfirmation: dto.data.checkboxConfirmation,
      ulbCount: computedActiveUlbCount,
    };
    // Omit excelFile entirely when unchanged (rather than `excelFile: undefined`) so
    // Mongoose's FileInfo `timestamps` option doesn't stamp the stored subdocument.
    if (normalizedFile !== undefined) finalSubmitSet['excelFile'] = normalizedFile;

    await this.model
      .findOneAndUpdate({ state: stateOid, year: yearOid, installment: dto.installment }, { $set: finalSubmitSet })
      .exec();

    this.logger.log(
      `Devolution Formula [state=${dto.stateId} year=${dto.yearId} installment=${dto.installment}] submitted by user=${user._id}`,
    );

    return xviFcSuccess('Devolution Formula submitted successfully.', {
      currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
      currentFormStatusLabel: getFormStatusLabel(FORM_STATUS.UNDER_REVIEW_BY_MOHUA),
    });
  }

  async dumpToExcel(query: DumpDevolutionFormulaQueryDto, user: AuthUser): Promise<ExcelJS.Buffer> {
    const rowMatch = this.buildDumpRowMatch(query);
    const formMatch = this.buildDumpFormMatch(query, user);

    const pipeline: PipelineStage[] = [
      { $match: rowMatch },
      {
        $lookup: {
          from: 'xvi_fc_devolution_formula_forms',
          localField: 'form',
          foreignField: '_id',
          as: 'formDoc',
        },
      },
      { $unwind: '$formDoc' },
      { $match: { ...formMatch, $expr: { $eq: ['$datasetVersion', '$formDoc.activeDatasetVersion'] } } },
      { $lookup: { from: 'states', localField: 'formDoc.state', foreignField: '_id', as: 'stateDoc' } },
      { $unwind: { path: '$stateDoc', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'users', localField: 'formDoc.submittedBy', foreignField: '_id', as: 'submittedByDoc' } },
      { $unwind: { path: '$submittedByDoc', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'users', localField: 'createdBy', foreignField: '_id', as: 'createdByDoc' } },
      { $unwind: { path: '$createdByDoc', preserveNullAndEmptyArrays: true } },
      { $lookup: { from: 'users', localField: 'updatedBy', foreignField: '_id', as: 'updatedByDoc' } },
      { $unwind: { path: '$updatedByDoc', preserveNullAndEmptyArrays: true } },
      { $sort: { 'stateDoc.name': 1, 'formDoc.year': 1, 'formDoc.installment': 1, rowNumber: 1 } },
      {
        $project: {
          rowNumber: 1,
          censusCode: 1,
          ulbName: 1,
          totalGrantAllocation: 1,
          installment1Amount: 1,
          installment2Amount: 1,
          devolutionFormula: 1,
          datasetVersion: 1,
          createdAt: 1,
          updatedAt: 1,
          'formDoc.year': 1,
          'formDoc.installment': 1,
          'formDoc.currentFormStatus': 1,
          'formDoc.validationStatus': 1,
          'formDoc.submittedAt': 1,
          'stateDoc.name': 1,
          'submittedByDoc.name': 1,
          'createdByDoc.name': 1,
          'updatedByDoc.name': 1,
        },
      },
    ];

    const aggRows = (await this.rowModel.aggregate(pipeline).exec()) as Record<string, unknown>[];
    const dumpRows: DfDumpRow[] = aggRows.map((row) => this.mapDumpAggregationRow(row));

    return this.excelService.generateExcel(DF_DUMP_HEADERS, dumpRows, 'Devolution Formula Dump');
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private buildDumpRowMatch(query: DumpDevolutionFormulaQueryDto): Record<string, unknown> {
    return { isActive: query.isActive ?? true };
  }

  private buildDumpFormMatch(query: DumpDevolutionFormulaQueryDto, user: AuthUser): Record<string, unknown> {
    const match: Record<string, unknown> = {};

    if (user.scope === Scope.STATE) {
      const userStateId = toObjectIdString(user.state);
      if (!userStateId) throw new ForbiddenException('Your account is not mapped to any state.');
      match['formDoc.state'] = new Types.ObjectId(userStateId);
    } else if (user.scope === Scope.ADMIN) {
      if (query.stateId) match['formDoc.state'] = new Types.ObjectId(query.stateId);
    } else {
      throw new ForbiddenException('Insufficient permissions for dump.');
    }

    if (query.yearId) match['formDoc.year'] = new Types.ObjectId(query.yearId);
    if (query.installment) match['formDoc.installment'] = query.installment;
    if (query.validationStatus) match['formDoc.validationStatus'] = query.validationStatus;
    if (query.formStatus !== undefined) match['formDoc.currentFormStatus'] = query.formStatus;

    return match;
  }

  private mapDumpAggregationRow(row: Record<string, unknown>): DfDumpRow {
    const formDoc = row['formDoc'] as Record<string, unknown> | undefined;
    const stateDoc = row['stateDoc'] as { name?: string } | undefined;
    const submittedByDoc = row['submittedByDoc'] as { name?: string } | undefined;
    const createdByDoc = row['createdByDoc'] as { name?: string } | undefined;
    const updatedByDoc = row['updatedByDoc'] as { name?: string } | undefined;
    const yearRaw = formDoc?.['year'] as Types.ObjectId | string | null | undefined;
    const yearId = yearRaw != null ? String(yearRaw) : '';

    return {
      rowNumber: row['rowNumber'] as number,
      stateName: stateDoc?.name ?? '',
      yearLabel: YearIdToLabel[yearId] ?? yearId,
      installment: (formDoc?.['installment'] as number) ?? 0,
      formStatus: getFormStatusLabel((formDoc?.['currentFormStatus'] as number) ?? 0),
      validationStatus: (formDoc?.['validationStatus'] as string | undefined) ?? '',
      censusCode: (row['censusCode'] as string | undefined) ?? '',
      ulbName: row['ulbName'] as string,
      totalGrantAllocation: row['totalGrantAllocation'] as number,
      installment1Amount: row['installment1Amount'] as number,
      installment2Amount: row['installment2Amount'] as number,
      devolutionFormula: row['devolutionFormula'] as string,
      datasetVersion: row['datasetVersion'] as number,
      submittedBy: submittedByDoc?.name ?? '',
      submittedAt: formDoc?.['submittedAt'] ? new Date(formDoc['submittedAt'] as Date).toISOString() : '',
      createdBy: createdByDoc?.name ?? '',
      updatedBy: updatedByDoc?.name ?? '',
      createdAt: row['createdAt'] ? new Date(row['createdAt'] as Date).toISOString() : '',
      updatedAt: row['updatedAt'] ? new Date(row['updatedAt'] as Date).toISOString() : '',
    };
  }

  private hydrateQuestions(
    questions: FieldConfig[],
    savedData: FormData,
    doc: DfFormLeanDoc | null,
    permissions: DfFormPermissions,
    folderPathContext: XviFcFolderPathContext,
    yearId: string,
    computedActiveUlbCount: number,
  ): HydratedFieldConfig[] {
    return questions.map((question) => {
      if (question.key === 'ulbCount') {
        return { ...question, value: computedActiveUlbCount };
      }

      const rawValue = Object.prototype.hasOwnProperty.call(savedData, question.key)
        ? savedData[question.key]
        : question.value;

      if (question.formFieldType === 'file') {
        const resolvedFolderPath = question.folderPathKey
          ? buildXviFcFolderPath(question.folderPathKey, folderPathContext)
          : question.folderPath;

        const fileVal = rawValue as FileInfo | null | undefined;
        const hydrated = this.fileInfoNormalizer.hydrateFileInfoForResponse(fileVal ?? null, (p) => {
          try {
            return this.fileTokenService.signFileUrl(p);
          } catch {
            return p;
          }
        });
        const value = hydrated ?? rawValue;

        if (question.key === 'excelFile') {
          return {
            ...question,
            folderPath: resolvedFolderPath,
            value,
            supportingContent: this.buildExcelFileSupportingContent(doc, permissions, yearId),
          };
        }

        return { ...question, folderPath: resolvedFolderPath, value };
      }

      return { ...question, value: rawValue };
    });
  }

  private buildExcelFileSupportingContent(
    doc: DfFormLeanDoc | null,
    permissions: DfFormPermissions,
    yearId: string,
  ): FieldSupportingContent[] {
    const { canView, canEdit } = permissions;
    const hasDataset = (doc?.activeDatasetVersion ?? 0) > 0;
    const hasUploadedExcel = !!doc?.excelFile?.path;
    const errorRowCount = doc?.errorRowCount ?? 0;
    const excelRowCount = doc?.excelRowCount ?? 0;
    const totalMoHUAAllocation = doc?.totalMoHUAAllocation ?? 0;
    const totalAllocatedSum = doc?.totalAllocatedSum ?? 0;
    const allocationBalanced = Math.abs(totalAllocatedSum - totalMoHUAAllocation) <= 0.001;
    const validationStatus = doc?.validationStatus;
    const newUlbCount = doc?.newUlbCount ?? 0;

    return [
      {
        type: 'actions',
        position: 'before',
        layout: 'inline',
        separator: 'dot',
        description: canEdit
          ? 'Download the template, upload the completed Excel file, review and resolve any validation errors, register newly added ULBs where required, and revalidate before final submission.'
          : '',
        actions: [
          {
            id: DF_ACTION_DOWNLOAD_TEMPLATE,
            label: 'Download Template',
            icon: 'bi bi-file-earmark-arrow-down',
            tone: 'primary' as const,
            visible: canEdit,
          },
          {
            id: DF_ACTION_VIEW_UPLOADED_DATA,
            label: 'View Uploaded Data',
            icon: 'bi bi-table',
            tone: (errorRowCount > 0 ? 'danger' : 'primary') as SupportingContentTone,
            visible: canView && hasDataset,
          },
          {
            id: DF_ACTION_DOWNLOAD_ERROR_SHEET,
            label: 'Download Error Sheet',
            icon: 'bi bi-file-earmark-excel',
            tone: 'danger' as const,
            visible: canView && errorRowCount > 0,
          },
          {
            id: DF_ACTION_REVALIDATE_EXCEL,
            label: 'Revalidate Excel',
            icon: 'bi bi-arrow-repeat',
            tone: 'primary' as const,
            visible: canEdit && hasUploadedExcel && validationStatus !== 'VALID',
          },
          {
            id: DF_ACTION_REGISTER_ULB,
            label: 'Register ULB',
            icon: 'bi bi-person-check',
            url: buildDfRegisterUlbUrl(yearId),
            tone: 'success' as const,
            variant: 'link' as const,
            visible: canEdit && newUlbCount > 0,
          },
        ],
        badges: [
          {
            label: `Total rows: ${excelRowCount}`,
            tone: 'secondary' as const,
            visible: canEdit && hasDataset,
          },
          {
            label: `${errorRowCount} error(s)`,
            tone: 'danger' as const,
            visible: canEdit && errorRowCount > 0,
          },
          {
            label: `Allocated amount: ₹${formatINR(totalMoHUAAllocation)} Cr.`,
            tone: 'secondary' as const,
            visible: canEdit && hasDataset,
          },
          {
            label: `Allocated sum: ₹${formatINR(totalAllocatedSum)} Cr.`,
            tone: (allocationBalanced ? 'success' : 'danger') as SupportingContentTone,
            visible: canEdit && hasDataset,
          },
          {
            label: `Remaining: ₹${formatINR(totalMoHUAAllocation - totalAllocatedSum)} Cr.`,
            tone: (allocationBalanced ? 'success' : 'danger') as SupportingContentTone,
            visible: canEdit && hasDataset,
          },
          {
            label: 'All valid',
            icon: 'bi bi-check-circle-fill',
            tone: 'success' as const,
            visible: canEdit && validationStatus === 'VALID',
          },
        ],
      },
    ];
  }

  private assertStateAccess(user: AuthUser, stateId: string): void {
    if (user.scope === Scope.ADMIN) return;
    if (user.scope === Scope.STATE) {
      const userStateId = toObjectIdString(user.state);
      if (userStateId && userStateId === stateId) return;
    }
    throw new ForbiddenException("You do not have access to this state's data.");
  }

  private buildFormPermissions(user: AuthUser, _stateId: string, status: number): DfFormPermissions {
    const perms = new Set(getEffectivePermissions(user));
    return {
      canView: perms.has(Permission.VIEW_STATE_FORMS),
      canEdit: perms.has(Permission.EDIT_STATE_FORMS) && canStateEditForm(status),
      canFinalSubmit: perms.has(Permission.FINAL_SUBMIT_STATE_FORMS) && canStateFinalSubmitForm(status),
    };
  }

  private buildValidationSummary(doc: DfFormLeanDoc | null, totalMoHUAAllocation: number) {
    if (!doc) {
      return this.dfValidator.buildValidationSummary({
        excelRowCount: 0,
        validRowCount: 0,
        errorRowCount: 0,
        missingUlbCount: 0,
        newUlbCount: 0,
        totalMoHUAAllocation,
        totalAllocatedSum: 0,
        activeDatasetVersion: 0,
      });
    }
    const excelRowCount = doc.excelRowCount ?? 0;
    const errorRowCount = doc.errorRowCount ?? 0;
    return this.dfValidator.buildValidationSummary({
      excelRowCount,
      validRowCount: excelRowCount - errorRowCount,
      errorRowCount,
      missingUlbCount: 0,
      newUlbCount: doc.newUlbCount ?? 0,
      totalMoHUAAllocation: doc.totalMoHUAAllocation ?? totalMoHUAAllocation,
      totalAllocatedSum: doc.totalAllocatedSum ?? 0,
      activeDatasetVersion: doc.activeDatasetVersion ?? 0,
    });
  }

  async resolveGrantAllocation(stateOid: Types.ObjectId, yearOid: Types.ObjectId) {
    const alloc = await this.grantAllocationModel.findOne({ stateId: stateOid, yearId: yearOid }).lean().exec();

    if (!alloc) {
      throwXviFcValidationError({
        excelFile: [
          {
            field: 'excelFile',
            code: 'grantAllocationMissing',
            message: 'Grant allocation not found for this state and year. Please contact the administrator.',
          },
        ],
      });
    }

    return alloc;
  }

  private async resolveGrantAllocationSummary(
    stateOid: Types.ObjectId,
    yearOid: Types.ObjectId,
  ): Promise<DfGrantAllocationSummary | null> {
    const alloc = await this.grantAllocationModel.findOne({ stateId: stateOid, yearId: yearOid }).lean().exec();

    if (!alloc) return null;

    return {
      grantAllocationId: String(alloc._id),
      basic: alloc.basic,
      performance: alloc.performance,
      total: alloc.basic + alloc.performance,
    };
  }

  private async checkInstallment1Prereq(stateOid: Types.ObjectId, yearOid: Types.ObjectId): Promise<void> {
    const eulbUnderReview = await this.eulbModel
      .findOne({
        state: stateOid,
        year: yearOid,
        formType: EULB_FORM_TYPE,
        currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
      })
      .lean()
      .exec();

    if (!eulbUnderReview) {
      throwXviFcValidationError({
        installment: [
          {
            field: 'installment',
            code: 'prerequisiteNotMet',
            message:
              'Elected Body form must be submitted and under review by MoHUA before submitting Devolution Formula.',
          },
        ],
      });
    }
  }

  private checkInstallment2Prereq(): void {
    if (this.isInstallment2Unlocked()) return;

    throwXviFcValidationError({
      installment: [
        {
          field: 'installment',
          code: 'installment2Locked',
          message: DevolutionFormulaService.INSTALLMENT_2_LOCK_REASON,
        },
      ],
    });
  }

  /**
   * TODO: Unlock when the Claim Batch model is implemented — query for at least one
   * Installment 1 claim batch acknowledged by MoHUA. Until then Installment 2 stays locked.
   */
  private isInstallment2Unlocked(): boolean {
    return false;
  }

  private buildInstallmentAccess(): DfInstallmentAccess {
    const installment2Unlocked = this.isInstallment2Unlocked();

    return {
      installment1: { canSelect: true, locked: false, lockReason: null },
      installment2: {
        canSelect: installment2Unlocked,
        locked: !installment2Unlocked,
        lockReason: installment2Unlocked ? null : DevolutionFormulaService.INSTALLMENT_2_LOCK_REASON,
      },
    };
  }
}
