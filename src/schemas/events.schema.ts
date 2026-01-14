import { Prop, Schema } from '@nestjs/mongoose';

export enum EventStatus {
  ACTIVE = 'active',
  INACTIVE = 'inactive',
  DRAFT = 'draft',
}

export type EventChange = Record<string, { old: any; new: any }>;

export class EventHistory {
  @Prop({ required: true, default: new Date() })
  changeAt: Date;

  @Prop({ type: Object, required: true })
  changes: EventChange;
}

@Schema({ timestamps: true })
export class Event {
  @Prop({ required: true, trim: true })
  title: string;

  @Prop({ required: true, trim: true })
  description: string;

  @Prop({ required: true, default: EventStatus.ACTIVE })
  isActive: EventStatus;

  @Prop({ required: true })
  startAt: Date;

  @Prop({ required: true })
  endAt: Date;

  @Prop({ trim: true })
  redirectionLink?: string;

  @Prop()
  formId?: number; // TODO: make this number or _id from formJson?

  @Prop({ type: [String], default: [] })
  buttonLabels?: string[];

  @Prop()
  imgUrl?: string;

  @Prop({
    type: [{ changedAt: { type: Date, required: true }, changes: { type: Object, required: true } }],
    default: [],
  })
  history: { changedAt: Date; changes: EventChange }[];
}
