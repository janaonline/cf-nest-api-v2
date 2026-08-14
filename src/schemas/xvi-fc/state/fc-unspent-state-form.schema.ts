import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { FileInfo, FileInfoSchema } from 'src/schemas/common/file.schema';

export const FC_UNSPENT_STATE_FORM_TYPE = 'FC_UNSPENT_STATE';

export type ApplicableFc = '14TH_FC' | '15TH_FC';

export type XviFcUnspentStateFormDocument = HydratedDocument<XviFcUnspentStateForm>;

@Schema({
  collection: 'xvifc_unspent_state_forms',
  timestamps: true,
  versionKey: false,
})
export class XviFcUnspentStateForm {
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'State', required: true })
  state!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Year', required: true })
  year!: Types.ObjectId;

  @Prop({ type: String, default: FC_UNSPENT_STATE_FORM_TYPE, immutable: true })
  formType!: string;

  @Prop({ type: Number, default: FORM_STATUS.NOT_STARTED })
  currentFormStatus!: number;

  @Prop({ type: Boolean, default: null })
  isFcUnspent!: boolean | null;

  /** Signed nil-balance declaration, uploaded only when isFcUnspent is false. */
  @Prop({ type: FileInfoSchema, default: null })
  fcDeclaration!: FileInfo | null;

  /**
   * Signed unspent-balance declaration (carries the ULB-wise table), uploaded only when
   * isFcUnspent is true.
   * Kept separate from fcDeclaration so each branch clears its own file on yes <-> no switches, preventing stale uploads.
   */
  @Prop({ type: FileInfoSchema, default: null })
  fcUnspentDeclaration!: FileInfo | null;

  @Prop({ type: Boolean, default: false })
  checkboxConfirmation!: boolean;

  /**
   * Mirrors currentFormStatus for quick "still a draft" checks — true while
   * NOT_STARTED/IN_PROGRESS/RETURNED_BY_MOHUA, false from final submit onward.
   */
  @Prop({ type: Boolean, default: true })
  isDraft!: boolean;

  @Prop({ type: String, default: null })
  mohuaRemarks?: string | null;

  /**
   * Stored for audit only; GET always re-derives applicableFc from the current year -> FC mapping, preventing stale data from becoming authoritative
   */
  @Prop({ type: String, enum: ['14TH_FC', '15TH_FC'], default: null })
  applicableFc?: ApplicableFc | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', default: null })
  submittedBy?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  submittedAt?: Date | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  createdBy!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  updatedBy!: Types.ObjectId;

  /** Incremented only on final submit (not on draft saves). */
  @Prop({ type: Number, default: 0 })
  auditRevision!: number;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  @Prop({ type: Boolean, default: false })
  isDeleted!: boolean;

  createdAt?: Date;
  updatedAt?: Date;
}

export const XviFcUnspentStateFormSchema = SchemaFactory.createForClass(XviFcUnspentStateForm);

XviFcUnspentStateFormSchema.index({ state: 1, year: 1, formType: 1 }, { unique: true });
