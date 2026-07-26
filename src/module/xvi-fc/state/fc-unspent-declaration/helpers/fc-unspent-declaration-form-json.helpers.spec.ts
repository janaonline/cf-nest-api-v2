import { InternalServerErrorException } from '@nestjs/common';
import { loadFcUnspentSeedDocument } from '../constants/fc-unspent-declaration-seed.fixture';
import {
  FcUnspentTypedFieldConfig,
  getFcUnspentFieldsByType,
  validateFcUnspentFormJsonData,
} from './fc-unspent-declaration-form-json.helpers';

const FC_UNSPENT_STATE_FORM_JSON = loadFcUnspentSeedDocument();

describe('getFcUnspentFieldsByType', () => {
  it('filters fields by group and strips fieldTypes from the result', () => {
    const mainFields = getFcUnspentFieldsByType(FC_UNSPENT_STATE_FORM_JSON.data, 'FC_UNSPENT_MAIN_FORM_FIELDS');
    expect(mainFields.map((f) => f.key)).toEqual(['isFcUnspent', 'fcDeclaration', 'checkboxConfirmation']);
    expect(mainFields.every((f) => !('fieldTypes' in f))).toBe(true);
  });

  it('filters row-edit fields covering all 8 ULB row-table columns', () => {
    const rowEditFields = getFcUnspentFieldsByType(FC_UNSPENT_STATE_FORM_JSON.data, 'FC_UNSPENT_ROW_EDIT_FIELDS');
    expect(rowEditFields.map((f) => f.key)).toEqual([
      'ulbId',
      'unspentAmount',
      'censusCode',
      'sbCode',
      'ulbName',
      'allocationAmount',
      'allocationPerc',
      'eligibility',
    ]);
    expect(rowEditFields.every((f) => !('fieldTypes' in f))).toBe(true);
  });
});

describe('validateFcUnspentFormJsonData — fieldTypes structural checks', () => {
  it('passes for the canonical seed payload', () => {
    expect(() => validateFcUnspentFormJsonData(FC_UNSPENT_STATE_FORM_JSON.data)).not.toThrow();
  });

  it('rejects a field missing fieldTypes entirely', () => {
    const data = FC_UNSPENT_STATE_FORM_JSON.data.map((f) => {
      if (f.key !== 'ulbId') return f;
      const { fieldTypes: _ft, ...rest } = f;
      return rest as unknown as FcUnspentTypedFieldConfig;
    });
    expect(() => validateFcUnspentFormJsonData(data)).toThrow(InternalServerErrorException);
    expect(() => validateFcUnspentFormJsonData(data)).toThrow(/is missing fieldTypes/);
  });

  it('rejects a field with an unknown fieldTypes tag', () => {
    const data = FC_UNSPENT_STATE_FORM_JSON.data.map((f) =>
      f.key === 'ulbId' ? { ...f, fieldTypes: ['SOME_UNKNOWN_TAG'] as unknown as typeof f.fieldTypes } : f,
    );
    expect(() => validateFcUnspentFormJsonData(data)).toThrow(/has unknown fieldType 'SOME_UNKNOWN_TAG'/);
  });
});
