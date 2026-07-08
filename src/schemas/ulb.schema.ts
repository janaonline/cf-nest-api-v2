import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { CommonFile, CommonFileSchema } from 'src/schemas/common/file.schema';

@Schema()
export class GSDPEligibility {
  @Prop({ type: Boolean, default: false })
  eligible: boolean;

  @Prop({ type: Boolean, default: false })
  upload: boolean;
}

export const GSDPEligibilitySchema = SchemaFactory.createForClass(GSDPEligibility);

@Schema()
export class DulyElected {
  @Prop({ type: Boolean, default: false })
  eligible: boolean;

  @Prop({ type: Date })
  electedDate: Date;
}

export const DulyElectedSchema = SchemaFactory.createForClass(DulyElected);

@Schema({ _id: false })
export class Approval {
  // ULBs created by ADMIN are auto-approved (service sets 'APPROVED' at create time).
  // ULBs created by a STATE user start 'PENDING' until an ADMIN approves/rejects them.
  @Prop({ type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'APPROVED', index: true })
  status: 'PENDING' | 'APPROVED' | 'REJECTED';

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  submittedBy: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  reviewedBy: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  reviewedAt: Date | null;

  @Prop({ default: '' })
  rejectReason: string;
}

export const ApprovalSchema = SchemaFactory.createForClass(Approval);

@Schema({ timestamps: { createdAt: 'createdAt', updatedAt: 'modifiedAt' } })
export class Ulb {
  @Prop({ required: true, unique: true, index: true })
  code: string;

  @Prop({ required: true, unique: true, index: true })
  name: string;

  @Prop({ unique: true, index: true })
  slug: string;

  // No `default: null` — a sparse unique index only excludes documents where the
  // field is entirely absent; an explicit `null` still counts as a value and would
  // collide across every ULB missing a census code.
  @Prop({ unique: true, sparse: true, index: true })
  censusCode: string;

  @Prop({ default: null })
  sbCode: string;

  @Prop({ default: 0 })
  population: number;

  @Prop({ default: 0 })
  area: number;

  @Prop({ default: 0 })
  wards: number;

  @Prop({ type: Types.ObjectId, ref: 'UlbType', required: true })
  ulbType: Types.ObjectId;

  @Prop({ default: null })
  natureOfUlb: string;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: Boolean, default: true })
  isPublish: boolean;

  @Prop({ type: Boolean, default: true })
  access_2021: boolean;

  @Prop({ type: Boolean, default: true })
  access_2122: boolean;

  @Prop({ type: Boolean, default: true })
  access_2223: boolean;

  @Prop({ type: Boolean, default: true })
  access_2324: boolean;

  @Prop({ type: Boolean, default: true })
  access_2425: boolean;

  @Prop({ type: Boolean, default: true })
  access_2526: boolean;

  @Prop({ type: Types.ObjectId, ref: 'State', required: true })
  state: Types.ObjectId;

  @Prop({
    type: {
      lat: { type: String, default: '0.0' },
      lng: { type: String, default: '0.0' },
    },
    _id: false,
  })
  location: {
    lat: string;
    lng: string;
  };

  @Prop({ default: '' })
  district: string;

  @Prop({ default: '' })
  censusType: string;

  @Prop({ enum: ['YES', 'No'], default: 'No' })
  isUA: string;

  @Prop({ type: Types.ObjectId, ref: 'UA' })
  UA: Types.ObjectId;

  @Prop({ enum: ['YES', 'No'], default: 'No' })
  isMillionPlus: string;

  @Prop({ default: '' })
  amrut: string;

  @Prop({ default: '' })
  lgdCode: string;

  @Prop({ default: '' })
  population_source: string;

  @Prop({ default: '' })
  areaSource: string;

  @Prop({ default: '' })
  wardSource: string;

  @Prop({ default: '' })
  districtSoure: string;

  @Prop({ default: '' })
  creditRating: string;

  @Prop()
  keywords: string;

  @Prop({ default: '' })
  regionalName: string;

  // ── Constitution & legal basis ─────────────────────────────────────────────
  @Prop({ type: Date, default: null })
  dateOfConstitution: Date | null;

  @Prop({ default: '' })
  gazetteNotificationNumber: string;

  @Prop({ type: CommonFileSchema, default: null })
  gazetteNotificationFile: CommonFile | null;

  // ── Approval workflow ──────────────────────────────────────────────────────
  @Prop({ type: ApprovalSchema, default: () => ({}) })
  approval: Approval;

  @Prop({
    type: {
      '2023-24': GSDPEligibilitySchema,
      '2024-25': GSDPEligibilitySchema,
    },
    _id: false,
  })
  gsdp: {
    '2023-24': GSDPEligibility;
    '2024-25': GSDPEligibility;
  };

  @Prop({
    type: { '2023-24': DulyElectedSchema, '2024-25': DulyElectedSchema },
    _id: false,
  })
  dulyElected: {
    '2023-24': DulyElected;
    '2024-25': DulyElected;
  };
}

export type UlbDocument = Ulb & Document;
export const UlbSchema = SchemaFactory.createForClass(Ulb);

UlbSchema.index({ state: 1, isActive: 1 });
UlbSchema.index({ state: 1, 'approval.status': 1 });
