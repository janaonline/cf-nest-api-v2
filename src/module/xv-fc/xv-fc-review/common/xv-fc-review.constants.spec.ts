import { mapCodeToSubSection, mapHeadOfAccountToSection } from './xv-fc-review.constants';

describe('xv-fc-review.constants', () => {
  describe('mapHeadOfAccountToSection', () => {
    it.each([
      ['Revenue', 'INCOME'],
      ['Tax', 'INCOME'],
      ['Expense', 'EXPENSE'],
      ['Asset', 'ASSET'],
      ['Liability', 'LIABILITY'],
      ['Debt', 'LIABILITY'],
      ['Other', 'ASSET'],
    ] as const)('maps headOfAccount %s to section %s', (headOfAccount, section) => {
      expect(mapHeadOfAccountToSection(headOfAccount)).toBe(section);
    });

    it('returns null when headOfAccount is missing', () => {
      expect(mapHeadOfAccountToSection(null)).toBeNull();
      expect(mapHeadOfAccountToSection(undefined)).toBeNull();
    });
  });

  describe('mapCodeToSubSection', () => {
    it.each(['11001', '11009', '11018'])('maps %s to TAX_REVENUE_BREAKDOWN', (code) => {
      expect(mapCodeToSubSection(code)).toBe('TAX_REVENUE_BREAKDOWN');
    });

    it.each(['33000', '33001', '33002', '33003', '33004'])('maps %s to SECURED_LOANS_PARTICULARS', (code) => {
      expect(mapCodeToSubSection(code)).toBe('SECURED_LOANS_PARTICULARS');
    });

    it.each(['33100', '33101', '33102', '33103', '33104'])('maps %s to UNSECURED_LOANS_PARTICULARS', (code) => {
      expect(mapCodeToSubSection(code)).toBe('UNSECURED_LOANS_PARTICULARS');
    });

    it.each(['31001', '31002'])('maps %s to OTHERS', (code) => {
      expect(mapCodeToSubSection(code)).toBe('OTHERS');
    });

    it('returns null for a code with no sub-section (e.g. a top-level Income/Expense/Asset/Liability line)', () => {
      expect(mapCodeToSubSection('110')).toBeNull();
      expect(mapCodeToSubSection('330')).toBeNull();
      expect(mapCodeToSubSection('331')).toBeNull();
      expect(mapCodeToSubSection('310')).toBeNull();
    });
  });
});
