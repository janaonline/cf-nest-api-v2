import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  ClaimLetterBatchHistory,
  ClaimLetterBatchHistoryDocument,
  ClaimLetterHistoryActionSource,
  ClaimLetterRejectedSourceRef,
  ClaimLetterSubmittedFiles,
} from 'src/schemas/xvi-fc/state/claim-letter-batch-history.schema';
import type {
  ClaimLetterBatchNumber,
  ClaimLetterInstallment,
} from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';

export interface RecordClaimLetterTransitionInput {
  claimLetter: Types.ObjectId;
  state: Types.ObjectId;
  year: Types.ObjectId;
  installment: ClaimLetterInstallment;
  batchNumber: ClaimLetterBatchNumber;
  version: number;
  fromStatus: number | null;
  toStatus: number;
  actionSource: ClaimLetterHistoryActionSource;
  reason?: string | null;
  /** Submit only. */
  submittedFiles?: ClaimLetterSubmittedFiles | null;
  /** SO return only: each form or row it reopened, with the SO's remark. */
  rejectedSourceRefs?: ClaimLetterRejectedSourceRef[];
  changedBy: Types.ObjectId;
  requestId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** Transition history, written in the same transaction as the status change; which mutations
 *  qualify is docs/adr/0003-workflow-transitions.md. */
@Injectable()
export class ClaimLetterHistoryService {
  constructor(
    @InjectModel(ClaimLetterBatchHistory.name)
    private readonly historyModel: Model<ClaimLetterBatchHistoryDocument>,
  ) {}

  async recordTransition(input: RecordClaimLetterTransitionInput, session?: ClientSession): Promise<void> {
    await this.historyModel.create(
      [
        {
          claimLetter: input.claimLetter,
          state: input.state,
          year: input.year,
          installment: input.installment,
          batchNumber: input.batchNumber,
          version: input.version,
          fromStatus: input.fromStatus,
          toStatus: input.toStatus,
          actionSource: input.actionSource,
          reason: input.reason ?? null,
          submittedFiles: input.submittedFiles ?? null,
          rejectedSourceRefs: input.rejectedSourceRefs ?? [],
          changedBy: input.changedBy,
          requestId: input.requestId,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        },
      ],
      { session: session ?? null },
    );
  }

  /** The letter's latest return (SO or MoHUA): its remark, what it reopened and who did it (name populated). */
  async findLatestRejection(claimLetter: Types.ObjectId): Promise<ClaimLetterRejection | null> {
    return this.historyModel
      .findOne({ claimLetter, actionSource: 'CLAIM_LETTER_REJECTION' })
      .sort({ changedAt: -1 })
      .select('reason rejectedSourceRefs changedBy changedAt')
      .populate<{ changedBy: { name?: string } | null }>('changedBy', 'name')
      .lean<ClaimLetterRejection>()
      .exec();
  }
}

export interface ClaimLetterRejection {
  reason?: string | null;
  rejectedSourceRefs: ClaimLetterRejectedSourceRef[];
  changedBy: { name?: string } | null;
  changedAt: Date;
}
