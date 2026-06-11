export type LineItemLegendForValidation = {
  nmamCode: string;
  name: string;
  accountHead: string;
  level: number;
  parentCode: string | null;
  rules: Rule[];
  isComputed?: boolean;
};

type FormulaSumRule = {
  type: 'formula';
  operation: 'sum';
  operands: string[];
};

type FormulaDiffRule = {
  type: 'formula';
  operation: 'diff';
  operands: string[];
};

export type FormulaLinearOperand = {
  code: string;
  sign: 1 | -1;
};

type FormulaLinearRule = {
  type: 'formula';
  operation: 'linear';
  operands: FormulaLinearOperand[];
};

/** Canonical set of allowed comparison operators. */
export const COMPARISON_OPERATORS = ['<=', '>=', '===', '!==', '<', '>'] as const;
export type ComparisonOperator = (typeof COMPARISON_OPERATORS)[number];

/** Deprecated: use COMPARISON_OPERATORS. */
export const operators = COMPARISON_OPERATORS;
/** Deprecated: use ComparisonOperator. */
export type Operators = ComparisonOperator;

type ComparisonRule = {
  type: 'comparison';
  operator: ComparisonOperator;
  value: number;
};

export type Rule = FormulaSumRule | FormulaDiffRule | FormulaLinearRule | ComparisonRule;

/** Runtime type guard: returns true when value is one of the six allowed comparison operators. */
export function isComparisonOperator(value: unknown): value is ComparisonOperator {
  return typeof value === 'string' && (COMPARISON_OPERATORS as readonly string[]).includes(value);
}

/**
 * Parses an unknown value into a typed Rule without unsafe assertions.
 * Returns null when the value does not match any known rule shape.
 * Call after validateRuleShape to convert validated raw JSON into typed rules.
 */
export function parseRule(rule: unknown): Rule | null {
  if (typeof rule !== 'object' || rule === null) return null;
  const r = rule as Record<string, unknown>;

  if (r['type'] === 'comparison') {
    const operator = r['operator'];
    const value = r['value'];
    if (!isComparisonOperator(operator)) return null;
    if (typeof value !== 'number' || !isFinite(value)) return null;
    return { type: 'comparison', operator, value };
  }

  if (r['type'] === 'formula') {
    const operation = r['operation'];
    const operands = r['operands'];
    if (!Array.isArray(operands) || operands.length === 0) return null;

    if (operation === 'sum' || operation === 'diff') {
      if (!operands.every((o): o is string => typeof o === 'string')) return null;
      return { type: 'formula', operation, operands };
    }

    if (operation === 'linear') {
      const parsed: FormulaLinearOperand[] = [];
      for (const op of operands) {
        if (typeof op !== 'object' || op === null) return null;
        const o = op as Record<string, unknown>;
        const code = o['code'];
        const sign = o['sign'];
        if (typeof code !== 'string') return null;
        if (sign !== 1 && sign !== -1) return null;
        parsed.push({ code, sign });
      }
      return { type: 'formula', operation: 'linear', operands: parsed };
    }
  }

  return null;
}

export const ACCOUNT_HEADS = {
  INCOME: 'INCOME',
  EXPENDITURE: 'EXPENDITURE',
  BALANCE_SHEET: 'BALANCE_SHEET',
  ASSET: 'ASSET',
  LIABILITY: 'LIABILITY',
  COMPUTED: 'COMPUTED',
} as const;

export type AccountHead = (typeof ACCOUNT_HEADS)[keyof typeof ACCOUNT_HEADS];
export const ACCOUNT_HEAD_VALUES = Object.values(ACCOUNT_HEADS) as AccountHead[];

export const DEFAULT_TEMPLATE_VERSION = '2026.1';

/**
 * Canonical computed legend nmamCode keys. Single source of truth.
 * Must stay in sync with DataCollection.computed field keys.
 */
export const COMPUTED_VALUES_KEYS = ['totIncome', 'totExpenditure', 'totRevenue', 'totOwnRevenue'] as const;
export type ComputedValuesKey = (typeof COMPUTED_VALUES_KEYS)[number];
export type ComputedLegendCode = `computed.${ComputedValuesKey}`;

/** All supported computed legend nmamCode values, derived from COMPUTED_VALUES_KEYS. */
export const COMPUTED_LEGEND_CODES: readonly ComputedLegendCode[] = [
  'computed.totIncome',
  'computed.totExpenditure',
  'computed.totRevenue',
  'computed.totOwnRevenue',
];

/** Runtime type guard for computed legend nmamCode values. */
export function isComputedLegendCode(value: string): value is ComputedLegendCode {
  return (COMPUTED_LEGEND_CODES as readonly string[]).includes(value);
}

export type RawLineItem = Record<string, unknown>;

/** Sanitized payload for a normal (non-computed) line item legend before DB write. */
type NormalSanitizedLineItem = {
  nmamCode: string;
  accountHead: Exclude<AccountHead, 'COMPUTED'>;
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
  isComputed: false;
};

/** Sanitized payload for a computed legend before DB write. Only applicable fields are included. */
type ComputedSanitizedLineItem = {
  nmamCode: string; // validated as ComputedLegendCode by validateItems before sanitization
  accountHead: 'COMPUTED';
  name: string;
  desc: string;
  sortOrder: number;
  isActive: boolean;
  rules: Rule[];
  templateVersion: string;
  isComputed: true;
};

export type SanitizedLineItem = NormalSanitizedLineItem | ComputedSanitizedLineItem;

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
