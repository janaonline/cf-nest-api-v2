import { randomUUID } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model, Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { toObjectIdString } from 'src/common/utils/objectid.util';
import { FORM_STATUS, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import { xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { XviFcFileRefDto } from 'src/module/xvi-fc/common/dto/xvi-fc-file-ref.dto';
import { FileInfoNormalizerService } from 'src/module/xvi-fc/common/services/file-info-normalizer.service';
import { ExpectedUlbSetService } from 'src/module/xvi-fc/common/services/expected-ulb-set.service';
import type { FieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';
import {
  ClaimLetterBatch,
  ClaimLetterBatchDocument,
  ClaimLetterBatchNumber,
} from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import {
  CLAIM_LETTER_EDIT_LOCK_LEASE_MINUTES,
  CLAIM_LETTER_FORM_ID,
  CLAIM_LETTER_MAX_BATCH_NUMBER,
  CLAIM_LETTER_PAGINATION_DEFAULT_LIMIT,
  CLAIM_LETTER_PAGINATION_DEFAULT_PAGE,
  CLAIM_LETTER_SIGNED_FILE_MAX_SIZE_KB,
} from '../../constants/claim-letter.constants';
import { assertInstallmentSupported } from '../../helpers/claim-letter-installment.helpers';
import { mapClaimLetterBatchDocToSummary } from '../../helpers/claim-letter-summary.helpers';
import { ClaimLetterEligibilityService } from '../eligibility/claim-letter-eligibility.service';
import { ClaimLetterHistoryService } from '../history/claim-letter-history.service';
import type { GetClaimLetterHistoryQueryDto } from '../../dto/get-claim-letter-history-query.dto';
import type {
  ClaimLetterBatchSummary,
  ClaimLetterClaimContext,
  ClaimLetterEligibilitySummary,
} from '../../types/claim-letter.types';
import { FormJsonService } from 'src/master/form-json/form-json.service';

/** Loose shape for .lean() query results — real field-level typing lives on the schema itself. */
type LeanClaimLetterBatch = Record<string, unknown>;

/**
 * Orchestrates the State-facing claim-letter read paths (eligibility summary, single-claim
 * detail, and the "list my claim letters" history view), plus the two parent-only mutations that
 * don't touch locks/children (signed-file upload, submit). Lock/child-touching mutations
 * (create/update/abandon) live in ClaimLetterAssemblyService.
 */
@Injectable()
export class ClaimLetterService {
  private readonly logger = new Logger(ClaimLetterService.name);

  constructor(
    private readonly eligibilityService: ClaimLetterEligibilityService,
    private readonly expectedUlbSetService: ExpectedUlbSetService,
    private readonly historyService: ClaimLetterHistoryService,
    private readonly fileInfoNormalizer: FileInfoNormalizerService,
    private readonly formJsonService: FormJsonService,
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(ClaimLetterBatch.name)
    private readonly batchModel: Model<ClaimLetterBatchDocument>,
  ) {}

  async getEligibilitySummary(
    stateId: string,
    yearId: string,
    installment: number,
    user: AuthUser,
  ): Promise<XviFcApiResponse<ClaimLetterEligibilitySummary>> {
    this.assertStateAccess(user, stateId);
    assertInstallmentSupported(installment);

    // expectedUlbSetService.resolve() runs concurrently with the other independent branches below
    // (only ulbLevelEligibility/remainingUlbIds need its result); each chains off it via .then()
    // instead of the whole request waiting on it first, and reuses the result instead of letting
    // resolveUlbLevelEligibilityForDisplay re-resolve the same full set internally on a cache miss.
    const expectedUlbsPromise = this.expectedUlbSetService.resolve(stateId, yearId);

    const [expectedUlbs, gate, ulbLevelEligibility, batchSlotInfo, financialOverview, remainingUlbIds] =
      await Promise.all([
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
      ]);

    const expectedUlbIds = expectedUlbs.map((u) => u.ulbId);
    const { batchSlotsUsed, nextBatchNumber } = batchSlotInfo;

    // Elected Body / FC Unspent: fold their row-level tally into the same checklist line as the
    // state's own form-submission status, rather than a second, separate entry for one requirement.
    const sourcesWithUlbBreakdown = gate.sources.map((source) => {
      const ulbBreakdown = ulbLevelEligibility.rowTalliesByFormId.get(source.formId);
      return ulbBreakdown ? { ...source, ulbBreakdown } : source;
    });

    const ulbReadiness = {
      eligible: expectedUlbIds.filter((id) => ulbLevelEligibility.perUlbEligible.get(id) ?? true).length,
      total: expectedUlbIds.length,
    };

    const summary: ClaimLetterEligibilitySummary = {
      installment: installment as 1,
      stateLevelGate: { passed: gate.passed, sources: sourcesWithUlbBreakdown },
      expectedUlbCount: expectedUlbs.length,
      batchSlotsUsed,
      batchSlotsMax: CLAIM_LETTER_MAX_BATCH_NUMBER,
      nextBatchNumber,
      financialOverview,
      ulbLevelCriteria: ulbLevelEligibility.standaloneCriteria,
      ulbReadiness,
      remainingUlbCount: remainingUlbIds.length,
    };

    return xviFcSuccess('Claim letter eligibility summary fetched.', summary);
  }

  /**
   * Lean sibling of `getEligibilitySummary` for the create/edit claim-letter page — that page only
   * ever reads `financialOverview`/`nextBatchNumber`/`batchSlotsMax`/`batchSlotsUsed`/
   * `expectedUlbCount`/`remainingUlbCount` (never `stateLevelGate`/`ulbLevelCriteria`/
   * `ulbReadiness`), so this skips `evaluateStateLevelGate`/`resolveUlbLevelEligibility` entirely
   * rather than computing and discarding them on every create/edit page load.
   */
  async getClaimContext(
    stateId: string,
    yearId: string,
    installment: number,
    user: AuthUser,
  ): Promise<XviFcApiResponse<ClaimLetterClaimContext>> {
    this.assertStateAccess(user, stateId);
    assertInstallmentSupported(installment);

    const [expectedUlbs, batchSlotInfo, financialOverview] = await Promise.all([
      this.expectedUlbSetService.resolve(stateId, yearId),
      this.resolveBatchSlotInfo(stateId, yearId, installment),
      this.eligibilityService.getFinancialOverview(stateId, yearId, installment as 1 | 2),
    ]);

    const expectedUlbIds = expectedUlbs.map((u) => u.ulbId);
    const remainingUlbIds = await this.eligibilityService.resolveRemainingUlbIds(
      stateId,
      yearId,
      installment,
      expectedUlbIds,
    );

    const context: ClaimLetterClaimContext = {
      expectedUlbCount: expectedUlbs.length,
      batchSlotsUsed: batchSlotInfo.batchSlotsUsed,
      batchSlotsMax: CLAIM_LETTER_MAX_BATCH_NUMBER,
      nextBatchNumber: batchSlotInfo.nextBatchNumber,
      financialOverview,
      remainingUlbCount: remainingUlbIds.length,
    };

    return xviFcSuccess('Claim letter context fetched.', context);
  }

  /** Shared by `getEligibilitySummary` and `getClaimContext` — how many of this state/year/
   *  installment's 3 batch slots are already used, and which slot a new draft would occupy next. */
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

  /** Persists `signedClaimFile` — writable only while IN_PROGRESS, no history write (not a
   *  workflow transition — docs/adr/0003-workflow-transitions.md). */
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
    this.assertStateAccess(user, toObjectIdString(parent['state']) ?? '');

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
      // Same file re-uploaded — no persistence change (see FileInfoNormalizerService).
      return xviFcSuccess('Signed claim letter file unchanged.', mapClaimLetterBatchDocToSummary(parent));
    }

    const updated = await this.batchModel
      .findOneAndUpdate(
        { _id: claimLetterId, currentFormStatus: FORM_STATUS.IN_PROGRESS },
        { $set: { signedClaimFile: file, updatedBy: new Types.ObjectId(user._id) } },
        { new: true },
      )
      .lean<LeanClaimLetterBatch | null>()
      .exec();
    if (!updated) throw new ConflictException('Claim letter status changed. Please retry.');

    return xviFcSuccess('Signed claim letter uploaded.', mapClaimLetterBatchDocToSummary(updated));
  }

  /**
   * `IN_PROGRESS -> UNDER_REVIEW_BY_MOHUA` — requires a signed file, idempotent on retry (an
   * already-submitted claim returns its current state rather than erroring — see
   * docs/adr/0001-idempotent-retry.md). Recorded as a workflow transition
   * (docs/adr/0003-workflow-transitions.md).
   */
  async submit(
    claimLetterId: string,
    user: AuthUser,
    ip?: string,
    userAgent?: string,
  ): Promise<XviFcApiResponse<ClaimLetterBatchSummary>> {
    const parent = await this.batchModel
      .findOne({ _id: claimLetterId, assemblyStatus: 'READY' })
      .lean<LeanClaimLetterBatch>()
      .exec();
    if (!parent) throw new NotFoundException(`Claim letter ${claimLetterId} not found`);
    this.assertStateAccess(user, toObjectIdString(parent['state']) ?? '');

    if (parent['currentFormStatus'] === FORM_STATUS.UNDER_REVIEW_BY_MOHUA) {
      return xviFcSuccess('Claim letter already submitted to MoHUA.', mapClaimLetterBatchDocToSummary(parent));
    }
    if (parent['currentFormStatus'] !== FORM_STATUS.IN_PROGRESS) {
      throw new ConflictException(
        `Claim letter cannot be submitted when status is ${getFormStatusLabel(parent['currentFormStatus'] as number)}.`,
      );
    }
    if (!parent['signedClaimFile']) {
      throw new BadRequestException('A signed claim letter file must be uploaded before submitting.');
    }

    if (parent['batchNumber'] === CLAIM_LETTER_MAX_BATCH_NUMBER) {
      await this.assertFinalBatchIsComplete(
        toObjectIdString(parent['state']) ?? '',
        toObjectIdString(parent['year']) ?? '',
        parent['installment'] as number,
      );
    }

    const userOid = new Types.ObjectId(user._id);
    const session = await this.connection.startSession();
    let updated: LeanClaimLetterBatch | null = null;
    try {
      session.startTransaction();

      updated = await this.batchModel
        .findOneAndUpdate(
          {
            _id: claimLetterId,
            currentFormStatus: FORM_STATUS.IN_PROGRESS,
            // Self-expiring lease, same as ClaimLetterAssemblyService's updateDraftRaw/abandonDraftRaw
            // — a stale lock (crash mid-update, never cleared) never permanently blocks submit either.
            $or: [{ editLockToken: null }, { editLockAcquiredAt: { $lt: this.editLockStaleBefore() } }],
          },
          {
            $set: {
              currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
              submittedAt: new Date(),
              submittedBy: userOid,
              updatedBy: userOid,
            },
          },
          { new: true, session },
        )
        .lean<LeanClaimLetterBatch | null>()
        .exec();

      if (updated) {
        await this.historyService.recordTransition(
          {
            claimLetter: updated['_id'] as Types.ObjectId,
            state: updated['state'] as Types.ObjectId,
            year: updated['year'] as Types.ObjectId,
            installment: updated['installment'] as 1 | 2,
            batchNumber: updated['batchNumber'] as 1 | 2 | 3,
            version: updated['version'] as number,
            fromStatus: FORM_STATUS.IN_PROGRESS,
            toStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
            actionSource: 'DIRECT_STATE_REVIEW',
            changedBy: userOid,
            requestId: randomUUID(),
            ipAddress: ip ?? null,
            userAgent: userAgent ?? null,
          },
          session,
        );
      }

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }

    if (updated) return xviFcSuccess('Claim letter submitted to MoHUA.', mapClaimLetterBatchDocToSummary(updated));

    // Concurrent status change (or an in-flight `updateDraft`) between our initial read and the
    // guarded update.
    const current = await this.batchModel.findById(claimLetterId).lean<LeanClaimLetterBatch | null>().exec();
    if (current?.['currentFormStatus'] === FORM_STATUS.UNDER_REVIEW_BY_MOHUA) {
      return xviFcSuccess('Claim letter already submitted to MoHUA.', mapClaimLetterBatchDocToSummary(current));
    }
    if (current?.['editLockToken'] && this.isEditLockActive(current['editLockAcquiredAt'])) {
      throw new ConflictException('Claim letter is currently being edited. Please retry in a moment.');
    }
    throw new ConflictException('Claim letter status changed. Please retry.');
  }

  /**
   * Batch `CLAIM_LETTER_MAX_BATCH_NUMBER` is the state's last chance to claim any ULB for this
   * installment — nothing else stops an ULB left out of every batch from being permanently
   * stranded once it submits. Deliberately checked against every expected ULB not yet locked into
   * *any* batch (`resolveRemainingUlbIds`), not just the ones currently eligible: an ineligible ULB
   * could still resolve its eligibility later, and this rejection is what keeps that possibility
   * open by refusing to close out the claim cycle while it's still unresolved.
   */
  private async assertFinalBatchIsComplete(stateId: string, yearId: string, installment: number): Promise<void> {
    const expectedUlbs = await this.expectedUlbSetService.resolve(stateId, yearId);
    const remainingUlbIds = await this.eligibilityService.resolveRemainingUlbIds(
      stateId,
      yearId,
      installment,
      expectedUlbs.map((u) => u.ulbId),
    );
    if (remainingUlbIds.length === 0) return;

    const remainingUlbIdSet = new Set(remainingUlbIds);
    const remainingNames = expectedUlbs.filter((u) => remainingUlbIdSet.has(u.ulbId)).map((u) => u.name);
    const shown = remainingNames.slice(0, 10);
    const suffix = remainingNames.length > shown.length ? ` and ${remainingNames.length - shown.length} more` : '';

    throw new BadRequestException(
      `This is the final claim batch (Batch ${CLAIM_LETTER_MAX_BATCH_NUMBER} of ${CLAIM_LETTER_MAX_BATCH_NUMBER}) — ` +
        `${remainingNames.length} ULB(s) are not yet included in any batch and must be added before this batch can ` +
        `be submitted: ${shown.join(', ')}${suffix}.`,
    );
  }

  async getDetail(claimLetterId: string, user: AuthUser): Promise<XviFcApiResponse<ClaimLetterBatchSummary>> {
    const doc = await this.batchModel
      .findOne({ _id: claimLetterId, assemblyStatus: 'READY' })
      .lean<LeanClaimLetterBatch>()
      .exec();
    if (!doc) throw new NotFoundException(`Claim letter ${claimLetterId} not found`);

    this.assertStateAccess(user, toObjectIdString(doc['state']) ?? '');

    const summary = mapClaimLetterBatchDocToSummary(doc);
    summary.questions = await this.loadQuestions(toObjectIdString(doc['year']) ?? '');
    this.applySignedFileValue(summary.questions, doc['signedClaimFile']);

    return xviFcSuccess('Claim letter fetched.', summary);
  }

  /**
   * `loadQuestions()` always returns the static formjsons *template* — its `value` is the blank
   * shape seeded at formjsons-authoring time, never the actual uploaded file — so the "View" link
   * in the read-only file widget had nothing to point at even after a real upload. Overlays the
   * persisted `signedClaimFile` here, mapped to the canonical `UploadedFileMetadata` shape the
   * frontend's `app-file` component expects.
   */
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

  /**
   * Claim Letter's own `formjsons` field config (today: just `signedClaimFile`) — a UI question
   * source, not to be confused with the `claimEligibility` config living on *other* forms (e.g.
   * Devolution) that this feature reads for eligibility gating. Missing/unseeded is expected before
   * the payload is pushed, so it degrades to an empty list with a logged warning rather than a 500 —
   * the rest of the claim detail must still render.
   */
  private async loadQuestions(designYearId: string): Promise<FieldConfig[]> {
    try {
      const formJson = await this.formJsonService.findActiveByDesignYearAndFormId(designYearId, CLAIM_LETTER_FORM_ID);
      return formJson.data ?? [];
    } catch (err) {
      if (err instanceof NotFoundException) {
        this.logger.warn(
          `Claim Letter formjsons (formId ${CLAIM_LETTER_FORM_ID}) not seeded for year ${designYearId}.`,
        );
        return [];
      }
      throw err;
    }
  }

  async listHistory(
    stateId: string,
    yearId: string,
    query: GetClaimLetterHistoryQueryDto,
    user: AuthUser,
  ): Promise<XviFcApiResponse<ClaimLetterBatchSummary[]>> {
    this.assertStateAccess(user, stateId);

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

    return xviFcSuccess(
      'Claim letters fetched.',
      docs.map((d) => mapClaimLetterBatchDocToSummary(d)),
      { page, limit, total },
    );
  }

  /** Self-expiring lease check for `editLockToken` — mirrors
   *  `ClaimLetterAssemblyService.editLockStaleBefore`/`isEditLockActive` (duplicated rather than
   *  shared, matching this file's existing `hasStateAccess`/`assertStateAccess` precedent). */
  private editLockStaleBefore(): Date {
    return new Date(Date.now() - CLAIM_LETTER_EDIT_LOCK_LEASE_MINUTES * 60_000);
  }

  private isEditLockActive(acquiredAt: unknown): boolean {
    if (!acquiredAt) return false;
    return new Date(acquiredAt as string | Date) >= this.editLockStaleBefore();
  }

  private hasStateAccess(user: AuthUser, stateId: string): boolean {
    if (user.scope === Scope.ADMIN) return true;
    if (user.scope === Scope.STATE) {
      const userStateId = toObjectIdString(user.state);
      return !!userStateId && userStateId === stateId;
    }
    return false;
  }

  private assertStateAccess(user: AuthUser, stateId: string): void {
    if (!this.hasStateAccess(user, stateId)) {
      throw new ForbiddenException(
        user.scope === Scope.STATE ? 'You can only access your own state data' : 'Access denied',
      );
    }
  }
}
