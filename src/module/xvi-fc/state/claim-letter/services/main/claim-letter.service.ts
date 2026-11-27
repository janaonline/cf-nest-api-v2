import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model, Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import { toObjectIdString } from 'src/common/utils/objectid.util';
import { assertStateAccess } from 'src/module/xvi-fc/common/utils/xvi-fc-state-access.util';
import { FORM_STATUS, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import { xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { XviFcFileRefDto } from 'src/module/xvi-fc/common/dto/xvi-fc-file-ref.dto';
import { FileInfoNormalizerService } from 'src/module/xvi-fc/common/services/file-info-normalizer.service';
import { ExpectedUlbSetService } from 'src/module/xvi-fc/common/services/expected-ulb-set.service';
import { PmuUndoEligibilityService } from 'src/module/xvi-fc/common/services/pmu-undo-eligibility.service';
import type { FieldConfig, FieldSupportingContent } from 'src/module/xvi-fc/common/types/field-config.type';
import { YearIdToLabel } from 'src/core/constants/years';
import { resolvePriorFcCycleLabel } from 'src/module/xvi-fc/state/fc-unspent-declaration/helpers/fc-unspent-declaration-cycle.helpers';
import { interpolateTemplateTokens } from 'src/module/xvi-fc/common/utils/template-tokens.util';
import {
  ClaimLetterBatch,
  ClaimLetterBatchDocument,
  ClaimLetterBatchNumber,
  type ClaimLetterStateFormReturn,
} from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import {
  ClaimLetterBatchUlb,
  ClaimLetterBatchUlbDocument,
} from 'src/schemas/xvi-fc/state/claim-letter-batch-ulb.schema';
import { State, StateDocument } from 'src/schemas/state.schema';
import {
  CLAIM_LETTER_ABANDONED_MESSAGE,
  CLAIM_LETTER_ACTION_PREVIEW_TEMPLATE,
  CLAIM_LETTER_PAGINATION_DEFAULT_LIMIT,
  CLAIM_LETTER_PAGINATION_DEFAULT_PAGE,
  CLAIM_LETTER_SIGNED_FILE_MAX_SIZE_KB,
} from '../../constants/claim-letter.constants';
import { assertInstallmentSupported } from '../../helpers/claim-letter-installment.helpers';
import { mapClaimLetterBatchDocToSummary } from '../../helpers/claim-letter-summary.helpers';
import { historySort, historyStatusCondition } from '../../helpers/claim-letter-history.helpers';
import { toClaimLetterBusyConflict } from '../../helpers/claim-letter-concurrency.helpers';
import { ClaimLetterFormStatusService } from '../form-status/claim-letter-form-status.service';
import { ClaimLetterHistoryService } from '../history/claim-letter-history.service';
import type { ClaimLetterPermissions } from '../../helpers/claim-letter-permissions.helpers';
import { ClaimLetterEligibilityService } from '../eligibility/claim-letter-eligibility.service';
import { ClaimLetterFormJsonService } from '../form-json/claim-letter-form-json.service';
import { ClaimLetterLetterDetailsService } from '../letter-details/claim-letter-letter-details.service';
import {
  allLettersInUseMessage,
  countOpenLetters,
  firstFreeBatchNumber,
  isLastDraft,
  openLettersFilter,
  type OpenLetterStatus,
} from '../../helpers/claim-letter-cap.helpers';
import {
  buildReturnSummary,
  draftStateFormReturnMessage,
  failingStateFormNames,
  isReturnedClaimLetter,
  stateConditionsBlockMessage,
  type ClaimLetterStateFormReturnInfo,
  type ReturnedClaimUlbRow,
} from '../../helpers/claim-letter-returned.helpers';
import type { GetClaimLetterHistoryQueryDto } from '../../dto/get-claim-letter-history-query.dto';
import type {
  ClaimLetterBatchSummary,
  ClaimLetterClaimContext,
  ClaimLetterEligibilitySummary,
  ClaimLetterFinancialSummaryDisplay,
  ClaimLetterReturnSummary,
} from '../../types/claim-letter.types';

type LeanClaimLetterBatch = Record<string, unknown>;

/** State read paths (eligibility summary, claim context, detail, history) and the signed-file upload.
 *  Submit is in ClaimLetterSubmitService; create, edit and abandon in ClaimLetterAssemblyService. */
@Injectable()
export class ClaimLetterService {
  private readonly logger = new Logger(ClaimLetterService.name);

  constructor(
    private readonly eligibilityService: ClaimLetterEligibilityService,
    private readonly expectedUlbSetService: ExpectedUlbSetService,
    private readonly fileInfoNormalizer: FileInfoNormalizerService,
    private readonly formJsonConfigService: ClaimLetterFormJsonService,
    private readonly letterDetailsService: ClaimLetterLetterDetailsService,
    private readonly formStatusService: ClaimLetterFormStatusService,
    private readonly undoEligibility: PmuUndoEligibilityService,
    private readonly historyService: ClaimLetterHistoryService,
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(ClaimLetterBatch.name)
    private readonly batchModel: Model<ClaimLetterBatchDocument>,
    @InjectModel(ClaimLetterBatchUlb.name)
    private readonly batchUlbModel: Model<ClaimLetterBatchUlbDocument>,
    @InjectModel(State.name)
    private readonly stateModel: Model<StateDocument>,
  ) {}

  async getEligibilitySummary(
    stateId: string,
    yearId: string,
    installment: number,
    user: AuthUser,
  ): Promise<XviFcApiResponse<ClaimLetterEligibilitySummary>> {
    assertStateAccess(user, stateId);
    assertInstallmentSupported(installment);
    // Only two branches need the expected ULBs, so they chain off this promise instead of waiting first.
    const expectedUlbsPromise = this.expectedUlbSetService.resolve(stateId, yearId);

    const [
      expectedUlbs,
      gate,
      ulbLevelEligibility,
      batchSlotInfo,
      financialOverview,
      remainingUlbIds,
      stateName,
      formConfig,
    ] = await Promise.all([
      expectedUlbsPromise,
      this.eligibilityService.evaluateStateLevelGateForDisplay(stateId, yearId, installment),
      expectedUlbsPromise.then((ulbs) => {
        const ids = ulbs.map((u) => u.ulbId);
        return this.eligibilityService.resolveUlbLevelEligibilityForDisplay(
          stateId,
          yearId,
          installment as 1 | 2,
          ids,
          ids,
        );
      }),
      this.resolveBatchSlotInfo(stateId, yearId, installment),
      this.eligibilityService.getFinancialOverview(stateId, yearId, installment as 1 | 2),
      expectedUlbsPromise.then((ulbs) =>
        this.eligibilityService.resolveRemainingUlbIds(
          stateId,
          yearId,
          installment,
          ulbs.map((u) => u.ulbId),
        ),
      ),
      this.resolveStateName(stateId),
      this.formJsonConfigService.loadFormConfig(yearId),
    ]);

    const expectedUlbIds = expectedUlbs.map((u) => u.ulbId);
    const { batchSlotsUsed, usedBatchNumbers } = batchSlotInfo;

    const priorFcCycleLabel = resolvePriorFcCycleLabel(YearIdToLabel[yearId] ?? '');
    const tokens = { priorFcCycleLabel };

    // FORM_AND_ROW sources show their ULB tally on their own checklist line; DB copy gets its {{tokens}} filled.
    const sourcesWithUlbBreakdown = gate.sources.map((source) => {
      const ulbBreakdown = ulbLevelEligibility.rowTalliesByFormId.get(source.formId);
      return {
        ...source,
        ...(ulbBreakdown ? { ulbBreakdown } : {}),
        checklistSummary: interpolateTemplateTokens(source.checklistSummary, tokens),
        displayDescription: interpolateTemplateTokens(source.displayDescription, tokens),
      };
    });

    const ulbReadiness = {
      eligible: expectedUlbIds.filter((id) => ulbLevelEligibility.perUlbEligible.get(id) ?? true).length,
      total: expectedUlbIds.length,
    };

    const summary: ClaimLetterEligibilitySummary = {
      stateName,
      installment: installment as 1,
      priorFcCycleLabel,
      stateLevelGate: { passed: gate.passed, sources: sourcesWithUlbBreakdown },
      expectedUlbCount: expectedUlbs.length,
      batchSlotsUsed,
      batchSlotsMax: formConfig.maxClaimLetters,
      nextBatchNumber: firstFreeBatchNumber(usedBatchNumbers, formConfig.maxClaimLetters),
      financialOverview,
      ulbLevelCriteria: ulbLevelEligibility.standaloneCriteria,
      ulbReadiness,
      remainingUlbCount: remainingUlbIds.length,
      claimAmountEditable: formConfig.claimAmountEditable,
    };

    return xviFcSuccess('Claim letter eligibility summary fetched.', summary);
  }

  /** For the create/edit page: skips the gate and ULB-level evaluation that page never shows. */
  async getClaimContext(
    stateId: string,
    yearId: string,
    installment: number,
    user: AuthUser,
  ): Promise<XviFcApiResponse<ClaimLetterClaimContext>> {
    assertStateAccess(user, stateId);
    assertInstallmentSupported(installment);

    const [expectedUlbs, batchSlotInfo, financialOverview, formConfig, stateName] = await Promise.all([
      this.expectedUlbSetService.resolve(stateId, yearId),
      this.resolveBatchSlotInfo(stateId, yearId, installment),
      this.eligibilityService.getFinancialOverview(stateId, yearId, installment as 1 | 2),
      this.formJsonConfigService.loadFormConfig(yearId),
      this.resolveStateName(stateId),
    ]);
    const nextBatchNumber = firstFreeBatchNumber(batchSlotInfo.usedBatchNumbers, formConfig.maxClaimLetters);
    const canPrepare = getEffectivePermissions(user).includes(Permission.PREPARE_GRANT_LETTERS);

    const expectedUlbIds = expectedUlbs.map((u) => u.ulbId);
    const remainingUlbIds = await this.eligibilityService.resolveRemainingUlbIds(
      stateId,
      yearId,
      installment,
      expectedUlbIds,
    );

    const context: ClaimLetterClaimContext = {
      stateName,
      expectedUlbCount: expectedUlbs.length,
      batchSlotsUsed: batchSlotInfo.batchSlotsUsed,
      batchSlotsMax: formConfig.maxClaimLetters,
      openDraftCount: batchSlotInfo.openDraftCount,
      nextBatchNumber,
      financialOverview,
      remainingUlbCount: remainingUlbIds.length,
      claimAmountEditable: formConfig.claimAmountEditable,
      varianceLowerPercent: formConfig.varianceLowerPercent,
      varianceUpperPercent: formConfig.varianceUpperPercent,
      canCreate: nextBatchNumber !== null && canPrepare,
      // Only for someone who could create one, or the UI offers a create action to a viewer.
      createBlockedReason:
        canPrepare && nextBatchNumber === null ? allLettersInUseMessage(formConfig.maxClaimLetters) : null,
    };

    return xviFcSuccess('Claim letter context fetched.', context);
  }

  /** Places held by open letters (not discarded, not returned), as allocateBatchNumber counts them. */
  private async resolveBatchSlotInfo(
    stateId: string,
    yearId: string,
    installment: number,
  ): Promise<{ batchSlotsUsed: number; usedBatchNumbers: Set<ClaimLetterBatchNumber>; openDraftCount: number }> {
    const usedBatches = await this.batchModel
      .find(openLettersFilter({ state: new Types.ObjectId(stateId), year: new Types.ObjectId(yearId), installment }))
      .select('batchNumber currentFormStatus')
      .lean<{ batchNumber: ClaimLetterBatchNumber; currentFormStatus: number }[]>()
      .exec();

    const usedBatchNumbers = new Set(usedBatches.map((b) => b.batchNumber));
    const openDraftCount = usedBatches.filter((b) => b.currentFormStatus === FORM_STATUS.IN_PROGRESS).length;
    return { batchSlotsUsed: usedBatchNumbers.size, usedBatchNumbers, openDraftCount };
  }

  /** Only while IN_PROGRESS; not a workflow transition, so no history row (ADR 0003). */
  async uploadSignedFile(
    claimLetterId: string,
    fileRef: XviFcFileRefDto,
    user: AuthUser,
  ): Promise<XviFcApiResponse<ClaimLetterBatchSummary>> {
    const parent = await this.batchModel
      .findOne({ _id: claimLetterId, assemblyStatus: 'READY' })
      .lean<LeanClaimLetterBatch>()
      .exec();
    if (!parent) throw new NotFoundException(`Claim letter ${claimLetterId} not found`);
    assertStateAccess(user, toObjectIdString(parent['state']) ?? '');

    // Abandon keeps IN_PROGRESS, so the flag is checked on its own.
    if (parent['isAbandoned']) throw new ConflictException(CLAIM_LETTER_ABANDONED_MESSAGE);
    if (parent['currentFormStatus'] !== FORM_STATUS.IN_PROGRESS) {
      throw new ConflictException(
        `Signed file cannot be uploaded when status is ${getFormStatusLabel(parent['currentFormStatus'] as number)}.`,
      );
    }

    const { file, errors } = this.fileInfoNormalizer.normalizeInboundFileInfo(
      fileRef as unknown as Record<string, unknown>,
      parent['signedClaimFile'] as never,
      { allowedExtensions: ['pdf'], maxSizeKb: CLAIM_LETTER_SIGNED_FILE_MAX_SIZE_KB, fieldKey: 'signedClaimFile' },
    );
    if (errors.length > 0) {
      throw new BadRequestException({ message: 'Validation failed.', errors: { signedClaimFile: errors } });
    }

    if (file === undefined) {
      // Same file re-uploaded: nothing to save (FileInfoNormalizerService).
      return xviFcSuccess('Signed claim letter file unchanged.', mapClaimLetterBatchDocToSummary(parent, user));
    }

    // A letter signed while a State form is being corrected would carry the old content (ADR 0009).
    await this.eligibilityService.assertStateConditionsMet(
      toObjectIdString(parent['state']) ?? '',
      toObjectIdString(parent['year']) ?? '',
      parent['installment'] as 1 | 2,
    );

    const notice = parent['stateFormReturnNotice'] as Pick<ClaimLetterStateFormReturn, 'at'> | null | undefined;
    const session = await this.connection.startSession();
    let updated: LeanClaimLetterBatch | null = null;
    try {
      session.startTransaction();

      // Serialized with the SO's approve and return through the per-State guard, as submit is: a State form returned
      // after the gate check above refuses the upload here. The notice pin alone misses a second return, which leaves
      // a "signed letter removed" notice as it was (ADR 0009).
      await this.undoEligibility.touchClaimUndoGuard(
        parent['state'] as Types.ObjectId,
        parent['year'] as Types.ObjectId,
        session,
      );
      await this.formStatusService.assertStateFormsStillReady(parent['_id'] as Types.ObjectId, session);

      updated = await this.batchModel
        .findOneAndUpdate(
          {
            _id: claimLetterId,
            currentFormStatus: FORM_STATUS.IN_PROGRESS,
            isAbandoned: false,
            // Pinned on the notice as read, so a newer notice is never cleared by this upload.
            ...(notice ? { 'stateFormReturnNotice.at': notice.at ?? null } : { stateFormReturnNotice: null }),
          },
          {
            $set: { signedClaimFile: file, stateFormReturnNotice: null, updatedBy: new Types.ObjectId(user._id) },
          },
          { new: true, session },
        )
        .lean<LeanClaimLetterBatch | null>()
        .exec();

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw toClaimLetterBusyConflict(err);
    } finally {
      await session.endSession();
    }
    if (!updated) throw new ConflictException('The claim letter changed while uploading. Reload and try again.');

    return xviFcSuccess('Signed claim letter uploaded.', mapClaimLetterBatchDocToSummary(updated, user));
  }

  async getDetail(claimLetterId: string, user: AuthUser): Promise<XviFcApiResponse<ClaimLetterBatchSummary>> {
    const doc = await this.batchModel
      .findOne({ _id: claimLetterId, assemblyStatus: 'READY' })
      .lean<LeanClaimLetterBatch>()
      .exec();
    if (!doc) throw new NotFoundException(`Claim letter ${claimLetterId} not found`);

    assertStateAccess(user, toObjectIdString(doc['state']) ?? '');

    const summary = mapClaimLetterBatchDocToSummary(doc, user);
    const isDraft = doc['currentFormStatus'] === FORM_STATUS.IN_PROGRESS && doc['isAbandoned'] !== true;
    const stateId = toObjectIdString(doc['state']) ?? '';
    const yearId = toObjectIdString(doc['year']) ?? '';
    const installment = doc['installment'] as 1 | 2;
    // Only a letter the SO returned itself; one returned with another letter's State form has its own note.
    const ownReturn = isReturnedClaimLetter(doc['currentFormStatus'] as number) && !doc['returnedWith'];
    const [formConfig, stateName, exemptionUnderReviewUlbCount, sfcExempted, draftState, returnSummary] =
      await Promise.all([
        this.formJsonConfigService.loadFormConfig(yearId),
        this.resolveStateName(stateId),
        isDraft
          ? this.eligibilityService.countBatchUlbsWithExemptionUnderReview(
              doc['_id'] as Types.ObjectId,
              stateId,
              yearId,
              installment,
            )
          : Promise.resolve(0),
        this.letterDetailsService.isSfcExempted({
          state: doc['state'] as Types.ObjectId,
          year: doc['year'] as Types.ObjectId,
        }),
        isDraft ? this.resolveDraftState(doc, stateId, yearId, installment) : Promise.resolve(null),
        ownReturn ? this.resolveReturnSummary(doc['_id'] as Types.ObjectId) : Promise.resolve(null),
      ]);
    summary.returnSummary = returnSummary;
    summary.exemptionUnderReviewUlbCount = exemptionUnderReviewUlbCount;
    summary.stateExemptionsUnderReview = draftState?.stateExemptionsUnderReview ?? [];
    summary.blockedReason = draftState?.blockedReason ?? null;
    summary.stateFormNotice = draftState?.stateFormNotice ?? null;
    summary.isLastPlace = draftState
      ? isLastDraft(draftState.openLetterCount, draftState.otherDraftCount, formConfig.maxClaimLetters)
      : false;
    // Read with the flag, so a save that adds the left-out ULBs unblocks Submit on the next load (2 reads, last draft only).
    summary.remainingUlbCount = summary.isLastPlace
      ? await this.countRemainingUlbs(stateId, yearId, installment)
      : null;
    if (draftState) summary.financialSummary = { ...summary.financialSummary, ...draftState.liveAmounts };
    if (summary.blockedReason) {
      summary.permissions = { ...summary.permissions, canFinalSubmit: false };
      // Download, signed upload and submit are refused while a State-level condition fails (ADR 0009).
      if (summary.finalClaimLetterStage === 'DRAFT') summary.finalClaimLetterStage = null;
    }
    // Letter-detail questions are served by GET :claimLetterId/letter-details.
    const letterKeys = new Set(formConfig.letterQuestions.map((q) => q.key));
    summary.questions = formConfig.questions.filter((q) => !letterKeys.has(q.key));
    summary.claimAmountEditable = formConfig.claimAmountEditable;
    summary.varianceLowerPercent = formConfig.varianceLowerPercent;
    summary.varianceUpperPercent = formConfig.varianceUpperPercent;
    summary.stateName = stateName;
    summary.letterDetailsComplete = this.letterDetailsService.evaluate(
      (doc['letterDetails'] as Record<string, unknown> | undefined) ?? {},
      formConfig,
      this.letterDetailsService.letterQuestionsFor(formConfig, sfcExempted),
    ).isComplete;
    this.applySignedFileValue(summary.questions, doc['signedClaimFile']);
    this.applySignedFileSupportingContent(summary.questions, doc, summary.permissions, summary.blockedReason);

    return xviFcSuccess('Claim letter fetched.', summary);
  }

  /** What the SO's return reopened (its history row) with each returned ULB's name and remark (2 reads). */
  private async resolveReturnSummary(claimLetter: Types.ObjectId): Promise<ClaimLetterReturnSummary | null> {
    const [rejection, returnedRows] = await Promise.all([
      this.historyService.findLatestRejection(claimLetter),
      this.batchUlbModel
        .find({ claimLetter, 'soDecision.status': 'RETURNED' })
        .select('ulbId ulbSnapshot.name soDecision.remark soDecision.rejectExemptionFormIds')
        .lean<ReturnedClaimUlbRow[]>()
        .exec(),
    ]);
    return rejection ? buildReturnSummary(rejection.rejectedSourceRefs ?? [], returnedRows) : null;
  }

  /**
   * A draft's live context: the State-level gate (one display evaluation for the block, the banner and the Submit
   * warning on State exemptions under review), the open letters for the last-draft rule, and the money figures of
   * the other letters as they are now, not as stored when this draft was last saved (ADR 0009).
   */
  private async resolveDraftState(
    doc: LeanClaimLetterBatch,
    stateId: string,
    yearId: string,
    installment: 1 | 2,
  ): Promise<{
    stateExemptionsUnderReview: string[];
    blockedReason: string | null;
    stateFormNotice: string | null;
    openLetterCount: number;
    otherDraftCount: number;
    liveAmounts: Pick<
      ClaimLetterFinancialSummaryDisplay,
      | 'totalInstallmentAllocation'
      | 'totalAlreadyAcknowledged'
      | 'totalClaimInProgress'
      | 'totalClaimInDraft'
      | 'availableToClaim'
      | 'remainingIfAcknowledged'
    >;
  }> {
    const claimLetterId = String(doc['_id']);
    const [gate, openLetters, overview] = await Promise.all([
      this.eligibilityService.evaluateStateLevelGateForDisplay(stateId, yearId, installment),
      this.batchModel
        .find(openLettersFilter({ state: new Types.ObjectId(stateId), year: new Types.ObjectId(yearId), installment }))
        .select('_id currentFormStatus')
        .lean<OpenLetterStatus[]>()
        .exec(),
      this.eligibilityService.getFinancialOverview(stateId, yearId, installment, claimLetterId),
    ]);
    const { openLetterCount, otherDraftCount } = countOpenLetters(openLetters, claimLetterId);

    const blockedReason = gate.passed ? null : stateConditionsBlockMessage(failingStateFormNames(gate.sources));
    const notice = doc['stateFormReturnNotice'] as
      | (ClaimLetterStateFormReturnInfo & Partial<Pick<ClaimLetterStateFormReturn, 'formIds'>>)
      | null
      | undefined;
    // A removed signed letter stays explained until the next upload; otherwise the banner lasts while the gate fails.
    // One banner says it all: a State form failing beyond the notice's is named after it.
    let stateFormNotice = blockedReason;
    if (notice && (notice.signedFileRemoved || !gate.passed)) {
      // A notice without form ids can't be compared, so nothing is added to it.
      const noticeFormIds = notice.formIds ? new Set(notice.formIds) : null;
      const othersFail =
        !!noticeFormIds && gate.sources.some((s) => s.result === 'FAILED' && !noticeFormIds.has(s.formId));
      stateFormNotice = draftStateFormReturnMessage(notice) + (othersFail && blockedReason ? ` ${blockedReason}` : '');
    }
    const currentSelectedClaim = (doc['financialSummary'] as ClaimLetterFinancialSummaryDisplay | undefined)
      ?.currentSelectedClaim;

    return {
      stateExemptionsUnderReview: gate.sources
        .filter((s) => s.exemptionStatus === FORM_STATUS.UNDER_REVIEW_BY_MOHUA)
        .map((s) => s.displayLabel ?? s.formType),
      blockedReason,
      stateFormNotice,
      openLetterCount,
      otherDraftCount,
      liveAmounts: {
        ...overview,
        remainingIfAcknowledged: overview.availableToClaim - (currentSelectedClaim ?? 0),
      },
    };
  }

  /** Expected ULBs in no open letter, as the claim context counts them. */
  private async countRemainingUlbs(stateId: string, yearId: string, installment: number): Promise<number> {
    const expectedUlbs = await this.expectedUlbSetService.resolve(stateId, yearId);
    const remaining = await this.eligibilityService.resolveRemainingUlbIds(
      stateId,
      yearId,
      installment,
      expectedUlbs.map((u) => u.ulbId),
    );
    return remaining.length;
  }

  private async resolveStateName(stateId: string): Promise<string> {
    if (!stateId) return '';
    const stateDoc = await this.stateModel.findById(stateId).select('name').lean<{ name: string } | null>().exec();
    return stateDoc?.name ?? '';
  }

  /** The "Letter details & Preview" action on signedClaimFile: shown while editable with ULBs; while a
   *  State-level condition fails it is hidden and the block reason shows instead (ADR 0009). */
  private applySignedFileSupportingContent(
    questions: FieldConfig[],
    doc: LeanClaimLetterBatch,
    permissions: ClaimLetterPermissions,
    blockedReason?: string | null,
  ): void {
    const field = questions.find((q) => q.key === 'signedClaimFile');
    if (!field) return;

    const hasUlbs = ((doc['ulbCount'] as number) ?? 0) > 0;
    const editable = permissions.canEdit && hasUlbs;
    const showActions = editable && !blockedReason;
    const supportingContent: FieldSupportingContent = {
      type: 'actions',
      position: 'before',
      layout: 'inline',
      separator: 'dot',
      description: showActions
        ? 'Fill in the letter details, preview and download the claim letter, then upload the signed copy below.'
        : editable && blockedReason
          ? blockedReason
          : '',
      actions: [
        {
          id: CLAIM_LETTER_ACTION_PREVIEW_TEMPLATE,
          label: 'Letter details & Preview',
          icon: 'bi bi-pencil-square',
          tone: 'primary',
          visible: showActions,
        },
      ],
    };
    field.supportingContent = [supportingContent];
  }

  /** The formjson field's value is the blank seed, so the uploaded file is overlaid for the "View" link. */
  private applySignedFileValue(questions: FieldConfig[], signedFile: unknown): void {
    if (!signedFile || typeof signedFile !== 'object') return;

    const field = questions.find((q) => q.key === 'signedClaimFile');
    if (!field) return;

    const file = signedFile as Record<string, unknown>;
    field.value = {
      originalName: (file['originalName'] as string | undefined) ?? '',
      path: (file['path'] as string | undefined) ?? '',
      mimeType: (file['mimeType'] as string | undefined) ?? '',
      sizeKb: (file['sizeKb'] as number | undefined) ?? null,
      pageCount: (file['pageCount'] as number | null | undefined) ?? null,
    };
  }

  async listHistory(
    stateId: string,
    yearId: string,
    query: GetClaimLetterHistoryQueryDto,
    user: AuthUser,
  ): Promise<XviFcApiResponse<ClaimLetterBatchSummary[]>> {
    assertStateAccess(user, stateId);

    const filter: FilterQuery<ClaimLetterBatchDocument> = {
      state: new Types.ObjectId(stateId),
      year: new Types.ObjectId(yearId),
      assemblyStatus: 'READY',
    };
    if (query.installment !== undefined) filter.installment = query.installment;
    if (query.batchNumber !== undefined) filter.batchNumber = query.batchNumber;
    if (query.status) Object.assign(filter, historyStatusCondition(query.status));

    const page = query.page ?? CLAIM_LETTER_PAGINATION_DEFAULT_PAGE;
    const limit = query.limit ?? CLAIM_LETTER_PAGINATION_DEFAULT_LIMIT;

    const [docs, total] = await Promise.all([
      this.batchModel
        .find(filter)
        // Last modified first unless the State picked a column.
        .sort(historySort(query.sortBy, query.sortOrder))
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<LeanClaimLetterBatch[]>()
        .exec(),
      this.batchModel.countDocuments(filter).exec(),
    ]);

    return xviFcSuccess(
      'Claim letters fetched.',
      docs.map((d) => mapClaimLetterBatchDocToSummary(d, user)),
      { page, limit, total },
    );
  }
}
