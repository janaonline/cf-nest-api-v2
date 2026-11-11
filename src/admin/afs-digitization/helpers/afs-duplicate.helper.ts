/** Slots compared for duplicates, in the order that decides which file is the original (the first one). */
export const DUPLICATE_SLOT_ORDER = [
  'bal_sheet',
  'bal_sheet_schedules',
  'inc_exp',
  'inc_exp_schedules',
  'cash_flow',
] as const;

export interface DuplicateCheckPdf {
  url?: string | null;
  fileSizeBytes?: number | null;
  pageCount?: number | null;
}

const hasValue = (n: number | null | undefined): n is number => typeof n === 'number' && Number.isFinite(n);

/**
 * Finds the slots of one ULB / year / audit type whose PDF is the same file as an earlier slot's.
 * Returns duplicate slot -> original slot.
 *
 * Two PDFs are the same file when they have the same url, or the same size AND page count. Metadata that is
 * missing (or an empty url) never matches, so a re-saved copy with a different size stays a separate file.
 */
export function findDuplicateSlots(pdfs: Partial<Record<string, DuplicateCheckPdf | undefined>>): Map<string, string> {
  const duplicates = new Map<string, string>();
  const originalByUrl = new Map<string, string>();
  const originalByContent = new Map<string, string>();

  for (const slot of DUPLICATE_SLOT_ORDER) {
    const pdf = pdfs[slot];
    const url = pdf?.url?.trim();
    if (!url) continue;

    const contentKey =
      hasValue(pdf?.fileSizeBytes) && hasValue(pdf?.pageCount) ? `${pdf.fileSizeBytes}:${pdf.pageCount}` : undefined;

    const original = originalByUrl.get(url) ?? (contentKey ? originalByContent.get(contentKey) : undefined);
    if (original) {
      duplicates.set(slot, original);
      continue;
    }

    originalByUrl.set(url, slot);
    if (contentKey) originalByContent.set(contentKey, slot);
  }

  return duplicates;
}
