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
import { FormJsonService } from 'src/form-json/form-json.service';
import type { FieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';
import { ClaimLetterBatch, ClaimLetterBatchDocument } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import {
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
import type { ClaimLetterBatchSummary, ClaimLetterEligibilitySummary } from '../../types/claim-letter.types';

/** Loose shape for .lean() query results — real field-level typing lives on the schema itself. */
type LeanClaimLetterBatch = Record<string, unknown>;

/**
 * Orchestrates the State-facing claim-letter read paths (eligibility summary, single-claim
 * detail, and the "list my claim letters" history view — brain §15.2), plus the two
 * parent-only mutations that don't touch locks/children (signed-file upload, submit — plan §6).
 * Lock/child-touching mutations (create/update/abandon) live in ClaimLetterAssemblyService.
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

    const [expectedUlbs, gate, usedBatches, financialOverview] = await Promise.all([
      this.expectedUlbSetService.resolve(stateId, yearId),
      // TODO: what happens to ULB forms?
      this.eligibilityService.evaluateStateLevelGate(stateId, yearId, installment),
      this.batchModel
        .find({
          state: new Types.ObjectId(stateId),
          year: new Types.ObjectId(yearId),
          installment,
          isAbandoned: false,
        })
        .select('batchNumber')
        .lean<{ batchNumber: 1 | 2 | 3 }[]>()
        .exec(),
      this.eligibilityService.getFinancialOverview(stateId, yearId, installment as 1 | 2),
    ]);

    const usedBatchNumbers = new Set(usedBatches.map((b) => b.batchNumber));
    const nextBatchNumber = ([1, 2, 3] as const).find((n) => !usedBatchNumbers.has(n)) ?? null;

    const summary: ClaimLetterEligibilitySummary = {
      installment: installment as 1,
      stateLevelGate: { passed: gate.passed, sources: gate.sources },
      expectedUlbCount: expectedUlbs.length,
      batchSlotsUsed: usedBatchNumbers.size,
      batchSlotsMax: CLAIM_LETTER_MAX_BATCH_NUMBER,
      nextBatchNumber,
      financialOverview,
    };

    return xviFcSuccess('Claim letter eligibility summary fetched.', summary);
  }

  /** Persists `signedClaimFile` — writable only while IN_PROGRESS (plan §1), no history write. */
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
   * `IN_PROGRESS -> UNDER_REVIEW_BY_MOHUA` (plan §6/§9) — requires a signed file, idempotent on
   * retry (an already-submitted claim returns its current state rather than erroring — plan §10).
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

    const userOid = new Types.ObjectId(user._id);
    const session = await this.connection.startSession();
    let updated: LeanClaimLetterBatch | null = null;
    try {
      session.startTransaction();

      updated = await this.batchModel
        .findOneAndUpdate(
          { _id: claimLetterId, currentFormStatus: FORM_STATUS.IN_PROGRESS },
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

    // Concurrent status change between our initial read and the guarded update.
    const current = await this.batchModel.findById(claimLetterId).lean<LeanClaimLetterBatch | null>().exec();
    if (current?.['currentFormStatus'] === FORM_STATUS.UNDER_REVIEW_BY_MOHUA) {
      return xviFcSuccess('Claim letter already submitted to MoHUA.', mapClaimLetterBatchDocToSummary(current));
    }
    throw new ConflictException('Claim letter status changed. Please retry.');
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
