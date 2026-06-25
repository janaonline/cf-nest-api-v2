import { ElectedUrbanLocalBodiesValidator } from 'src/module/xvi-fc/state/elected-urban-local-bodies/validators/elected-urban-local-bodies.validator';
import type { EulbDateValidationConfig } from 'src/module/xvi-fc/state/elected-urban-local-bodies/validators/elected-urban-local-bodies.validator';
import {
  EULB_CENSUS_CODE_MAX_LENGTH,
  EULB_ULB_NAME_MAX_LENGTH,
} from 'src/module/xvi-fc/state/elected-urban-local-bodies/constants/elected-urban-local-bodies.constants';

const TODAY = new Date('2025-01-15');
const VALID_CENSUS_CODE = 'ABC12345'; // 8 chars — within limit
const OVER_LIMIT_CENSUS_CODE = 'A'.repeat(EULB_CENSUS_CODE_MAX_LENGTH + 1); // 11 chars
const VALID_ULB_NAME = 'Some City Council';
const OVER_LIMIT_ULB_NAME = 'X'.repeat(EULB_ULB_NAME_MAX_LENGTH + 1); // 251 chars

const mockDateConfig: EulbDateValidationConfig = {
  constitutionMin: new Date(Date.UTC(2021, 4, 31, 0, 0, 0, 0)),
  constitutionMinMessage: 'Date of Constitution cannot be before 31 May 2021.',
  constitutionMaxMessage: 'Date of Constitution cannot be a future date.',
  expiryMax: new Date(Date.UTC(2030, 2, 31, 23, 59, 59, 999)),
  expiryMaxMessage: 'Date of Expiry cannot be after 31 March 2030.',
  expiryMinMessage: 'Date of Expiry cannot be before today.',
  remarksMaxLength: 250,
  remarksMaxLengthMessage: 'Remarks must not exceed 250 characters.',
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
      const errors = validator.validateExtraUlbRow(makeRow({ censusCode: OVER_LIMIT_CENSUS_CODE }), TODAY, mockDateConfig);
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
      const errors = validator.validatePortalUpdateFields({ censusCode: OVER_LIMIT_CENSUS_CODE }, TODAY, mockDateConfig);
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
