import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Types } from 'mongoose';
import { Role } from '../module/auth/enum/role.enum';

@Schema({ timestamps: true })
export class User extends Document {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true, unique: true })
  email: string;

  @Prop()
  age: number;

  @Prop({ type: String, enum: Object.values(Role), required: true })
  role: Role;

  @Prop({ type: Boolean, default: true })
  isActive: boolean;

  @Prop({ type: Types.ObjectId, ref: 'Ulb' })
  ulb: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'State' })
  state: Types.ObjectId;
}

export const UserSchema = SchemaFactory.createForClass(User);
