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

describe('DynamicFormValidationService — minDate/maxDate with TODAY±N[DMY]', () => {
  const mockNormalizer = { toRawStoragePath: jest.fn((url: string) => url) };
  const service = new DynamicFormValidationService(mockNormalizer as unknown as FileUrlNormalizerService);

  const dateField = {
    key: 'dateOfConstitution',
    formFieldType: 'date',
    label: 'Date of Constitution',
    validations: [
      { name: 'minDate', validator: 'TODAY-50Y', message: 'Date of constitution cannot be more than 50 years ago.' },
      { name: 'maxDate', validator: 'TODAY+0D', message: 'Date of constitution cannot be a future date.' },
    ],
  } as unknown as FieldConfig;

  it('rejects a date more than 50 years in the past', () => {
    const fiftyOneYearsAgo = new Date();
    fiftyOneYearsAgo.setFullYear(fiftyOneYearsAgo.getFullYear() - 51);

    const result = service.validateDraftAndBuildPayload([dateField], {
      dateOfConstitution: fiftyOneYearsAgo.toISOString(),
    });

    expect(result.isValid).toBe(false);
    expect(result.errors['dateOfConstitution']?.[0]).toMatchObject({ code: 'minDate' });
  });

  it('rejects a future date', () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const result = service.validateDraftAndBuildPayload([dateField], { dateOfConstitution: tomorrow.toISOString() });

    expect(result.isValid).toBe(false);
    expect(result.errors['dateOfConstitution']?.[0]).toMatchObject({ code: 'maxDate' });
  });

  it('accepts a date within the last 50 years and not in the future', () => {
    const tenYearsAgo = new Date();
    tenYearsAgo.setFullYear(tenYearsAgo.getFullYear() - 10);

    const result = service.validateDraftAndBuildPayload([dateField], {
      dateOfConstitution: tenYearsAgo.toISOString(),
    });

    expect(result.isValid).toBe(true);
    expect(result.errors['dateOfConstitution']).toBeUndefined();
  });
});

describe('DynamicFormValidationService — actualTarget field', () => {
  const mockNormalizer = { toRawStoragePath: jest.fn((url: string) => url) };
  const service = new DynamicFormValidationService(mockNormalizer as unknown as FileUrlNormalizerService);

  const indicatorField = {
    key: 'ind1',
    formFieldType: 'actualTarget',
    label: 'Per capita supply of water',
    validations: [
      { name: 'required', validator: null, message: 'Required.' },
      { name: 'min', validator: 0, message: 'Cannot be negative.' },
      { name: 'max', validator: 1000, message: 'Cannot exceed 1000.' },
    ],
  } as unknown as FieldConfig;

  it('passes through the {actual, target} object unchanged in sanitizedPayload', () => {
    const result = service.validateDraftAndBuildPayload([indicatorField], { ind1: { actual: 120, target: 150 } });

    expect(result.isValid).toBe(true);
    expect(result.sanitizedPayload['ind1']).toEqual({ actual: 120, target: 150 });
  });

  it('draft mode allows both actual and target to be absent', () => {
    const result = service.validateDraftAndBuildPayload([indicatorField], { ind1: { actual: null, target: null } });
    expect(result.isValid).toBe(true);
  });

  it('final submit requires both actual and target, keyed by dot-path', () => {
    const result = service.validateFinalSubmitAndBuildPayload([indicatorField], {
      ind1: { actual: null, target: null },
    });

    expect(result.isValid).toBe(false);
    expect(result.errors['ind1.actual']).toEqual([{ field: 'ind1.actual', message: 'Required.', code: 'required' }]);
    expect(result.errors['ind1.target']).toEqual([{ field: 'ind1.target', message: 'Required.', code: 'required' }]);
  });

  it('final submit passes when only one sub-value is missing, flags just that one', () => {
    const result = service.validateFinalSubmitAndBuildPayload([indicatorField], {
      ind1: { actual: 120, target: null },
    });

    expect(result.isValid).toBe(false);
    expect(result.errors['ind1.actual']).toBeUndefined();
    expect(result.errors['ind1.target']).toEqual([{ field: 'ind1.target', message: 'Required.', code: 'required' }]);
  });

  it('enforces min/max independently on actual and target', () => {
    const result = service.validateFinalSubmitAndBuildPayload([indicatorField], {
      ind1: { actual: -5, target: 5000 },
    });

    expect(result.isValid).toBe(false);
    expect(result.errors['ind1.actual']).toEqual([
      { field: 'ind1.actual', message: 'Cannot be negative.', code: 'min' },
    ]);
    expect(result.errors['ind1.target']).toEqual([
      { field: 'ind1.target', message: 'Cannot exceed 1000.', code: 'max' },
    ]);
  });

  it('final submit passes with both values within range', () => {
    const result = service.validateFinalSubmitAndBuildPayload([indicatorField], {
      ind1: { actual: 120, target: 150 },
    });

    expect(result.isValid).toBe(true);
  });
});
