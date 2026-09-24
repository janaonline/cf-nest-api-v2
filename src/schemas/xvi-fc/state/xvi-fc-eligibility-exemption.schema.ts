import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { FileInfo, FileInfoSchema } from 'src/schemas/common/file.schema';

export const REQUEST_EXEMPTION_FORM_TYPE = 'REQUEST_EXEMPTION';
export const REQUEST_EXEMPTION_FORM_ID = 34;

/**
 * The formIds a state may request a discretionary exemption for are per-year data, not a compiled
 * constant — see `RequestExemptionFormJsonConfigService.loadReasonOptions`, which reads them from
 * the `formjsons` document (formId 34, field key `reasonForExemption`). Today that set is TS-133's
 * "Requested" conditions (Elected Body / Audited AFS / Provisional AFS). SFC (formId 22) is
 * deliberately excluded: `sfc-status.schema.ts` has no `ulb` field at all (it's a flat {state,
 * year} document, evaluated once for the whole state in `evaluateStateLevelGate`), so it has no
 * per-ULB unit this mechanism could ever exempt. See the request-exemption feature plan for the
 * full reasoning; a state-level gate exemption (SFC or otherwise) is a distinct, deferred feature.
 */
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
 * The discretionary STATE -> MoHUA exemption request ("Request Exemption") — one document per
 * `{ulb, year}` (DB-enforced via a unique index below), holding one `data[]` entry per requested
 * `formId`. A state can still file "Elected Body" one day and, separately, "Audited AFS" the next
 * for the *same* ULB — both live as two entries on the *same* document, not two documents.
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

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Ulb', required: true })
  ulb!: Types.ObjectId;

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
// current entry per formId, ever" (see XviFcEligibilityExemptionEntry's own doc-comment).
XviFcEligibilityExemptionSchema.index({ ulb: 1, year: 1 }, { unique: true });
// Backs list()'s existing query shape — many ULBs per state+year.
XviFcEligibilityExemptionSchema.index({ state: 1, year: 1 });
// Multikey index over the array, forward-looking for the (not yet built) MoHUA review queue.
XviFcEligibilityExemptionSchema.index({ 'data.currentFormStatus': 1 });
