import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { FORM_STATUS, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import { FormJsonService } from 'src/master/form-json/form-json.service';
import { claimSourceFiltersByDesignYear } from 'src/module/xvi-fc/common/utils/claim-eligibility-source-query.util';
import type { DecisionRecord } from 'src/module/xvi-fc/common/utils/xvi-fc-decision.util';
import { AnnualAccountFormStatus, FORM_STATUS_ID } from 'src/schemas/xvi-fc/annual-account.schema';
import { ClaimLetterBatch, ClaimLetterBatchDocument } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import {
  ClaimLetterBatchUlb,
  ClaimLetterBatchUlbDocument,
} from 'src/schemas/xvi-fc/state/claim-letter-batch-ulb.schema';

/**
 * Where one source form's status lives. State forms wait for a claim letter at UNDER_REVIEW_BY_SO (15),
 * ULB forms at APPROVED_BY_STATE (8); the SO approving the letter moves both to UNDER_REVIEW_BY_MOHUA (5).
 */
interface FormTarget {
  collection: string;
  /** The field holding the form's status number, which the write is conditional on. */
  statusField: string;
  fromStatus: number;
  /** `{ field: value }` written next to the status; the values come from the target status. */
  buildSet: (toStatus: number) => Record<string, unknown>;
  /** Row-level collection for forms whose rows carry their own review status (Elected Body, FC Unspent, Devolution). */
  rowCollection?: string;
  /** Row statuses a row moves from; `null` also matches a row with no status yet (Devolution rows). */
  rowFromStatuses?: (number | null)[];
  /** Row field that shows the State why a row was returned; Devolution rows have none. */
  rowRemarkField?: string;
  /** What an SO return writes next to the status: the remark where the form shows one. */
  buildReturnSet: (remark: string | null, decision: DecisionRecord) => Record<string, unknown>;
  /** Array filters `buildReturnSet`'s `$[name]` paths need (Annual Accounts' approved documents). */
  returnArrayFilters?: Record<string, unknown>[];
}

const stateForm = (
  collection: string,
  options: {
    rowCollection?: string;
    rowFromStatuses?: (number | null)[];
    rowRemarkField?: string;
  } = {},
): FormTarget => ({
  collection,
  statusField: 'currentFormStatus',
  fromStatus: FORM_STATUS.UNDER_REVIEW_BY_SO,
  buildSet: (toStatus) => ({ currentFormStatus: toStatus }),
  rowCollection: options.rowCollection,
  rowFromStatuses: options.rowFromStatuses ?? [FORM_STATUS.UNDER_REVIEW_BY_SO],
  rowRemarkField: options.rowRemarkField,
  // The same field a PMU rejection fills, so the State's form always shows the latest return's reason.
  buildReturnSet: (remark) => ({ rejectionRemarks: remark }),
});

const ulbForm = (collection: string, withLabel = false): FormTarget => ({
  collection,
  statusField: 'currentFormStatus',
  fromStatus: FORM_STATUS.APPROVED_BY_STATE,
  buildSet: (toStatus) => ({
    currentFormStatus: toStatus,
    ...(withLabel && { currentFormStatusLabel: getFormStatusLabel(toStatus) }),
  }),
  // Bank Account and DUR show MoHUA's decision note to the ULB; SLB has no decision field.
  buildReturnSet: (_remark, decision) => (withLabel ? { mohuaDecision: decision } : {}),
});

const ANNUAL_ACCOUNT_STATUS_TEXT = new Map(
  Object.entries(FORM_STATUS_ID).map(([text, id]) => [id, text as AnnualAccountFormStatus]),
);

const annualAccountForm = (): FormTarget => ({
  collection: 'xvifc_annualaccounts',
  statusField: 'form_status_id',
  fromStatus: FORM_STATUS.APPROVED_BY_STATE,
  // Annual Accounts keeps the status as text plus an id, per section document.
  buildSet: (toStatus) => ({ form_status_id: toStatus, form_status: ANNUAL_ACCOUNT_STATUS_TEXT.get(toStatus) }),
  // A document the State approved stays locked for re-upload, so a return marks each one returned with the SO's note:
  // the ULB sees Re-upload, exactly as after a State return, and must re-upload it before resubmitting (a newer upload
  // makes the decision stale). Optional / undecided documents are left as they are.
  buildReturnSet: (_remark, decision) => ({ mohuaDecision: decision, 'documents.$[approved].stateDecision': decision }),
  returnArrayFilters: [{ 'approved.stateDecision.status': 'APPROVED' }],
});

/** formId (the claim-eligibility registry's ids, see master/form-json-config/CLAUDE.md) -> its storage. */
const FORM_TARGETS: Readonly<Record<number, FormTarget>> = {
  22: stateForm('xvifc_sfc'),
  23: stateForm('xvifc_elected_ulb_forms', {
    rowCollection: 'xvifc_elected_ulb_rows',
    rowRemarkField: 'rejectionRemark',
  }),
  // Devolution rows have no PMU row review, so a row is still unset (null) when the SO approves its ULB's claim.
  24: stateForm('xvifc_devolution_forms', {
    rowCollection: 'xvifc_devolution_rows',
    rowFromStatuses: [null, FORM_STATUS.UNDER_REVIEW_BY_SO],
  }),
  25: stateForm('xvifc_unspent_state_forms', {
    rowCollection: 'xvifc_unspent_state_form_rows',
    rowRemarkField: 'rejectionRemark',
  }),
  35: stateForm('xvifc_gtc'),
  30: annualAccountForm(),
  31: annualAccountForm(),
  32: ulbForm('xvifc_slb_forms'),
  33: ulbForm('xvifc_bankaccounts', true),
  36: ulbForm('xvifc_dur_forms', true),
};

/** State forms whose rows carry each ULB's own status: an SO return reopens the row of each ULB it was picked for. */
export const CLAIM_LETTER_ROW_FORM_IDS: readonly number[] = [23, 24, 25];

/** Statuses a form or row the letter relied on may hold while the letter waits for the SO (5/7: an earlier letter). */
const CLAIM_READY_STATUSES = [FORM_STATUS.UNDER_REVIEW_BY_MOHUA, FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA];

/** Stored when the SO gave no remark: the letter history requires one per returned form. */
const DEFAULT_RETURN_REMARK = 'Returned for correction';

/** A row form's own reason when the SO returned some of its rows and wrote nothing for the State. */
const ROW_FORM_RETURN_REMARK = "Some ULBs' rows were returned for correction; see each row's remark.";

/** Devolution Formula's formId: its claim child records the exact row each ULB's allocation came from. */
const DEVOLUTION_FORM_ID = 24;

/** Ids per write: keeps each `$in` small however many ULBs a letter holds. */
const WRITE_CHUNK_SIZE = 1000;

export interface ClaimLetterFormMoveSummary {
  /** Forms and rows actually moved to 5, keyed by formId. */
  moved: Record<number, number>;
}

/** One ULB the SO marked returned: its own forms, the State forms whose row for it reopens, and its remark. */
export interface ClaimLetterUlbReturn {
  ulbId: Types.ObjectId;
  ulbFormIds: number[];
  rowFormIds: number[];
  remark: string | null;
  /** Written on the ULB's own forms (Bank Account, DUR, Annual Accounts) so the ULB sees why. */
  decision: DecisionRecord;
}

/** What the SO sends back: each returned ULB's picks, and the State-wide forms (SFC, GTC). */
export interface ClaimLetterReturnSelection {
  ulbReturns: ClaimLetterUlbReturn[];
  stateFormIds: number[];
  stateRemark: string | null;
}

/** One form or row the return reopened, as the letter history records it. */
export interface ClaimLetterReturnedSource {
  formId: number;
  formDocumentId: Types.ObjectId;
  rowDocumentId: Types.ObjectId | null;
  ulbId: Types.ObjectId | null;
  remark: string;
}

interface SourceRef {
  formId: number;
  result: string;
  formDocumentId?: Types.ObjectId | null;
  rowDocumentId?: Types.ObjectId | null;
}

interface CollectionIds {
  target: FormTarget;
  formIds: number[];
  /** Ids the guard checks: the forms the letter's frozen evidence relied on. */
  guard: Set<string>;
  /** Ids to move: the guarded ones plus the selected ULBs' forms found live. */
  write: Set<string>;
}

interface LoadedLetter {
  stateId: Types.ObjectId;
  yearId: Types.ObjectId;
  stateSources: SourceRef[];
  children: { ulbId: Types.ObjectId; devolutionRowId: Types.ObjectId | null; eligibilitySources: SourceRef[] }[];
}

/**
 * Writes the status of the forms a claim letter was built from, in the caller's transaction.
 *
 * State forms and rows come from the evidence frozen on the letter (`PASSED` sources). ULB forms are found live,
 * per selected ULB, through the enabled form-json sources - the same collections the eligibility check reads - so
 * a letter built before a ULB form was configured as a condition still moves that ULB's form. The evidence-based
 * ones are also the lock guard: if any changed after the letter was submitted, the whole approval is refused.
 *
 * Every write is conditional on the form still sitting at its "waiting for a claim letter" status, so a
 * form already at 5 (an earlier letter moved it), exempted, or changed since is skipped, never overwritten.
 * One `updateMany` per collection, not one write per form. An exempted source has nothing to move.
 *
 * Writes the status only. The claim letter's own history (ClaimLetterHistoryService) is the audit trail
 * for this move; the forms' own history collections get no row for it.
 */
@Injectable()
export class ClaimLetterFormStatusService {
  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(ClaimLetterBatch.name) private readonly batchModel: Model<ClaimLetterBatchDocument>,
    @InjectModel(ClaimLetterBatchUlb.name) private readonly batchUlbModel: Model<ClaimLetterBatchUlbDocument>,
    private readonly formJsonService: FormJsonService,
  ) {}

  /** SO approval: the letter's State and ULB forms (and rows) go from their waiting status to 5. */
  async moveFormsToMohuaReview(
    claimLetterId: Types.ObjectId,
    userOid: Types.ObjectId,
    session: ClientSession,
  ): Promise<ClaimLetterFormMoveSummary> {
    const letter = await this.loadLetter(claimLetterId, session);
    const toStatus = FORM_STATUS.UNDER_REVIEW_BY_MOHUA;
    const now = new Date();

    // Ids per collection: `guard` = forms the frozen evidence relied on, `write` = guard plus ULB forms found live.
    const byCollection = new Map<string, CollectionIds>();
    const rowIdsByFormId = new Map<number, Set<string>>();
    const exemptUlbForms = new Set<string>();
    const record = (source: SourceRef, ulbId?: Types.ObjectId) => {
      const target = FORM_TARGETS[source.formId];
      if (!target) return;
      if (source.result === 'EXEMPTED') {
        if (ulbId) exemptUlbForms.add(`${String(ulbId)}:${source.formId}`);
        return;
      }
      if (source.result !== 'PASSED') return;
      if (source.formDocumentId) {
        const entry = this.entryFor(byCollection, target, source.formId);
        entry.guard.add(String(source.formDocumentId));
        entry.write.add(String(source.formDocumentId));
      }
      if (source.rowDocumentId) this.add(rowIdsByFormId, source.formId, source.rowDocumentId);
    };
    letter.stateSources.forEach((source) => record(source));
    for (const child of letter.children) {
      child.eligibilitySources.forEach((source) => record(source, child.ulbId));
      // The Devolution row each selected ULB's allocation came from, recorded on the claim child.
      if (child.devolutionRowId) this.add(rowIdsByFormId, DEVOLUTION_FORM_ID, child.devolutionRowId);
    }

    await this.addSelectedUlbForms(letter, exemptUlbForms, byCollection, session);

    const moved: Record<number, number> = {};
    for (const { target, formIds, guard, write } of byCollection.values()) {
      await this.assertNotChanged(target.collection, target.statusField, [target.fromStatus], [...guard], session);
      const count = await this.updateStatus(
        target.collection,
        target.statusField,
        target.fromStatus,
        [...write],
        { ...target.buildSet(toStatus), updatedBy: userOid, updatedAt: now },
        session,
      );
      moved[formIds[0]] = (moved[formIds[0]] ?? 0) + count;
    }

    for (const [formId, ids] of rowIdsByFormId) {
      const rowCollection = FORM_TARGETS[formId].rowCollection;
      if (!rowCollection) continue;
      const rowFrom = FORM_TARGETS[formId].rowFromStatuses ?? [FORM_STATUS.UNDER_REVIEW_BY_SO];
      await this.assertNotChanged(rowCollection, 'rowStatus', rowFrom, [...ids], session);
      const count = await this.updateStatus(
        rowCollection,
        'rowStatus',
        rowFrom,
        [...ids],
        { rowStatus: toStatus, updatedBy: userOid, updatedAt: now },
        session,
      );
      moved[formId] = (moved[formId] ?? 0) + count;
    }

    return { moved };
  }

  /**
   * SO return: reopens (16) exactly what the SO marked, in the caller's transaction, and nothing else.
   * - A State-wide form (SFC, GTC) goes to 16 with the State remark.
   * - A row form (Elected Body, FC Unspent, Devolution) picked for a returned ULB: that ULB's row goes to 16 with the
   *   ULB's own remark, and the form goes to 16 too, because the State can only edit a row while its form is
   *   editable. Other ULBs' rows keep their status. A row form the letter recorded as exempted has no row to reopen.
   * - A returned ULB's own form goes from 8 to 16 with that ULB's decision; Annual Accounts also marks each
   *   State-approved document returned, since an approved document can't be re-uploaded.
   * Every write is conditional on the status the letter left it in, so a form changed since is not overwritten.
   * Returns what was reopened, for the letter history.
   */
  async returnFormsForCorrection(
    claimLetterId: Types.ObjectId,
    selection: ClaimLetterReturnSelection,
    decision: DecisionRecord,
    session: ClientSession,
  ): Promise<ClaimLetterReturnedSource[]> {
    const letter = await this.loadLetter(claimLetterId, session);
    const childByUlb = new Map(letter.children.map((child) => [String(child.ulbId), child]));
    const outsideLetter = selection.ulbReturns.filter((r) => !childByUlb.has(String(r.ulbId)));
    if (outsideLetter.length) {
      throw new BadRequestException(`${outsideLetter.length} returned ULB(s) are not in this claim letter.`);
    }

    const toStatus = FORM_STATUS.RETURNED_BY_SO;
    const audit = { updatedBy: decision.decidedBy.userId, updatedAt: decision.decidedAt };
    const returned: ClaimLetterReturnedSource[] = [];
    const passedSource = (formId: number) =>
      letter.stateSources.find((s) => s.formId === formId && s.result === 'PASSED' && s.formDocumentId);
    const returnStateForm = async (formId: number, formDocumentId: Types.ObjectId, remark: string | null) => {
      const target = FORM_TARGETS[formId];
      await this.updateStatus(
        target.collection,
        target.statusField,
        [target.fromStatus, ...CLAIM_READY_STATUSES],
        [String(formDocumentId)],
        { ...target.buildSet(toStatus), ...target.buildReturnSet(remark, decision), ...audit },
        session,
      );
      returned.push(this.returnedRef(formId, formDocumentId, null, null, remark));
    };

    for (const formId of selection.stateFormIds) {
      if (!FORM_TARGETS[formId]) continue;
      const source = passedSource(formId);
      if (!source?.formDocumentId) {
        throw new BadRequestException(`Form ${formId} was not submitted as part of this claim letter (exempted), so it cannot be returned.`);
      }
      await returnStateForm(formId, source.formDocumentId, selection.stateRemark);
    }

    for (const formId of CLAIM_LETTER_ROW_FORM_IDS) {
      const ulbReturns = selection.ulbReturns.filter((r) => r.rowFormIds.includes(formId));
      const source = passedSource(formId);
      if (!ulbReturns.length || !source?.formDocumentId) continue;
      const target = FORM_TARGETS[formId];
      const rowsReturned = returned.length;
      for (const ulbReturn of ulbReturns) {
        const child = childByUlb.get(String(ulbReturn.ulbId))!;
        const rowId =
          formId === DEVOLUTION_FORM_ID
            ? child.devolutionRowId
            : (child.eligibilitySources.find((s) => s.formId === formId)?.rowDocumentId ?? null);
        if (!rowId) continue;
        const remark = ulbReturn.remark;
        const count = await this.updateStatus(
          target.rowCollection!,
          'rowStatus',
          [...(target.rowFromStatuses ?? []), ...CLAIM_READY_STATUSES],
          [String(rowId)],
          { rowStatus: toStatus, ...(target.rowRemarkField && { [target.rowRemarkField]: remark }), ...audit },
          session,
        );
        if (count) returned.push(this.returnedRef(formId, source.formDocumentId, rowId, ulbReturn.ulbId, remark));
      }
      // The form follows its rows; its own reason points the State at them unless the SO wrote one for the State.
      if (returned.length > rowsReturned) {
        await returnStateForm(formId, source.formDocumentId, selection.stateRemark ?? ROW_FORM_RETURN_REMARK);
      }
    }

    const withUlbForms = selection.ulbReturns.filter((r) => r.ulbFormIds.length);
    if (withUlbForms.length) {
      const returnByUlb = new Map(withUlbForms.map((r) => [String(r.ulbId), r]));
      const exempt = new Set<string>();
      for (const { ulbId } of withUlbForms) {
        for (const s of childByUlb.get(String(ulbId))!.eligibilitySources) {
          if (s.result === 'EXEMPTED') exempt.add(`${String(ulbId)}:${s.formId}`);
        }
      }
      const formIds = [...new Set(withUlbForms.flatMap((r) => r.ulbFormIds))];
      const live = await this.findWaitingUlbForms(letter, withUlbForms.map((r) => r.ulbId), formIds, session);
      for (const form of live) {
        const ulbReturn = returnByUlb.get(String(form.ulbId));
        if (!ulbReturn?.ulbFormIds.includes(form.formId) || exempt.has(`${String(form.ulbId)}:${form.formId}`)) continue;
        const count = await this.updateStatus(
          form.target.collection,
          form.target.statusField,
          form.target.fromStatus,
          [String(form.id)],
          {
            ...form.target.buildSet(toStatus),
            ...form.target.buildReturnSet(ulbReturn.remark, ulbReturn.decision),
            ...audit,
          },
          session,
          form.target.returnArrayFilters,
        );
        if (count) returned.push(this.returnedRef(form.formId, form.id, null, form.ulbId, ulbReturn.remark));
      }
    }

    return returned;
  }

  private returnedRef(
    formId: number,
    formDocumentId: Types.ObjectId,
    rowDocumentId: Types.ObjectId | null,
    ulbId: Types.ObjectId | null,
    remark: string | null,
  ): ClaimLetterReturnedSource {
    return { formId, formDocumentId, rowDocumentId, ulbId, remark: remark || DEFAULT_RETURN_REMARK };
  }

  /**
   * Adds each selected ULB's own forms that are waiting at 8 (see `findWaitingUlbForms`). A ULB the letter
   * recorded as exempt for a form keeps that form untouched. A form not at 8 is simply not picked up here;
   * only the frozen-evidence forms are guarded.
   */
  private async addSelectedUlbForms(
    letter: LoadedLetter,
    exemptUlbForms: Set<string>,
    byCollection: Map<string, CollectionIds>,
    session: ClientSession,
  ): Promise<void> {
    const ulbIds = letter.children.map((child) => child.ulbId);
    for (const form of await this.findWaitingUlbForms(letter, ulbIds, null, session)) {
      if (exemptUlbForms.has(`${String(form.ulbId)}:${form.formId}`)) continue;
      this.entryFor(byCollection, form.target, form.formId).write.add(String(form.id));
    }
  }

  /**
   * The given ULBs' own forms waiting at 8, found through the enabled ULB-level form-json sources (collection, match
   * and field names exactly as the eligibility check queries them), optionally limited to some formIds.
   */
  private async findWaitingUlbForms(
    letter: LoadedLetter,
    ulbIds: Types.ObjectId[],
    onlyFormIds: number[] | null,
    session: ClientSession,
  ): Promise<{ formId: number; target: FormTarget; id: Types.ObjectId; ulbId: Types.ObjectId }[]> {
    if (ulbIds.length === 0) return [];
    const found: { formId: number; target: FormTarget; id: Types.ObjectId; ulbId: Types.ObjectId }[] = [];

    const sources = await this.formJsonService.findEnabledClaimEligibilitySources(String(letter.yearId));
    for (const formJson of sources) {
      const formId = formJson.formId;
      const config = formJson.claimEligibility;
      const target = formId === undefined ? undefined : FORM_TARGETS[formId];
      const source = config?.source;
      if (!formId || !config || !target || target.fromStatus !== FORM_STATUS.APPROVED_BY_STATE) continue;
      if (onlyFormIds && !onlyFormIds.includes(formId)) continue;
      if (!source?.collection || !source.fields?.ulb) continue;

      const query: Record<string, unknown> = { ...source.match, [source.fields.ulb]: { $in: ulbIds } };
      if (claimSourceFiltersByDesignYear(config)) query[source.fields.designYear] = letter.yearId;
      if (source.fields.state) query[source.fields.state] = letter.stateId;

      const docs = await this.connection
        .collection(source.collection)
        .find(query, { projection: { [source.fields.ulb]: 1, [target.statusField]: 1 }, session })
        .toArray();
      for (const doc of docs) {
        if (doc[target.statusField] !== FORM_STATUS.APPROVED_BY_STATE) continue;
        found.push({ formId, target, id: doc['_id'] as Types.ObjectId, ulbId: doc[source.fields.ulb] as Types.ObjectId });
      }
    }
    return found;
  }

  /** The letter's State sources and its children (selected ULB plus that ULB's frozen sources), ids only. */
  private async loadLetter(claimLetterId: Types.ObjectId, session: ClientSession): Promise<LoadedLetter> {
    const parent = await this.batchModel
      .findById(claimLetterId)
      .select(
        'state year stateEligibilitySources.formId stateEligibilitySources.result stateEligibilitySources.formDocumentId',
      )
      .session(session)
      .lean<{ state: Types.ObjectId; year: Types.ObjectId; stateEligibilitySources?: SourceRef[] }>()
      .exec();
    if (!parent) throw new NotFoundException(`Claim letter ${String(claimLetterId)} not found`);

    // Projected to the id fields only: the evidence blob on each source is large and not needed here.
    const cursor = this.batchUlbModel
      .find({ claimLetter: claimLetterId })
      .select(
        'ulbId devolutionSource.rowDocumentId eligibilitySources.formId eligibilitySources.result eligibilitySources.formDocumentId eligibilitySources.rowDocumentId',
      )
      .session(session)
      .lean<{
        ulbId: Types.ObjectId;
        devolutionSource?: { rowDocumentId?: Types.ObjectId };
        eligibilitySources?: SourceRef[];
      }>()
      .cursor();
    const children: LoadedLetter['children'] = [];
    for await (const child of cursor) {
      children.push({
        ulbId: child.ulbId,
        devolutionRowId: child.devolutionSource?.rowDocumentId ?? null,
        eligibilitySources: child.eligibilitySources ?? [],
      });
    }

    return {
      stateId: parent.state,
      yearId: parent.year,
      stateSources: parent.stateEligibilitySources ?? [],
      children,
    };
  }

  /** Annual Accounts' two section forms share one collection, so ids are grouped per collection. */
  private entryFor(map: Map<string, CollectionIds>, target: FormTarget, formId: number): CollectionIds {
    const entry = map.get(target.collection) ?? {
      target,
      formIds: [],
      guard: new Set<string>(),
      write: new Set<string>(),
    };
    if (!entry.formIds.includes(formId)) entry.formIds.push(formId);
    map.set(target.collection, entry);
    return entry;
  }

  private add(into: Map<number, Set<string>>, formId: number, id: Types.ObjectId): void {
    const set = into.get(formId) ?? new Set<string>();
    set.add(String(id));
    into.set(formId, set);
  }

  /**
   * The claim lock guard for this move: a form the letter relied on must still be waiting at `fromStatus`, or
   * already past it (5 or 7, moved by an earlier letter). Anything else means it changed after the letter was
   * submitted (e.g. the State undid a ULB form's approval), so the whole approval is refused rather than
   * leaving a letter that claims a form no longer ready.
   */
  private async assertNotChanged(
    collection: string,
    statusField: string,
    fromStatuses: (number | null)[],
    ids: string[],
    session: ClientSession,
  ): Promise<void> {
    const target = this.connection.collection(collection);
    const accepted = [...fromStatuses, FORM_STATUS.UNDER_REVIEW_BY_MOHUA, FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA];
    let changed = 0;
    for (let i = 0; i < ids.length; i += WRITE_CHUNK_SIZE) {
      const chunk = ids.slice(i, i + WRITE_CHUNK_SIZE).map((id) => new Types.ObjectId(id));
      changed += await target.countDocuments({ _id: { $in: chunk }, [statusField]: { $nin: accepted } }, { session });
    }
    if (changed > 0) {
      throw new ConflictException(
        `${changed} form(s) in this claim letter changed after it was submitted and are no longer ready. Return the letter to the State instead of approving it.`,
      );
    }
  }

  private async updateStatus(
    collection: string,
    statusField: string,
    fromStatus: number | (number | null)[],
    ids: string[],
    set: Record<string, unknown>,
    session: ClientSession,
    arrayFilters?: Record<string, unknown>[],
  ): Promise<number> {
    const target = this.connection.collection(collection);
    let modified = 0;
    for (let i = 0; i < ids.length; i += WRITE_CHUNK_SIZE) {
      const chunk = ids.slice(i, i + WRITE_CHUNK_SIZE).map((id) => new Types.ObjectId(id));
      const result = await target.updateMany(
        { _id: { $in: chunk }, [statusField]: Array.isArray(fromStatus) ? { $in: fromStatus } : fromStatus },
        { $set: set },
        { session, ...(arrayFilters && { arrayFilters }) },
      );
      modified += result.modifiedCount;
    }
    return modified;
  }
}
