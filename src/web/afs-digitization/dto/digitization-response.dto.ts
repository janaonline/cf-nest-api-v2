/**
 * Interface representing the response from the digitization API.
 * Contains S3_Excel_Storage_Link, request_id, and various processing metrics.
 */
export interface DigitizationResponseDto {
  request_id: string;
  S3_Excel_Storage_Link: string;
  Message?: string;
  
  // PDF Upload metrics
  PDFUpload_Status?: string;
  PDFUpload_StatusCode?: number;
  PDFUpload_FileName?: string;
  PDFUpload_FileType?: string;
  PDFUpload_FileSize_In_Bytes?: number;
  
  // PDF Quality Check metrics
  PDFQualityCheck_Status?: string;
  PDFQualityCheck_StatusCode?: number;
  PDFQualityCheck_ProcessingTimeMs?: number;
  PDFQualityCheck_BlurScore?: number;
  
  // PDF Enhancement metrics
  PDFEnhancement_Status?: string;
  PDFEnhancement_StatusCode?: number;
  PDFEnhancement_ProcessingTimeMs?: number;
  
  // S3 Upload metrics
  S3Upload_Status?: string;
  S3Upload_StatusCode?: number;
  S3Upload_ProcessingTimeMs?: number;
  
  // OCR metrics
  OCR_Status?: string;
  OCR_StatusCode?: number;
  OCR_ProcessingTimeMs?: number;
  
  // LLM Post-processing metrics
  LLM_Postprocessing_Status?: string;
  LLM_Postprocessing_StatusCode?: number;
  LLM_Postprocessing_ProcessingTimeMs?: number;
  
  // LLM Confidence Scoring metrics
  LLM_ConfidenceScoring_Status?: string;
  LLM_ConfidenceScoring_StatusCode?: number;
  LLM_ConfidenceScoring_ProcessingTimeMs?: number;
  
  // LLM Validation metrics
  LLM_Validation_Status?: string;
  LLM_Validation_StatusCode?: number;
  LLM_Validation_ProcessingTimeMs?: number;
  
  // Excel Generation metrics
  ExcelGeneration_Status?: string;
  ExcelGeneration_StatusCode?: number;
  ExcelGeneration_ProcessingTimeMs?: number;
  
  // Excel Storage metrics
  ExcelStorage_Status?: string;
  ExcelStorage_StatusCode?: number;
  ExcelStorage_ProcessingTimeMs?: number;
  
  // Overall metrics
  TotalProcessingTimeMs?: number;
  ProcessingMode?: string;
  RetryCount?: number;
  FinalStatusCode?: number;
  
  // Error information
  ErrorCode?: string;
  ErrorMessage?: string;
  ErrorResolution?: string;
  OriginalErrorMessage?: string;
  IPAddress?: string;
}
