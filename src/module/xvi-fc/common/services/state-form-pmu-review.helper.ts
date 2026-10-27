import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { ClientSession, Model, Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';

export interface TransitionPmuFormParams<TFormDoc> {
  formModel: Model<TFormDoc>;
  formId: Types.ObjectId;
  /** Fields to `$set` on the form — status/auditRevision/updatedBy/remarks field names stay
   *  caller-specific since they differ per form. */
  setFields: Record<string, unknown>;
  session?: ClientSession;
  /** Defaults to 'Form not found.' */
  notFoundMessage?: string;
  /** When given, the write only applies while the form is still in this status — a 409 otherwise.
   *  Used by undo so it can never overwrite a decision someone else made in the meantime. */
  expectedStatus?: number;
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
    const filter: Record<string, unknown> = { _id: params.formId };
    if (params.expectedStatus !== undefined) filter['currentFormStatus'] = params.expectedStatus;

    const query = params.formModel.findOneAndUpdate(filter, { $set: params.setFields }, { new: true });
    if (params.session) query.session(params.session);

    const updated = await query.exec();
    if (!updated) {
      if (params.expectedStatus !== undefined) {
        throw new ConflictException('The form status changed while you were working. Refresh and try again.');
      }
      throw new NotFoundException(params.notFoundMessage ?? 'Form not found.');
    }
    return updated;
  }

  /**
   * Writes the two history entries of a PMU undo — `fromStatus -> UNDO (10)` then
   * `UNDO -> UNDER_REVIEW_BY_PMU (13)` — in order. History is read newest-first by `changedAt`, so the
   * second entry is stamped 1 ms after the first to keep the pair's order stable. `buildDocument`
   * gets each step's `{ fromStatus, toStatus, changedAt }` and returns that step's full history
   * document (form-specific field names, same as the approve/reject writers).
   */
  async writeUndoHistory<THistoryDoc>(params: {
    historyModel: Model<THistoryDoc>;
    fromStatus: number;
    buildDocument: (step: { fromStatus: number; toStatus: number; changedAt: Date }) => Record<string, unknown>;
    session?: ClientSession;
  }): Promise<void> {
    const now = Date.now();
    const docs = [
      { fromStatus: params.fromStatus, toStatus: FORM_STATUS.UNDO, changedAt: new Date(now) },
      { fromStatus: FORM_STATUS.UNDO, toStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU, changedAt: new Date(now + 1) },
    ].map((step) => params.buildDocument(step));

    await params.historyModel.create(docs, params.session ? { session: params.session, ordered: true } : { ordered: true });
  }

  /** Writes one history entry, skipping entirely when `fromStatus === toStatus` — the same
   *  no-op convention every per-form history writer already follows (SFC/GTC/FC Unspent). */
  async writeHistoryIfChanged<THistoryDoc>(params: WritePmuHistoryParams<THistoryDoc>): Promise<void> {
    if (params.fromStatus === params.toStatus) return;

    const doc = await params.buildDocument();
    await params.historyModel.create([doc], params.session ? { session: params.session } : undefined);
  }
}
