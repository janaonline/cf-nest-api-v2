import type { Rule } from 'src/module/line-items-legends/types';

/** A single validation error for a submitted line item. */
export type DataCollectionValidationIssue = {
  lineItemCode: string;
  value: unknown;
  severity: 'ERROR';
  message: string;
  validationRule?: Rule;
  submittedOperands?: string[];
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
