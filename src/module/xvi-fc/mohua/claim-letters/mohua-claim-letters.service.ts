import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model, Types } from 'mongoose';
import { FORM_STATUS, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import { assertValidFormStatusTransition } from 'src/common/utils/form-status-transitions';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { CLAIM_LETTER_APPROVED_STATUSES } from 'src/module/xvi-fc/state/claim-letter/constants/claim-letter.constants';
import type { ClaimLetterBatchNumber } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import { ClaimLetterFormStatusService } from 'src/module/xvi-fc/state/claim-letter/services/form-status/claim-letter-form-status.service';
import {
  ClaimLetterHistoryService,
  type ClaimLetterRejection,
} from 'src/module/xvi-fc/state/claim-letter/services/history/claim-letter-history.service';
import { escapeRegex } from 'src/common/utils/regex.util';
import { FileTokenService } from 'src/core/file-token/file-token.service';
import { State } from 'src/schemas/state.schema';
import { Year } from 'src/schemas/year.schema';
import { ClaimLetterBatch } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import { ClaimLetterBatchUlb, ClaimLetterSoDecision } from 'src/schemas/xvi-fc/state/claim-letter-batch-ulb.schema';
import { ClaimLetterUlbLock } from 'src/schemas/xvi-fc/state/claim-letter-ulb-lock.schema';
import { buildDecisionRecord } from 'src/module/xvi-fc/common/utils/xvi-fc-decision.util';
import { XviFcEligibilityExemption } from 'src/schemas/xvi-fc/state/xvi-fc-eligibility-exemption.schema';
import type { ClaimLetterReturnedSource } from 'src/module/xvi-fc/state/claim-letter/services/form-status/claim-letter-form-status.service';
import { RequestExemptionMohuaService } from '../request-exemption/request-exemption-mohua.service';
import { OmUlb } from 'src/schemas/xvi-fc/mohua/om-ulb.schema';
import { copyClaimLetterUlbsToOm } from '../om/om-ulbs.helper';
import type { ReturnMohuaClaimLetterDto } from './mohua-claim-letters-return.dto';
import type { DecideMohuaClaimLetterUlbDto } from './mohua-claim-letters-ulb-decision.dto';
import { GrantAllocation } from 'src/schemas/xvi-fc/grant-allocation.schema';
import { ExpectedUlbSetService } from 'src/module/xvi-fc/common/services/expected-ulb-set.service';
import { ClaimLetterEligibilityService } from 'src/module/xvi-fc/state/claim-letter/services/eligibility/claim-letter-eligibility.service';
import { MOHUA_OVERVIEW_EXCLUDED_STATE_CODES } from '../overview/mohua-overview.constants';
import { allocationRupees } from '../overview/mohua-overview.util';
import {
  MOHUA_CLAIM_LETTERS_FIRST_CLAIM_STATUS,
  MOHUA_CLAIM_LETTERS_INSTALLMENT,
  MOHUA_CLAIM_LETTERS_INSTALLMENTS_PER_YEAR,
  MOHUA_CLAIM_LETTERS_LISTED_STATUSES,
  MOHUA_CLAIM_LETTERS_ULB_STATUS,
  MOHUA_CLAIM_LETTER_RETURNED_STATUSES,
  MOHUA_CLAIM_LETTER_ULB_EXEMPTION_KIND,
  MOHUA_CLAIM_LETTER_ULB_RETURNED_MESSAGE,
  MOHUA_CLAIM_LETTER_ULBS_DEFAULT_LIMIT,
} from './mohua-claim-letters.constants';
import type { GetMohuaClaimLetterUlbsQueryDto } from './mohua-claim-letters-query.dto';
import type {
  MohuaClaimLetterDetail,
  MohuaClaimLetterListItem,
  MohuaClaimLetterReturnDetails,
  MohuaClaimLetterSoDecision,
  MohuaClaimLetterUlbs,
  MohuaClaimLettersStateRow,
  MohuaClaimLettersStates,
  MohuaStateClaimLetters,
  MohuaStateClaimLettersSummary,
} from './mohua-claim-letters.types';

/** The parts of a claim ULB row's eligibility source that say which discretionary exemption it relied on. */
type ExemptionSourceLean = {
  formId: number;
  formDocumentId?: Types.ObjectId | null;
  exemptionId?: Types.ObjectId | null;
  exemptionKind?: string | null;
};

type ChildWithSources = { ulbId: Types.ObjectId; eligibilitySources?: ExemptionSourceLean[] };

/** One ULB's own discretionary exemption the letter relied on, with its live status. */
interface UlbExemption {
  formId: number;
  exemptionId: Types.ObjectId;
  formDocumentId: Types.ObjectId | null;
  status: number;
}

type LeanBatch = {
  _id: Types.ObjectId;
  state: Types.ObjectId;
  year: Types.ObjectId;
  installment: number;
  fileBaseName: string;
  batchNumber: number;
  version: number;
  revision?: number;
  submittedAt?: Date | null;
  ulbCount: number;
  currentFormStatus: number;
  financialSummary?: { currentSelectedClaim?: number };
  signedClaimFile?: { originalName?: string; name?: string; path?: string; sizeKb?: number } | null;
  finalClaimPdf?: { file?: { originalName?: string; name?: string; path?: string; sizeKb?: number } | null } | null;
};

/**
 * Read-only data behind MoHUA's Claims & Submissions screens. Only claim letters that the State submitted are listed,
 * at the statuses in MOHUA_CLAIM_LETTERS_LISTED_STATUSES — never drafts, abandoned batches or superseded versions.
 */
@Injectable()
export class MohuaClaimLettersService {
  constructor(
    @InjectModel(State.name) private readonly stateModel: Model<State>,
    @InjectModel(Year.name) private readonly yearModel: Model<Year>,
    @InjectModel(ClaimLetterBatch.name) private readonly batchModel: Model<ClaimLetterBatch>,
    @InjectModel(ClaimLetterBatchUlb.name) private readonly batchUlbModel: Model<ClaimLetterBatchUlb>,
    @InjectModel(GrantAllocation.name) private readonly grantAllocationModel: Model<GrantAllocation>,
    @InjectModel(ClaimLetterUlbLock.name) private readonly lockModel: Model<ClaimLetterUlbLock>,
    private readonly fileTokenService: FileTokenService,
    private readonly eligibilityService: ClaimLetterEligibilityService,
    private readonly expectedUlbSetService: ExpectedUlbSetService,
    private readonly formStatusService: ClaimLetterFormStatusService,
    private readonly historyService: ClaimLetterHistoryService,
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(XviFcEligibilityExemption.name) private readonly exemptionModel: Model<XviFcEligibilityExemption>,
    private readonly exemptionService: RequestExemptionMohuaService,
    @InjectModel(OmUlb.name) private readonly omUlbModel: Model<OmUlb>,
  ) {}

  /**
   * Every state with whether its first claim letter has arrived, its installment allocation and what it has claimed —
   * states with a letter first, then the rest, each group A to Z.
   */
  async listStates(yearId: string, installment: number): Promise<MohuaClaimLettersStates> {
    this.assertSupportedInstallment(installment);
    const year = await this.yearModel.findById(yearId).select('year').lean<{ year: string }>().exec();
    if (!year) throw new NotFoundException(`Year ${yearId} not found`);

    const [states, batches, allocationByState] = await Promise.all([
      this.stateModel
        .find({
          isActive: true,
          isUT: { $ne: true },
          accessToXVFC: { $ne: false },
          code: { $nin: MOHUA_OVERVIEW_EXCLUDED_STATE_CODES },
        })
        .select('name code')
        .sort({ name: 1 })
        .lean<{ _id: Types.ObjectId; name: string; code: string }[]>()
        .exec(),
      this.batchModel
        .find(this.listedFilter({ year: new Types.ObjectId(yearId), installment }))
        .select('state batchNumber ulbCount currentFormStatus financialSummary.currentSelectedClaim')
        .lean<LeanBatch[]>()
        .exec(),
      this.loadInstallmentAllocations(yearId),
    ]);

    const claimedByState = new Map<string, { amount: number; ulbs: number; count: number; latest: number }>();
    for (const batch of batches) {
      const key = String(batch.state);
      const current = claimedByState.get(key) ?? { amount: 0, ulbs: 0, count: 0, latest: 0 };
      // A returned letter's amount is not claimed (same rule as the State-side claimed totals).
      if (batch.currentFormStatus !== FORM_STATUS.RETURNED_BY_MOHUA && batch.currentFormStatus !== FORM_STATUS.RETURNED_BY_SO) {
        current.amount += batch.financialSummary?.currentSelectedClaim ?? 0;
      }
      current.ulbs += batch.ulbCount ?? 0;
      current.count += 1;
      current.latest = Math.max(current.latest, batch.batchNumber ?? 0);
      claimedByState.set(key, current);
    }

    const rows = states.map((state): MohuaClaimLettersStateRow => {
      const id = String(state._id);
      const claimed = claimedByState.get(id);
      return {
        stateId: id,
        name: state.name,
        code: state.code,
        firstClaimStatus: claimed
          ? MOHUA_CLAIM_LETTERS_FIRST_CLAIM_STATUS.RECEIVED
          : MOHUA_CLAIM_LETTERS_FIRST_CLAIM_STATUS.PENDING,
        installmentAllocation: allocationByState.get(id) ?? null,
        amountClaimed: claimed ? claimed.amount : null,
        ulbsIncluded: claimed ? claimed.ulbs : null,
        claimLetterCount: claimed?.count ?? 0,
        latestClaimNumber: claimed?.latest || null,
      };
    });

    // States whose claim letter has arrived come first; each group keeps the alphabetical order from the query.
    const received = MOHUA_CLAIM_LETTERS_FIRST_CLAIM_STATUS.RECEIVED;
    rows.sort((a, b) => Number(b.firstClaimStatus === received) - Number(a.firstClaimStatus === received));

    return { year: { id: yearId, label: year.year }, installment, states: rows };
  }

  /** One state's listed claim letters, oldest first. */
  async listStateClaimLetters(stateId: string, yearId: string, installment: number): Promise<MohuaStateClaimLetters> {
    this.assertSupportedInstallment(installment);
    const state = await this.stateModel.findById(stateId).select('name').lean<{ name: string }>().exec();
    if (!state) throw new NotFoundException(`State ${stateId} not found`);

    const batches = await this.batchModel
      .find(this.listedFilter({ state: new Types.ObjectId(stateId), year: new Types.ObjectId(yearId), installment }))
      .select('fileBaseName batchNumber submittedAt ulbCount currentFormStatus financialSummary.currentSelectedClaim')
      .sort({ batchNumber: 1, submittedAt: 1 })
      .lean<LeanBatch[]>()
      .exec();

    return {
      state: { id: stateId, name: state.name },
      installment,
      summary: await this.buildSummary(stateId, yearId, installment, batches),
      claimLetters: batches.map(
        (batch): MohuaClaimLetterListItem => ({
          id: String(batch._id),
          number: batch.fileBaseName,
          batchNumber: batch.batchNumber,
          receivedOn: batch.submittedAt ? new Date(batch.submittedAt).toISOString() : null,
          ulbCount: batch.ulbCount ?? 0,
          amount: batch.financialSummary?.currentSelectedClaim ?? 0,
          status: batch.currentFormStatus,
          statusLabel: getFormStatusLabel(batch.currentFormStatus),
        }),
      ),
    };
  }

  /**
   * The band under a state's letters. Claimed/balance amounts and the pending-ULB count reuse the State-side claim
   * figures (status buckets and ULB locks), with the allocation the states table shows; ULB counts per status come
   * from the letters themselves.
   */
  private async buildSummary(
    stateId: string,
    yearId: string,
    installment: number,
    batches: LeanBatch[],
  ): Promise<MohuaStateClaimLettersSummary> {
    const [allocationByState, expectedUlbs] = await Promise.all([
      this.loadInstallmentAllocations(yearId),
      this.expectedUlbSetService.resolve(stateId, yearId),
    ]);
    const allocation = allocationByState.get(stateId) ?? 0;
    const [breakdown, remainingUlbIds] = await Promise.all([
      this.eligibilityService.getClaimStatusBreakdown(stateId, yearId, installment, allocation),
      this.eligibilityService.resolveRemainingUlbIds(
        stateId,
        yearId,
        installment,
        expectedUlbs.map((ulb) => ulb.ulbId),
      ),
    ]);

    const ulbsAt = (status: number) =>
      batches.filter((b) => b.currentFormStatus === status).reduce((sum, b) => sum + (b.ulbCount ?? 0), 0);
    const amountClaimed = breakdown.totalAlreadyAcknowledged + breakdown.totalClaimInProgress;

    return {
      claimedUlbs: expectedUlbs.length - remainingUlbIds.length,
      pendingUlbs: remainingUlbIds.length,
      approvedUlbs: CLAIM_LETTER_APPROVED_STATUSES.reduce((sum, status) => sum + ulbsAt(status), 0),
      underReviewUlbs: ulbsAt(FORM_STATUS.UNDER_REVIEW_BY_SO) + ulbsAt(FORM_STATUS.UNDER_REVIEW_BY_MOHUA),
      returnedUlbs: ulbsAt(FORM_STATUS.RETURNED_BY_SO) + ulbsAt(FORM_STATUS.RETURNED_BY_MOHUA),
      amountClaimed,
      balance: Math.max(0, allocation - amountClaimed),
    };
  }

  /**
   * The SO approves a claim letter under SO review: it moves to UNDER_REVIEW_BY_MOHUA (5) and the transition is
   * logged, in one transaction. The update filter pins the status and the revision the page showed, so a letter that
   * changed (or was decided) in the meantime is refused, never approved blind. A letter already past this step is a
   * no-op.
   * The letter's State and ULB forms (and rows) move from their waiting status (15 / 8) to 5 in the same
   * transaction. The ULB locks are acknowledged by MoHUA's final approval (phase 4).
   */
  async approve(
    claimLetterId: string,
    expectedRevision: number,
    remark: string | undefined,
    user: AuthUser,
    ip?: string,
    userAgent?: string,
  ): Promise<MohuaClaimLetterDetail> {
    const claimLetterOid = new Types.ObjectId(claimLetterId);
    const batch = await this.batchModel
      .findOne(this.listedFilter({ _id: claimLetterOid }))
      .select('state year installment batchNumber version currentFormStatus')
      .lean<LeanBatch>()
      .exec();
    if (!batch) throw new NotFoundException(`Claim letter ${claimLetterId} not found`);

    if (
      batch.currentFormStatus === FORM_STATUS.UNDER_REVIEW_BY_MOHUA ||
      CLAIM_LETTER_APPROVED_STATUSES.includes(batch.currentFormStatus)
    ) {
      return this.getClaimLetter(claimLetterId);
    }
    if (batch.currentFormStatus !== FORM_STATUS.UNDER_REVIEW_BY_SO) {
      throw new ConflictException(
        `Only a claim letter under SO review can be approved; this one is ${getFormStatusLabel(batch.currentFormStatus)}.`,
      );
    }
    if (await this.batchUlbModel.exists({ claimLetter: claimLetterOid, 'soDecision.status': 'RETURNED' })) {
      throw new ConflictException(MOHUA_CLAIM_LETTER_ULB_RETURNED_MESSAGE);
    }
    assertValidFormStatusTransition(FORM_STATUS.UNDER_REVIEW_BY_SO, FORM_STATUS.UNDER_REVIEW_BY_MOHUA);

    // Unmarked ULBs count as fine, so the exemptions they relied on that MoHUA has not decided are approved with the
    // letter (ADR 0005 left that decision to this review). Each is its own transaction in the exemption service, so
    // they run first: one failing (e.g. its form moved on) leaves the letter undecided, and a retry skips the ones
    // already approved.
    for (const exemption of await this.findPendingExemptions(claimLetterOid)) {
      await this.exemptionService.approve(String(exemption.exemptionId), exemption.formId, user, ip ?? '', userAgent ?? '');
    }

    const userOid = new Types.ObjectId(user._id);
    const trimmedRemark = remark?.trim() || null;
    const session = await this.connection.startSession();
    try {
      session.startTransaction();

      const updated = await this.batchModel
        .findOneAndUpdate(
          {
            _id: claimLetterOid,
            currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_SO,
            revision: expectedRevision,
            isAbandoned: false,
          },
          {
            $set: {
              currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
              mohuaRemarks: trimmedRemark,
              updatedBy: userOid,
            },
            $inc: { revision: 1 },
          },
          { new: true, session },
        )
        .select('_id')
        .lean<{ _id: Types.ObjectId }>()
        .exec();
      if (!updated) {
        throw new ConflictException(
          'The claim letter changed or was already decided while you were reviewing it. Please reload and try again.',
        );
      }

      await this.formStatusService.moveFormsToMohuaReview(claimLetterOid, userOid, session);
      await this.historyService.recordTransition(
        {
          claimLetter: claimLetterOid,
          state: batch.state,
          year: batch.year,
          installment: batch.installment as 1 | 2,
          batchNumber: batch.batchNumber as ClaimLetterBatchNumber,
          version: batch.version,
          fromStatus: FORM_STATUS.UNDER_REVIEW_BY_SO,
          toStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
          actionSource: 'DIRECT_MOHUA_REVIEW',
          reason: trimmedRemark,
          changedBy: userOid,
          requestId: randomUUID(),
          ipAddress: ip ?? null,
          userAgent: userAgent ?? null,
        },
        session,
      );
      // The verified letter's ULBs now wait for its Office Memorandum (mohua/om).
      await copyClaimLetterUlbsToOm(this.batchUlbModel, this.omUlbModel, claimLetterOid, session);

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }

    return this.getClaimLetter(claimLetterId);
  }

  /**
   * The SO returns a claim letter under SO review for correction (15 -> 16), in one transaction:
   * - the letter is closed: flagged abandoned too, so its batch slot is free and the State builds a new letter, and its
   *   ULB locks are released so those ULBs can go into that new letter;
   * - exactly what the SO picked goes to 16 (ClaimLetterFormStatusService): each ULB marked RETURNED (decideUlb) with
   *   its own forms, rows and remark, plus the State-wide items in the request; every other form keeps its status;
   * - the transition is logged with each reopened form or row.
   * Pinned on the status and the revision the page showed, like approve. A letter already returned is a no-op.
   */
  async returnForCorrection(
    claimLetterId: string,
    dto: ReturnMohuaClaimLetterDto,
    user: AuthUser,
    ip?: string,
    userAgent?: string,
  ): Promise<MohuaClaimLetterDetail> {
    const claimLetterOid = new Types.ObjectId(claimLetterId);
    const batch = await this.batchModel
      .findOne(this.listedFilter({ _id: claimLetterOid }))
      .select('state year installment batchNumber version currentFormStatus')
      .lean<LeanBatch>()
      .exec();
    if (!batch) throw new NotFoundException(`Claim letter ${claimLetterId} not found`);

    if (batch.currentFormStatus === FORM_STATUS.RETURNED_BY_SO) return this.getClaimLetter(claimLetterId);
    if (batch.currentFormStatus !== FORM_STATUS.UNDER_REVIEW_BY_SO) {
      throw new ConflictException(
        `Only a claim letter under SO review can be returned; this one is ${getFormStatusLabel(batch.currentFormStatus)}.`,
      );
    }
    // Each ULB's picks come from the decision the SO saved on it while reviewing (decideUlb).
    const returnedUlbs = await this.batchUlbModel
      .find({ claimLetter: claimLetterOid, 'soDecision.status': 'RETURNED' })
      .select('ulbId soDecision eligibilitySources')
      .lean<(ChildWithSources & { soDecision: ClaimLetterSoDecision })[]>()
      .exec();
    if (returnedUlbs.length + dto.stateFormIds.length === 0) {
      throw new BadRequestException('Mark at least one ULB for return, or pick a State item, to return the claim letter.');
    }
    assertValidFormStatusTransition(FORM_STATUS.UNDER_REVIEW_BY_SO, FORM_STATUS.RETURNED_BY_SO);

    const rejectedExemptions = await this.rejectPickedExemptions(returnedUlbs, user, ip, userAgent);

    const userOid = new Types.ObjectId(user._id);
    const stateRemark = dto.stateRemark?.trim() || null;
    const decision = buildDecisionRecord('RETURNED', stateRemark, user, ip ?? null, userAgent ?? null);
    const now = decision.decidedAt;
    const ulbReturns = returnedUlbs.map(({ ulbId, soDecision }) => ({
      ulbId,
      ulbFormIds: soDecision.ulbFormIds ?? [],
      rowFormIds: soDecision.rowFormIds ?? [],
      remark: soDecision.remark ?? null,
      decision: buildDecisionRecord('RETURNED', soDecision.remark ?? null, user, ip ?? null, userAgent ?? null),
    }));

    const session = await this.connection.startSession();
    try {
      session.startTransaction();

      const updated = await this.batchModel
        .findOneAndUpdate(
          {
            _id: claimLetterOid,
            currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_SO,
            revision: dto.expectedRevision,
            isAbandoned: false,
          },
          {
            $set: {
              currentFormStatus: FORM_STATUS.RETURNED_BY_SO,
              mohuaRemarks: stateRemark,
              isAbandoned: true,
              abandonedAt: now,
              abandonedBy: userOid,
              resolvedAt: now,
              resolvedBy: userOid,
              updatedBy: userOid,
            },
            $inc: { revision: 1 },
          },
          { new: true, session },
        )
        .select('_id')
        .lean<{ _id: Types.ObjectId }>()
        .exec();
      if (!updated) {
        throw new ConflictException(
          'The claim letter changed or was already decided while you were reviewing it. Please reload and try again.',
        );
      }

      // Deleted, not flagged, so each ULB is immediately selectable in the State's new letter (same as abandon).
      await this.lockModel.deleteMany({ claimLetter: claimLetterOid, lockState: 'ACTIVE' }, { session });

      const returned = await this.formStatusService.returnFormsForCorrection(
        claimLetterOid,
        { ulbReturns, stateFormIds: dto.stateFormIds, stateRemark },
        decision,
        session,
      );
      await this.historyService.recordTransition(
        {
          claimLetter: claimLetterOid,
          state: batch.state,
          year: batch.year,
          installment: batch.installment as 1 | 2,
          batchNumber: batch.batchNumber as ClaimLetterBatchNumber,
          version: batch.version,
          fromStatus: FORM_STATUS.UNDER_REVIEW_BY_SO,
          toStatus: FORM_STATUS.RETURNED_BY_SO,
          actionSource: 'CLAIM_LETTER_REJECTION',
          reason: stateRemark,
          rejectedSourceRefs: [...returned, ...rejectedExemptions],
          changedBy: userOid,
          requestId: randomUUID(),
          ipAddress: ip ?? null,
          userAgent: userAgent ?? null,
        },
        session,
      );

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }

    return this.getClaimLetter(claimLetterId);
  }

  /**
   * The SO's return mark on one ULB of a letter under SO review: RETURNED (with the forms, rows and remark the
   * letter's return will reopen; marking again replaces them) or PENDING (clears it). There is no approved mark: an
   * unmarked ULB counts as fine. Nothing else moves, and the letter's revision is not bumped,
   * so marking ULBs never makes a later approve or return fail as "changed".
   */
  async decideUlb(
    claimLetterId: string,
    ulbId: string,
    dto: DecideMohuaClaimLetterUlbDto,
    user: AuthUser,
  ): Promise<MohuaClaimLetterSoDecision | null> {
    const batch = await this.findListedBatch(claimLetterId);
    if (batch.currentFormStatus !== FORM_STATUS.UNDER_REVIEW_BY_SO) {
      throw new ConflictException(
        `ULBs can only be marked while the claim letter is under SO review; this one is ${getFormStatusLabel(batch.currentFormStatus)}.`,
      );
    }
    const ulbFormIds = dto.ulbFormIds ?? [];
    const rowFormIds = dto.rowFormIds ?? [];
    const rejectExemptionFormIds = dto.rejectExemptionFormIds ?? [];
    const remark = dto.remark?.trim() || null;
    if (dto.status === 'RETURNED') {
      if (ulbFormIds.length + rowFormIds.length + rejectExemptionFormIds.length === 0) {
        throw new BadRequestException('Pick at least one form to return for this ULB.');
      }
      await this.assertExemptionPicks(batch._id, ulbId, ulbFormIds, rowFormIds, rejectExemptionFormIds, remark);
    }

    const soDecision: ClaimLetterSoDecision | null =
      dto.status === 'PENDING'
        ? null
        : {
            status: 'RETURNED',
            ulbFormIds,
            rowFormIds,
            rejectExemptionFormIds,
            remark,
            decidedBy: new Types.ObjectId(user._id),
            decidedAt: new Date(),
          };
    const updated = await this.batchUlbModel
      .updateOne({ claimLetter: batch._id, ulbId: new Types.ObjectId(ulbId) }, { $set: { soDecision } })
      .exec();
    if (!updated.matchedCount) throw new NotFoundException(`ULB ${ulbId} is not in claim letter ${claimLetterId}`);

    return soDecision && toSoDecision(soDecision);
  }

  /** One claim letter: its State-signed file and the headline numbers. */
  async getClaimLetter(claimLetterId: string): Promise<MohuaClaimLetterDetail> {
    const batch = await this.findListedBatch(claimLetterId);
    const [state, exemptionsApplied, rejection, returnedUlbs, pendingExemptions] = await Promise.all([
      this.stateModel.findById(batch.state).select('name').lean<{ name: string }>().exec(),
      this.batchUlbModel.countDocuments({ claimLetter: batch._id, 'appliedExemptionIds.0': { $exists: true } }),
      this.findRejection(batch),
      this.batchUlbModel.countDocuments({ claimLetter: batch._id, 'soDecision.status': 'RETURNED' }),
      // Only the SO's decision acts on them, so only a letter under SO review needs the lookup.
      batch.currentFormStatus === FORM_STATUS.UNDER_REVIEW_BY_SO
        ? this.findPendingExemptions(batch._id)
        : Promise.resolve([]),
    ]);

    // The final claim letter PDF (the letter with its annexures merged); older letters fall back to the uploaded signed copy.
    const file = batch.finalClaimPdf?.file?.path ? batch.finalClaimPdf.file : batch.signedClaimFile;
    return {
      id: String(batch._id),
      revision: batch.revision ?? 0,
      number: batch.fileBaseName,
      state: { id: String(batch.state), name: state?.name ?? '' },
      yearId: String(batch.year),
      installment: batch.installment,
      receivedOn: batch.submittedAt ? new Date(batch.submittedAt).toISOString() : null,
      status: batch.currentFormStatus,
      statusLabel: getFormStatusLabel(batch.currentFormStatus),
      signedClaimFile: file?.path
        ? {
            name: file.originalName || file.name || `${batch.fileBaseName}.pdf`,
            url: this.fileTokenService.signFileUrlForSession(file.path, 'inline'),
            sizeKb: file.sizeKb ?? 0,
          }
        : null,
      summary: {
        claimAmountReceived: batch.financialSummary?.currentSelectedClaim ?? 0,
        totalCities: batch.ulbCount ?? 0,
        exemptionsApplied,
      },
      returnDetails: rejection && toReturnDetails(rejection),
      returnedUlbCount: returnedUlbs,
      pendingExemptionCount: pendingExemptions.length,
    };
  }

  /** The ULBs in one claim letter, searchable by name or census code, paged. */
  async getClaimLetterUlbs(
    claimLetterId: string,
    query: GetMohuaClaimLetterUlbsQueryDto,
  ): Promise<MohuaClaimLetterUlbs> {
    const batch = await this.findListedBatch(claimLetterId);
    const limit = query.limit ?? MOHUA_CLAIM_LETTER_ULBS_DEFAULT_LIMIT;

    const filter: FilterQuery<ClaimLetterBatchUlb> = { claimLetter: batch._id };
    const term = query.search?.trim();
    if (term) {
      const pattern = new RegExp(escapeRegex(term), 'i');
      filter.$or = [{ 'ulbSnapshot.name': pattern }, { 'ulbSnapshot.censusCode': pattern }];
    }

    const [total, rejection] = await Promise.all([this.batchUlbModel.countDocuments(filter), this.findRejection(batch)]);
    // On a returned letter each ULB shows only what the return reopened for it; untouched ULBs show no status.
    const returnedByUlb = new Map<string, number[]>();
    for (const ref of rejection?.rejectedSourceRefs ?? []) {
      if (!ref.ulbId) continue;
      const formIds = returnedByUlb.get(String(ref.ulbId)) ?? [];
      if (!formIds.includes(ref.formId)) formIds.push(ref.formId);
      returnedByUlb.set(String(ref.ulbId), formIds);
    }
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const page = Math.min(query.page ?? 1, totalPages);

    const rows = await this.batchUlbModel
      .find(filter)
      .select('ulbId ulbSnapshot allocatedAmount claimedAmount appliedExemptionIds soDecision eligibilitySources')
      .sort({ 'ulbSnapshot.name': 1, _id: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean<
        {
          ulbId: Types.ObjectId;
          ulbSnapshot: { name: string; censusCode?: string | null };
          allocatedAmount: number;
          claimedAmount: number;
          appliedExemptionIds?: Types.ObjectId[];
          soDecision?: ClaimLetterSoDecision | null;
          eligibilitySources?: ExemptionSourceLean[];
        }[]
      >()
      .exec();
    const exemptionsByUlb = await this.loadUlbExemptions(rows);

    return {
      items: rows.map((row) => {
        const returnedFormIds = returnedByUlb.get(String(row.ulbId)) ?? [];
        const showStatus = !rejection || returnedFormIds.length > 0;
        return {
          ulbId: String(row.ulbId),
          name: row.ulbSnapshot.name,
          censusCode: row.ulbSnapshot.censusCode ?? null,
          installmentShare: row.allocatedAmount,
          claimedAmount: row.claimedAmount,
          ulbStatus: row.appliedExemptionIds?.length
            ? MOHUA_CLAIM_LETTERS_ULB_STATUS.ELIGIBLE_VIA_EXEMPTION
            : MOHUA_CLAIM_LETTERS_ULB_STATUS.ELIGIBLE,
          reviewStatus: showStatus ? batch.currentFormStatus : null,
          reviewStatusLabel: showStatus ? getFormStatusLabel(batch.currentFormStatus) : null,
          returnedFormIds,
          // Only return marks mean anything (an older "approved" mark reads as unmarked).
          soDecision: row.soDecision?.status === 'RETURNED' ? toSoDecision(row.soDecision) : null,
          exemptions: (exemptionsByUlb.get(String(row.ulbId)) ?? []).map((e) => ({
            formId: e.formId,
            exemptionId: String(e.exemptionId),
            status: e.status,
          })),
        };
      }),
      pagination: { page, limit, total, totalPages },
    };
  }

  /**
   * An "Eligible via exemption" ULB is returned only through its exemptions: each picked one must be an exemption the
   * letter relied on that is still under MoHUA review, a remark is required (rejecting needs one), and none of its
   * forms can be reopened instead. A ULB without such exemptions cannot pick any.
   */
  private async assertExemptionPicks(
    claimLetter: Types.ObjectId,
    ulbId: string,
    ulbFormIds: number[],
    rowFormIds: number[],
    rejectExemptionFormIds: number[],
    remark: string | null,
  ): Promise<void> {
    const child = await this.batchUlbModel
      .findOne({ claimLetter, ulbId: new Types.ObjectId(ulbId) })
      .select('ulbId eligibilitySources')
      .lean<ChildWithSources>()
      .exec();
    if (!child) throw new NotFoundException(`ULB ${ulbId} is not in this claim letter`);
    const exemptions = (await this.loadUlbExemptions([child])).get(ulbId) ?? [];

    if (exemptions.length && ulbFormIds.length + rowFormIds.length) {
      throw new BadRequestException('This ULB is eligible via exemption: return it by rejecting its exemptions.');
    }
    for (const formId of rejectExemptionFormIds) {
      const exemption = exemptions.find((e) => e.formId === formId);
      if (!exemption) throw new BadRequestException(`Form ${formId} has no exemption request in this claim letter.`);
      if (exemption.status !== FORM_STATUS.UNDER_REVIEW_BY_MOHUA) {
        throw new ConflictException(
          `The exemption for form ${formId} is already ${getFormStatusLabel(exemption.status)}. Reload and try again.`,
        );
      }
    }
    if (rejectExemptionFormIds.length && !remark) {
      throw new BadRequestException('A remark is required to reject an exemption.');
    }
  }

  /**
   * The return's half for "Eligible via exemption" ULBs: rejects each exemption the SO picked, with that ULB's remark,
   * through the exemption service (its own transaction each, so this runs before the letter's). An exemption already
   * rejected - a retry after a failure - is skipped; one approved meanwhile stops the return. Unpicked exemptions keep
   * their status. Returns the rejected ones as history refs, so the return panel and rows list them.
   */
  private async rejectPickedExemptions(
    returnedUlbs: (ChildWithSources & { soDecision: ClaimLetterSoDecision })[],
    user: AuthUser,
    ip?: string,
    userAgent?: string,
  ): Promise<ClaimLetterReturnedSource[]> {
    const picked = returnedUlbs.filter((u) => u.soDecision.rejectExemptionFormIds?.length);
    if (!picked.length) return [];
    const exemptionsByUlb = await this.loadUlbExemptions(picked);

    const refs: ClaimLetterReturnedSource[] = [];
    for (const { ulbId, soDecision } of picked) {
      const remark = soDecision.remark ?? '';
      for (const formId of soDecision.rejectExemptionFormIds) {
        const exemption = exemptionsByUlb.get(String(ulbId))?.find((e) => e.formId === formId);
        if (!exemption) continue;
        if (exemption.status === FORM_STATUS.UNDER_REVIEW_BY_MOHUA) {
          await this.exemptionService.reject(String(exemption.exemptionId), formId, remark, user, ip ?? '', userAgent ?? '');
        } else if (exemption.status !== FORM_STATUS.RETURNED_BY_MOHUA) {
          throw new ConflictException(
            `The exemption for form ${formId} was ${getFormStatusLabel(exemption.status)} meanwhile. Reload and review this ULB again.`,
          );
        }
        refs.push({
          formId,
          formDocumentId: exemption.formDocumentId ?? exemption.exemptionId,
          rowDocumentId: null,
          ulbId,
          remark: remark || 'Exemption rejected',
        });
      }
    }
    return refs;
  }

  /** Every ULB exemption the letter relied on that MoHUA has not decided yet (still 5). */
  private async findPendingExemptions(claimLetter: Types.ObjectId): Promise<UlbExemption[]> {
    const children = await this.batchUlbModel
      .find({ claimLetter, 'appliedExemptionIds.0': { $exists: true } })
      .select('ulbId eligibilitySources')
      .lean<ChildWithSources[]>()
      .exec();
    return [...(await this.loadUlbExemptions(children)).values()]
      .flat()
      .filter((e) => e.status === FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
  }

  /**
   * ulbId -> the ULB's own discretionary exemptions its claim row relied on (`eligibilitySources` entries with an
   * `exemptionId`), each with its live status read in one query. Automatic new-ULB exemptions have no request, so
   * there is nothing for MoHUA to decide and they are left out.
   */
  private async loadUlbExemptions(children: ChildWithSources[]): Promise<Map<string, UlbExemption[]>> {
    const refs = children.flatMap((child) =>
      (child.eligibilitySources ?? [])
        .filter((s) => s.exemptionId && s.exemptionKind === MOHUA_CLAIM_LETTER_ULB_EXEMPTION_KIND)
        .map((s) => ({
          ulbId: String(child.ulbId),
          formId: s.formId,
          exemptionId: s.exemptionId!,
          formDocumentId: s.formDocumentId ?? null,
        })),
    );
    const byUlb = new Map<string, UlbExemption[]>();
    if (!refs.length) return byUlb;

    const ids = [...new Set(refs.map((r) => String(r.exemptionId)))].map((id) => new Types.ObjectId(id));
    const docs = await this.exemptionModel
      .find({ _id: { $in: ids } })
      .select('data.formId data.currentFormStatus')
      .lean<{ _id: Types.ObjectId; data: { formId: number; currentFormStatus: number }[] }[]>()
      .exec();
    const liveStatus = new Map(
      docs.flatMap((doc) => doc.data.map((entry) => [`${String(doc._id)}:${entry.formId}`, entry.currentFormStatus])),
    );

    for (const { ulbId, ...ref } of refs) {
      const status = liveStatus.get(`${String(ref.exemptionId)}:${ref.formId}`);
      if (status === undefined) continue;
      byUlb.set(ulbId, [...(byUlb.get(ulbId) ?? []), { ...ref, status }]);
    }
    return byUlb;
  }

  /** The return that closed this letter; null while the letter is not returned. */
  private findRejection(batch: LeanBatch): Promise<ClaimLetterRejection | null> {
    if (!MOHUA_CLAIM_LETTER_RETURNED_STATUSES.includes(batch.currentFormStatus)) return Promise.resolve(null);
    return this.historyService.findLatestRejection(batch._id);
  }

  private assertSupportedInstallment(installment: number): void {
    if (installment !== MOHUA_CLAIM_LETTERS_INSTALLMENT) {
      throw new NotFoundException(`Installment ${installment} is not supported yet`);
    }
  }

  /**
   * READY, submitted, not abandoned, not replaced by a newer version, and at a status MoHUA lists. A letter the SO
   * returned is flagged abandoned too (that frees its batch slot), but MoHUA still lists it as returned.
   */
  private listedFilter<T extends object>(scope: T) {
    return {
      ...scope,
      assemblyStatus: 'READY',
      $or: [{ isAbandoned: false }, { currentFormStatus: FORM_STATUS.RETURNED_BY_SO }],
      supersededBy: null,
      currentFormStatus: { $in: MOHUA_CLAIM_LETTERS_LISTED_STATUSES },
    };
  }

  private async findListedBatch(claimLetterId: string): Promise<LeanBatch> {
    const batch = await this.batchModel
      .findOne(this.listedFilter({ _id: new Types.ObjectId(claimLetterId) }))
      .select(
        'state year installment fileBaseName batchNumber revision submittedAt ulbCount currentFormStatus financialSummary.currentSelectedClaim signedClaimFile finalClaimPdf.file',
      )
      .lean<LeanBatch>()
      .exec();
    if (!batch) throw new NotFoundException(`Claim letter ${claimLetterId} not found`);
    return batch;
  }

  /**
   * stateId -> the state's allocation for one installment: the year's grant (basic + performance, from the
   * grantAllocation collection) split equally across the year's installments.
   */
  private async loadInstallmentAllocations(yearId: string): Promise<Map<string, number>> {
    const allocations = await this.grantAllocationModel
      .find({ yearId: new Types.ObjectId(yearId) })
      .select('stateId basic performance')
      .lean<{ stateId: Types.ObjectId; basic: number; performance: number }[]>()
      .exec();

    return new Map(
      allocations.map((allocation) => [
        String(allocation.stateId),
        Math.round(allocationRupees(allocation) / MOHUA_CLAIM_LETTERS_INSTALLMENTS_PER_YEAR),
      ]),
    );
  }
}

function toSoDecision(decision: ClaimLetterSoDecision): MohuaClaimLetterSoDecision {
  return {
    status: decision.status,
    ulbFormIds: decision.ulbFormIds ?? [],
    rowFormIds: decision.rowFormIds ?? [],
    rejectExemptionFormIds: decision.rejectExemptionFormIds ?? [],
    remark: decision.remark ?? null,
    decidedAt: new Date(decision.decidedAt).toISOString(),
  };
}

/**
 * Groups a return's refs: a ref without a ULB is a State form, one with a row is that State form's row for one ULB,
 * and one with a ULB but no row is the ULB's own form.
 */
function toReturnDetails(rejection: ClaimLetterRejection): MohuaClaimLetterReturnDetails {
  const refs = rejection.rejectedSourceRefs ?? [];
  const countUlbs = (formId: number, rows: boolean) =>
    refs.filter((r) => r.formId === formId && r.ulbId && !!r.rowDocumentId === rows).length;
  const ulbFormRefs = refs.filter((r) => r.ulbId && !r.rowDocumentId);

  return {
    returnedAt: new Date(rejection.changedAt).toISOString(),
    returnedBy: rejection.changedBy?.name ?? null,
    stateRemark: rejection.reason ?? null,
    stateForms: refs.filter((r) => !r.ulbId).map((r) => ({ formId: r.formId, ulbCount: countUlbs(r.formId, true) })),
    ulbForms: [...new Set(ulbFormRefs.map((r) => r.formId))].map((formId) => ({
      formId,
      ulbCount: countUlbs(formId, false),
    })),
    returnedUlbCount: new Set(refs.filter((r) => r.ulbId).map((r) => String(r.ulbId))).size,
  };
}
