/**
 * A ULB is only a valid FC Unspent row if our registry identifies it by a census code or an SB code
 * (the two codes every table, document and review screen prints). A ULB with neither is rejected on
 * save and left out of the picker, so the picker never offers a ULB the save would refuse.
 */
export function hasUlbIdentityCode(ulb: { censusCode?: string | null; sbCode?: string | null }): boolean {
  return Boolean(ulb.censusCode?.trim() || ulb.sbCode?.trim());
}

/**
 * Mongo equivalent of {@link hasUlbIdentityCode}: census code OR SB code holds a non-blank string
 * (`/\S/` never matches null, missing or whitespace-only values). `prefix` addresses the Ulb document
 * when it sits under another field in an aggregation (e.g. `'ulb.'`).
 */
export function ulbIdentityCodeCondition(prefix = ''): { $or: Record<string, { $regex: RegExp }>[] } {
  return {
    $or: [{ [`${prefix}censusCode`]: { $regex: /\S/ } }, { [`${prefix}sbCode`]: { $regex: /\S/ } }],
  };
}
