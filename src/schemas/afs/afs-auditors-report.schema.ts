// afs-excel-file.schema.ts
import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types, Schema as MongooseSchema } from 'mongoose';
import { Queue, QueueSchema } from '../queue.schema';
import { AuditType, DigitizationStatuses, UploadedBy } from './enums';

export type AfsAuditorsReportDocument = HydratedDocument<AfsAuditorsReport>;

// {
//     "_id": "a8c45fc80f4c4d48bc3ac76303782509",
//     "ulb": "a8c45fc80f4c4d48bc3ac76303782509",
//     "year": "a8c45fc80f4c4d48bc3ac76303782509",
//     "filename": "04679fab-edb0-4631-bf7f-e1bc3973e2a1.pdf",
//     "s3_key_pdf": "auditors-report/docs/a8c45fc80f4c4d48bc3ac76303782509.pdf",
//     "ocr_extraction": {
//         "textract_job_id": "76aafd07135ce1937b830e14d2ebccc094e3222c141857e2979ba149758cdb49",
//         "ocr_text_key": "auditors-report/docs/a8c45fc80f4c4d48bc3ac76303782509.ocr.txt",
//         "language_tag": "LANG_EN",
//         "page_count": Int32("1"),
//         "is_readable": true,
//         "readability_score": 0.717680597014925,
//         "status": "SUCCEEDED",
//         "error": null,
//         "updated_at": ISODate("2026-02-06T12:40:12.719Z")
//     },
//     "classification": {
//         "doc_type": "FULL_AUDIT_REPORT",
//         "confidence": 1,
//         "method": "ai",
//         "evidence": [
//             "Sub: Audit - Ramanathapuram District - Abiramam (Gr 1) TownPanchayat- Audit on the accounts for the year 2020 - 2021 - Issue of Audit Report - reg.",
//             "The Audit Report mentioning the defects and irregularities are hereby issued for your perusal.",
//             "As per the GO ref 3, the replies to the objections should be sent to this office with the approval of Town Panchayat council within two months on receipt of this Audit Report in three copies."
//         ],
//         "reason": "The document explicitly states its purpose is the 'Issue of Audit Report' and refers to itself as 'this Audit Report' multiple times, detailing its contents (defects and irregularities) and requesting replies to objections.",
//         "status": "SUCCEEDED",
//         "error": null,
//         "updated_at": ISODate("2026-02-06T12:40:17.684Z")
//     },
//     "audit": {
//         "extraction": {
//             "audit_firm": "Local Fund Audit",
//             "auditor_name": "Mrs. S. Selvi",
//             "audit_date": "04.02.2022",
//             "audit_place": "Ramanathapuram",
//             "evidence_quotes": [
//                 "LOCAL FUND AUDIT DEPARTMENT",
//                 "Mrs. S. Selvi, Assistant Director, Local Fund Audit, Ramanathapuram.",
//                 "R.C.No.38/A1/2022 Dated: 04.02.2022.",
//                 "Assistant Director, Local Fund Audit, Ramanathapuram."
//             ],
//             "method": "ai",
//             "confidence": 0.7
//         },
//         "verification": {
//             "audit_firm": {
//                 "value": "Local Fund Audit",
//                 "verified": true,
//                 "match_type": "direct"
//             },
//             "auditor_name": {
//                 "value": "Mrs. S. Selvi",
//                 "verified": true,
//                 "match_type": "direct"
//             },
//             "audit_date": {
//                 "value": "04.02.2022",
//                 "verified": true,
//                 "match_type": "direct"
//             },
//             "audit_place": {
//                 "value": "Ramanathapuram",
//                 "verified": true,
//                 "match_type": "direct"
//             }
//         },
//         "verification_status": "VERIFIED",
//         "status": "SUCCEEDED",
//         "error": null,
//         "updated_at": ISODate("2026-02-06T12:40:22.95Z")
//     },
//     "summary": {
//         "data": {
//             "document_id": "a8c45fc80f4c4d48bc3ac76303782509",
//             "city_id": "stringdfsf",
//             "fy": "stringdsfsd",
//             "bullets": [
//                 "An audit of the Abiramam (Gr 1) Town Panchayat accounts for 2020-2021 has been completed.",
//                 "The Local Fund Audit Department issued an audit report for the specified period.",
//                 "The audit report identifies defects and irregularities in the accounts.",
//                 "Replies to the audit objections must be sent to the office within two months of receiving the report.",
//                 "These replies require the approval of the Town Panchayat council and must be submitted in three copies.",
//                 "The audit was conducted as per specific Government Orders and the Tamil Nadu Municipalities Act of 1920.",
//                 "The Executive Officer is requested to acknowledge receipt of the audit report."
//             ],
//             "key_sections_detected": [
//                 "Header Information",
//                 "Subject of Audit",
//                 "Legal References",
//                 "Audit Findings and Instructions",
//                 "Distribution List"
//             ],
//             "risks_or_issues": [
//                 "The Audit Report mentions defects and irregularities in the accounts."
//             ],
//             "evidence_quotes": [
//                 "Audit on the accounts for the year 2020 - 2021 has been preferred and completed.",
//                 "The Audit Report mentioning the defects and irregularities are hereby issued for your perusal.",
//                 "the replies to the objections should be sent to this office with the approval of Town Panchayat council within two months",
//                 "Receipt of this Report may kindly be acknowledged."
//             ],
//             "model": "gemini-2.5-flash",
//             "status": "SUCCEEDED",
//             "updated_at": ISODate("2026-02-06T12:40:30.547Z")
//         },
//         "status": "SUCCEEDED",
//         "error": null,
//         "updated_at": ISODate("2026-02-06T12:40:30.547Z")
//     },
//     "processing": {
//         "status": "SUCCEEDED",
//         "created_at": ISODate("2026-02-06T12:40:04.588Z"),
//         "updated_at": ISODate("2026-02-06T12:40:30.55Z")
//     },
//     "created_at": ISODate("2026-02-06T12:40:04.588Z"),
//     "updated_at": ISODate("2026-02-06T12:40:30.55Z")
// }

@Schema({ _id: false })
class DataItem {
  @Prop({ type: String, required: true })
  filename: string;
  @Prop({ type: String, required: true })
  s3_key_pdf: string;

  @Prop({ type: MongooseSchema.Types.Mixed, required: false })
  ocr_extraction?: any;

  @Prop({ type: MongooseSchema.Types.Mixed, required: false })
  classification?: any;

  @Prop({ type: MongooseSchema.Types.Mixed, required: false })
  audit?: any;

  @Prop({ type: MongooseSchema.Types.Mixed, required: false })
  summary?: any;

  @Prop({ type: MongooseSchema.Types.Mixed, required: false })
  processing?: any;
}

export const DataItemSchema = SchemaFactory.createForClass(DataItem);

@Schema({ _id: false })
class FileItem {
  @Prop({ type: Number, default: -1 })
  overallConfidenceScore: number;

  @Prop({ type: String })
  digitizationMsg?: string;

  @Prop({
    type: String,
    enum: Object.values(DigitizationStatuses),
    default: DigitizationStatuses.NOT_DIGITIZED,
  })
  digitizationStatus: DigitizationStatuses;

  @Prop({ type: Number })
  totalProcessingTimeMs?: number;

  @Prop({ type: String })
  requestId: string;

  @Prop({ type: Date, default: Date.now })
  createdAt: Date;

  @Prop({ type: String, enum: Object.values(UploadedBy) })
  uploadedBy: UploadedBy;

  @Prop({ type: String })
  pdfUrl: string;

  @Prop({ type: String })
  digitizedFileUrl: string;

  @Prop({ type: Number })
  noOfPages: number;

  @Prop({ type: DataItemSchema })
  data: DataItem;

  @Prop({ type: QueueSchema })
  queue: Queue;
}

export const FileItemSchema = SchemaFactory.createForClass(FileItem);

@Schema({ collection: 'afs_auditors_report', timestamps: true })
export class AfsAuditorsReport {
  @Prop({ type: Types.ObjectId, ref: 'AnnualAccountData' })
  annualAccountsId: Types.ObjectId;

  // new ObjectId field referencing ulb collection
  @Prop({ type: Types.ObjectId, ref: 'Ulb' })
  ulb: Types.ObjectId;

  // new ObjectId field referencing Year collection
  @Prop({ type: Types.ObjectId, ref: 'Year' })
  year: Types.ObjectId;

  // @Prop({ type: String, required: true })
  // financialYear: string; // e.g. "2020-21"

  @Prop({ type: String, enum: Object.values(AuditType), required: true })
  auditType: AuditType; // e.g. "audited"

  @Prop({ type: String, required: true })
  docType: string; // e.g. "bal_sheet_schedules"

  @Prop({ type: FileItemSchema })
  ulbFile: FileItem;

  @Prop({ type: FileItemSchema })
  afsFile: FileItem;
}

export const AfsAuditorsReportSchema = SchemaFactory.createForClass(AfsAuditorsReport);
