import { buildXviFcDownloadFileName } from './xvi-fc-download-file-name.util';

describe('buildXviFcDownloadFileName', () => {
  it('builds the CF_{StateName}_{FormName}_{YearLabel}.{ext} filename for normal inputs', () => {
    const result = buildXviFcDownloadFileName({
      entityName: 'Chhattisgarh',
      formName: 'ulb-wise-allocation-formula-template',
      yearLabel: '2024-25',
      extension: 'xlsx',
    });

    expect(result).toBe('CF_Chhattisgarh_Ulb-wise-allocation-formula-template_2024-25.xlsx');
  });

  it('sanitizes special characters in a state name (spaces, slashes) into single hyphens', () => {
    const result = buildXviFcDownloadFileName({
      entityName: 'Jammu & Kashmir / Ladakh',
      formName: 'elected-body-template',
      yearLabel: '2026-27',
      extension: 'xlsx',
    });

    expect(result).toBe('CF_Jammu-Kashmir-Ladakh_Elected-body-template_2026-27.xlsx');
  });

  it('sanitizes special characters anywhere they appear (formName, yearLabel too)', () => {
    const result = buildXviFcDownloadFileName({
      entityName: 'Andhra Pradesh',
      formName: 'claim-letter-CL/AP/2026-27/1-1',
      yearLabel: 'FY 2026/27',
      extension: 'pdf',
    });

    expect(result).toBe('CF_Andhra-Pradesh_Claim-letter-CL-AP-2026-27-1-1_FY-2026-27.pdf');
  });

  it('drops an empty segment without leaving a stray underscore', () => {
    const result = buildXviFcDownloadFileName({
      entityName: '',
      formName: 'elected-body-list',
      yearLabel: '2026-27',
      extension: 'docx',
    });

    expect(result).toBe('CF_Elected-body-list_2026-27.docx');
  });

  it('drops a whitespace-only segment without leaving a stray underscore', () => {
    const result = buildXviFcDownloadFileName({
      entityName: 'Kerala',
      formName: 'fc-unspent-declaration-no',
      yearLabel: '   ',
      extension: 'docx',
    });

    expect(result).toBe('CF_Kerala_Fc-unspent-declaration-no.docx');
  });
});
