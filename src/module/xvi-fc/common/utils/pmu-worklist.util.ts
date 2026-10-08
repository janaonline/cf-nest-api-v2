import type { FilterQuery, Model, Types } from 'mongoose';
import { Types as MongooseTypes } from 'mongoose';
import { FORM_STATUS, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import { State, StateDocument } from 'src/schemas/state.schema';
import type { PmuWorklistRow } from '../types/pmu-worklist.type';

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
}

/**
 * Cross-state list backing every PMU worklist page: every active+published, non-UT state,
 * left-joined against whatever form document (if any) exists for it this year (and installment,
 * when applicable). A missing document gets a synthesized `NOT_STARTED` row — each of the 5 PMU
 * review services' own `getWorklist` already treated a missing document this way; this is that
 * same query/join logic extracted once instead of re-pasted per form.
 *
 * Deliberately preserves the existing `.skip(0).limit(30)` page-size cap (tagged upstream with a
 * "TODO: Clean up card — hardcoded page size, no real pagination UI yet" comment in every one of
 * the 5 original implementations) — fixing that is a product/UI decision, not part of this
 * duplication-removal refactor, so behavior stays byte-for-byte identical here.
 */
export async function buildPmuWorklistRows<TFormDoc>(
  params: BuildPmuWorklistRowsParams<TFormDoc>,
): Promise<PmuWorklistRow[]> {
  const yearOid = new MongooseTypes.ObjectId(params.yearId);
  const select: Record<string, 0 | 1> = { _id: 0, state: 1, currentFormStatus: 1, updatedAt: 1 };
  if (params.installments) select['installment'] = 1;

  const [states, forms] = await Promise.all([
    params.stateModel
      .find({ isActive: true, isPublish: true, isUT: false }, { name: 1 })
      .sort({ name: 1 })
      // TODO: Clean up card — hardcoded page size, no real pagination UI yet.
      .skip(0)
      .limit(30)
      .lean(),
    params.formModel
      .find({ year: yearOid, ...params.extraFormFilter } as FilterQuery<TFormDoc>)
      .select(select)
      .lean<LeanWorklistForm[]>()
      .exec(),
  ]);

  if (params.installments) {
    const byKey = new Map(forms.map((f) => [`${f.state.toString()}:${f.installment}`, f]));
    return states.flatMap((s) =>
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
  }

  const byState = new Map(forms.map((f) => [f.state.toString(), f]));
  return states.map((s) => {
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
