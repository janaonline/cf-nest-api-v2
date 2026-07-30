import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  ClaimLetterBatchHistory,
  ClaimLetterBatchHistoryDocument,
  ClaimLetterHistoryActionSource,
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
  changedBy: Types.ObjectId;
  requestId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Writes claim-letter status-transition history (plan §9) — only on committed transitions
 * (create draft, submit, abandon in V1), never for draft edits or file uploads. Always called
 * inside the same transaction as the status change it records (brain §19.9).
 */
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
          changedBy: input.changedBy,
          requestId: input.requestId,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
        },
      ],
      { session: session ?? null },
    );
  }
}
