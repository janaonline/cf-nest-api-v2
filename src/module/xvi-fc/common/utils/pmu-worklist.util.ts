import { Logger } from '@nestjs/common';
import type { FilterQuery, Model, Types } from 'mongoose';
import { Types as MongooseTypes } from 'mongoose';
import { FORM_STATUS, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import { State, StateDocument } from 'src/schemas/state.schema';
import type { PmuWorklistRow, PmuWorklistSummary } from '../types/pmu-worklist.type';
import { isPmuWorklistSummaryBalanced, summarizePmuWorklist } from './pmu-worklist-summary.util';
import {
  PMU_WORKLIST_PAGINATION_DEFAULT_LIMIT,
  PMU_WORKLIST_PAGINATION_DEFAULT_PAGE,
} from '../constants/pmu-worklist-pagination.constants';

interface LeanWorklistForm {
  state: Types.ObjectId;
  installment?: number;
  currentFormStatus: number;
  updatedAt: Date;
}

export interface BuildPmuWorklistRowsParams<TFormDoc> {
  stateModel: Model<StateDocument>;
  formModel: Model<TFormDoc>;
  yearId: string;
  /** Merged into `{ year: yearOid }` — e.g. `{ formType: SFC_STATUS_FORM_TYPE }`. Omit when the
   *  form schema has no such discriminator (GTC, Devolution Formula). */
  extraFormFilter?: FilterQuery<TFormDoc>;
  /** When given, crosses every state with every installment value (GTC, Devolution Formula)
   *  instead of one row per state (SFC Status, Elected Urban Local Bodies, FC Unspent
   *  Declaration). Assumes the form schema has an `installment` field when this is set. */
  installments?: readonly number[];
  /** Applied to the synthesized row list, after the join — see `buildPmuWorklistRows`'s own
   *  docblock below for why filtering/sorting/paging all happen here rather than on the state/form
   *  queries. */
  stateId?: string;
  /** Narrows an installment-scoped form (GTC, Devolution Formula) to one installment; ignored when
   *  `installments` is not set. Applied before the summary, so the cards reflect the same scope. */
  installment?: number;
  status?: number;
  sortBy?: string;
  sortDir?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface PmuWorklistRowsResult {
  rows: PmuWorklistRow[];
  /** Counts for the overview cards: computed before the `status` filter and before paging. */
  summary: PmuWorklistSummary;
  page: number;
  limit: number;
  total: number;
}

/**
 * Cross-state list backing every PMU worklist page: every active+published, non-UT state,
 * left-joined against whatever form document (if any) exists for it this year (and installment,
 * when applicable). A missing document gets a synthesized `NOT_STARTED` row — each of the 5 PMU
 * review services' own `getWorklist` already treated a missing document this way; this is that
 * same query/join logic extracted once instead of re-pasted per form.
 *
 * The state query's `.limit(30)` is an intentional ceiling for India's 28 states (plus margin),
 * not a page size — left untouched. Filtering/sorting/pagination apply to the *synthesized* row
 * list instead, after the join: for the 2-installment modules (GTC, Devolution Formula) a state
 * maps to 2 rows, so paginating the state query itself would make `limit` mean a different row
 * count depending which module you called. One state's installment rows can straddle a page
 * boundary as a result — nothing is dropped or duplicated, a reviewer paging through sees every row.
 */
const logger = new Logger('buildPmuWorklistRows');

export async function buildPmuWorklistRows<TFormDoc>(
  params: BuildPmuWorklistRowsParams<TFormDoc>,
): Promise<PmuWorklistRowsResult> {
  const yearOid = new MongooseTypes.ObjectId(params.yearId);
  const select: Record<string, 0 | 1> = { _id: 0, state: 1, currentFormStatus: 1, updatedAt: 1 };
  if (params.installments) select['installment'] = 1;

  const [states, forms] = await Promise.all([
    params.stateModel
      .find({ isActive: true, isPublish: true, isUT: false }, { name: 1 })
      .sort({ name: 1 })
      // Ceiling, not a page size — India has 28 states; this guards against unbounded growth.
      .skip(0)
      .limit(30)
      .lean(),
    params.formModel
      .find({ year: yearOid, ...params.extraFormFilter } as FilterQuery<TFormDoc>)
      .select(select)
      .lean<LeanWorklistForm[]>()
      .exec(),
  ]);

  let rows: PmuWorklistRow[];
  if (params.installments) {
    const byKey = new Map(forms.map((f) => [`${f.state.toString()}:${f.installment}`, f]));
    rows = states.flatMap((s) =>
      params.installments!.map((installment) => {
        const form = byKey.get(`${s._id.toString()}:${installment}`);
        return {
          stateId: s._id.toString(),
          stateName: s.name,
          currentFormStatus: form?.currentFormStatus ?? FORM_STATUS.NOT_STARTED,
          currentFormStatusLabel: getFormStatusLabel(form?.currentFormStatus ?? FORM_STATUS.NOT_STARTED),
          updatedAt: form ? form.updatedAt.toISOString() : null,
          installment,
        } as PmuWorklistRow;
      }),
    );
  } else {
    const byState = new Map(forms.map((f) => [f.state.toString(), f]));
    rows = states.map((s) => {
      const form = byState.get(s._id.toString());
      return {
        stateId: s._id.toString(),
        stateName: s.name,
        currentFormStatus: form?.currentFormStatus ?? FORM_STATUS.NOT_STARTED,
        currentFormStatusLabel: getFormStatusLabel(form?.currentFormStatus ?? FORM_STATUS.NOT_STARTED),
        updatedAt: form ? form.updatedAt.toISOString() : null,
      };
    });
  }

  if (params.stateId) rows = rows.filter((r) => r.stateId === params.stateId);
  if (params.installments && params.installment !== undefined) {
    rows = rows.filter((r) => r.installment === params.installment);
  }

  // Cards describe the whole scope (form + state + installment), so they must be taken before the
  // Form Status filter narrows `rows` and before paging slices it.
  const summary = summarizePmuWorklist(rows);
  if (process.env['NODE_ENV'] !== 'production' && !isPmuWorklistSummaryBalanced(summary)) {
    logger.warn(
      `PMU worklist summary does not add up to N (an unmapped status or duplicate records): ${JSON.stringify(summary)}`,
    );
  }

  if (params.status !== undefined) rows = rows.filter((r) => r.currentFormStatus === params.status);

  if (params.sortBy) {
    const sortBy = params.sortBy;
    const dir = params.sortDir === 'desc' ? -1 : 1;
    rows = [...rows].sort((a, b) => {
      const av = (a as unknown as Record<string, unknown>)[sortBy];
      const bv = (b as unknown as Record<string, unknown>)[sortBy];
      if (av == null && bv == null) return 0;
      if (av == null) return -1 * dir;
      if (bv == null) return 1 * dir;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }

  const total = rows.length;
  const page = params.page ?? PMU_WORKLIST_PAGINATION_DEFAULT_PAGE;
  const limit = params.limit ?? PMU_WORKLIST_PAGINATION_DEFAULT_LIMIT;
  const skip = (page - 1) * limit;

  return { rows: rows.slice(skip, skip + limit), summary, page, limit, total };
}
