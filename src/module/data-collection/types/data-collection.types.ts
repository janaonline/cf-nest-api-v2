import { Types } from 'mongoose';
import type { Rule } from 'src/module/line-items-legends/types';
import { DataCollection } from '../entities/data-collection.schema';

/** Computed financial totals derived from submitted line items. Never accepted from client. */
export type ComputedValues = {
  totIncome: number;
  totExpenditure: number;
  totRevenue: number;
  totOwnRevenue: number;
};

/**
 * The four property keys that may be set on DataCollection.computed.
 * A computed legend's nmamCode must resolve to one of these via `computed.<key>`.
 */
export const COMPUTED_VALUES_KEYS = ['totIncome', 'totExpenditure', 'totRevenue', 'totOwnRevenue'] as const;
export type ComputedValuesKey = (typeof COMPUTED_VALUES_KEYS)[number];

/** Runtime type guard for computed property keys. */
export function isComputedValuesKey(value: string): value is ComputedValuesKey {
  return (COMPUTED_VALUES_KEYS as readonly string[]).includes(value);
}

/**
 * Extracts the ComputedValues property key from a computed legend nmamCode.
 * Returns null when the nmamCode is not a recognized computed legend code.
 * Example: 'computed.totIncome' → 'totIncome'
 */
export function extractComputedKey(nmamCode: string): ComputedValuesKey | null {
  const PREFIX = 'computed.';
  if (!nmamCode.startsWith(PREFIX)) return null;
  const key = nmamCode.slice(PREFIX.length);
  return isComputedValuesKey(key) ? key : null;
}

/** A single validation error for a submitted line item or computed value. */
export type DataCollectionValidationIssue = {
  lineItemCode: string;
  value: unknown;
  severity: 'ERROR';
  message: string;
  validationRule?: Rule;
  submittedOperands?: string[];
  expectedCondition?: string;
  expected?: number | null;
  received?: number | null;
};

/** Internal result of template validation; consumed by create/update to decide save vs reject. */
export type DataCollectionValidationResult = {
  errors: DataCollectionValidationIssue[];
  hasErrors: boolean;
};

/** Raw line item map as received from the API request, before value validation. */
export type SubmittedLineItems = Record<string, unknown>;

/** Public shape of one ULB entry returned by GET /data-collection/ulbs. */
export type DataCollectionUlbListItem = {
  code: string;
  name: string;
  state?: { code?: string; name?: string };
};

/** Request metadata forwarded from the controller to the service for audit logging. */
export type DataCollectionRequestMeta = {
  ip?: string;
  userAgent?: string;
};

/** Public active financial data response returned to integration clients. */
export type ExternalDataCollectionResponse = {
  ulbCode: string;
  yearCode: string;
  templateVersion: string;
  validationStatus: 'VALID' | 'WARNING';
  status: 'ACTIVE';
  lineItems: Record<string, number>;
  createdAt: Date;
  updatedAt: Date;
};

export type FormulaComputeResult =
  | { value: number; submittedCodes: string[] }
  | { errors: DataCollectionValidationIssue[] };

export type ActiveDataCollectionFilter = {
  ulbId: Types.ObjectId;
  yearId: Types.ObjectId;
  isActive: true;
  status: 'ACTIVE';
  templateVersion?: string;
};

export type DataCollectionResponseSource = Pick<
  DataCollection,
  'templateVersion' | 'validationStatus' | 'status' | 'createdAt' | 'updatedAt'
> & {
  lineItems: Map<string, number> | Record<string, number>;
  computed?: ComputedValues;
};
