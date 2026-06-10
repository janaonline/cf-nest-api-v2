import { Types } from 'mongoose';
import type { LineItemLegendForValidation, Rule } from 'src/module/line-items-legends/types';
import { DataCollection } from '../entities/data-collection.schema';

/** Computed financial totals derived from submitted line items. Never accepted from client. */
export type ComputedValues = {
  totIncome: number;
  totExpenditure: number;
  totRevenue: number;
  totOwnRevenue: number;
};

/** A single validation error for a submitted line item. */
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

export type ValidationContext = {
  /** Validated finite-number values keyed by nmamCode. Sparse — only submitted. */
  submittedLineItems: Record<string, number>;
  /** Codes that were submitted but had invalid (non-finite) values; already reported. */
  invalidSubmittedCodes: Set<string>;
  legendByCode: Map<string, LineItemLegendForValidation>;
  /** Legend records for every code that passed key + value validation. */
  submittedLegendItems: LineItemLegendForValidation[];
  computed: ComputedValues;
};

export type ValidationOutcome = DataCollectionValidationResult & {
  computed: ComputedValues;
  submittedLineItems: Record<string, number>;
};
