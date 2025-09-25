export interface FileItem {
  name: string;
  url: string;
} // url = S3 key
export interface ULBItem {
  ulbName?: string;
  files: FileItem[];
}
export interface ZipBuildRequest {
  data: ULBItem[];
  zipKey?: string; // e.g., bundles/mysuru-2021-22.zip (optional)
  emailTo: string; // recipient email
  subject?: string;
  message?: string;
}
export interface ZipBuildResult {
  zipKey: string;
  url: string;
  totalFiles: number;
  skippedFiles: number;
  sizeBytes?: number;
}
