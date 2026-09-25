import type { SupportingContentBadge } from 'src/module/xvi-fc/common/types/field-config.type';

/**
 * Builds the missing/new/duplicate ULB reconciliation pills shared by any xvi-fc state module
 * that reconciles an Excel upload against the active ULB registry — used by both
 * elected-urban-local-bodies and devolution-formula's `buildElectedBodyFileSupportingContent`/
 * `buildExcelFileSupportingContent`. A future module with the same reconciliation shape should
 * call this with its own persisted counts rather than duplicating the label/tone literals again.
 */
export function buildUlbReconciliationBadges(params: {
  missingCount: number;
  newCount: number;
  duplicateCount: number;
  visible: boolean;
}): SupportingContentBadge[] {
  return [
    {
      label: `${params.missingCount} missing ULB(s)`,
      tone: 'warning',
      visible: params.visible && params.missingCount > 0,
    },
    {
      label: `${params.newCount} new ULB(s)`,
      tone: 'warning',
      visible: params.visible && params.newCount > 0,
    },
    {
      label: `${params.duplicateCount} duplicate ULB(s)`,
      tone: 'warning',
      visible: params.visible && params.duplicateCount > 0,
    },
  ];
}
