import { Types } from 'mongoose';
import type { ClaimEligibilityConfig } from '../types/claim-eligibility.type';

/** False only for a SUBMISSION_PERIOD_SINGLETON source (e.g. Bank Account): submitted once and
 *  reused across design years, so a design-year filter would miss it. */
export function claimSourceFiltersByDesignYear(config: Pick<ClaimEligibilityConfig, 'yearScope'>): boolean {
  return config.yearScope !== 'SUBMISSION_PERIOD_SINGLETON';
}

/**
 * Finds a form's document for one State from its `claimEligibility.source`. Shared by the
 * eligibility check and the claim letter's final PDF, so both read the same document.
 */
export function buildClaimSourceQuery(
  config: ClaimEligibilityConfig,
  ctx: { stateId: Types.ObjectId; designYearId: string; installment: number },
): Record<string, unknown> {
  const { match, fields } = config.source;
  const query: Record<string, unknown> = { ...match };
  if (fields && claimSourceFiltersByDesignYear(config)) query[fields.designYear] = new Types.ObjectId(ctx.designYearId);
  if (fields?.state) query[fields.state] = ctx.stateId;
  // Installment scoping travels in the evaluator config bag; `source.fields` has no installment key.
  const installmentField = config.evaluator.config?.['installmentField'];
  if (typeof installmentField === 'string') query[installmentField] = ctx.installment;
  return query;
}
