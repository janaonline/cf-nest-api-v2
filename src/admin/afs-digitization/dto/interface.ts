export interface AfsFile {
  _id: string;
  auditType: string;
  fileType: 'afsFile' | 'ulbFile';
  fileName: string;
  type: string;
  ulbId: string;
  year: string;
  modifiedAt: string;
  ulbName: string;
  state: string;
}

export interface AfsFileList {
  success: boolean;
  data: AfsFile[];
}

export interface IAfsExcelFile {
  name: string;
  url: string;
}

export interface AfsExcelData {
  excel: IAfsExcelFile[];
  type: string;
  source: string;
}

export interface AfsFileReport {
  success: boolean;
  data: AfsExcelData;
}

export interface AuditorReport {
  _id: string;
  file: {
    name: string;
    url: string;
  };
}
