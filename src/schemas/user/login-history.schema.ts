import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';

export type LoginType = 'fiscalRankings' | '15thFC' | 'AAINA' | 'XVIFC' | 'state-dashboard';

@Schema({ timestamps: true })
export class LoginHistory extends Document {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  user!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'VisitSession', default: null })
  visitSession!: Types.ObjectId;

  @Prop({ type: Date, default: () => new Date() })
  loggedInAt!: Date;

  @Prop({ type: Date, default: null })
  loggedOutAt!: Date;

  @Prop({
    type: String,
    default: '15thFC',
    enum: {
      values: ['fiscalRankings', '15thFC', 'AAINA', 'XVIFC', 'state-dashboard'],
      message: "ERROR: STATUS BE EITHER 'Fiscal Ranking'/ '15th FC'/ '16th FC' / 'state-dashboard'",
    },
  })
  loginType!: LoginType;

  @Prop({ type: Array, default: [] })
  reports!: any[];

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  @Prop({ type: Number })
  inactiveSessionTime!: number;

  @Prop({ type: String, default: null })
  refreshTokenHash!: string;

  @Prop({ type: String, default: null })
  currentRefreshTokenId!: string;

  @Prop({ type: Date, default: null })
  refreshTokenIssuedAt!: Date;

  @Prop({ type: Date, default: null })
  refreshTokenLastUsedAt!: Date;

  @Prop({ type: Date, default: null })
  refreshTokenRotatedAt!: Date;
}

export const LoginHistorySchema = SchemaFactory.createForClass(LoginHistory);
