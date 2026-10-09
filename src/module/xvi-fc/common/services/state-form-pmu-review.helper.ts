import { Injectable, NotFoundException } from '@nestjs/common';
import type { ClientSession, Model, Types } from 'mongoose';

export interface TransitionPmuFormParams<TFormDoc> {
  formModel: Model<TFormDoc>;
  formId: Types.ObjectId;
  /** Fields to `$set` on the form — status/auditRevision/updatedBy/remarks field names stay
   *  caller-specific since they differ per form. */
  setFields: Record<string, unknown>;
  session?: ClientSession;
  /** Defaults to 'Form not found.' */
  notFoundMessage?: string;
}

export interface WritePmuHistoryParams<THistoryDoc> {
  historyModel: Model<THistoryDoc>;
  fromStatus: number;
  toStatus: number;
  /** Builds the full history document (field names, snapshot payload — all form-specific). May
   *  be async (e.g. to fetch a row snapshot) — only called when a history entry will actually be
   *  written, so that fetch never runs on a no-op. */
  buildDocument: () => Record<string, unknown> | Promise<Record<string, unknown>>;
  session?: ClientSession;
}

/**
 * Mechanical core shared by all 5 PMU review services' complete-form approve/reject path: the
 * form's status write plus the no-op-skip history write. Deliberately agnostic of per-form shape —
 * field names, snapshot payload, and remarks field all stay in the caller's
 * `setFields`/`buildDocument`. Row-level mechanics have no equivalent here — see
 * `PmuRowReviewHelper`. Full rationale (what this replaced, why it stays agnostic): see
 * common/services/CLAUDE.md's "PMU Review shared mechanics" section.
 */
@Injectable()
export class StateFormPmuReviewHelper {
  /** Applies the given `$set` to the form, returning the updated document. Throws
   *  NotFoundException if the form vanished between read and write (e.g. a concurrent action). */
  async transitionForm<TFormDoc>(params: TransitionPmuFormParams<TFormDoc>): Promise<TFormDoc> {
    const query = params.formModel.findOneAndUpdate({ _id: params.formId }, { $set: params.setFields }, { new: true });
    if (params.session) query.session(params.session);

    const updated = await query.exec();
    if (!updated) throw new NotFoundException(params.notFoundMessage ?? 'Form not found.');
    return updated;
  }

  /** Writes one history entry, skipping entirely when `fromStatus === toStatus` — the same
   *  no-op convention every per-form history writer already follows (SFC/GTC/FC Unspent). */
  async writeHistoryIfChanged<THistoryDoc>(params: WritePmuHistoryParams<THistoryDoc>): Promise<void> {
    if (params.fromStatus === params.toStatus) return;

    const doc = await params.buildDocument();
    await params.historyModel.create([doc], params.session ? { session: params.session } : undefined);
  }
}
