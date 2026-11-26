import { splitTotalIntoInstallments } from './devolution-formula-installments.helpers';

describe('splitTotalIntoInstallments', () => {
  it('splits an even Total into two whole halves', () => {
    expect(splitTotalIntoInstallments(38971962)).toEqual({
      installment1Amount: 19485981,
      installment2Amount: 19485981,
    });
  });

  it('splits an odd Total into two x.50 halves that add back to the Total exactly', () => {
    const { installment1Amount, installment2Amount } = splitTotalIntoInstallments(38971963);
    expect(installment1Amount).toBe(19485981.5);
    expect(installment2Amount).toBe(19485981.5);
    expect(installment1Amount + installment2Amount).toBe(38971963);
  });

  it('keeps sums of many x.50 halves exact', () => {
    // 66 odd + 41 even Totals summing to Rs 417 Cr: instalment 1 must total exactly half.
    const totals = [...Array<number>(66).fill(38971963), ...Array<number>(41).fill(38971962)];
    const inst1Sum = totals.reduce((sum, t) => sum + splitTotalIntoInstallments(t).installment1Amount, 0);
    expect(inst1Sum).toBe(2085000000);
  });

  it('reads number-like text the way the validator does (a text-formatted Excel cell)', () => {
    expect(splitTotalIntoInstallments('1001')).toEqual({ installment1Amount: 500.5, installment2Amount: 500.5 });
    expect(splitTotalIntoInstallments(' 1000 ')).toEqual({ installment1Amount: 500, installment2Amount: 500 });
  });

  it('returns 0 for zero, missing, non-numeric or negative Totals', () => {
    for (const total of [0, '', null, undefined, 'abc', NaN, Infinity, -10]) {
      expect(splitTotalIntoInstallments(total)).toEqual({ installment1Amount: 0, installment2Amount: 0 });
    }
  });
});
