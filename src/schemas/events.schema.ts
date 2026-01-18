import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types, Document } from 'mongoose';

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

@Schema()
export class EventHistory {
  @Prop({ required: true, default: Date.now })
  changeAt: Date;

  @Prop({ type: Object, required: true })
  changes: EventChange;
}
const EventHistorySchema = SchemaFactory.createForClass(EventHistory);

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

  @Prop({
    required: true,
    type: Number,
    enum: Object.values(EventStatus).filter((v) => typeof v === 'number'),
    default: EventStatus.ACTIVE,
  })
  eventStatus: EventStatus;

  @Prop({ required: true })
  startAt: Date;

  @Prop({ required: true })
  endAt: Date;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User' })
  deletedBy: Types.ObjectId;

  @Prop({ trim: true })
  redirectionLink?: string;

  @Prop({ type: Types.ObjectId, ref: 'FormJson' })
  formId?: Types.ObjectId;

  @Prop({ type: [String], default: [] })
  buttonLabels?: string[];

  @Prop({ type: [String], default: [] })
  imgUrl?: string[];

  @Prop({
    type: [EventHistorySchema],
    default: [],
  })
  history: EventHistory[];
}

export type EventDocument = Event & Document;
export const EventSchema = SchemaFactory.createForClass(Event);

EventSchema.index({ eventStatus: 1, startAt: 1 });
EventSchema.index({ eventStatus: 1, endAt: 1 });
EventSchema.index({ title: 'text' });
