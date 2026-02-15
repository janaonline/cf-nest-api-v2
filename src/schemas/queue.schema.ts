import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export enum QueueStatus {
  NOT_STARTED = 'not-started',
  ON_THE_JOB = 'on-the-job',
  COMPLETED = 'completed',
  FAILED = 'failed',
  PROCESSING = 'processing',
  WAITING = 'waiting',
  QUEUED = 'queued',
  REMOVED = 'removed',
}

@Schema({ _id: false })
export class Queue {
  @Prop({ type: String })
  jobId: string;

  @Prop({ type: String, enum: Object.values(QueueStatus), default: QueueStatus.WAITING })
  status: string;

  @Prop({ type: Number, default: 0 }) // 0-100
  progress: number;

  @Prop({ type: String, required: false })
  failedReason?: string;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: Number, default: 0 })
  attemptsMade: number;

  @Prop({ type: Date, required: false })
  processedOn?: Date;

  @Prop({ type: Date, required: false })
  finishedOn?: Date;
}

export const QueueSchema = SchemaFactory.createForClass(Queue);
