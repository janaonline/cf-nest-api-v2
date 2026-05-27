export type LineItemLegendForValidation = {
  nmamCode: string;
  name: string;
  accountHead: string;
  level: number;
  parentCode: string | null;
  rules: Rule[];
};

type FormulaRule = {
  type: 'formula';
  operation: 'sum' | 'diff';
  operands: string[];
};

type ComparisonRule = {
  type: 'comparison';
  operator: '<=' | '>=' | '===' | '<' | '>';
  value: number;
};

export type Rule = FormulaRule | ComparisonRule;

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

export type RawLineItem = Record<string, unknown>;

export type SanitizedLineItem = {
  nmamCode: string;
  accountHead: AccountHead;
  majorCode: string;
  parentCode: string | null;
  segmentCode: string;
  segmentPath: string[];
  codePath: string[];
  name: string;
  desc: string;
  level: number;
  sortOrder: number;
  isActive: boolean;
  rules: Rule[];
  templateVersion: string;
};

export type ImportDryRunResult = {
  dryRun: true;
  valid: true;
  total: number;
  templateVersion: string;
  wouldUpsert: number;
};

export type ImportWriteResult = {
  dryRun: false;
  templateVersion: string;
  total: number;
  upserted: number;
  modified: number;
};

export type ImportResult = ImportDryRunResult | ImportWriteResult;
