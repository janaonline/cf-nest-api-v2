export const ACCOUNT_HEADS = {
  INCOME: 'INCOME',
  EXPENDITURE: 'EXPENDITURE',
  BALANCE_SHEET: 'BALANCE_SHEET',
  ASSET: 'ASSET',
  LIABILITY: 'LIABILITY',
} as const;

export type AccountHead = (typeof ACCOUNT_HEADS)[keyof typeof ACCOUNT_HEADS];
export const ACCOUNT_HEAD_VALUES = Object.values(ACCOUNT_HEADS) as AccountHead[];

export const DEFAULT_TEMPLATE_VERSION = '2026.1';
