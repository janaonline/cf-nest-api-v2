import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ _id: false })
class FiscalRanking {
  @Prop({ type: String, index: true, enum: ['2022-23', '2023-24'] })
  rankingYear: string;

  @Prop({ type: Number, default: 0 })
  totalUlbs: number;

  @Prop({ type: Number, default: 0 })
  participatedUlbsPercentage: number;

  @Prop({ type: Number, default: 0 })
  participatedUlbs: number;

  @Prop({ type: Number, default: 0 })
  rankedUlbs: number;

  @Prop({ type: Number, default: 0 })
  nonRankedUlbs: number;

  @Prop({ type: Number, default: 0 })
  auditedAccountsCount: number;

  @Prop({ type: Number, default: 0 })
  annualBudgetsCount: number;
}
const FiscalRankingSchema = SchemaFactory.createForClass(FiscalRanking);

@Schema({ timestamps: { createdAt: 'createdAt', updatedAt: 'modifiedAt' } })
export class State {
  @Prop({ type: String, required: true, unique: true })
  name: string;

  @Prop({ type: String, unique: true })
  slug: string;

  @Prop({ type: String, required: true, unique: true })
  code: string;

  @Prop({ type: String, default: '' })
  regionalName: string;

  @Prop({ type: String, default: null })
  censusCode: string | null;

  @Prop({ type: Boolean, default: 1 })
  isActive: boolean;

  @Prop({ type: Boolean, default: 1 })
  isPublish: boolean;

  @Prop({ type: Boolean, default: 0 })
  isUT: boolean;

  // ----- CFR. -----
  @Prop({ type: [FiscalRankingSchema], default: [] })
  fiscalRanking: FiscalRanking[];

  @Prop({ type: String, enum: ['Large', 'Small', 'UT'] })
  stateType: string;

  @Prop({ type: Number })
  gsdpGrowthRate: number;

  @Prop({ type: Boolean })
  isHilly: boolean;

  // auditedAccounts: [yearCount],
  // annualBudgets: [yearCount],
}

export type StateDocument = State & Document;
export const StateSchema = SchemaFactory.createForClass(State);

// Compound index to ensure one record.
StateSchema.index({ name: 1, code: 1, slug: 1, isActive: 1, isPublish: 1 });
