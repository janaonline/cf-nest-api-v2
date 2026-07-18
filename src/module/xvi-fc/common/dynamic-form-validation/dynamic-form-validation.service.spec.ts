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

describe('DynamicFormValidationService — requiredTrue', () => {
  const mockNormalizer = { toRawStoragePath: jest.fn((url: string) => url) };
  const service = new DynamicFormValidationService(mockNormalizer as unknown as FileUrlNormalizerService);

  const checkboxField = {
    key: 'checkboxConfirmation',
    formFieldType: 'checkbox',
    label: 'Confirm',
    validations: [{ name: 'requiredTrue', validator: null, message: 'Please confirm before submitting.' }],
  } as unknown as FieldConfig;

  it('draft: succeeds when the requiredTrue field is entirely absent (mandatory-on-draft disabled)', () => {
    const result = service.validateDraftAndBuildPayload([checkboxField], {});
    expect(result.isValid).toBe(true);
    expect(result.errors['checkboxConfirmation']).toBeUndefined();
  });

  it('draft: succeeds when the requiredTrue field is present but false (mandatory-on-draft disabled)', () => {
    const result = service.validateDraftAndBuildPayload([checkboxField], { checkboxConfirmation: false });
    expect(result.isValid).toBe(true);
    expect(result.errors['checkboxConfirmation']).toBeUndefined();
  });

  it('final submit: still fails with code "required" when the requiredTrue field is absent', () => {
    const result = service.validateFinalSubmitAndBuildPayload([checkboxField], {});
    expect(result.isValid).toBe(false);
    expect(result.errors['checkboxConfirmation']?.[0]).toMatchObject({ code: 'required' });
  });

  it('final submit: still fails with code "requiredTrue" when the field is present but false', () => {
    const result = service.validateFinalSubmitAndBuildPayload([checkboxField], { checkboxConfirmation: false });
    expect(result.isValid).toBe(false);
    expect(result.errors['checkboxConfirmation']?.[0]).toMatchObject({ code: 'requiredTrue' });
  });

  it('final submit: succeeds when the field is true', () => {
    const result = service.validateFinalSubmitAndBuildPayload([checkboxField], { checkboxConfirmation: true });
    expect(result.isValid).toBe(true);
  });
});
