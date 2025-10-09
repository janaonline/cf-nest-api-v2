// zip.types.ts
export interface FileItem {
  name?: string; // optional custom filename inside zip
  url: string; // S3 key (object path)
}

export interface ZipJobRequest {
  // files: FileItem[]; // flat list of S3 keys
  // outputKey?: string; // optional S3 key for the final zip
  // email?: string; // optional notify recipient
  // title?: string; // optional title for email
  success: boolean;
  message: string;
  outputKey?: string; // optional S3 key for the final zip
  email?: string; // optional notify recipient
  title?: string; // optional title for email
  ulbData: ULBData[];
}

export interface ZipJobResult {
  bucket: string;
  zipKey: string;
  totalFiles: number;
  skippedFiles: number;
  sizeBytes?: number; // best-effort; may not be known at runtime
}

// export interface File {
//   name: string;
//   url: string;
// }

export interface ULBData {
  _id: string;
  state: string;
  ulbId: string;
  ulbName: string;
  stateName: string;
  auditType: string;
  year: string;
  files: FileItem[];
}

// export interface ApiResponse {
//   success: boolean;
//   message: string;
//   outputKey?: string; // optional S3 key for the final zip
//   email?: string; // optional notify recipient
//   title?: string; // optional title for email
//   ulbData: ULBData[];
// }
