import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
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
import { toObjectIdString } from 'src/users/user-scope.helpers';
import { DynamicFormValidationService } from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.service';
import { XvifcFormActorsService } from 'src/module/xvi-fc/common/services/xvifc-form-actors.service';
import { FileUrlNormalizerService } from 'src/module/xvi-fc/common/services/file-url-normalizer.service';
import type { FormData } from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.types';
import type {
  FieldConfig,
  FieldSupportingContent,
  HydratedFieldConfig,
  UploadedFileValue,
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
import {
  EULB_FORM_TYPE,
  ElectedUrbanLocalBodiesForm,
  EulbFormDocument,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import {
  DF_ACTION_DOWNLOAD_ERROR_SHEET,
  DF_ACTION_DOWNLOAD_TEMPLATE,
  DF_ACTION_REVALIDATE_EXCEL,
  DF_ACTION_VIEW_UPLOADED_DATA,
  DF_DUMP_HEADERS,
  DF_FORM_NAME,
  DF_FORM_QUESTIONS,
} from '../../constants/devolution-formula.constants';
import type { SaveDraftDevolutionFormulaDto } from '../../dto/save-draft-devolution-formula.dto';
import type { FinalSubmitDevolutionFormulaDto } from '../../dto/final-submit-devolution-formula.dto';
import type { DumpDevolutionFormulaQueryDto } from '../../dto/dump-devolution-formula-query.dto';
import type {
  DfFormGetResponseData,
  DfFormLeanDoc,
  DfFormPermissions,
  DfGrantAllocationSummary,
  DfDumpRow,
} from '../../types/devolution-formula.types';
import { DevolutionFormulaValidator } from '../../validators/devolution-formula.validator';

@Injectable()
export class DevolutionFormulaService {
  private readonly logger = new Logger(DevolutionFormulaService.name);

  constructor(
    @InjectModel(DevolutionFormulaForm.name)
    private readonly model: Model<DevolutionFormulaFormDocument>,
    @InjectModel(DevolutionFormulaRow.name)
    private readonly rowModel: Model<DevolutionFormulaRowDocument>,
    @InjectModel(GrantAllocation.name)
    private readonly grantAllocationModel: Model<GrantAllocationDocument>,
    @InjectModel(ElectedUrbanLocalBodiesForm.name)
    private readonly eulbModel: Model<EulbFormDocument>,
    private readonly dfValidator: DevolutionFormulaValidator,
    private readonly xvifcFormActorsService: XvifcFormActorsService,
    private readonly excelService: ExcelService,
    private readonly fileTokenService: FileTokenService,
    private readonly fileUrlNormalizer: FileUrlNormalizerService,
    private readonly dynamicFormValidator: DynamicFormValidationService,
  ) {}

  async getForm(
    stateId: string,
    yearId: string,
    installment: number,
    user: AuthUser,
  ): Promise<XviFcApiResponse<DfFormGetResponseData>> {
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
    const permissions = this.buildFormPermissions(user, stateId, currentFormStatus);
    const { actors, stateName } = this.xvifcFormActorsService.buildActorsAndStateName(
      doc as unknown as Parameters<typeof this.xvifcFormActorsService.buildActorsAndStateName>[0],
    );

    const grantAllocationSummary = await this.resolveGrantAllocationSummary(stateOid, yearOid);
    const validationSummary = this.buildValidationSummary(doc, grantAllocationSummary?.total ?? 0);

    const savedData: FormData = {};
    if (doc?.excelFile) savedData['excelFile'] = doc.excelFile;
    if (doc?.checkboxConfirmation !== undefined) savedData['checkboxConfirmation'] = doc.checkboxConfirmation;

    const questions = this.hydrateQuestions(this.loadFormQuestions(), savedData, doc, permissions, folderPathContext);

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
      .lean<Pick<DfFormLeanDoc, '_id' | 'currentFormStatus'>>()
      .exec();

    if (existing) {
      assertCanStateEditForm(existing.currentFormStatus ?? FORM_STATUS.NOT_STARTED);
    }

    const grantAlloc = await this.resolveGrantAllocation(stateOid, yearOid);

    const rawFile = dto.data?.excelFile;
    const normalizedFile = rawFile?.fileUrl
      ? { ...rawFile, fileUrl: this.fileUrlNormalizer.toRawStoragePath(rawFile.fileUrl) }
      : rawFile;

    const formData: FormData = {};
    if (normalizedFile !== undefined) formData['excelFile'] = normalizedFile;
    if (dto.data?.checkboxConfirmation !== undefined) formData['checkboxConfirmation'] = dto.data.checkboxConfirmation;

    const validation = this.dynamicFormValidator.validateDraftAndBuildPayload(this.loadFormQuestions(), formData);
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

    const normalizedFile = dto.data.excelFile?.fileUrl
      ? { ...dto.data.excelFile, fileUrl: this.fileUrlNormalizer.toRawStoragePath(dto.data.excelFile.fileUrl) }
      : dto.data.excelFile;

    const formData: FormData = {
      excelFile: normalizedFile,
      checkboxConfirmation: dto.data.checkboxConfirmation,
    };

    const validation = this.dynamicFormValidator.validateFinalSubmitAndBuildPayload(this.loadFormQuestions(), formData);
    if (!validation.isValid) throwXviFcValidationError(validation.errors);

    // Prerequisite gate for installment 1
    if (dto.installment === 1) {
      await this.checkInstallment1Prereq(stateOid, yearOid);
    }

    // Prerequisite gate for installment 2
    if (dto.installment === 2) {
      this.checkInstallment2Prereq();
    }

    // Grant allocation must still exist, and its total must match what was validated
    const currentAlloc = await this.resolveGrantAllocation(stateOid, yearOid);
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

    await this.model
      .findOneAndUpdate(
        { state: stateOid, year: yearOid, installment: dto.installment },
        {
          $set: {
            currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
            isDraft: false,
            submittedAt: new Date(),
            submittedBy: userOid,
            updatedBy: userOid,
            excelFile: normalizedFile,
            checkboxConfirmation: dto.data.checkboxConfirmation,
          },
        },
      )
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
    const filter: Record<string, unknown> = {};

    if (user.scope === Scope.STATE) {
      const userStateId = toObjectIdString(user.state);
      if (!userStateId) throw new ForbiddenException('Your account is not mapped to any state.');
      filter['state'] = new Types.ObjectId(userStateId);
    } else if (user.scope === Scope.ADMIN) {
      if (query.stateId) filter['state'] = new Types.ObjectId(query.stateId);
    } else {
      throw new ForbiddenException('Insufficient permissions for dump.');
    }

    if (query.yearId) filter['year'] = new Types.ObjectId(query.yearId);
    if (query.installment) filter['installment'] = query.installment;
    if (query.validationStatus) filter['validationStatus'] = query.validationStatus;

    const forms = await this.model
      .find(filter)
      .select('_id state year installment currentFormStatus validationStatus activeDatasetVersion')
      .populate<{ state: { _id: Types.ObjectId; name: string } }>('state', 'name')
      .lean()
      .exec();

    const dumpRows: DfDumpRow[] = [];

    for (const form of forms) {
      const activeVersion = ((form as Record<string, unknown>)['activeDatasetVersion'] as number) ?? 0;
      if (activeVersion === 0) continue;

      const state = (form as Record<string, unknown>)['state'] as { name: string } | null;
      const yearId = String((form as Record<string, unknown>)['year']);
      const yearLabel = YearIdToLabel[yearId] ?? yearId;
      const formStatus = getFormStatusLabel(((form as Record<string, unknown>)['currentFormStatus'] as number) ?? 0);
      const validationStatus = ((form as Record<string, unknown>)['validationStatus'] as string | undefined) ?? '';
      const installment = (form as Record<string, unknown>)['installment'] as number;

      const rows = await this.rowModel
        .find({ form: form._id, datasetVersion: activeVersion, isActive: true })
        .select(
          'rowNumber censusCode sbCode ulbName totalGrantAllocation installment1Amount installment2Amount devolutionFormula validationStatus datasetVersion createdAt updatedAt',
        )
        .lean()
        .exec();

      for (const row of rows) {
        dumpRows.push({
          rowNumber: row.rowNumber,
          stateName: state?.name ?? '',
          yearLabel,
          installment,
          formStatus,
          validationStatus,
          censusCode: row.censusCode ?? '',
          sbCode: row.sbCode ?? '',
          ulbName: row.ulbName,
          totalGrantAllocation: row.totalGrantAllocation,
          installment1Amount: row.installment1Amount,
          installment2Amount: row.installment2Amount,
          devolutionFormula: row.devolutionFormula,
          datasetVersion: row.datasetVersion,
          createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : '',
          updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : '',
        });
      }
    }

    return this.excelService.generateExcel(DF_DUMP_HEADERS, dumpRows, 'Devolution Formula Dump');
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private loadFormQuestions(): FieldConfig[] {
    return DF_FORM_QUESTIONS.map((q) => ({ ...q }));
  }

  private hydrateQuestions(
    questions: FieldConfig[],
    savedData: FormData,
    doc: DfFormLeanDoc | null,
    permissions: DfFormPermissions,
    folderPathContext: XviFcFolderPathContext,
  ): HydratedFieldConfig[] {
    return questions.map((question) => {
      const rawValue = Object.prototype.hasOwnProperty.call(savedData, question.key)
        ? savedData[question.key]
        : question.value;

      if (question.formFieldType === 'file') {
        const resolvedFolderPath = question.folderPathKey
          ? buildXviFcFolderPath(question.folderPathKey, folderPathContext)
          : question.folderPath;

        let value = rawValue;
        const fileVal = rawValue as UploadedFileValue | null | undefined;
        if (fileVal?.fileUrl) {
          try {
            const signedUrl = this.fileTokenService.signFileUrl(fileVal.fileUrl);
            value = { ...fileVal, fileUrl: signedUrl };
          } catch {
            // keep raw if signing fails
          }
        }

        if (question.key === 'excelFile') {
          return {
            ...question,
            folderPath: resolvedFolderPath,
            value,
            supportingContent: this.buildExcelFileSupportingContent(doc, permissions),
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
  ): FieldSupportingContent[] {
    const { canView, canEdit } = permissions;
    const hasDataset = (doc?.activeDatasetVersion ?? 0) > 0;
    const hasErrorSheet = !!doc?.errorExcelFile?.fileUrl;

    return [
      {
        type: 'actions',
        position: 'before',
        layout: 'inline',
        separator: 'dot',
        actions: [
          {
            id: DF_ACTION_DOWNLOAD_TEMPLATE,
            label: 'Download Template',
            icon: 'bi bi-file-earmark-arrow-down',
            tone: 'primary' as const,
            visible: canView,
          },
          {
            id: DF_ACTION_VIEW_UPLOADED_DATA,
            label: 'View Uploaded Data',
            icon: 'bi bi-table',
            tone: 'primary' as const,
            visible: canView && hasDataset,
          },
          {
            id: DF_ACTION_DOWNLOAD_ERROR_SHEET,
            label: 'Download Error Sheet',
            icon: 'bi bi-file-earmark-excel',
            tone: 'danger' as const,
            visible: canView && hasErrorSheet,
          },
          {
            id: DF_ACTION_REVALIDATE_EXCEL,
            label: 'Revalidate Excel',
            icon: 'bi bi-arrow-repeat',
            tone: 'primary' as const,
            visible: canEdit && hasDataset,
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
    const eulbAcknowledged = await this.eulbModel
      .findOne({
        state: stateOid,
        year: yearOid,
        formType: EULB_FORM_TYPE,
        currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
      })
      .lean()
      .exec();

    if (!eulbAcknowledged) {
      throwXviFcValidationError({
        installment: [
          {
            field: 'installment',
            code: 'prerequisiteNotMet',
            message:
              'Installment 1 cannot be submitted until the Elected Urban Local Bodies form has been acknowledged by MoHUA.',
          },
        ],
      });
    }
  }

  /**
   * TODO: Unlock when the Claim Batch model is implemented.
   * Until then Installment 2 is always locked.
   */
  private checkInstallment2Prereq(): void {
    throwXviFcValidationError({
      installment: [
        {
          field: 'installment',
          code: 'installment2Locked',
          message:
            'Installment 2 is locked until at least one Installment 1 claim batch has been acknowledged by MoHUA. (TODO: implement claim batch model)',
        },
      ],
    });
  }
}
