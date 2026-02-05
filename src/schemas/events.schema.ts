import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';

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
  webinarId: {
    maxLength: 50,
    minLength: 5,
  },
};

// export type EventChange = Partial<{
//   [K in keyof Events]: {
//     old: Events[K];
//     new: Events[K];
//   };
// }>;
type StringKeyOf<T> = Extract<keyof T, string>;
export type EventChange<T extends object> = Partial<{
  [K in StringKeyOf<T>]: {
    old: T[K];
    new: T[K];
  };
}>;

@Schema()
export class EventHistory {
  @Prop({ required: true, default: Date.now })
  changeAt: Date;

  @Prop({ type: Object, required: true })
  changes: EventChange<Event>;
}
const EventHistorySchema = SchemaFactory.createForClass(EventHistory);

@Schema({ timestamps: true })
export class Events {
  createdAt!: Date;
  updatedAt!: Date;

  @Prop({
    required: true,
    trim: true,
    maxLength: CONSTRAINTS.webinarId.maxLength,
    minLength: CONSTRAINTS.webinarId.minLength,
  })
  webinarId: string;

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

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  createdBy: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  deletedBy: Types.ObjectId;

  @Prop({ trim: true })
  redirectionLink?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'FormJson' })
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

export type EventDocument = HydratedDocument<Events>;
export const EventSchema = SchemaFactory.createForClass(Events);

EventSchema.index({ eventStatus: 1, startAt: 1 });
EventSchema.index({ eventStatus: 1, endAt: 1 });
EventSchema.index({ title: 'text' });
EventSchema.index({ webinarId: 1 }, { unique: true });
