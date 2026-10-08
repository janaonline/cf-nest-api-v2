import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Buffer } from 'exceljs';
import { Model, Types } from 'mongoose';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { ExcelColumnValidation, ExcelService, RowHeader } from 'src/services/excel/excel.service';
import { EulbFormJsonConfigService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/form-json/elected-urban-local-bodies-form-json.service';
import { getFieldsByType } from 'src/module/xvi-fc/state/elected-urban-local-bodies/helpers/elected-urban-local-bodies-form-json.helpers';
import { computeEulbStatusSummary } from 'src/module/xvi-fc/state/elected-urban-local-bodies/helpers/elected-urban-local-bodies-status-summary.helper';
import {
  deriveElectedBodyStatuses,
  parseFieldRelativeBoundary,
  type EulbDateOffsetBoundary,
} from 'src/module/xvi-fc/state/elected-urban-local-bodies/validators/elected-urban-local-bodies.validator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { FORM_STATUS, FormHistoryAction, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import {
  assertCanStateEditForm,
  assertCanStateFinalSubmitForm,
} from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
import { assertStateAccess, buildStateFormPermissions } from 'src/module/xvi-fc/common/utils/xvi-fc-state-access.util';
import { DynamicFormValidationService } from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.service';
import { XvifcFormActorsService } from 'src/module/xvi-fc/common/services/xvifc-form-actors.service';
import { FileInfoNormalizerService } from 'src/module/xvi-fc/common/services/file-info-normalizer.service';
import { FormQuestionHydratorService } from 'src/module/xvi-fc/common/services/form-question-hydrator.service';
import { keyByFieldKey, requireField } from 'src/module/xvi-fc/common/utils/xvi-fc-field-lookup.util';
import { deriveFileValidationOptions } from 'src/module/xvi-fc/common/utils/xvi-fc-file-constraint.util';
import { buildUlbReconciliationBadges } from 'src/module/xvi-fc/common/utils/xvi-fc-ulb-reconciliation-badges.util';
import { buildValidationIssuesMessage } from 'src/module/xvi-fc/common/utils/xvi-fc-validation-issues-message.util';
import { formatXviFcDate } from 'src/module/xvi-fc/common/utils/xvi-fc-date-format.util';
import type { FileInfo } from 'src/schemas/common/file.schema';
import type { FormData } from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.types';
import type {
  FieldConfig,
  FieldSupportingContent,
  FormFieldOption,
  HydratedFieldConfig,
} from 'src/module/xvi-fc/common/types/field-config.type';
import {
  resolveXviFcFolderPathsInFormJson,
  type XviFcFolderPathContext,
} from 'src/module/xvi-fc/common/folder-paths/xvi-fc-folder-path.resolver';
import { YearIdToLabel } from 'src/core/constants/years';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import {
  throwXviFcValidationError,
  throwXviFcValidationErrorWithData,
  xviFcSuccess,
} from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import {
  EULB_FORM_TYPE,
  ElectedUrbanLocalBodiesForm,
  EulbFormDocument,
  EulbValidationStatus,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import {
  ElectedUrbanLocalBodiesRow,
  EulbRowDocument,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import {
  ElectedUrbanLocalBodiesFormHistory,
  EulbFormHistoryDocument,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form-history.schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { UlbEligibilityService } from 'src/module/ulb-eligibility/ulb-eligibility.service';
import {
  EULB_ACTION_DOWNLOAD_ERROR_SHEET,
  EULB_ACTION_DOWNLOAD_TEMPLATE,
  EULB_ACTION_REGISTER_ULB,
  EULB_ACTION_REVALIDATE_EXCEL,
  EULB_ACTION_VIEW_UPLOADED_DATA,
  EULB_FORM_NAME,
  TEMPLATE_HEADERS,
  buildEulbRegisterUlbUrl,
} from 'src/module/xvi-fc/state/elected-urban-local-bodies/constants/elected-urban-local-bodies.constants';
import type { SaveElectedUrbanLocalBodiesDraftDto } from 'src/module/xvi-fc/state/elected-urban-local-bodies/dto/save-elected-urban-local-bodies-draft.dto';
import type { FinalSubmitElectedUrbanLocalBodiesDto } from 'src/module/xvi-fc/state/elected-urban-local-bodies/dto/final-submit-elected-urban-local-bodies.dto';
import type {
  EulbFormGetResponseData,
  EulbFormLeanDoc,
  EulbFormPermissions,
  EulbDumpFormRecord,
  EulbDumpRow,
  EulbDumpRowRecord,
  EulbStatusSummary,
  EulbValidationSummary,
} from 'src/module/xvi-fc/state/elected-urban-local-bodies/types/elected-urban-local-bodies.types';

/** Converts a date validator value ('2021-05-31' or 'TODAY') to an Excel formula expression. */
function toExcelDateExpr(dateVal: string): string {
  if (dateVal === 'TODAY') return 'TODAY()';
  const d = new Date(dateVal);
  return `DATE(${d.getUTCFullYear()},${d.getUTCMonth() + 1},${d.getUTCDate()})`;
}

/** `EDATE()` shifts by whole months, so Y/M units use it directly; D falls back to plain cell arithmetic. */
function buildRelativeExcelExpr(cellRef: string, offset: EulbDateOffsetBoundary): string {
  const delta = offset.amount * offset.sign;
  switch (offset.unit) {
    case 'Y':
      return `EDATE(${cellRef},${delta * 12})`;
    case 'M':
      return `EDATE(${cellRef},${delta})`;
    case 'D':
      return `(${cellRef}+${delta})`;
  }
}

/** Static prompt text — Excel prompts can't be computed per row like the formula itself. See
 *  CLAUDE.md's "dateOfExpiry's maxDate" section. */
function describeRelativeOffset(offset: EulbDateOffsetBoundary, fieldLabel: string): string {
  const unitWord = offset.unit === 'D' ? 'day' : offset.unit === 'M' ? 'month' : 'year';
  const plural = offset.amount === 1 ? '' : 's';
  const direction = offset.sign < 0 ? 'before' : 'after';
  return `${offset.amount} ${unitWord}${plural} ${direction} ${fieldLabel}`;
}

/** Returns a Date (not a string) so ISNUMBER() in the validation formula still passes; '' for
 *  empty/invalid leaves the cell blank. */
function dateToTemplateValue(val: Date | string | undefined | null): Date | string {
  if (!val) return '';
  if (val instanceof Date) return isNaN(val.getTime()) ? '' : val;
  const d = new Date(val);
  return isNaN(d.getTime()) ? '' : d;
}

function dateToDumpValue(val: Date | string | undefined | null): string {
  if (!val) return '';
  if (val instanceof Date) return isNaN(val.getTime()) ? '' : val.toISOString().split('T')[0];
  const d = new Date(val);
  return isNaN(d.getTime()) ? val : d.toISOString().split('T')[0];
}

function datetimeToDumpValue(val: Date | undefined): string {
  return val ? val.toISOString() : '';
}

type EulbTemplateRow = {
  censusCode: string;
  ulbName: string;
  electedBodyStatus: string;
  dateOfConstitution: Date | string;
  dateOfExpiry: Date | string;
  remarks: string;
};

const EULB_DUMP_HEADERS: RowHeader[] = [
  { label: 'Row Number', key: 'rowNumber', width: 14 },
  { label: 'Census Code', key: 'censusCode', width: 16 },
  { label: 'ULB Name', key: 'ulbName', width: 35 },
  { label: 'Elected Body Status', key: 'electedBodyStatus', width: 24 },
  { label: 'Date on which the elected body is in place', key: 'dateOfConstitution', width: 48 },
  { label: 'Date of Expiry', key: 'dateOfExpiry', width: 20 },
  { label: 'Remarks', key: 'remarks', width: 35 },
  { label: 'Validation Status', key: 'validationStatus', width: 20 },
  { label: 'Latest Data Source', key: 'latestDataSource', width: 22 },
  { label: 'Dataset Version', key: 'datasetVersion', width: 18 },
  { label: 'Submitted By', key: 'submittedBy', width: 25 },
  { label: 'Submitted At', key: 'submittedAt', width: 24 },
  { label: 'Created By', key: 'createdBy', width: 25 },
  { label: 'Updated By', key: 'updatedBy', width: 25 },
  { label: 'Created At', key: 'createdAt', width: 24 },
  { label: 'Updated At', key: 'updatedAt', width: 24 },
];

@Injectable()
export class ElectedUrbanLocalBodiesService {
  private readonly logger = new Logger(ElectedUrbanLocalBodiesService.name);

  constructor(
    @InjectModel(ElectedUrbanLocalBodiesForm.name)
    private readonly model: Model<EulbFormDocument>,
    @InjectModel(ElectedUrbanLocalBodiesRow.name)
    private readonly rowModel: Model<EulbRowDocument>,
    @InjectModel(ElectedUrbanLocalBodiesFormHistory.name)
    private readonly historyModel: Model<EulbFormHistoryDocument>,
    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,
    private readonly validator: DynamicFormValidationService,
    private readonly xvifcFormActorsService: XvifcFormActorsService,
    private readonly excelService: ExcelService,
    private readonly fileTokenService: FileTokenService,
    private readonly fileInfoNormalizer: FileInfoNormalizerService,
    private readonly eulbFormJsonConfig: EulbFormJsonConfigService,
    private readonly ulbEligibilityService: UlbEligibilityService,
    private readonly formQuestionHydrator: FormQuestionHydratorService,
  ) {}

  /** electedBodyExcelFile gets default (no-form) supporting actions here — there's no form doc yet
   *  to compute real permissions/state from. */
  async getQuestions(): Promise<XviFcApiResponse<HydratedFieldConfig[]>> {
    const fields = await this.eulbFormJsonConfig.loadFields();
    const mainFormFields = getFieldsByType(fields, 'EULB_MAIN_FORM_FIELDS');
    if (mainFormFields.length === 0) {
      throw new InternalServerErrorException('EULB_MAIN_FORM_FIELDS group is empty in form configuration.');
    }
    const noPermissions: EulbFormPermissions = { canView: false, canEdit: false, canFinalSubmit: false };
    const questions = mainFormFields.map((q) => {
      if (q.key === 'electedBodyExcelFile') {
        return { ...q, supportingContent: this.buildElectedBodyFileSupportingContent(null, noPermissions, '') };
      }
      return q;
    });
    return xviFcSuccess('Elected Urban Local Bodies questions fetched.', questions as HydratedFieldConfig[]);
  }

  /** `ulbCount` is hydrated as a read-only, backend-owned field from the active ULB registry — the
   *  client-provided value is ignored. Returns a default Not Started form when no record exists yet. */
  async getForm(stateId: string, yearId: string, user: AuthUser): Promise<XviFcApiResponse<EulbFormGetResponseData>> {
    assertStateAccess(user, stateId);

    const fields = await this.eulbFormJsonConfig.loadFields(yearId);
    const designYear = YearIdToLabel[yearId];
    if (!designYear) throw new NotFoundException(`Design year not found for yearId: ${yearId}`);
    const folderPathContext: XviFcFolderPathContext = { _id: stateId, designYear, role: 'state' };

    const mainFormFields = getFieldsByType(fields, 'EULB_MAIN_FORM_FIELDS');
    const rowEditFields = getFieldsByType(fields, 'EULB_ROW_EDIT_FIELDS');
    if (mainFormFields.length === 0) {
      throw new InternalServerErrorException('EULB_MAIN_FORM_FIELDS group is empty in form configuration.');
    }
    if (rowEditFields.length === 0) {
      throw new InternalServerErrorException('EULB_ROW_EDIT_FIELDS group is empty in form configuration.');
    }

    const stateOid = new Types.ObjectId(stateId);
    const eligibleUlbFilter = await this.ulbEligibilityService.getEligibleUlbFilter(stateOid, 'XVIFC');

    const [doc, computedActiveUlbCount] = await Promise.all([
      this.model
        .findOne({
          state: stateOid,
          year: new Types.ObjectId(yearId),
          formType: EULB_FORM_TYPE,
          isDeleted: false,
        })
        .populate('state', 'name')
        .populate('createdBy', 'name')
        .populate('updatedBy', 'name')
        .populate('submittedBy', 'name')
        .lean<EulbFormLeanDoc>()
        .exec(),
      this.ulbModel.countDocuments(eligibleUlbFilter),
    ]);

    const currentFormStatus = doc?.currentFormStatus ?? FORM_STATUS.NOT_STARTED;

    // Build savedData from top-level form fields (ulbCount is not included — it is backend-owned)
    const savedData: FormData = {};
    if (doc) {
      if (doc.checkboxConfirmation !== undefined) savedData['checkboxConfirmation'] = doc.checkboxConfirmation;
      if (doc.electedBodyExcelFile !== undefined) savedData['electedBodyExcelFile'] = doc.electedBodyExcelFile;
      if (doc.signedElectedbodyFile !== undefined) savedData['signedElectedbodyFile'] = doc.signedElectedbodyFile;
    }

    const permissions = buildStateFormPermissions(user, stateId, currentFormStatus);
    const questions = this.hydrateQuestions(
      mainFormFields,
      savedData,
      doc,
      permissions,
      yearId,
      computedActiveUlbCount,
      folderPathContext,
    );
    const { actors, stateName } = this.xvifcFormActorsService.buildActorsAndStateName(doc);
    const validationSummary = this.buildValidationSummary(doc);

    // Only computed post-submission (UNDER_REVIEW_BY_MOHUA+) — avoids a needless aggregation query
    // on every pre-submission page load.
    let statusSummary: EulbStatusSummary | null = null;
    if (doc && currentFormStatus >= FORM_STATUS.UNDER_REVIEW_BY_MOHUA) {
      const electedBodyStatuses = deriveElectedBodyStatuses(rowEditFields);
      statusSummary = await computeEulbStatusSummary(
        this.rowModel,
        doc._id as Types.ObjectId,
        stateId,
        yearId,
        doc.activeDatasetVersion ?? 0,
        electedBodyStatuses,
      );
    }

    const responseData: EulbFormGetResponseData = {
      _id: doc ? String(doc._id) : null,
      formName: EULB_FORM_NAME,
      stateId,
      yearId,
      stateName,
      currentFormStatus,
      currentFormStatusLabel: getFormStatusLabel(currentFormStatus),
      questions,
      rowEditFields,
      permissions,
      actors,
      validationSummary,
      statusSummary,
      instructions: [],
      meta: { version: 1 },
    };

    return xviFcSuccess('Elected Urban Local Bodies form fetched.', responseData);
  }

  /** Every row is registry-backed (no separate "excluded row" case here); saved values are
   *  overlaid onto the matching registry ULB when an active dataset exists. */
  async getTemplate(stateId: string, yearId: string, user: AuthUser): Promise<Buffer> {
    assertStateAccess(user, stateId);

    const fields = await this.eulbFormJsonConfig.loadFields(yearId);
    const rowEditFields = getFieldsByType(fields, 'EULB_ROW_EDIT_FIELDS');
    if (rowEditFields.length === 0) {
      throw new InternalServerErrorException('EULB_ROW_EDIT_FIELDS group is empty in form configuration.');
    }

    const stateOid = new Types.ObjectId(stateId);

    // Always load the active, XVI-FC-eligible registry — needed in both branches to determine
    // template rows. Must use the same filter as every other active-ULB-count call site (see
    // CLAUDE.md's "Every active-ULB-count call site must use the same eligibility filter").
    // TODO: dateOfConstitution's maxDate is hardcoded to today, not read from config — see
    // CLAUDE.md's "Known gaps". Not yet scoped.
    const eligibleUlbFilter = await this.ulbEligibilityService.getEligibleUlbFilter(stateOid, 'XVIFC');
    const activeUlbs = await this.ulbModel
      .find(eligibleUlbFilter)
      .select('_id name censusCode sbCode')
      .sort({ name: 1 })
      .lean()
      .exec();

    const computedActiveUlbCount = activeUlbs.length;

    const formDoc = await this.model
      .findOne({
        state: stateOid,
        year: new Types.ObjectId(yearId),
        formType: EULB_FORM_TYPE,
        isDeleted: false,
      })
      .lean<EulbFormLeanDoc>()
      .exec();

    const activeVersion = formDoc?.activeDatasetVersion ?? 0;

    let rows: EulbTemplateRow[];

    if (activeVersion > 0 && formDoc) {
      const savedDbRows = await this.rowModel
        .find({
          form: formDoc._id as Types.ObjectId,
          datasetVersion: activeVersion,
          isActive: true,
        })
        .select('ulbId censusCode ulbName electedBodyStatus dateOfConstitution dateOfExpiry remarks')
        .lean()
        .exec();

      const savedRowByUlbId = new Map<string, (typeof savedDbRows)[number]>();
      for (const r of savedDbRows) {
        if (r.ulbId) savedRowByUlbId.set(r.ulbId.toString(), r);
      }

      rows = activeUlbs.map((u) => {
        const saved = savedRowByUlbId.get(u._id.toString());
        const censusCode = String(u['censusCode'] ?? u['sbCode'] ?? '');
        return {
          censusCode,
          ulbName: u['name'],
          electedBodyStatus: saved?.electedBodyStatus ?? '',
          dateOfConstitution: saved ? dateToTemplateValue(saved.dateOfConstitution) : '',
          dateOfExpiry: saved ? dateToTemplateValue(saved.dateOfExpiry) : '',
          remarks: saved?.remarks ?? '',
        };
      });
    } else {
      rows = activeUlbs.map((u: Record<string, unknown>) => ({
        censusCode: (u['censusCode'] as string | null) || (u['sbCode'] as string | null) || '',
        ulbName: u['name'] as string,
        electedBodyStatus: '',
        dateOfConstitution: '',
        dateOfExpiry: '',
        remarks: '',
      }));
    }

    const validations = this.buildTemplateValidations(rowEditFields, computedActiveUlbCount);
    return this.excelService.generateExcel(
      TEMPLATE_HEADERS as RowHeader[],
      rows,
      'Elected Bodies Template',
      validations,
    );
  }

  /** Deliberately excludes histories, raw uploads, post-submission batches, and old dataset
   *  versions — only the active version's flat row projection. */
  async dumpToExcel(stateId: string, yearId: string, user: AuthUser): Promise<Buffer> {
    assertStateAccess(user, stateId);

    const stateOid = new Types.ObjectId(stateId);
    const yearOid = new Types.ObjectId(yearId);
    const formDoc = await this.model
      .findOne({
        state: stateOid,
        year: yearOid,
        formType: EULB_FORM_TYPE,
        isDeleted: false,
      })
      .select('_id activeDatasetVersion submittedBy submittedAt')
      .populate('submittedBy', 'name')
      .lean<EulbDumpFormRecord>()
      .exec();

    if (!formDoc) {
      throw new NotFoundException('Elected Urban Local Bodies form not found for this state and year.');
    }

    const activeVersion = formDoc.activeDatasetVersion ?? 0;
    const rows =
      activeVersion > 0
        ? await this.rowModel
            .find({
              form: formDoc._id,
              state: stateOid,
              year: yearOid,
              datasetVersion: activeVersion,
              isActive: true,
            })
            .select(
              'rowNumber censusCode ulbName electedBodyStatus dateOfConstitution dateOfExpiry remarks validationStatus lastUpdatedSource datasetVersion createdBy updatedBy createdAt updatedAt',
            )
            .populate('createdBy', 'name')
            .populate('updatedBy', 'name')
            .sort({ rowNumber: 1 })
            .lean<EulbDumpRowRecord[]>()
            .exec()
        : [];

    return this.excelService.generateExcel(
      EULB_DUMP_HEADERS,
      rows.map((row) => this.buildDumpRow(row, formDoc)),
      'EULB Dump',
    );
  }

  /** Partial validation only — absent required fields are allowed (except requiredTrue checkboxes).
   *  Upserts the main form document; does not touch rows. */
  async saveDraft(
    dto: SaveElectedUrbanLocalBodiesDraftDto,
    user: AuthUser,
    ip: string,
    userAgent: string,
  ): Promise<XviFcApiResponse> {
    assertStateAccess(user, dto.stateId);

    const fields = await this.eulbFormJsonConfig.loadFields(dto.yearId);
    const mainFormFields = getFieldsByType(fields, 'EULB_MAIN_FORM_FIELDS');
    if (mainFormFields.length === 0) {
      throw new InternalServerErrorException('EULB_MAIN_FORM_FIELDS group is empty in form configuration.');
    }

    const stateOid = new Types.ObjectId(dto.stateId);
    const yearOid = new Types.ObjectId(dto.yearId);
    const userOid = new Types.ObjectId(user._id);
    const filter = { state: stateOid, year: yearOid, formType: EULB_FORM_TYPE };

    // Compute active ULB count server-side; the client-submitted ulbCount is ignored. See
    // CLAUDE.md's "Every active-ULB-count call site must use the same eligibility filter".
    const eligibleUlbFilter = await this.ulbEligibilityService.getEligibleUlbFilter(stateOid, 'XVIFC');
    const [activeUlbCount, existing] = await Promise.all([
      this.ulbModel.countDocuments(eligibleUlbFilter),
      this.model
        .findOne(filter, {
          _id: 1,
          currentFormStatus: 1,
          electedBodyExcelFile: 1,
          signedElectedbodyFile: 1,
          validationStatus: 1,
        })
        .lean<
          Pick<
            EulbFormLeanDoc,
            '_id' | 'currentFormStatus' | 'electedBodyExcelFile' | 'signedElectedbodyFile' | 'validationStatus'
          >
        >()
        .exec(),
    ]);

    let normalizedExcelFile: FileInfo | null | undefined;
    if (dto.data.electedBodyExcelFile !== undefined) {
      const excelFileField = requireField(
        keyByFieldKey(mainFormFields),
        'electedBodyExcelFile',
        'ElectedUrbanLocalBodiesService.saveDraft',
      );
      const { file, errors: fileErrors } = this.fileInfoNormalizer.normalizeInboundFileInfo(
        dto.data.electedBodyExcelFile as unknown as Record<string, unknown>,
        existing?.electedBodyExcelFile,
        deriveFileValidationOptions(excelFileField, 'electedBodyExcelFile'),
      );
      if (fileErrors.length > 0) throwXviFcValidationError({ electedBodyExcelFile: fileErrors });
      normalizedExcelFile = file;
    }

    let normalizedSignedFile: FileInfo | null | undefined;
    if (dto.data.signedElectedbodyFile !== undefined) {
      const signedFileField = requireField(
        keyByFieldKey(mainFormFields),
        'signedElectedbodyFile',
        'ElectedUrbanLocalBodiesService.saveDraft',
      );
      const { file, errors: fileErrors } = this.fileInfoNormalizer.normalizeInboundFileInfo(
        dto.data.signedElectedbodyFile as unknown as Record<string, unknown>,
        existing?.signedElectedbodyFile,
        deriveFileValidationOptions(signedFileField, 'signedElectedbodyFile'),
      );
      if (fileErrors.length > 0) throwXviFcValidationError({ signedElectedbodyFile: fileErrors });
      normalizedSignedFile = file;
    }

    /**
     * A new/replaced/removed electedBodyExcelFile invalidates the previous validationStatus.
     * normalizedExcelFile is undefined only when the file is unchanged, matching the persistence logic below.
     */
    const effectiveValidationStatus: EulbValidationStatus =
      normalizedExcelFile !== undefined ? 'NOT_VALIDATED' : (existing?.validationStatus ?? 'NOT_VALIDATED');

    const formData: FormData = {
      ulbCount: activeUlbCount,
      electedBodyExcelFile: normalizedExcelFile,
      signedElectedbodyFile: normalizedSignedFile,
      checkboxConfirmation: dto.data.checkboxConfirmation,
      // Synthetic key for signedElectedbodyFile.visibleWhen to check Excel validity, not just presence.
      // See dynamic-form-validation.service.ts's evaluateCondition.
      electedBodyExcelValidationStatus: effectiveValidationStatus,
    };

    const result = this.validator.validateDraftAndBuildPayload(mainFormFields, formData);
    if (!result.isValid) throwXviFcValidationError(result.errors);

    const fieldUpdates: Record<string, unknown> = {
      currentFormStatus: FORM_STATUS.IN_PROGRESS,
      updatedBy: userOid,
      ulbCount: activeUlbCount,
    };
    if (normalizedExcelFile !== undefined) {
      fieldUpdates['electedBodyExcelFile'] = normalizedExcelFile;
      // Reset the stale validationStatus from the previous file — mirrors deleteUploadedExcel's
      // reset on delete (services/row/elected-urban-local-bodies-row.service.ts).
      fieldUpdates['validationStatus'] = effectiveValidationStatus;
    }
    if (normalizedSignedFile !== undefined) fieldUpdates['signedElectedbodyFile'] = normalizedSignedFile;
    if (result.sanitizedPayload['checkboxConfirmation'] !== undefined)
      fieldUpdates['checkboxConfirmation'] = result.sanitizedPayload['checkboxConfirmation'];

    if (existing) {
      const fromStatus = existing.currentFormStatus ?? FORM_STATUS.NOT_STARTED;
      assertCanStateEditForm(fromStatus);

      const updated = await this.model.findOneAndUpdate(filter, { $set: fieldUpdates }, { new: true }).lean().exec();

      await this.recordFormHistory({
        formId: existing._id as Types.ObjectId,
        state: stateOid,
        year: yearOid,
        action: FormHistoryAction.CREATE_DRAFT,
        fromStatus,
        toStatus: FORM_STATUS.IN_PROGRESS,
        changedBy: userOid,
        ip,
        userAgent,
      });

      return xviFcSuccess('Elected Urban Local Bodies form saved as draft.', {
        ...updated,
        currentFormStatusLabel: getFormStatusLabel(FORM_STATUS.IN_PROGRESS),
      });
    }

    const created = await this.model.create({
      state: stateOid,
      year: yearOid,
      formType: EULB_FORM_TYPE,
      currentFormStatus: FORM_STATUS.IN_PROGRESS,
      isDraft: true,
      isActive: true,
      isDeleted: false,
      createdBy: userOid,
      ...fieldUpdates,
    });

    await this.recordFormHistory({
      formId: created._id,
      state: stateOid,
      year: yearOid,
      action: FormHistoryAction.CREATE_DRAFT,
      fromStatus: FORM_STATUS.NOT_STARTED,
      toStatus: FORM_STATUS.IN_PROGRESS,
      changedBy: userOid,
      ip,
      userAgent,
    });

    return xviFcSuccess('Elected Urban Local Bodies form saved as draft.', {
      ...created.toObject(),
      currentFormStatusLabel: getFormStatusLabel(FORM_STATUS.IN_PROGRESS),
    });
  }

  /** Enforces all Excel row-level pre-conditions (validated, zero error/missing/extra rows, row
   *  count matches the computed active ULB count) before transitioning to UNDER_REVIEW_BY_PMU — see
   *  CLAUDE.md's "finalSubmit's old coupling with devolution-formula is gone" section and
   *  pmu/elected-urban-local-bodies/CLAUDE.md for the PMU hand-off. */
  async finalSubmit(
    dto: FinalSubmitElectedUrbanLocalBodiesDto,
    user: AuthUser,
    ip: string,
    userAgent: string,
  ): Promise<XviFcApiResponse> {
    assertStateAccess(user, dto.stateId);

    const fields = await this.eulbFormJsonConfig.loadFields(dto.yearId);
    const mainFormFields = getFieldsByType(fields, 'EULB_MAIN_FORM_FIELDS');
    if (mainFormFields.length === 0) {
      throw new InternalServerErrorException('EULB_MAIN_FORM_FIELDS group is empty in form configuration.');
    }

    const stateOid = new Types.ObjectId(dto.stateId);
    const yearOid = new Types.ObjectId(dto.yearId);
    const userOid = new Types.ObjectId(user._id);
    const filter = { state: stateOid, year: yearOid, formType: EULB_FORM_TYPE };

    // Compute active ULB count server-side; the client-submitted ulbCount is ignored. See
    // CLAUDE.md's "Every active-ULB-count call site must use the same eligibility filter".
    const eligibleUlbFilter = await this.ulbEligibilityService.getEligibleUlbFilter(stateOid, 'XVIFC');
    const activeUlbCount = await this.ulbModel.countDocuments(eligibleUlbFilter);

    const existing = await this.model
      .findOne(filter, {
        _id: 1,
        currentFormStatus: 1,
        validationStatus: 1,
        errorRowCount: 1,
        missingDbUlbCount: 1,
        excelRowCount: 1,
        dbUlbCount: 1,
        maxAllowedExcelRows: 1,
        matchedDbUlbCount: 1,
        extraExcelRowCount: 1,
        duplicateUlbCount: 1,
        activeDatasetVersion: 1,
        electedBodyExcelFile: 1,
        signedElectedbodyFile: 1,
      })
      .lean()
      .exec();

    const fromStatus = existing?.currentFormStatus ?? FORM_STATUS.NOT_STARTED;
    assertCanStateFinalSubmitForm(fromStatus);

    const excelFileFieldFinal = requireField(
      keyByFieldKey(mainFormFields),
      'electedBodyExcelFile',
      'ElectedUrbanLocalBodiesService.finalSubmit',
    );
    const { file: normalizedExcelFile, errors: excelFileErrors } = this.fileInfoNormalizer.normalizeInboundFileInfo(
      dto.data.electedBodyExcelFile as unknown as Record<string, unknown>,
      existing?.electedBodyExcelFile as FileInfo | undefined,
      deriveFileValidationOptions(excelFileFieldFinal, 'electedBodyExcelFile'),
    );
    if (excelFileErrors.length > 0) throwXviFcValidationError({ electedBodyExcelFile: excelFileErrors });

    const signedFileFieldFinal = requireField(
      keyByFieldKey(mainFormFields),
      'signedElectedbodyFile',
      'ElectedUrbanLocalBodiesService.finalSubmit',
    );
    const { file: normalizedSignedFile, errors: signedFileErrors } = this.fileInfoNormalizer.normalizeInboundFileInfo(
      dto.data.signedElectedbodyFile as unknown as Record<string, unknown>,
      existing?.signedElectedbodyFile as FileInfo | undefined,
      deriveFileValidationOptions(signedFileFieldFinal, 'signedElectedbodyFile'),
    );
    if (signedFileErrors.length > 0) throwXviFcValidationError({ signedElectedbodyFile: signedFileErrors });

    // `normalizedExcelFile`/`normalizedSignedFile` are `undefined` when the file is unchanged from
    // what's already stored — fall back to the existing file so the required-field validator below
    // still sees it as present (the raw, possibly-undefined value is used for the $set below).
    const formData: FormData = {
      ulbCount: activeUlbCount,
      electedBodyExcelFile: normalizedExcelFile !== undefined ? normalizedExcelFile : existing?.electedBodyExcelFile,
      signedElectedbodyFile:
        normalizedSignedFile !== undefined ? normalizedSignedFile : existing?.signedElectedbodyFile,
      checkboxConfirmation: dto.data.checkboxConfirmation,
      // Same synthetic key as saveDraft — existing.validationStatus is already loaded above (it's
      // exactly what the hard-gate check below reads too), so this needs no extra query.
      electedBodyExcelValidationStatus: existing?.validationStatus ?? 'NOT_VALIDATED',
    };
    const validation = this.validator.validateFinalSubmitAndBuildPayload(mainFormFields, formData);
    if (!validation.isValid) throwXviFcValidationError(validation.errors);

    // Excel/row validation checks
    if (!existing) {
      throwXviFcValidationErrorWithData(
        {
          electedBodyExcelFile: [
            {
              field: 'electedBodyExcelFile',
              code: 'excelNotValidated',
              message:
                'Excel has not been validated. Please validate or revalidate the uploaded Excel before submitting.',
            },
          ],
        },
        {
          validationSummary: {
            validationStatus: 'NOT_VALIDATED' as EulbValidationStatus,
            excelRowCount: 0,
            errorRowCount: 0,
            activeDatasetVersion: 0,
          },
        },
      );
    }

    const storedValidationStatus = existing.validationStatus as EulbValidationStatus | undefined;
    const errorRowCount = (existing.errorRowCount as number | undefined) ?? 0;
    const missingDbUlbCount = (existing.missingDbUlbCount as number | undefined) ?? 0;
    const excelRowCount = (existing.excelRowCount as number | undefined) ?? 0;
    const dbUlbCount = (existing.dbUlbCount as number | undefined) ?? 0;
    const maxAllowedExcelRows = (existing.maxAllowedExcelRows as number | undefined) ?? dbUlbCount * 2;
    const matchedDbUlbCount = (existing.matchedDbUlbCount as number | undefined) ?? 0;
    const extraExcelRowCount = (existing.extraExcelRowCount as number | undefined) ?? 0;
    const duplicateUlbCount = (existing.duplicateUlbCount as number | undefined) ?? 0;
    const activeDatasetVersion = (existing.activeDatasetVersion as number | undefined) ?? 0;

    const dbValidationSummary: EulbValidationSummary = {
      dbUlbCount,
      maxAllowedExcelRows,
      excelRowCount,
      matchedDbUlbCount,
      missingDbUlbCount,
      extraExcelRowCount,
      duplicateUlbCount,
      errorRowCount,
      validationStatus: storedValidationStatus ?? 'NOT_VALIDATED',
      activeDatasetVersion,
    };

    if (!storedValidationStatus || storedValidationStatus === 'NOT_VALIDATED') {
      throwXviFcValidationErrorWithData(
        {
          electedBodyExcelFile: [
            {
              field: 'electedBodyExcelFile',
              code: 'excelNotValidated',
              message:
                'Excel has not been validated. Please validate or revalidate the uploaded Excel before submitting.',
            },
          ],
        },
        { validationSummary: dbValidationSummary },
      );
    }

    // Extra ULB rows indicate unregistered ULBs — report this specifically before generic checks.
    if (extraExcelRowCount > 0) {
      throwXviFcValidationErrorWithData(
        {
          electedBodyExcelFile: [
            {
              field: 'electedBodyExcelFile',
              code: 'newUlbsAdded',
              message: `${extraExcelRowCount} ULB(s) in the uploaded Excel are not registered in City Finance. Please register them before submitting.`,
            },
          ],
        },
        { validationSummary: dbValidationSummary },
      );
    }

    // Compare stored Excel row count against computed active ULB count (not client-submitted ulbCount).
    if (excelRowCount !== activeUlbCount) {
      throwXviFcValidationErrorWithData(
        {
          electedBodyExcelFile: [
            {
              field: 'electedBodyExcelFile',
              code: 'excelInvalid',
              message: `Excel row count (${excelRowCount}) does not match the number of active ULBs registered in City Finance (${activeUlbCount}).`,
            },
          ],
        },
        { validationSummary: dbValidationSummary },
      );
    }

    if (storedValidationStatus !== 'VALID') {
      throwXviFcValidationErrorWithData(
        {
          electedBodyExcelFile: [
            {
              field: 'electedBodyExcelFile',
              code: 'excelInvalid',
              message:
                'Uploaded Excel has validation errors. Please view uploaded data, fix errors, and revalidate before final submit.',
            },
          ],
        },
        { validationSummary: dbValidationSummary },
      );
    }
    if (errorRowCount > 0) {
      throwXviFcValidationErrorWithData(
        {
          electedBodyExcelFile: [
            {
              field: 'electedBodyExcelFile',
              code: 'excelInvalid',
              message: `${errorRowCount} row(s) have validation errors. Fix all errors before submitting.`,
            },
          ],
        },
        { validationSummary: dbValidationSummary },
      );
    }
    if (missingDbUlbCount > 0) {
      throwXviFcValidationErrorWithData(
        {
          electedBodyExcelFile: [
            {
              field: 'electedBodyExcelFile',
              code: 'excelInvalid',
              message: `${missingDbUlbCount} DB ULB(s) are missing from the Excel file.`,
            },
          ],
        },
        { validationSummary: dbValidationSummary },
      );
    }

    const toStatus = FORM_STATUS.UNDER_REVIEW_BY_PMU;
    const now = new Date();

    const fieldUpdates: Record<string, unknown> = {
      currentFormStatus: toStatus,
      submittedBy: userOid,
      submittedAt: now,
      updatedBy: userOid,
      isDraft: false,
      ulbCount: activeUlbCount,
      checkboxConfirmation: dto.data.checkboxConfirmation,
    };
    // Omit when unchanged (rather than `electedBodyExcelFile: undefined`) so Mongoose's
    // FileInfo `timestamps` option doesn't re-stamp the stored subdocument.
    if (normalizedExcelFile !== undefined) fieldUpdates['electedBodyExcelFile'] = normalizedExcelFile;
    if (normalizedSignedFile !== undefined) fieldUpdates['signedElectedbodyFile'] = normalizedSignedFile;

    // Two collections are written together here (parent + rows), so this needs the same
    // transactional guarantee finalSubmit already has in fc-unspent-declaration.service.ts —
    // a crash between the two writes must never leave the form UNDER_REVIEW_BY_PMU while
    // its rows are still `null`.
    const session = await this.model.db.startSession();
    let updated: EulbFormLeanDoc | null = null;
    try {
      session.startTransaction();

      updated = await this.model
        .findOneAndUpdate({ _id: existing._id }, { $set: fieldUpdates }, { new: true, session })
        .lean<EulbFormLeanDoc>()
        .exec();

      await this.rowModel
        .updateMany(
          { form: existing._id, datasetVersion: activeDatasetVersion, isActive: true },
          { $set: { rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU } },
          { session },
        )
        .exec();

      // Written inside the same transaction (unlike saveDraft's best-effort insert) so a failure
      // here aborts the whole submit instead of leaving no audit trail.
      if (fromStatus !== toStatus) {
        // Snapshot rows now — Excel re-upload hard-deletes the previous version's rows (see
        // docs/adr/0001-dataset-versioning.md), so this is the only surviving record of what was submitted.
        let submittedRowsSnapshot: Record<string, unknown>[] | null = null;
        if (activeDatasetVersion > 0) {
          const activeRows = await this.rowModel
            .find({ form: existing._id, datasetVersion: activeDatasetVersion, isActive: true })
            .session(session)
            .sort({ rowNumber: 1 })
            .select(
              'rowNumber ulbId censusCode ulbName electedBodyStatus dateOfConstitution dateOfExpiry remarks datasetVersion',
            )
            .lean()
            .exec();
          submittedRowsSnapshot = activeRows.map((r) => ({
            rowNumber: r.rowNumber,
            ulbId: r.ulbId,
            censusCode: r.censusCode,
            ulbName: r.ulbName,
            electedBodyStatus: r.electedBodyStatus,
            dateOfConstitution: r.dateOfConstitution,
            dateOfExpiry: r.dateOfExpiry,
            remarks: r.remarks,
            datasetVersion: r.datasetVersion,
          }));
        }

        await this.historyModel.create(
          [
            {
              eulbForm: existing._id,
              state: stateOid,
              year: yearOid,
              action: FormHistoryAction.FINAL_SUBMIT,
              fromStatus,
              toStatus,
              changedBy: userOid,
              ip,
              userAgent,
              snapshot: submittedRowsSnapshot,
            },
          ],
          { session },
        );
      }

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }

    return xviFcSuccess('Elected Urban Local Bodies form submitted successfully.', {
      ...updated,
      currentFormStatusLabel: getFormStatusLabel(toStatus),
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  /** No-op on `fromStatus === toStatus`. Best-effort, non-transactional — a failure here doesn't
   *  fail saveDraft (mirrors sfc-status.service.ts's update-then-log pattern). `finalSubmit` writes
   *  its own entry inside its transaction instead, so a failure there aborts the submit. */
  private async recordFormHistory(entry: {
    formId: Types.ObjectId;
    state: Types.ObjectId;
    year: Types.ObjectId;
    action: FormHistoryAction;
    fromStatus: number;
    toStatus: number;
    changedBy: Types.ObjectId;
    ip?: string;
    userAgent?: string;
  }): Promise<void> {
    if (entry.fromStatus === entry.toStatus) return;
    try {
      await this.historyModel.create({
        eulbForm: entry.formId,
        state: entry.state,
        year: entry.year,
        action: entry.action,
        fromStatus: entry.fromStatus,
        toStatus: entry.toStatus,
        changedBy: entry.changedBy,
        ip: entry.ip,
        userAgent: entry.userAgent,
      });
    } catch (err) {
      this.logger.error('Failed to write Elected Urban Local Bodies form history', err);
    }
  }

  /** Delegates the core merge/file-signing to the shared `FormQuestionHydratorService`, then layers
   *  EULB-specific overrides: `ulbCount` gets the backend-computed active count, and
   *  `electedBodyExcelFile` gets its form-driven supportingContent (actions/badges). */
  private hydrateQuestions(
    questions: FieldConfig[],
    savedData: FormData,
    doc: EulbFormLeanDoc | null,
    permissions: EulbFormPermissions,
    yearId: string,
    computedActiveUlbCount: number,
    folderPathContext?: XviFcFolderPathContext,
  ): HydratedFieldConfig[] {
    const coreHydrated = this.formQuestionHydrator.hydrate(questions, savedData);
    const withFolderPaths = folderPathContext
      ? resolveXviFcFolderPathsInFormJson(coreHydrated, folderPathContext)
      : coreHydrated;

    return withFolderPaths.map((hydrated) => {
      if (hydrated.key === 'ulbCount') {
        return { ...hydrated, value: computedActiveUlbCount };
      }
      if (hydrated.key === 'electedBodyExcelFile') {
        return {
          ...hydrated,
          supportingContent: this.buildElectedBodyFileSupportingContent(doc, permissions, yearId),
        };
      }
      return hydrated;
    });
  }

  /** Action/badge visibility is derived entirely from the current form doc's stored counts/status
   *  — only download-template shows when `doc` is null (no form record yet). */
  private buildElectedBodyFileSupportingContent(
    doc: EulbFormLeanDoc | null,
    permissions: EulbFormPermissions,
    yearId: string,
  ): FieldSupportingContent[] {
    const { canView, canEdit } = permissions;
    const activeDatasetVersion = doc?.activeDatasetVersion ?? 0;
    const excelRowCount = doc?.excelRowCount ?? 0;
    const errorRowCount = doc?.errorRowCount ?? 0;
    const missingDbUlbCount = doc?.missingDbUlbCount ?? 0;
    const extraExcelRowCount = doc?.extraExcelRowCount ?? 0;
    const duplicateUlbCount = doc?.duplicateUlbCount ?? 0;
    const validationStatus = doc?.validationStatus ?? 'NOT_VALIDATED';

    const hasActiveDataset = activeDatasetVersion > 0 && excelRowCount > 0;
    const hasUploadedExcel = !!doc?.electedBodyExcelFile?.path;

    return [
      {
        type: 'actions',
        position: 'before',
        layout: 'inline',
        separator: 'dot',
        description: canEdit
          ? 'Download the template, upload the completed Excel. If errors are found, review the uploaded rows or download the error sheet, make corrections, and revalidate before final submission.'
          : '',
        actions: [
          {
            id: EULB_ACTION_DOWNLOAD_TEMPLATE,
            label: 'Download the template',
            icon: 'bi bi-file-earmark-arrow-down',
            tone: 'primary',
            visible: canEdit,
          },
          {
            id: EULB_ACTION_VIEW_UPLOADED_DATA,
            label: 'Review uploaded data',
            icon: 'bi bi-table',
            tone: errorRowCount > 0 ? 'danger' : 'primary',
            visible: canView && hasActiveDataset,
          },
          {
            id: EULB_ACTION_DOWNLOAD_ERROR_SHEET,
            label: 'Download error sheet',
            icon: 'bi bi-file-earmark-excel',
            tone: 'danger',
            visible: canView && errorRowCount > 0,
          },
          {
            id: EULB_ACTION_REVALIDATE_EXCEL,
            label: 'Revalidate uploaded Excel',
            icon: 'bi bi-arrow-repeat',
            tone: 'primary',
            visible: canEdit && hasUploadedExcel && validationStatus !== 'VALID',
          },
          {
            id: EULB_ACTION_REGISTER_ULB,
            label: 'Register ULB',
            icon: 'bi bi-person-check',
            url: buildEulbRegisterUlbUrl(yearId),
            tone: 'success' as const,
            variant: 'link' as const,
            visible: canEdit && extraExcelRowCount > 0,
          },
        ],
        badges: [
          {
            label: `Total rows: ${excelRowCount}`,
            tone: 'secondary',
            visible: canEdit && hasActiveDataset,
          },
          {
            label: 'All valid',
            icon: 'bi bi-check-circle-fill',
            tone: 'success',
            visible: canEdit && validationStatus === 'VALID',
          },
          {
            label: `${errorRowCount} error(s)`,
            tone: 'danger',
            visible: canEdit && errorRowCount > 0,
          },
          ...buildUlbReconciliationBadges({
            missingCount: missingDbUlbCount,
            newCount: extraExcelRowCount,
            duplicateCount: duplicateUlbCount,
            visible: canEdit,
          }),
        ],
        validationMessage: buildValidationIssuesMessage({
          errorRowCount,
          missingCount: missingDbUlbCount,
          newCount: extraExcelRowCount,
          duplicateCount: duplicateUlbCount,
          visible: canEdit && hasActiveDataset && validationStatus === 'INVALID',
        }),
      },
    ];
  }

  private buildValidationSummary(doc: EulbFormLeanDoc | null): EulbValidationSummary {
    return {
      dbUlbCount: doc?.dbUlbCount ?? 0,
      maxAllowedExcelRows: doc?.maxAllowedExcelRows ?? 0,
      excelRowCount: doc?.excelRowCount ?? 0,
      matchedDbUlbCount: doc?.matchedDbUlbCount ?? 0,
      missingDbUlbCount: doc?.missingDbUlbCount ?? 0,
      extraExcelRowCount: doc?.extraExcelRowCount ?? 0,
      duplicateUlbCount: doc?.duplicateUlbCount ?? 0,
      errorRowCount: doc?.errorRowCount ?? 0,
      validationStatus: doc?.validationStatus ?? 'NOT_VALIDATED',
      activeDatasetVersion: doc?.activeDatasetVersion ?? 0,
    };
  }

  /** Returns an empty array when rowCount is 0, so generateExcel skips validation application. */
  private buildTemplateValidations(rowEditFields: FieldConfig[], rowCount: number): ExcelColumnValidation[] {
    if (rowCount === 0) return [];

    const statusField = rowEditFields.find((f) => f.key === 'electedBodyStatus')!;
    const constitutionField = rowEditFields.find((f) => f.key === 'dateOfConstitution')!;
    const expiryField = rowEditFields.find((f) => f.key === 'dateOfExpiry')!;
    const remarksField = rowEditFields.find((f) => f.key === 'remarks')!;

    const statusOptions = (statusField.options as FormFieldOption[]).map((o) => o.label).join(',');

    const constitutionMinVal = constitutionField.validations?.find((v) => v.name === 'minDate')?.validator as string;
    const constitutionMaxVal = constitutionField.maxDate!;

    const expiryMinVal = expiryField.minDate!;
    const expiryMaxVal = expiryField.validations?.find((v) => v.name === 'maxDate')?.validator as string;
    // See CLAUDE.md's "dateOfExpiry's maxDate" section for why this one bound needs a per-row
    // formula instead of a shared constant like the other three.
    const expiryMaxRelative = parseFieldRelativeBoundary(expiryMaxVal);

    const maxLength = remarksField.validations?.find((v) => v.name === 'maxlength')?.validator as number;

    const constitutionMin = toExcelDateExpr(constitutionMinVal);
    const constitutionMax = toExcelDateExpr(constitutionMaxVal);
    const expiryMin = toExcelDateExpr(expiryMinVal);
    const expiryMax = expiryMaxRelative ? undefined : toExcelDateExpr(expiryMaxVal);

    return [
      {
        key: 'electedBodyStatus',
        mode: 'static',
        validation: {
          type: 'list',
          allowBlank: false,
          formulae: [`"${statusOptions}"`],
          showInputMessage: true,
          promptTitle: 'Elected Body Status',
          prompt: 'Select a value from the dropdown.',
          showErrorMessage: true,
          errorStyle: 'error',
          errorTitle: 'Invalid Status',
          error: 'Select a valid elected body status.',
        },
      },
      {
        key: 'dateOfConstitution',
        mode: 'perRow',
        buildValidation: (row, keyToLetter) => {
          const statusLetter = keyToLetter.get('electedBodyStatus')!;
          const constitutionLetter = keyToLetter.get('dateOfConstitution')!;
          return {
            type: 'custom',
            allowBlank: false,
            formulae: [
              `OR(AND($${statusLetter}${row}<>"Constituted",${constitutionLetter}${row}=""),AND($${statusLetter}${row}="Constituted",ISNUMBER(${constitutionLetter}${row}),${constitutionLetter}${row}>=${constitutionMin},${constitutionLetter}${row}<=${constitutionMax}))`,
            ],
            showInputMessage: true,
            promptTitle: 'Date on which the elected body is in place',
            prompt: `Required when status is Constituted. Must be between ${formatXviFcDate(constitutionMinVal)} and today.`,
            showErrorMessage: true,
            errorStyle: 'error',
            errorTitle: 'Date on which the elected body is in place',
            error: 'Required for Constituted status and must be within the allowed date range.',
          };
        },
      },
      {
        key: 'dateOfExpiry',
        mode: 'perRow',
        buildValidation: (row, keyToLetter) => {
          const statusLetter = keyToLetter.get('electedBodyStatus')!;
          const expiryLetter = keyToLetter.get('dateOfExpiry')!;
          const constitutionLetter = keyToLetter.get('dateOfConstitution')!;
          const upperBoundExpr = expiryMaxRelative
            ? buildRelativeExcelExpr(`${constitutionLetter}${row}`, expiryMaxRelative)
            : expiryMax!;
          const prompt = expiryMaxRelative
            ? `Required when status is Constituted. Must be between today and ${describeRelativeOffset(expiryMaxRelative, constitutionField.label)}`
            : `Required when status is Constituted. Must be between today and ${formatXviFcDate(expiryMaxVal)}.`;
          return {
            type: 'custom',
            allowBlank: false,
            formulae: [
              `OR(AND($${statusLetter}${row}<>"Constituted",${expiryLetter}${row}=""),AND($${statusLetter}${row}="Constituted",ISNUMBER(${expiryLetter}${row}),${expiryLetter}${row}>=${expiryMin},${expiryLetter}${row}<=${upperBoundExpr}))`,
            ],
            showInputMessage: true,
            promptTitle: 'Date of Expiry',
            prompt,
            showErrorMessage: true,
            errorStyle: 'error',
            errorTitle: 'Date of Expiry',
            error: 'Required for Constituted status and must be within the allowed date range.',
          };
        },
      },
      {
        key: 'remarks',
        mode: 'static',
        validation: {
          type: 'textLength',
          operator: 'lessThanOrEqual',
          allowBlank: true,
          formulae: [maxLength],
          showInputMessage: true,
          promptTitle: 'Remarks',
          prompt: `Maximum ${maxLength} characters.`,
          showErrorMessage: true,
          errorStyle: 'error',
          errorTitle: 'Remarks Too Long',
          error: 'Remarks cannot exceed the configured maximum length.',
        },
      },
    ];
  }

  private buildDumpRow(row: EulbDumpRowRecord, form: EulbDumpFormRecord): EulbDumpRow {
    return {
      rowNumber: row.rowNumber,
      censusCode: row.censusCode ?? '',
      ulbName: row.ulbName,
      electedBodyStatus: row.electedBodyStatus ?? '',
      dateOfConstitution: dateToDumpValue(row.dateOfConstitution),
      dateOfExpiry: dateToDumpValue(row.dateOfExpiry),
      remarks: row.remarks ?? '',
      validationStatus: row.validationStatus,
      latestDataSource: row.lastUpdatedSource,
      datasetVersion: row.datasetVersion,
      submittedBy: form.submittedBy?.name ?? '',
      submittedAt: datetimeToDumpValue(form.submittedAt),
      createdBy: row.createdBy?.name ?? '',
      updatedBy: row.updatedBy?.name ?? '',
      createdAt: datetimeToDumpValue(row.createdAt),
      updatedAt: datetimeToDumpValue(row.updatedAt),
    };
  }
}
