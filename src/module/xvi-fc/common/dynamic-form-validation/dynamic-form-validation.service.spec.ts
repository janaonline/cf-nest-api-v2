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

  it('accepts today submitted the way the frontend actually encodes it (regression: server timezones ahead of UTC, e.g. IST, must not reject same-day submissions)', () => {
    // Mirrors the frontend's toUtcIsoDateString(): reinterprets the picked LOCAL calendar
    // day-number as UTC midnight, rather than doing a real timezone conversion.
    const now = new Date();
    const submittedToday = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())).toISOString();

    const result = service.validateDraftAndBuildPayload([dateField], { dateOfConstitution: submittedToday });

    expect(result.isValid).toBe(true);
    expect(result.errors['dateOfConstitution']).toBeUndefined();
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

describe('DynamicFormValidationService — actualTarget actualLessThanOrEqualToTarget rule', () => {
  const mockNormalizer = { toRawStoragePath: jest.fn((url: string) => url) };
  const service = new DynamicFormValidationService(mockNormalizer as unknown as FileUrlNormalizerService);

  const fieldWithRule = {
    key: 'ind1',
    formFieldType: 'actualTarget',
    label: 'Per capita supply of water',
    validations: [
      { name: 'required', validator: null, message: 'Required.' },
      { name: 'actualLessThanOrEqualToTarget', validator: null, message: 'Actual must be less than or equal to target.' },
    ],
  } as unknown as FieldConfig;

  it('passes when target equals actual', () => {
    const result = service.validateFinalSubmitAndBuildPayload([fieldWithRule], {
      ind1: { actual: 100, target: 100 },
    });

    expect(result.isValid).toBe(true);
  });

  it('rejects when actual is greater than target', () => {
    const result = service.validateFinalSubmitAndBuildPayload([fieldWithRule], {
      ind1: { actual: 120, target: 100 },
    });

    expect(result.isValid).toBe(false);
    expect(result.errors['ind1.target']).toEqual([
      {
        field: 'ind1.target',
        message: 'Actual must be less than or equal to target.',
        code: 'actualLessThanOrEqualToTarget',
      },
    ]);
  });

  it('passes when actual is strictly lower than target', () => {
    const result = service.validateFinalSubmitAndBuildPayload([fieldWithRule], {
      ind1: { actual: 80, target: 100 },
    });

    expect(result.isValid).toBe(true);
  });

  it('is not enforced when the field config does not declare the rule', () => {
    const fieldWithoutRule = {
      ...fieldWithRule,
      validations: [{ name: 'required', validator: null, message: 'Required.' }],
    } as unknown as FieldConfig;

    const result = service.validateFinalSubmitAndBuildPayload([fieldWithoutRule], {
      ind1: { actual: 50, target: 90 },
    });

    expect(result.isValid).toBe(true);
  });
});

describe('DynamicFormValidationService — isNotEmpty/isEmpty visibility operator', () => {
  const mockNormalizer = { toRawStoragePath: jest.fn((url: string) => url) };
  const service = new DynamicFormValidationService(mockNormalizer as unknown as FileUrlNormalizerService);

  // Mirrors the EULB pair: signedElectedbodyFile only visible once electedBodyExcelFile has a file.
  const controllerFileField = {
    key: 'electedBodyExcelFile',
    formFieldType: 'file',
    label: 'Upload elected bodies list',
  } as unknown as FieldConfig;

  const dependentFileField = {
    key: 'signedElectedbodyFile',
    formFieldType: 'file',
    label: 'Upload signed elected bodies list',
    validations: [{ name: 'required', validator: null, message: 'This field is required.' }],
    visibleWhen: { mode: 'all', conditions: [{ key: 'electedBodyExcelFile', operator: 'isNotEmpty' }] },
  } as unknown as FieldConfig;

  const fields = [controllerFileField, dependentFileField];

  it('hides the dependent (excluded from payload, required skipped) when the controller file is absent', () => {
    const result = service.validateFinalSubmitAndBuildPayload(fields, {});

    expect(result.isValid).toBe(true);
    expect(result.errors['signedElectedbodyFile']).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result.sanitizedPayload, 'signedElectedbodyFile')).toBe(false);
  });

  it('hides the dependent when the controller file is the default empty shape ({originalName: "", path: "", ...})', () => {
    const result = service.validateFinalSubmitAndBuildPayload(fields, {
      electedBodyExcelFile: { originalName: '', path: '', mimeType: '', sizeKb: null, pageCount: null },
    });

    expect(result.isValid).toBe(true);
    expect(result.errors['signedElectedbodyFile']).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(result.sanitizedPayload, 'signedElectedbodyFile')).toBe(false);
  });

  it('shows the dependent once the controller file has a path, and enforces its own required validator', () => {
    const withoutSigned = service.validateFinalSubmitAndBuildPayload(fields, {
      electedBodyExcelFile: { originalName: 'ulbs.xlsx', path: 'state/ulbs.xlsx' },
    });

    expect(withoutSigned.isValid).toBe(false);
    expect(withoutSigned.errors['signedElectedbodyFile']?.[0]).toMatchObject({ code: 'required' });

    const withSigned = service.validateFinalSubmitAndBuildPayload(fields, {
      electedBodyExcelFile: { originalName: 'ulbs.xlsx', path: 'state/ulbs.xlsx' },
      signedElectedbodyFile: { originalName: 'signed.pdf', path: 'state/signed.pdf' },
    });

    expect(withSigned.isValid).toBe(true);
    expect(withSigned.sanitizedPayload['signedElectedbodyFile']).toMatchObject({ originalName: 'signed.pdf' });
  });

  it('also recognizes the legacy fileName/fileUrl shape as present', () => {
    const result = service.validateFinalSubmitAndBuildPayload(fields, {
      electedBodyExcelFile: { fileName: 'ulbs.xlsx', fileUrl: 'state/ulbs.xlsx' },
      signedElectedbodyFile: { fileName: 'signed.pdf', fileUrl: 'state/signed.pdf' },
    });

    expect(result.isValid).toBe(true);
  });

  it('isEmpty is the exact inverse of isNotEmpty', () => {
    const invertedField = {
      ...dependentFileField,
      visibleWhen: { mode: 'all', conditions: [{ key: 'electedBodyExcelFile', operator: 'isEmpty' }] },
    } as unknown as FieldConfig;

    // electedBodyExcelFile absent -> isEmpty() true -> dependent is visible and required.
    const whenAbsent = service.validateFinalSubmitAndBuildPayload([controllerFileField, invertedField], {});
    expect(whenAbsent.isValid).toBe(false);
    expect(whenAbsent.errors['signedElectedbodyFile']?.[0]).toMatchObject({ code: 'required' });

    // electedBodyExcelFile present -> isEmpty() false -> dependent is hidden, required skipped.
    const whenPresent = service.validateFinalSubmitAndBuildPayload([controllerFileField, invertedField], {
      electedBodyExcelFile: { originalName: 'ulbs.xlsx', path: 'state/ulbs.xlsx' },
    });
    expect(whenPresent.isValid).toBe(true);
    expect(whenPresent.errors['signedElectedbodyFile']).toBeUndefined();
  });

  it('treats a non-empty scalar (e.g. a filled-in text field) as present for isNotEmpty', () => {
    const textController = { key: 'note', formFieldType: 'text', label: 'Note' } as unknown as FieldConfig;
    const dependent = {
      key: 'followUp',
      formFieldType: 'text',
      label: 'Follow-up',
      validations: [{ name: 'required', validator: null, message: 'Required.' }],
      visibleWhen: { mode: 'all', conditions: [{ key: 'note', operator: 'isNotEmpty' }] },
    } as unknown as FieldConfig;

    const whenBlank = service.validateFinalSubmitAndBuildPayload([textController, dependent], { note: '   ' });
    expect(whenBlank.errors['followUp']).toBeUndefined();

    const whenFilled = service.validateFinalSubmitAndBuildPayload([textController, dependent], { note: 'hello' });
    expect(whenFilled.errors['followUp']?.[0]).toMatchObject({ code: 'required' });
  });
});
