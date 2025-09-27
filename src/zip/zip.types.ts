// zip.types.ts
export interface FileItem {
  name?: string; // optional custom filename inside zip
  key: string; // S3 key (object path)
}

export interface ZipJobRequest {
  files: FileItem[]; // flat list of S3 keys
  outputKey?: string; // optional S3 key for the final zip
  email?: string; // optional notify recipient
  title?: string; // optional title for email
}

export interface ZipJobResult {
  bucket: string;
  zipKey: string;
  totalFiles: number;
  skippedFiles: number;
  sizeBytes?: number; // best-effort; may not be known at runtime
}
