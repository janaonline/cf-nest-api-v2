import { Injectable } from '@nestjs/common';
import type { DfRowError, DfValidationSummary } from '../types/devolution-formula.types';
import { amountsAreEqual } from '../helpers/devolution-formula-tolerance.helpers';

export interface DfParsedExcelRow {
  rowNumber: number;
  censusCode: string;
  ulbName: string;
  totalGrantAllocation: unknown;
  /** Derived as Total / 2 (splitTotalIntoInstallments), never read from the upload or validated here. */
  installment1Amount: unknown;
  installment2Amount: unknown;
  devolutionFormula: string;
}

// The Total is whole Rupees only - a fractional Total is rejected, not rounded; apportioning into
// whole-Rupee shares that sum exactly is the State's job. Instalments aren't checked (docs/adr/0002).

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && isFinite(v);
}

/** Whole Rupees only — no decimals. Call only after isFiniteNumber has already confirmed a number. */
function isWholeNumber(v: number): boolean {
  return Number.isInteger(v);
}

@Injectable()
export class DevolutionFormulaValidator {
  /**
   * Validates a single parsed Excel row against the ULB registry match result.
   * Call only AFTER the registry check — dbUlb must already be resolved.
   * Unknown ULBs (dbUlb === null because no identifier matched) should produce
   * a registry error before this is called.
   */
  validateRow(
    parsed: DfParsedExcelRow,
    maxFormulaLength: number,
    context?: { totalMoHUAAllocation?: number },
  ): DfRowError[] {
    const errors: DfRowError[] = [];

    // 1. Required field checks
    if (!parsed.ulbName || !String(parsed.ulbName).trim()) {
      errors.push({ field: 'ulbName', code: 'required', message: 'ULB Name is required.' });
    }
    if (
      parsed.totalGrantAllocation === '' ||
      parsed.totalGrantAllocation === null ||
      parsed.totalGrantAllocation === undefined
    ) {
      errors.push({ field: 'totalGrantAllocation', code: 'required', message: 'Total Grant Allocation is required.' });
    }
    if (!parsed.devolutionFormula || !String(parsed.devolutionFormula).trim()) {
      errors.push({ field: 'devolutionFormula', code: 'required', message: 'Allocation Formula is required.' });
    } else if (String(parsed.devolutionFormula).trim().length > maxFormulaLength) {
      errors.push({
        field: 'devolutionFormula',
        code: 'maxlength',
        message: `Allocation Formula cannot exceed ${maxFormulaLength} characters.`,
        value: parsed.devolutionFormula,
      });
    }

    if (errors.length > 0) return errors;

    // 2. Type / format checks (the instalments are derived from the Total, so only the Total is checked).
    // Only a number or number-like text counts: Number(true) is 1, and a TRUE cell would get 0 / 0 instalments.
    const rawTotal = parsed.totalGrantAllocation;
    const total = typeof rawTotal === 'number' || typeof rawTotal === 'string' ? Number(rawTotal) : NaN;

    if (!isFiniteNumber(total)) {
      errors.push({
        field: 'totalGrantAllocation',
        code: 'number',
        message: 'Total Grant Allocation must be a valid number.',
        value: parsed.totalGrantAllocation,
      });
    } else if (!isWholeNumber(total)) {
      errors.push({
        field: 'totalGrantAllocation',
        code: 'notWholeNumber',
        message: 'Total Grant Allocation must be a whole number of Rupees (no decimals).',
        value: total,
      });
    } else if (total < 0) {
      errors.push({
        field: 'totalGrantAllocation',
        code: 'min',
        message: 'Total Grant Allocation must be ≥ 0.',
        value: total,
      });
    } else if (context?.totalMoHUAAllocation !== undefined && total > context.totalMoHUAAllocation) {
      errors.push({
        field: 'totalGrantAllocation',
        code: 'max',
        message: `Total Grant Allocation (₹${total}) cannot exceed the MoHUA grant allocation (₹${context.totalMoHUAAllocation}).`,
        value: total,
      });
    }

    return errors;
  }

  /**
   * Validates editable fields submitted via the portal row-edit endpoint.
   * Only validates what was provided; missing optional fields are not flagged.
   * Instalment values in the request are ignored (always derived from the Total).
   */
  validatePortalRowEdit(
    dto: {
      totalGrantAllocation?: number;
      devolutionFormula?: string;
    },
    maxFormulaLength: number,
    context?: { totalMoHUAAllocation?: number },
  ): DfRowError[] {
    const errors: DfRowError[] = [];

    if (dto.devolutionFormula !== undefined) {
      if (!String(dto.devolutionFormula).trim()) {
        errors.push({ field: 'devolutionFormula', code: 'required', message: 'Allocation Formula cannot be empty.' });
      } else if (String(dto.devolutionFormula).trim().length > maxFormulaLength) {
        errors.push({
          field: 'devolutionFormula',
          code: 'maxlength',
          message: `Allocation Formula cannot exceed ${maxFormulaLength} characters.`,
          value: dto.devolutionFormula,
        });
      }
    }

    const hasTotal = dto.totalGrantAllocation !== undefined;

    if ((hasTotal && !isFiniteNumber(dto.totalGrantAllocation)) || (hasTotal && dto.totalGrantAllocation! < 0)) {
      errors.push({
        field: 'totalGrantAllocation',
        code: 'number',
        message: 'Total Grant Allocation must be a whole number ≥ 0.',
      });
    } else if (hasTotal && isFiniteNumber(dto.totalGrantAllocation) && !isWholeNumber(dto.totalGrantAllocation)) {
      errors.push({
        field: 'totalGrantAllocation',
        code: 'notWholeNumber',
        message: 'Total Grant Allocation must be a whole number of Rupees (no decimals).',
      });
    } else if (
      hasTotal &&
      isFiniteNumber(dto.totalGrantAllocation) &&
      context?.totalMoHUAAllocation !== undefined &&
      dto.totalGrantAllocation > context.totalMoHUAAllocation
    ) {
      errors.push({
        field: 'totalGrantAllocation',
        code: 'max',
        message: `Total Grant Allocation cannot exceed the MoHUA grant allocation (₹${context.totalMoHUAAllocation}).`,
      });
    }

    return errors;
  }

  /**
   * Builds a DfValidationSummary from raw counts.
   */
  buildValidationSummary(params: {
    excelRowCount: number;
    validRowCount: number;
    errorRowCount: number;
    missingUlbCount: number;
    newUlbCount?: number;
    duplicateUlbCount?: number;
    totalMoHUAAllocation: number;
    totalAllocatedSum: number;
    activeDatasetVersion: number;
  }): DfValidationSummary {
    const {
      excelRowCount,
      validRowCount,
      errorRowCount,
      missingUlbCount,
      newUlbCount = 0,
      duplicateUlbCount = 0,
      totalMoHUAAllocation,
      totalAllocatedSum,
      activeDatasetVersion,
    } = params;
    const allUlbsCovered = missingUlbCount === 0;
    // Defensive backstop against externally-written GrantAllocation data — see
    // devolution-formula-tolerance.helpers.ts.
    const allocationBalanced = amountsAreEqual(totalAllocatedSum, totalMoHUAAllocation);
    const isValid = errorRowCount === 0 && allUlbsCovered && allocationBalanced;

    return {
      excelRowCount,
      validRowCount,
      errorRowCount,
      missingUlbCount,
      newUlbCount,
      duplicateUlbCount,
      totalMoHUAAllocation,
      totalAllocatedSum,
      allUlbsCovered,
      allocationBalanced,
      validationStatus: isValid ? 'VALID' : excelRowCount === 0 ? 'NOT_VALIDATED' : 'INVALID',
      activeDatasetVersion,
    };
  }
}
