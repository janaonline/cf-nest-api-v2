import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FORM_STATUS, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import { YearIdToLabel } from 'src/core/constants/years';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { DynamicFormValidationService } from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.service';
import type { XviFcValidationErrorMap } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { throwXviFcValidationError, xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { ExemptionResolverService } from 'src/module/xvi-fc/common/services/exemption-resolver.service';
import { FormQuestionHydratorService } from 'src/module/xvi-fc/common/services/form-question-hydrator.service';
import type {
  FieldConfig,
  FormFieldOption,
  HydratedFieldConfig,
} from 'src/module/xvi-fc/common/types/field-config.type';
import { assertStateAccess } from 'src/module/xvi-fc/common/utils/xvi-fc-state-access.util';
import { ClaimLetterBatch, ClaimLetterBatchDocument } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import { CLAIM_LETTER_SFC_ATR_DATE_KEY } from '../../constants/claim-letter.constants';
import { buildClaimLetterPermissions, canEditClaimLetter } from '../../helpers/claim-letter-permissions.helpers';
import { resolveSfcExemptionStatus } from '../../helpers/claim-letter-sfc-exemption.helpers';
import type { SaveClaimLetterLetterDetailsDto } from '../../dto/save-claim-letter-letter-details.dto';
import { ClaimLetterFormJsonService, type ClaimLetterFormConfig } from '../form-json/claim-letter-form-json.service';
import { ClaimLetterActiveBatchService } from '../active-batch/claim-letter-active-batch.service';

export const SIGNED_FILE_REMOVAL_NOT_CONFIRMED = 'SIGNED_FILE_REMOVAL_NOT_CONFIRMED';
export const LETTER_DETAILS_CHANGED = 'LETTER_DETAILS_CHANGED';
export const LETTER_DETAILS_INCOMPLETE = 'LETTER_DETAILS_INCOMPLETE';

type LetterValues = Record<string, unknown>;

interface LetterDetailsParent {
  _id: Types.ObjectId;
  state: Types.ObjectId;
  year: Types.ObjectId;
  installment: number;
  currentFormStatus: number;
  isAbandoned: boolean;
  signedClaimFile?: unknown;
  letterDetails?: LetterValues;
  letterDetailsUpdatedAt?: Date | null;
}

export interface ClaimLetterLetterDetailsEvaluation {
  isComplete: boolean;
  /** Labels of the fields that are missing or invalid. */
  missingFields: string[];
}

export interface ClaimLetterLetterDetailsState extends ClaimLetterLetterDetailsEvaluation {
  values: LetterValues;
  hasSignedFile: boolean;
  letterDetailsUpdatedAt: string | null;
}

export interface ClaimLetterLetterDetailsView extends ClaimLetterLetterDetailsState {
  /** In `meta.letterDetailKeys` order. */
  fields: HydratedFieldConfig[];
  canEdit: boolean;
  previous: {
    source: { yearLabel: string; installment: number; batchNumber: number };
    values: LetterValues;
  } | null;
}

export interface ClaimLetterLetterDetailsSaveResult extends ClaimLetterLetterDetailsState {
  signedFileRemoved: boolean;
}

const PARENT_FIELDS =
  'state year installment batchNumber currentFormStatus isAbandoned signedClaimFile letterDetails letterDetailsUpdatedAt';
const NUMERIC_TYPES = new Set(['number', 'amount']);
const OPTION_TYPES = new Set(['radio', 'select']);

/** State-entered letter details; fields and required flags come from formjson 26 (module CLAUDE.md). */
@Injectable()
export class ClaimLetterLetterDetailsService {
  constructor(
    private readonly formJsonConfigService: ClaimLetterFormJsonService,
    private readonly validation: DynamicFormValidationService,
    private readonly hydrator: FormQuestionHydratorService,
    private readonly activeBatchService: ClaimLetterActiveBatchService,
    private readonly exemptionResolver: ExemptionResolverService,
    @InjectModel(ClaimLetterBatch.name) private readonly batchModel: Model<ClaimLetterBatchDocument>,
  ) {}

  async get(claimLetterId: string, user: AuthUser): Promise<XviFcApiResponse<ClaimLetterLetterDetailsView>> {
    const parent = await this.loadParent(claimLetterId, user);
    const [formConfig, previous, blockedBy, sfcExempted] = await Promise.all([
      this.formJsonConfigService.loadFormConfig(String(parent.year)),
      this.findPrevious(parent),
      this.activeBatchService.resolveBlockingBatchNumber(parent),
      this.isSfcExempted(parent),
    ]);
    const saved = parent.letterDetails ?? {};
    const canEdit = buildClaimLetterPermissions(user, parent.currentFormStatus, parent.isAbandoned).canEdit;
    const questions = this.letterQuestionsFor(formConfig, sfcExempted);

    const view: ClaimLetterLetterDetailsView = {
      ...this.toState(parent, saved, formConfig, questions),
      fields: this.hydrator.hydrate(questions, saved),
      canEdit: canEdit && blockedBy === null,
      previous: previous && this.toPrevious(previous, formConfig),
    };
    return xviFcSuccess('Claim letter details fetched.', view);
  }

  async save(
    claimLetterId: string,
    dto: SaveClaimLetterLetterDetailsDto,
    user: AuthUser,
  ): Promise<XviFcApiResponse<ClaimLetterLetterDetailsSaveResult>> {
    const parent = await this.loadParent(claimLetterId, user);
    if (!canEditClaimLetter(parent.currentFormStatus, parent.isAbandoned)) {
      throw new ConflictException(
        `Letter details cannot be edited when status is ${getFormStatusLabel(parent.currentFormStatus)}.`,
      );
    }
    await this.activeBatchService.assertActive(parent);
    const [formConfig, sfcExempted] = await Promise.all([
      this.formJsonConfigService.loadFormConfig(String(parent.year)),
      this.isSfcExempted(parent),
    ]);
    if (!formConfig.letterConfigured) this.throwNotConfigured();
    const questions = this.letterQuestionsFor(formConfig, sfcExempted);

    const questionByKey = new Map(formConfig.letterQuestions.map((q) => [q.key, q]));
    const sentQuestions = Object.keys(dto.data)
      .map((key) => questionByKey.get(key))
      .filter((q): q is FieldConfig => q !== undefined);

    const saved = parent.letterDetails ?? {};
    const merged: LetterValues = { ...saved };
    const errors: XviFcValidationErrorMap = {};
    for (const question of sentQuestions) {
      const normalized = this.normalizeValue(question, dto.data[question.key], errors);
      if (normalized === undefined) delete merged[question.key];
      else merged[question.key] = normalized;
    }
    const draft = this.validation.validateDraftAndBuildPayload(sentQuestions, merged);
    for (const [key, list] of Object.entries(draft.errors)) errors[key] = [...(errors[key] ?? []), ...list];
    if (Object.keys(errors).length > 0) throwXviFcValidationError(errors);

    const changed = sentQuestions.some((q) => saved[q.key] !== merged[q.key]);
    const hasSignedFile = !!parent.signedClaimFile;
    if (!changed) {
      return xviFcSuccess('Claim letter details unchanged.', {
        ...this.toState(parent, saved, formConfig, questions),
        signedFileRemoved: false,
      });
    }
    if (hasSignedFile && !dto.confirmSignedFileRemoval) {
      throw new ConflictException({
        message:
          'Saving these changes will remove the uploaded signed letter. You will need to download, sign and upload it again.',
        code: SIGNED_FILE_REMOVAL_NOT_CONFIRMED,
      });
    }

    const userOid = new Types.ObjectId(user._id);
    const updated = await this.batchModel
      .findOneAndUpdate(
        {
          _id: parent._id,
          assemblyStatus: 'READY',
          currentFormStatus: FORM_STATUS.IN_PROGRESS,
          isAbandoned: false,
          letterDetailsUpdatedAt: parent.letterDetailsUpdatedAt ?? null,
          signedClaimFile: hasSignedFile ? { $ne: null } : null,
        },
        {
          $set: {
            letterDetails: merged,
            letterDetailsUpdatedAt: new Date(),
            letterDetailsUpdatedBy: userOid,
            updatedBy: userOid,
            ...(hasSignedFile && { signedClaimFile: null }),
          },
        },
        { new: true },
      )
      .select(PARENT_FIELDS)
      .lean<LetterDetailsParent | null>()
      .exec();
    if (!updated) await this.throwSaveConflict(claimLetterId);

    return xviFcSuccess('Claim letter details saved.', {
      ...this.toState(updated!, merged, formConfig, questions),
      signedFileRemoved: hasSignedFile,
    });
  }

  /** True while the State's Entire State SFC exemption counts (Row B prints it, no ATR date). */
  isSfcExempted(parent: { state: Types.ObjectId; year: Types.ObjectId }): Promise<boolean> {
    return resolveSfcExemptionStatus(this.exemptionResolver, parent.state, parent.year).then((s) => s !== null);
  }

  /** This State's letter questions: without the ATR date while its SFC exemption counts. */
  letterQuestionsFor(formConfig: ClaimLetterFormConfig, sfcExempted: boolean): FieldConfig[] {
    if (!sfcExempted) return formConfig.letterQuestions;
    return formConfig.letterQuestions.filter((q) => q.key !== CLAIM_LETTER_SFC_ATR_DATE_KEY);
  }

  /** Mandatory fields present and every saved value valid; not configured = incomplete. */
  evaluate(
    saved: LetterValues,
    formConfig: ClaimLetterFormConfig,
    questions: FieldConfig[],
  ): ClaimLetterLetterDetailsEvaluation {
    if (!formConfig.letterConfigured) return { isComplete: false, missingFields: [] };
    const { errors } = this.validation.validateFinalSubmitAndBuildPayload(questions, saved);
    const labelByKey = new Map(questions.map((q) => [q.key, q.label]));
    const keys = Object.keys(errors);
    return { isComplete: keys.length === 0, missingFields: keys.map((key) => labelByKey.get(key) ?? key) };
  }

  /** Download and Submit gate: 400 naming the fields to complete, errors keyed by field. */
  async assertComplete(
    parent: { state: Types.ObjectId; year: Types.ObjectId; letterDetails?: LetterValues },
    action: string,
  ): Promise<void> {
    const [formConfig, sfcExempted] = await Promise.all([
      this.formJsonConfigService.loadFormConfig(String(parent.year)),
      this.isSfcExempted(parent),
    ]);
    if (!formConfig.letterConfigured) this.throwNotConfigured();
    const questions = this.letterQuestionsFor(formConfig, sfcExempted);
    const { errors } = this.validation.validateFinalSubmitAndBuildPayload(questions, parent.letterDetails ?? {});
    const keys = Object.keys(errors);
    if (keys.length === 0) return;
    const labelByKey = new Map(questions.map((q) => [q.key, q.label]));
    throw new BadRequestException({
      message: `Complete the letter details before ${action}: ${keys.map((k) => labelByKey.get(k) ?? k).join(', ')}.`,
      code: LETTER_DETAILS_INCOMPLETE,
      errors,
    });
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private async loadParent(claimLetterId: string, user: AuthUser): Promise<LetterDetailsParent> {
    const parent = await this.batchModel
      .findOne({ _id: claimLetterId, assemblyStatus: 'READY' })
      .select(PARENT_FIELDS)
      .lean<LetterDetailsParent | null>()
      .exec();
    if (!parent) throw new NotFoundException(`Claim letter ${claimLetterId} not found`);
    assertStateAccess(user, String(parent.state));
    return parent;
  }

  private toState(
    parent: LetterDetailsParent,
    values: LetterValues,
    formConfig: ClaimLetterFormConfig,
    questions: FieldConfig[],
  ): ClaimLetterLetterDetailsState {
    return {
      values,
      ...this.evaluate(values, formConfig, questions),
      hasSignedFile: !!parent.signedClaimFile,
      letterDetailsUpdatedAt: parent.letterDetailsUpdatedAt
        ? new Date(parent.letterDetailsUpdatedAt).toISOString()
        : null,
    };
  }

  /** Trimmed value, `undefined` for blank; a wrong type or unknown option is recorded in `errors`. */
  private normalizeValue(question: FieldConfig, raw: unknown, errors: XviFcValidationErrorMap): unknown {
    if (raw === undefined || raw === null || (typeof raw === 'string' && !raw.trim())) return undefined;
    const fail = (code: string, message: string) => {
      errors[question.key] = [{ field: question.key, code, message }];
      return undefined;
    };

    if (NUMERIC_TYPES.has(question.formFieldType)) {
      return typeof raw === 'number' && Number.isFinite(raw) ? raw : fail('type', 'Enter a number.');
    }
    if (typeof raw !== 'string') return fail('type', 'Enter text.');
    const value = raw.trim();

    if (question.formFieldType === 'date') {
      const date = new Date(value);
      return !Number.isNaN(date.getTime()) && date.toISOString() === value
        ? value
        : fail('date', 'Enter a valid date.');
    }
    if (OPTION_TYPES.has(question.formFieldType)) {
      const options: (string | FormFieldOption)[] = question.options ?? [];
      const ids = options.map((o) => (typeof o === 'string' ? o : o.id));
      if (!ids.includes(value)) return fail('option', 'Choose one of the options.');
    }
    return value;
  }

  private async findPrevious(parent: LetterDetailsParent) {
    return this.batchModel
      .findOne({
        state: parent.state,
        _id: { $ne: parent._id },
        isAbandoned: false,
        assemblyStatus: 'READY',
        letterDetailsUpdatedAt: { $ne: null },
      })
      .sort({ letterDetailsUpdatedAt: -1 })
      .select('year installment batchNumber letterDetails')
      .lean<{ year: Types.ObjectId; installment: number; batchNumber: number; letterDetails?: LetterValues } | null>()
      .exec();
  }

  /** Configured keys only, minus the skip-prefill ones (Letter No., Letter date). */
  private toPrevious(
    previous: { year: Types.ObjectId; installment: number; batchNumber: number; letterDetails?: LetterValues },
    formConfig: ClaimLetterFormConfig,
  ): ClaimLetterLetterDetailsView['previous'] {
    const source = previous.letterDetails ?? {};
    const values: LetterValues = {};
    for (const q of formConfig.letterQuestions) {
      if (!formConfig.letterSkipPrefill.has(q.key) && source[q.key] !== undefined) values[q.key] = source[q.key];
    }
    if (Object.keys(values).length === 0) return null;
    return {
      source: {
        yearLabel: YearIdToLabel[String(previous.year)] ?? '',
        installment: previous.installment,
        batchNumber: previous.batchNumber,
      },
      values,
    };
  }

  private async throwSaveConflict(claimLetterId: string): Promise<never> {
    const current = await this.batchModel
      .findById(claimLetterId)
      .select('currentFormStatus isAbandoned')
      .lean<{ currentFormStatus: number; isAbandoned: boolean } | null>()
      .exec();
    if (current && !canEditClaimLetter(current.currentFormStatus, current.isAbandoned)) {
      throw new ConflictException('Claim letter status changed. Please reload.');
    }
    throw new ConflictException({
      message: 'The letter details or signed file were changed elsewhere. Reload and try again.',
      code: LETTER_DETAILS_CHANGED,
    });
  }

  private throwNotConfigured(): never {
    throw new BadRequestException({
      message: 'Letter details are not configured. Please contact the admin.',
      code: LETTER_DETAILS_INCOMPLETE,
    });
  }
}
