import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
export const issueKindEnum = ['data_seems_wrong', 'missing_data', 'ui_visual_bug', 'suggestion'];
export const descLen = { max: 500, min: 25 };

@Schema({ timestamps: true })
export class ReportAnIssue {
  @Prop({ required: true, enum: issueKindEnum })
  issueKind: string;

  @Prop({ required: true, trim: true, maxLength: descLen.max, minLength: descLen.min })
  desc: string;

  @Prop({
    required: true,
    index: true,
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please use a valid email address.'],
  })
  email: string;

  @Prop({ default: false })
  issueScreenshotUrl?: string;
}

export type ReportAnIssueDocument = ReportAnIssue & Document;
export const ReportAnIssueSchema = SchemaFactory.createForClass(ReportAnIssue);
