import { DynamicFormValidationService } from './dynamic-form-validation.service';
import type { FileUrlNormalizerService } from '../services/file-url-normalizer.service';
import type { FieldConfig } from '../types/field-config.type';

describe('DynamicFormValidationService — file payload normalization', () => {
  const mockNormalizer = {
    toRawStoragePath: jest.fn((url: string) => `raw::${url}`),
  };
  const service = new DynamicFormValidationService(mockNormalizer as unknown as FileUrlNormalizerService);

  const fileField = { key: 'sfcReport', formFieldType: 'file', label: 'SFC Report' } as unknown as FieldConfig;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('normalizes a signed fileUrl to a raw storage path while preserving pageCount', () => {
    const result = service.validateDraftAndBuildPayload([fileField], {
      sfcReport: {
        fileName: 'report.pdf',
        fileUrl: 'https://api.example.com/file/download?signature=abc',
        fileSize: 2048,
        mimeType: 'application/pdf',
        pageCount: 9,
      },
    });

    expect(result.sanitizedPayload['sfcReport']).toMatchObject({
      fileUrl: 'raw::https://api.example.com/file/download?signature=abc',
      pageCount: 9,
    });
  });

  it('preserves pageCount: null through normalization (Excel uploads)', () => {
    const result = service.validateDraftAndBuildPayload([fileField], {
      sfcReport: {
        fileName: 'data.xlsx',
        fileUrl: 'state/path/data.xlsx',
        fileSize: 1024,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        pageCount: null,
      },
    });

    expect((result.sanitizedPayload['sfcReport'] as { pageCount?: number | null }).pageCount).toBeNull();
  });

  it('handles a missing pageCount backward-compatibly (key stays absent)', () => {
    const result = service.validateDraftAndBuildPayload([fileField], {
      sfcReport: {
        fileName: 'legacy.pdf',
        fileUrl: 'state/path/legacy.pdf',
        fileSize: 512,
        mimeType: 'application/pdf',
      },
    });

    const sanitized = result.sanitizedPayload['sfcReport'] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(sanitized, 'pageCount')).toBe(false);
    expect(sanitized['fileUrl']).toBe('raw::state/path/legacy.pdf');
  });
});
