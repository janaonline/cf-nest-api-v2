import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';

export enum EventStatus {
  INACTIVE = 0,
  ACTIVE = 1,
  DRAFT = 2,
}

export const CONSTRAINTS = {
  title: {
    maxLength: 100,
    minLength: 10,
  },
  desc: {
    maxLength: 1000,
    minLength: 50,
  },
};

export type EventChange = Record<string, { old: unknown; new: unknown }>;

export class EventHistory {
  @Prop({ required: true, default: new Date() })
  changeAt: Date;

  @Prop({ type: Object, required: true })
  changes: EventChange;
}

@Schema({ timestamps: true })
export class Event {
  @Prop({
    required: true,
    trim: true,
    maxLength: CONSTRAINTS.title.maxLength,
    minLength: CONSTRAINTS.title.minLength,
  })
  title: string;

  @Prop({
    required: true,
    trim: true,
    maxLength: CONSTRAINTS.desc.maxLength,
    minLength: CONSTRAINTS.desc.minLength,
  })
  desc: string;

  @Prop({ required: true, default: EventStatus.ACTIVE })
  eventStatus: EventStatus;

  @Prop({ required: true })
  startAt: Date;

  @Prop({ required: true })
  endAt: Date;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  deleteBy: Types.ObjectId;

  @Prop({ trim: true })
  redirectionLink?: string;

  @Prop({ type: Types.ObjectId, ref: 'FormJson' })
  formId?: Types.ObjectId;

  @Prop({ type: [String], default: [] })
  buttonLabels?: string[];

  @Prop({ type: [String], default: [] })
  imgUrl?: string[];

  @Prop({
    type: [
      {
        changedAt: { type: Date, required: true },
        changes: { type: Object, required: true },
      },
    ],
    default: [],
  })
  history: { changedAt: Date; changes: EventChange }[];
}

// TODO: add index

export type EventDocument = Event & Document;
export const EventSchema = SchemaFactory.createForClass(Event);
