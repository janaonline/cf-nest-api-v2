import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Role } from '../../module/auth/enum/role.enum';

@Schema({ timestamps: true })
export class User extends Document {
  @Prop({ required: true })
  name!: string;

  @Prop({ type: String, default: null })
  mobile!: string;

  @Prop({ required: true, unique: true })
  email!: string;

  @Prop({ required: true, select: false })
  password!: string;

  @Prop({ type: Number, required: true, default: 0, select: false })
  loginAttempts!: number;

  @Prop({ type: Number, select: false })
  lockUntil!: number;

  @Prop({ type: Boolean, default: false, select: false })
  isLocked!: boolean;

  @Prop({ type: String, enum: Object.values(Role), required: true })
  role!: Role;

  @Prop({ type: String, required: false })
  username!: string;

  @Prop({ type: String, default: null })
  sbCode!: string;

  @Prop({ type: String, default: null })
  censusCode!: string;

  @Prop({ type: String, default: '' })
  designation!: string;

  @Prop({ type: String, default: '' })
  organization!: string;

  @Prop({ type: Types.ObjectId, ref: 'State' })
  state!: Types.ObjectId;

  @Prop({ type: String, default: '' })
  departmentName!: string;

  @Prop({ type: String, default: '' })
  departmentContactNumber!: string;

  @Prop({ type: String, default: '' })
  departmentEmail!: string;

  @Prop({ type: String, default: '' })
  address!: string;

  @Prop({ type: Types.ObjectId, ref: 'Ulb', index: true })
  ulb!: Types.ObjectId;

  @Prop({ type: String, default: '' })
  commissionerName!: string;

  @Prop({ type: String, default: '' })
  commissionerEmail!: string;

  @Prop({ type: String, default: '' })
  commissionerConatactNumber!: string;

  @Prop({ type: String, default: '' })
  accountantName!: string;

  @Prop({ type: String, default: '' })
  accountantEmail!: string;

  @Prop({ type: String, default: '' })
  accountantConatactNumber!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy!: Types.ObjectId;

  @Prop({ type: String, enum: ['PENDING', 'APPROVED', 'REJECTED', 'NA'], default: 'NA' })
  status!: string;

  @Prop({ type: String, default: '' })
  rejectReason!: string;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  @Prop({ type: Boolean, default: true })
  isEmailVerified!: boolean;

  @Prop({ type: Boolean, default: false, select: false })
  isPasswordResetInProgress!: boolean;

  @Prop({ type: Boolean, default: false })
  isDeleted!: boolean;

  @Prop({ type: Number, select: false })
  passwordExpires!: number;

  @Prop({ type: Array, default: [], select: false })
  passwordHistory!: string[];

  @Prop({ type: Boolean, default: false })
  isRegistered!: boolean;

  @Prop({ type: Boolean, default: false })
  isVerified2223!: boolean;

  @Prop({ type: Boolean, default: false })
  isNodalOfficer!: boolean;

  @Prop({ type: Number })
  otpAttempts!: number;

  @Prop({ type: Date })
  otpBlockedUntil!: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
