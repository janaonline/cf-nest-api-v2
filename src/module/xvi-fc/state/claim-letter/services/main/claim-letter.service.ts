import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
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
import type { FieldConfig, FieldSupportingContent } from 'src/module/xvi-fc/common/types/field-config.type';
import { YearIdToLabel } from 'src/core/constants/years';
import { resolvePriorFcCycleLabel } from 'src/module/xvi-fc/state/fc-unspent-declaration/helpers/fc-unspent-declaration-cycle.helpers';
import { interpolateTemplateTokens } from 'src/module/xvi-fc/common/utils/template-tokens.util';
import {
  ClaimLetterBatch,
  ClaimLetterBatchDocument,
  ClaimLetterBatchNumber,
} from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import { State, StateDocument } from 'src/schemas/state.schema';
import {
  CLAIM_LETTER_ABANDONED_MESSAGE,
  CLAIM_LETTER_ACTION_PREVIEW_TEMPLATE,
  CLAIM_LETTER_MAX_BATCH_NUMBER,
  CLAIM_LETTER_PAGINATION_DEFAULT_LIMIT,
  CLAIM_LETTER_PAGINATION_DEFAULT_PAGE,
  CLAIM_LETTER_SIGNED_FILE_MAX_SIZE_KB,
} from '../../constants/claim-letter.constants';
import { assertInstallmentSupported } from '../../helpers/claim-letter-installment.helpers';
import { mapClaimLetterBatchDocToSummary } from '../../helpers/claim-letter-summary.helpers';
import type { ClaimLetterPermissions } from '../../helpers/claim-letter-permissions.helpers';
import { ClaimLetterEligibilityService } from '../eligibility/claim-letter-eligibility.service';
import { ClaimLetterFormJsonService } from '../form-json/claim-letter-form-json.service';
import { ClaimLetterLetterDetailsService } from '../letter-details/claim-letter-letter-details.service';
import { ClaimLetterActiveBatchService } from '../active-batch/claim-letter-active-batch.service';
import type { GetClaimLetterHistoryQueryDto } from '../../dto/get-claim-letter-history-query.dto';
import type {
  ClaimLetterBatchSummary,
  ClaimLetterClaimContext,
  ClaimLetterEligibilitySummary,
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
    private readonly activeBatchService: ClaimLetterActiveBatchService,
    @InjectModel(ClaimLetterBatch.name)
    private readonly batchModel: Model<ClaimLetterBatchDocument>,
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
      activeBatch,
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
      this.activeBatchService.resolveActiveBatch({ state: stateId, year: yearId, installment }),
    ]);

    const expectedUlbIds = expectedUlbs.map((u) => u.ulbId);
    const { batchSlotsUsed, nextBatchNumber } = batchSlotInfo;

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
      batchSlotsMax: CLAIM_LETTER_MAX_BATCH_NUMBER,
      nextBatchNumber,
      financialOverview,
      ulbLevelCriteria: ulbLevelEligibility.standaloneCriteria,
      ulbReadiness,
      remainingUlbCount: remainingUlbIds.length,
      activeBatchNumber: activeBatch?.batchNumber ?? null,
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

    const [expectedUlbs, batchSlotInfo, financialOverview, varianceConfig, stateName, activeBatch] = await Promise.all([
      this.expectedUlbSetService.resolve(stateId, yearId),
      this.resolveBatchSlotInfo(stateId, yearId, installment),
      this.eligibilityService.getFinancialOverview(stateId, yearId, installment as 1 | 2),
      this.formJsonConfigService.loadVarianceConfig(yearId),
      this.resolveStateName(stateId),
      this.activeBatchService.resolveActiveBatch({ state: stateId, year: yearId, installment }),
    ]);

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
      batchSlotsMax: CLAIM_LETTER_MAX_BATCH_NUMBER,
      nextBatchNumber: batchSlotInfo.nextBatchNumber,
      financialOverview,
      remainingUlbCount: remainingUlbIds.length,
      varianceLowerPercent: varianceConfig.lowerPercent,
      varianceUpperPercent: varianceConfig.upperPercent,
      canCreate: !activeBatch && getEffectivePermissions(user).includes(Permission.PREPARE_GRANT_LETTERS),
      createBlockedReason: activeBatch ? this.activeBatchService.blockedReason(activeBatch.batchNumber) : null,
    };

    return xviFcSuccess('Claim letter context fetched.', context);
  }

  private async resolveBatchSlotInfo(
    stateId: string,
    yearId: string,
    installment: number,
  ): Promise<{ batchSlotsUsed: number; nextBatchNumber: ClaimLetterBatchNumber | null }> {
    const usedBatches = await this.batchModel
      .find({
        state: new Types.ObjectId(stateId),
        year: new Types.ObjectId(yearId),
        installment,
        isAbandoned: false,
      })
      .select('batchNumber')
      .lean<{ batchNumber: 1 | 2 | 3 }[]>()
      .exec();

    const usedBatchNumbers = new Set(usedBatches.map((b) => b.batchNumber));
    const nextBatchNumber = ([1, 2, 3] as const).find((n) => !usedBatchNumbers.has(n)) ?? null;
    return { batchSlotsUsed: usedBatchNumbers.size, nextBatchNumber };
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

    const updated = await this.batchModel
      .findOneAndUpdate(
        { _id: claimLetterId, currentFormStatus: FORM_STATUS.IN_PROGRESS, isAbandoned: false },
        { $set: { signedClaimFile: file, updatedBy: new Types.ObjectId(user._id) } },
        { new: true },
      )
      .lean<LeanClaimLetterBatch | null>()
      .exec();
    if (!updated) throw new ConflictException('Claim letter status changed. Please retry.');

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
    const [formConfig, stateName, blockedBy, exemptionUnderReviewUlbCount, stateExemptionsUnderReview, sfcExempted] =
      await Promise.all([
        this.formJsonConfigService.loadFormConfig(toObjectIdString(doc['year']) ?? ''),
        this.resolveStateName(toObjectIdString(doc['state']) ?? ''),
        this.activeBatchService.resolveBlockingBatchNumber({
          _id: doc['_id'] as Types.ObjectId,
          state: doc['state'] as Types.ObjectId,
          year: doc['year'] as Types.ObjectId,
          installment: doc['installment'] as number,
          currentFormStatus: doc['currentFormStatus'] as number,
          isAbandoned: doc['isAbandoned'] === true,
        }),
        isDraft
          ? this.eligibilityService.countBatchUlbsWithExemptionUnderReview(
              doc['_id'] as Types.ObjectId,
              stateId,
              yearId,
              installment,
            )
          : Promise.resolve(0),
        isDraft ? this.resolveStateExemptionsUnderReview(stateId, yearId, installment) : Promise.resolve([]),
        this.letterDetailsService.isSfcExempted({
          state: doc['state'] as Types.ObjectId,
          year: doc['year'] as Types.ObjectId,
        }),
      ]);
    summary.exemptionUnderReviewUlbCount = exemptionUnderReviewUlbCount;
    summary.stateExemptionsUnderReview = stateExemptionsUnderReview;
    summary.blockedByBatchNumber = blockedBy;
    summary.blockedReason = blockedBy === null ? null : this.activeBatchService.blockedReason(blockedBy);
    if (blockedBy !== null) {
      summary.permissions = { ...summary.permissions, canFinalSubmit: false };
      // The final-PDF endpoints refuse a blocked draft (ADR 0004).
      if (summary.finalClaimLetterStage === 'DRAFT') summary.finalClaimLetterStage = null;
    }
    // Letter-detail questions are served by GET :claimLetterId/letter-details.
    const letterKeys = new Set(formConfig.letterQuestions.map((q) => q.key));
    summary.questions = formConfig.questions.filter((q) => !letterKeys.has(q.key));
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

  /** State forms whose Entire State exemption request is still under MoHUA review (Submit warning). */
  private async resolveStateExemptionsUnderReview(
    stateId: string,
    yearId: string,
    installment: 1 | 2,
  ): Promise<string[]> {
    const gate = await this.eligibilityService.evaluateStateLevelGateForDisplay(stateId, yearId, installment);
    return gate.sources
      .filter((s) => s.exemptionStatus === FORM_STATUS.UNDER_REVIEW_BY_MOHUA)
      .map((s) => s.displayLabel ?? s.formType);
  }

  private async resolveStateName(stateId: string): Promise<string> {
    if (!stateId) return '';
    const stateDoc = await this.stateModel.findById(stateId).select('name').lean<{ name: string } | null>().exec();
    return stateDoc?.name ?? '';
  }

  /** The "Letter details & Preview" action on signedClaimFile: shown while editable with ULBs; a
   *  blocked batch shows the block reason instead. */
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

    const page = query.page ?? CLAIM_LETTER_PAGINATION_DEFAULT_PAGE;
    const limit = query.limit ?? CLAIM_LETTER_PAGINATION_DEFAULT_LIMIT;

    const [docs, total] = await Promise.all([
      this.batchModel
        .find(filter)
        .sort({ batchNumber: 1, version: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean<LeanClaimLetterBatch[]>()
        .exec(),
      this.batchModel.countDocuments(filter).exec(),
    ]);

    // One active-batch lookup per installment on the page (at most two), in parallel.
    const installments = [...new Set(docs.map((d) => d['installment'] as number))];
    const actives = await Promise.all(
      installments.map((installment) =>
        this.activeBatchService.resolveActiveBatch({ state: stateId, year: yearId, installment }),
      ),
    );
    const activeByInstallment = new Map(installments.map((inst, i) => [inst, actives[i]]));

    return xviFcSuccess(
      'Claim letters fetched.',
      docs.map((d) => {
        const summary = mapClaimLetterBatchDocToSummary(d, user);
        const blockedBy = this.activeBatchService.blockingBatchNumberFor(
          {
            _id: d['_id'],
            currentFormStatus: d['currentFormStatus'] as number,
            isAbandoned: d['isAbandoned'] as boolean,
          },
          activeByInstallment.get(d['installment'] as number) ?? null,
        );
        summary.blockedByBatchNumber = blockedBy;
        summary.blockedReason = blockedBy === null ? null : this.activeBatchService.blockedReason(blockedBy);
        if (blockedBy !== null && summary.finalClaimLetterStage === 'DRAFT') summary.finalClaimLetterStage = null;
        return summary;
      }),
      { page, limit, total },
    );
  }
}
