// digitization-log.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type DigitizationLogDocument = HydratedDocument<DigitizationLog>;

@Schema({ collection: 'digitization-log' })
export class DigitizationLog {
  @Prop({ required: true })
  RequestId: string;

  @Prop({ type: Date, required: true })
  Timestamp: Date;

  @Prop()
  IPAddress: string;

  @Prop()
  Message: string;

  @Prop()
  PDFUpload_Status: string;

  @Prop()
  PDFUpload_StatusCode: number;

  @Prop()
  PDFUpload_FileName: string;

  @Prop()
  PDFUpload_FileType: string;

  @Prop()
  PDFUpload_FileSize_In_Bytes: number;

  @Prop()
  PDFQualityCheck_Status: string;

  @Prop()
  PDFQualityCheck_StatusCode: number;

  @Prop()
  PDFQualityCheck_ProcessingTimeMs: number;

  @Prop()
  PDFQualityCheck_BlurScore: number;

  @Prop()
  PDFEnhancement_Status: string;

  @Prop()
  PDFEnhancement_StatusCode: number;

  @Prop()
  PDFEnhancement_ProcessingTimeMs: number;

  @Prop()
  S3Upload_Status: string;

  @Prop()
  S3Upload_StatusCode: number;

  @Prop()
  S3Upload_ProcessingTimeMs: number;

  @Prop()
  OCR_Status: string;

  @Prop()
  OCR_StatusCode: number;

  @Prop()
  OCR_ProcessingTimeMs: number;

  @Prop()
  LLM_Postprocessing_Status: string;

  @Prop()
  LLM_Postprocessing_StatusCode: number;

  @Prop()
  LLM_Postprocessing_ProcessingTimeMs: number;

  @Prop()
  LLM_ConfidenceScoring_Status: string;

  @Prop()
  LLM_ConfidenceScoring_StatusCode: number;

  @Prop()
  LLM_ConfidenceScoring_ProcessingTimeMs: number;

  @Prop()
  LLM_Validation_Status: string;

  @Prop()
  LLM_Validation_StatusCode: number;

  @Prop()
  LLM_Validation_ProcessingTimeMs: number;

  @Prop()
  ExcelGeneration_Status: string;

  @Prop()
  ExcelGeneration_StatusCode: number;

  @Prop()
  ExcelGeneration_ProcessingTimeMs: number;

  @Prop()
  ExcelStorage_Status: string;

  @Prop()
  ExcelStorage_StatusCode: number;

  @Prop()
  ExcelStorage_ProcessingTimeMs: number;

  @Prop()
  SourcePDFUrl: string;

  @Prop()
  DigitizedExcelUrl: string;

  @Prop()
  TotalProcessingTimeMs: number;

  @Prop()
  ProcessingMode: string; // e.g. "direct"

  @Prop()
  RetryCount: number;

  @Prop()
  ErrorCode: string;

  @Prop()
  ErrorMessage: string;

  @Prop()
  ErrorResolution: string;

  @Prop()
  OriginalErrorMessage: string;

  @Prop()
  FinalStatusCode: number;
}

export const DigitizationLogSchema = SchemaFactory.createForClass(DigitizationLog);

// optional indexes
DigitizationLogSchema.index({ RequestId: 1 }, { unique: true });
DigitizationLogSchema.index({ Timestamp: -1 });
