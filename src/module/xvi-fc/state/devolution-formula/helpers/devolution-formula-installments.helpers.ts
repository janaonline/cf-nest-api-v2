// The only place instalments are computed; why they are derived and may be x.50: docs/adr/0002-installments-derived-as-half-of-total.md.
export interface DfInstallmentAmounts {
  installment1Amount: number;
  installment2Amount: number;
}

/**
 * Total / 2 for each instalment; 0 when the Total is missing, non-numeric or negative (that row is invalid anyway).
 * Number-like text ("1000" from a text-formatted Excel cell) counts, the same way the validator reads it.
 */
export function splitTotalIntoInstallments(total: unknown): DfInstallmentAmounts {
  const amount = typeof total === 'string' && total.trim() !== '' ? Number(total) : total;
  const half = typeof amount === 'number' && isFinite(amount) && amount >= 0 ? amount / 2 : 0;
  return { installment1Amount: half, installment2Amount: half };
}
