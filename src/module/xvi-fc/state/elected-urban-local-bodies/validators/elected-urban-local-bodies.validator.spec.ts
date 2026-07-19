import {
  ElectedUrbanLocalBodiesValidator,
  extractDateConfig,
} from 'src/module/xvi-fc/state/elected-urban-local-bodies/validators/elected-urban-local-bodies.validator';
import type { EulbDateValidationConfig } from 'src/module/xvi-fc/state/elected-urban-local-bodies/validators/elected-urban-local-bodies.validator';
import type { FieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';

// DB-driven — mirrors the DB form-json document's censusCode/ulbName maxlength validators and
// electedBodyStatus options (see mockDateConfig below), not a hardcoded backend constant.
const CENSUS_CODE_MAX_LENGTH = 10;
const ULB_NAME_MAX_LENGTH = 250;

const TODAY = new Date('2025-01-15');
const VALID_CENSUS_CODE = 'ABC12345'; // 8 chars — within limit
const OVER_LIMIT_CENSUS_CODE = 'A'.repeat(CENSUS_CODE_MAX_LENGTH + 1); // 11 chars
const VALID_ULB_NAME = 'Some City Council';
const OVER_LIMIT_ULB_NAME = 'X'.repeat(ULB_NAME_MAX_LENGTH + 1); // 251 chars

const mockDateConfig: EulbDateValidationConfig = {
  constitutionMin: new Date(Date.UTC(2021, 4, 31, 0, 0, 0, 0)),
  constitutionMinMessage: 'Date of Constitution cannot be before 31 May 2021.',
  constitutionMaxMessage: 'Date of Constitution cannot be a future date.',
  expiryMax: new Date(Date.UTC(2030, 2, 31, 23, 59, 59, 999)),
  expiryMaxMessage: 'Date of Expiry cannot be after 31 March 2030.',
  expiryMinMessage: 'Date of Expiry cannot be before today.',
  remarksMaxLength: 250,
  remarksMaxLengthMessage: 'Remarks must not exceed 250 characters.',
  censusCodeMaxLength: CENSUS_CODE_MAX_LENGTH,
  censusCodeMaxLengthMessage: `Census code must not exceed ${CENSUS_CODE_MAX_LENGTH} characters.`,
  ulbNameMaxLength: ULB_NAME_MAX_LENGTH,
  ulbNameMaxLengthMessage: `ULB name must not exceed ${ULB_NAME_MAX_LENGTH} characters.`,
  electedBodyStatuses: ['Constituted', 'Not Constituted', 'Exempt'],
};

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    rowNumber: 1,
    ulbName: VALID_ULB_NAME,
    censusCode: VALID_CENSUS_CODE,
    electedBodyStatus: 'Not Constituted',
    ...overrides,
  };
}

// ─── extractDateConfig ───────────────────────────────────────────────────────

const VALID_ROW_EDIT_FIELDS: FieldConfig[] = [
  {
    key: 'dateOfConstitution',
    formFieldType: 'date',
    label: 'Date of Constitution',
    validations: [
      { name: 'minDate', validator: '2021-05-31', message: 'Date of Constitution cannot be before 31 May 2021.' },
      { name: 'maxDate', validator: 'TODAY', message: 'Date of Constitution cannot be a future date.' },
    ],
  },
  {
    key: 'dateOfExpiry',
    formFieldType: 'date',
    label: 'Date of Expiry',
    validations: [
      { name: 'minDate', validator: 'TODAY', message: 'Date of Expiry cannot be before today.' },
      { name: 'maxDate', validator: '2030-03-31', message: 'Date of Expiry cannot be after 31 March 2030.' },
    ],
  },
  {
    key: 'remarks',
    formFieldType: 'text',
    label: 'Remarks',
    validations: [{ name: 'maxlength', validator: 250, message: 'Remarks cannot exceed 250 characters.' }],
  },
  {
    key: 'electedBodyStatus',
    formFieldType: 'select',
    label: 'Elected Body Status',
    options: [
      { id: 'Constituted', label: 'Constituted' },
      { id: 'Not Constituted', label: 'Not Constituted' },
      { id: 'Exempt', label: 'Exempt' },
    ],
    validations: [{ name: 'required', validator: null, message: 'Elected Body Status is required.' }],
  },
];

const VALID_EXTRA_ULB_PORTAL_FIELDS: FieldConfig[] = [
  {
    key: 'censusCode',
    formFieldType: 'text',
    label: 'Census Code',
    validations: [
      { name: 'required', validator: null, message: 'Census code is required.' },
      { name: 'maxlength', validator: 10, message: 'Census code must not exceed 10 characters.' },
    ],
  },
  {
    key: 'ulbName',
    formFieldType: 'text',
    label: 'ULB Name',
    validations: [
      { name: 'required', validator: null, message: 'ULB name is required.' },
      { name: 'maxlength', validator: 250, message: 'ULB name must not exceed 250 characters.' },
    ],
  },
];

describe('extractDateConfig', () => {
  it('derives censusCodeMaxLength/ulbNameMaxLength/electedBodyStatuses from the DB-loaded field groups', () => {
    const config = extractDateConfig(VALID_ROW_EDIT_FIELDS, VALID_EXTRA_ULB_PORTAL_FIELDS);
    expect(config.censusCodeMaxLength).toBe(10);
    expect(config.censusCodeMaxLengthMessage).toBe('Census code must not exceed 10 characters.');
    expect(config.ulbNameMaxLength).toBe(250);
    expect(config.ulbNameMaxLengthMessage).toBe('ULB name must not exceed 250 characters.');
    expect(config.electedBodyStatuses).toEqual(['Constituted', 'Not Constituted', 'Exempt']);
  });

  it('throws when EXTRA_ULB_PORTAL_FIELDS is missing censusCode/ulbName', () => {
    expect(() => extractDateConfig(VALID_ROW_EDIT_FIELDS, [])).toThrow();
  });

  it('throws when censusCode/ulbName are missing a maxlength validator', () => {
    const brokenExtraFields = VALID_EXTRA_ULB_PORTAL_FIELDS.map((f) =>
      f.key === 'censusCode' ? { ...f, validations: [] } : f,
    );
    expect(() => extractDateConfig(VALID_ROW_EDIT_FIELDS, brokenExtraFields)).toThrow();
  });

  it('throws when electedBodyStatus is missing its options list', () => {
    const brokenRowFields = VALID_ROW_EDIT_FIELDS.map((f) =>
      f.key === 'electedBodyStatus' ? { ...f, options: [] } : f,
    );
    expect(() => extractDateConfig(brokenRowFields, VALID_EXTRA_ULB_PORTAL_FIELDS)).toThrow();
  });
});

describe('ElectedUrbanLocalBodiesValidator', () => {
  let validator: ElectedUrbanLocalBodiesValidator;

  beforeEach(() => {
    validator = new ElectedUrbanLocalBodiesValidator();
  });

  // ─── validateExtraUlbRow ─────────────────────────────────────────────────────

  describe('validateExtraUlbRow', () => {
    it('returns required error when censusCode is undefined', () => {
      const errors = validator.validateExtraUlbRow(makeRow({ censusCode: undefined }), TODAY, mockDateConfig);
      expect(errors.some((e) => e.field === 'censusCode' && e.code === 'required')).toBe(true);
    });

    it('returns required error when censusCode is blank string', () => {
      const errors = validator.validateExtraUlbRow(makeRow({ censusCode: '' }), TODAY, mockDateConfig);
      expect(errors.some((e) => e.field === 'censusCode' && e.code === 'required')).toBe(true);
    });

    it('returns maxlength error when censusCode exceeds EULB_CENSUS_CODE_MAX_LENGTH', () => {
      const errors = validator.validateExtraUlbRow(
        makeRow({ censusCode: OVER_LIMIT_CENSUS_CODE }),
        TODAY,
        mockDateConfig,
      );
      expect(errors.some((e) => e.field === 'censusCode' && e.code === 'maxlength')).toBe(true);
    });

    it('returns no censusCode error for a valid census code', () => {
      const errors = validator.validateExtraUlbRow(makeRow({ censusCode: VALID_CENSUS_CODE }), TODAY, mockDateConfig);
      expect(errors.some((e) => e.field === 'censusCode')).toBe(false);
    });

    it('returns required error when ulbName is blank', () => {
      const errors = validator.validateExtraUlbRow(makeRow({ ulbName: '' }), TODAY, mockDateConfig);
      expect(errors.some((e) => e.field === 'ulbName' && e.code === 'required')).toBe(true);
    });

    it('returns maxlength error when ulbName exceeds EULB_ULB_NAME_MAX_LENGTH', () => {
      const errors = validator.validateExtraUlbRow(makeRow({ ulbName: OVER_LIMIT_ULB_NAME }), TODAY, mockDateConfig);
      expect(errors.some((e) => e.field === 'ulbName' && e.code === 'maxlength')).toBe(true);
    });

    it('returns no ulbName error for a valid ULB name', () => {
      const errors = validator.validateExtraUlbRow(makeRow(), TODAY, mockDateConfig);
      expect(errors.some((e) => e.field === 'ulbName')).toBe(false);
    });

    it('returns no errors for a fully valid EXTRA_ULB row', () => {
      const errors = validator.validateExtraUlbRow(makeRow(), TODAY, mockDateConfig);
      expect(errors).toHaveLength(0);
    });
  });

  // ─── validatePortalUpdateFields — identity fields ───────────────────────────

  describe('validatePortalUpdateFields — identity fields', () => {
    it('returns required error when censusCode is present but blank', () => {
      const errors = validator.validatePortalUpdateFields({ censusCode: '' }, TODAY, mockDateConfig);
      expect(errors.some((e) => e.field === 'censusCode' && e.code === 'required')).toBe(true);
    });

    it('returns maxlength error when censusCode exceeds limit', () => {
      const errors = validator.validatePortalUpdateFields(
        { censusCode: OVER_LIMIT_CENSUS_CODE },
        TODAY,
        mockDateConfig,
      );
      expect(errors.some((e) => e.field === 'censusCode' && e.code === 'maxlength')).toBe(true);
    });

    it('returns required error when ulbName is present but blank', () => {
      const errors = validator.validatePortalUpdateFields({ ulbName: '' }, TODAY, mockDateConfig);
      expect(errors.some((e) => e.field === 'ulbName' && e.code === 'required')).toBe(true);
    });

    it('returns maxlength error when ulbName exceeds limit', () => {
      const errors = validator.validatePortalUpdateFields({ ulbName: OVER_LIMIT_ULB_NAME }, TODAY, mockDateConfig);
      expect(errors.some((e) => e.field === 'ulbName' && e.code === 'maxlength')).toBe(true);
    });

    it('returns no identity errors when censusCode and ulbName are absent from DTO', () => {
      const errors = validator.validatePortalUpdateFields({}, TODAY, mockDateConfig);
      expect(errors.some((e) => e.field === 'censusCode' || e.field === 'ulbName')).toBe(false);
    });

    it('returns no errors for valid censusCode and ulbName', () => {
      const errors = validator.validatePortalUpdateFields(
        { censusCode: VALID_CENSUS_CODE, ulbName: VALID_ULB_NAME },
        TODAY,
        mockDateConfig,
      );
      expect(errors.some((e) => e.field === 'censusCode' || e.field === 'ulbName')).toBe(false);
    });

    it('preserves existing electedBodyStatus / remarks validation unchanged', () => {
      const errors = validator.validatePortalUpdateFields(
        { electedBodyStatus: 'INVALID_VALUE', remarks: 'R'.repeat(251) },
        TODAY,
        mockDateConfig,
      );
      expect(errors.some((e) => e.field === 'electedBodyStatus')).toBe(true);
      expect(errors.some((e) => e.field === 'remarks')).toBe(true);
    });
  });
});
