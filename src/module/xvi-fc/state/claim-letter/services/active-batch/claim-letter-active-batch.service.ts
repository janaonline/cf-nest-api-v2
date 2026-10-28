import { ConflictException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { ClaimLetterBatch, ClaimLetterBatchDocument } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';

export const CLAIM_LETTER_BATCH_BLOCKED = 'CLAIM_LETTER_BATCH_BLOCKED';

/** Draft, under MoHUA review, or returned by MoHUA. */
const ACTIVE_STATUSES: number[] = [
  FORM_STATUS.IN_PROGRESS,
  FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
  FORM_STATUS.RETURNED_BY_MOHUA,
];

export interface ClaimLetterActiveBatch {
  _id: Types.ObjectId;
  batchNumber: number;
}

interface BatchScope {
  _id?: Types.ObjectId | string;
  state: Types.ObjectId | string;
  year: Types.ObjectId | string;
  installment: number;
}

/** A batch's own state decides whether the rule applies to it at all. */
interface BatchStatus {
  currentFormStatus: number;
  isAbandoned: boolean;
}

type GuardedBatch = BatchScope & BatchStatus & { _id: Types.ObjectId | string };

/** The only place that decides the active batch, so the rule can be lifted later (ADR 0004). */
@Injectable()
export class ClaimLetterActiveBatchService {
  constructor(@InjectModel(ClaimLetterBatch.name) private readonly batchModel: Model<ClaimLetterBatchDocument>) {}

  /** One indexed query on `{ state, year, installment, currentFormStatus }`. */
  async resolveActiveBatch(scope: BatchScope): Promise<ClaimLetterActiveBatch | null> {
    return this.batchModel
      .findOne({
        state: new Types.ObjectId(String(scope.state)),
        year: new Types.ObjectId(String(scope.year)),
        installment: scope.installment,
        currentFormStatus: { $in: ACTIVE_STATUSES },
        isAbandoned: false,
        supersededBy: null,
        assemblyStatus: 'READY',
      })
      .sort({ createdAt: 1 })
      .select('batchNumber')
      .lean<ClaimLetterActiveBatch | null>()
      .exec();
  }

  /** The batch number blocking this batch, or null when it may proceed. An abandoned or finished batch
   *  is never blocked: the rule only orders batches that are themselves active. */
  async resolveBlockingBatchNumber(batch: GuardedBatch): Promise<number | null> {
    if (!this.isActive(batch)) return null;
    return this.blockingBatchNumberFor(batch, await this.resolveActiveBatch(batch));
  }

  /** For listings: `active` is the State/year/installment's active batch, already resolved. */
  blockingBatchNumberFor(batch: BatchStatus & { _id: unknown }, active: ClaimLetterActiveBatch | null): number | null {
    return active && this.isActive(batch) && String(active._id) !== String(batch._id) ? active.batchNumber : null;
  }

  /** 409 when another batch of the same State/year/installment is the active one. */
  async assertActive(batch: GuardedBatch): Promise<void> {
    const blocking = await this.resolveBlockingBatchNumber(batch);
    if (blocking !== null) throw this.blockedError(blocking);
  }

  /** 409 when any batch of this State/year/installment is still active. */
  async assertCanCreate(scope: BatchScope): Promise<void> {
    const active = await this.resolveActiveBatch(scope);
    if (active) throw this.blockedError(active.batchNumber);
  }

  blockedReason(batchNumber: number): string {
    return (
      `Only one claim batch can be processed at a time. Batch ${batchNumber} is still in progress or under ` +
      'MoHUA review.'
    );
  }

  private isActive(batch: BatchStatus): boolean {
    return ACTIVE_STATUSES.includes(batch.currentFormStatus) && !batch.isAbandoned;
  }

  private blockedError(batchNumber: number): ConflictException {
    return new ConflictException({ message: this.blockedReason(batchNumber), code: CLAIM_LETTER_BATCH_BLOCKED });
  }
}
