import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { FileInfo, FileInfoSchema } from 'src/schemas/common/file.schema';

export const REQUEST_EXEMPTION_FORM_TYPE = 'REQUEST_EXEMPTION';
export const REQUEST_EXEMPTION_FORM_ID = 34;

/** `formjsons` field keys for this form (formId 34) — see `RequestExemptionFormJsonConfigService`,
 *  which reads each key's live `options` from the `formjsons` document rather than a compiled
 *  constant, so the offered reasons can grow without a schema change. `EXEMPTION_FOR_FIELD_KEY`
 *  drives which of the two reason fields applies: `'ULB'` -> `REASON_FIELD_KEY_ULB` (per-ULB
 *  reasons, e.g. Elected Body/Audited AFS/Provisional AFS — formIds 23/30/31 today), `'STATE'` ->
 *  `REASON_FIELD_KEY_STATE` (whole-state reasons, e.g. SFC extension/compliance — formId 22
 *  today). See `XviFcEligibilityExemption.ulb`'s own doc-comment for how the two branches are
 *  told apart in storage. */
export const EXEMPTION_FOR_FIELD_KEY = 'exemptionFor';
export const REASON_FIELD_KEY_ULB = 'reasonForExemption';
export const REASON_FIELD_KEY_STATE = 'reasonForExemptionState';

export type XviFcEligibilityExemptionDocument = HydratedDocument<XviFcEligibilityExemption>;

/**
 * One entry per requested `formId` — never two entries with the same `formId` in the same
 * document (enforced in `RequestExemptionService`, not the schema — an array `enum`-of-unique
 * can't be expressed at the schema level the way a scalar enum can). A rejected entry
 * (`RETURNED_BY_MOHUA`) stays in its slot, visible and inert — there's no "edit" operation exposed
 * on it (the only write path is `finalSubmit`, which always writes a whole new entry object, never
 * a partial patch). A later submission for that same `formId` wholesale-replaces that slot: fresh
 * `supportingDetails`/`supportingFile`/`submittedBy`/`submittedAt`, `decidedBy`/`decidedAt`/
 * `mohuaRemarks` cleared back to `null` — nothing carries over except the `formId` key itself. This
 * reuses the exact in-place-revision convention every other state form here already uses for a
 * returned document; deliberately not a "physically remove + archive to history" pattern (no such
 * mechanism exists anywhere else in this codebase). See `RequestExemptionService.finalSubmit`.
 */
@Schema({ _id: false, versionKey: false })
export class XviFcEligibilityExemptionEntry {
  @Prop({ type: Number, required: true })
  formId!: number;

  /** Shared FORM_STATUS enum — only ever `UNDER_REVIEW_BY_MOHUA`, `RETURNED_BY_MOHUA`, or
   *  `SUBMISSION_ACKNOWLEDGED_BY_MOHUA` for an entry (this form has no draft step and no
   *  STATE-review leg — every entry is created straight at `UNDER_REVIEW_BY_MOHUA`, same as FC
   *  Unspent Declaration). */
  @Prop({ type: Number, required: true })
  currentFormStatus!: number;

  @Prop({ type: String, default: '' })
  supportingDetails!: string;

  @Prop({ type: FileInfoSchema, default: null })
  supportingFile!: FileInfo | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  submittedBy!: Types.ObjectId;

  @Prop({ type: Date, required: true })
  submittedAt!: Date;

  /** Only ever set once this entry is `SUBMISSION_ACKNOWLEDGED_BY_MOHUA` — a rejected entry is
   *  never left showing a stale prior decision once it's been wholesale-replaced by a fresh
   *  attempt (cleared back to `null` at that point). */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  decidedBy?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  decidedAt?: Date | null;

  /** MoHUA's reason on reject — required non-empty at the point of rejection (enforced in the
   *  service, not the schema), retained afterward so the state can see why until this entry is
   *  wholesale-replaced by a fresh attempt. */
  @Prop({ type: String, default: null })
  mohuaRemarks?: string | null;
}

export const XviFcEligibilityExemptionEntrySchema = SchemaFactory.createForClass(XviFcEligibilityExemptionEntry);

/**
 * The discretionary STATE -> MoHUA exemption request ("Request Exemption"). Two shapes share this
 * one collection:
 * - **Per-ULB** (`ulb` a real ObjectId): one document per `{ulb, year}` (DB-enforced by the first
 *   partial unique index below), holding one `data[]` entry per requested `formId`. A state can
 *   still file "Elected Body" one day and, separately, "Audited AFS" the next for the *same*
 *   ULB — both live as two entries on the *same* document, not two documents.
 * - **Whole-state** (`ulb: null`): one document per `{state, year}` (DB-enforced by the second
 *   partial unique index below) — the user-facing "Entire State" branch (e.g. SFC extension/
 *   compliance). Deliberately reuses this same schema/collection rather than a second one: every
 *   other piece of the lifecycle (status enum, transaction shape, permission model, MoHUA
 *   approve/reject, the per-formId entry array) is identical between the two, and a later
 *   "does ULB X inherit its state's whole-state exemption" resolver becomes a single `{$or:
 *   [{ulb:X},{state:S,ulb:null}]}` query against one collection instead of a two-collection union.
 *   See `EXEMPTION_FOR_FIELD_KEY`/`REASON_FIELD_KEY_STATE` above for the form-side field that
 *   drives this branch, and `RequestExemptionService.validateAndSanitize` for the server-side
 *   enforcement that a whole-state document can only ever carry whole-state-reason formIds.
 * Collection name follows the module's `xvifc_...` convention (`xvifc_annualaccounts`,
 * `xvifc_bankaccounts`, `xvifc_sfc`, etc.).
 */
@Schema({
  collection: 'xvifc_eligibility_exemptions',
  timestamps: true,
  versionKey: false,
})
export class XviFcEligibilityExemption {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'State', required: true })
  state!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  year!: Types.ObjectId;

  /** `null` = a whole-state request, applying to every ULB in `state` — never absent/undefined on
   *  a whole-state document (always an explicit `null`), since the second partial unique index
   *  below keys off exactly that. A real ObjectId = a per-ULB request, as before. */
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Ulb', default: null })
  ulb!: Types.ObjectId | null;

  @Prop({ type: [XviFcEligibilityExemptionEntrySchema], default: [] })
  data!: XviFcEligibilityExemptionEntry[];

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  updatedBy!: Types.ObjectId;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  @Prop({ type: Boolean, default: false })
  isDeleted!: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

export const XviFcEligibilityExemptionSchema = SchemaFactory.createForClass(XviFcEligibilityExemption);

// One document per ULB per design year — the actual DB-enforced guarantee behind "at most one
// current entry per formId, ever" (see XviFcEligibilityExemptionEntry's own doc-comment). Scoped
// to real-ULB documents only (partialFilterExpression) — same pattern already used for this exact
// "sometimes-null ref" problem in devolution-formula-row.schema.ts.
XviFcEligibilityExemptionSchema.index(
  { ulb: 1, year: 1 },
  { unique: true, partialFilterExpression: { ulb: { $type: 'objectId' } }, name: 'uniq_ulb_year_exemption' },
);
// One whole-state (ulb: null) document per state per design year — the DB-enforced guarantee
// behind "one entry per state, never duplicated per ULB" for the whole-state branch.
XviFcEligibilityExemptionSchema.index(
  { state: 1, year: 1 },
  { unique: true, partialFilterExpression: { ulb: { $type: 'null' } }, name: 'uniq_state_year_exemption_no_ulb' },
);
// Backs list()'s existing query shape — many ULBs (and, now, the whole-state doc) per state+year.
XviFcEligibilityExemptionSchema.index({ state: 1, year: 1 });
// Multikey index over the array, forward-looking for the (not yet built) MoHUA review queue.
XviFcEligibilityExemptionSchema.index({ 'data.currentFormStatus': 1 });
