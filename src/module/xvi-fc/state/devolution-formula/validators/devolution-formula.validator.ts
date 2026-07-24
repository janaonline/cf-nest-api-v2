import { Injectable } from '@nestjs/common';
import type { DfInstallment } from '../constants/devolution-formula.constants';
import type { DfRowError, DfValidationSummary } from '../types/devolution-formula.types';

export interface DfParsedExcelRow {
  rowNumber: number;
  censusCode: string;
  ulbName: string;
  totalGrantAllocation: unknown;
  installment1Amount: unknown;
  installment2Amount: unknown;
  devolutionFormula: string;
}

const ALLOCATION_TOLERANCE = 0.001;

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && isFinite(v);
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
    installment: DfInstallment,
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
    if (
      parsed.installment1Amount === '' ||
      parsed.installment1Amount === null ||
      parsed.installment1Amount === undefined
    ) {
      errors.push({ field: 'installment1Amount', code: 'required', message: 'Installment 1 Amount is required.' });
    }
    if (
      parsed.installment2Amount === '' ||
      parsed.installment2Amount === null ||
      parsed.installment2Amount === undefined
    ) {
      errors.push({ field: 'installment2Amount', code: 'required', message: 'Installment 2 Amount is required.' });
    }
    if (!parsed.devolutionFormula || !String(parsed.devolutionFormula).trim()) {
      errors.push({ field: 'devolutionFormula', code: 'required', message: 'Devolution Formula is required.' });
    } else if (String(parsed.devolutionFormula).trim().length > maxFormulaLength) {
      errors.push({
        field: 'devolutionFormula',
        code: 'maxlength',
        message: `Devolution Formula cannot exceed ${maxFormulaLength} characters.`,
        value: parsed.devolutionFormula,
      });
    }

    if (errors.length > 0) return errors;

    // 2. Type / format checks
    const total = Number(parsed.totalGrantAllocation);
    const inst1 = Number(parsed.installment1Amount);
    const inst2 = Number(parsed.installment2Amount);

    if (!isFiniteNumber(total)) {
      errors.push({
        field: 'totalGrantAllocation',
        code: 'number',
        message: 'Total Grant Allocation must be a valid number.',
        value: parsed.totalGrantAllocation,
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
        message: `Total Grant Allocation (${total}Cr.) cannot exceed the MoHUA grant allocation (${context.totalMoHUAAllocation}Cr.).`,
        value: total,
      });
    }

    if (!isFiniteNumber(inst1)) {
      errors.push({
        field: 'installment1Amount',
        code: 'number',
        message: 'Installment 1 Amount must be a valid number.',
        value: parsed.installment1Amount,
      });
    } else if (inst1 < 0) {
      errors.push({
        field: 'installment1Amount',
        code: 'min',
        message: 'Installment 1 Amount must be ≥ 0.',
        value: inst1,
      });
    } else if (isFiniteNumber(total) && inst1 > total) {
      errors.push({
        field: 'installment1Amount',
        code: 'max',
        message: `Installment 1 Amount (${inst1}) cannot exceed Total Grant Allocation (${total}).`,
        value: inst1,
      });
    }

    if (!isFiniteNumber(inst2)) {
      errors.push({
        field: 'installment2Amount',
        code: 'number',
        message: 'Installment 2 Amount must be a valid number.',
        value: parsed.installment2Amount,
      });
    } else if (inst2 < 0) {
      errors.push({
        field: 'installment2Amount',
        code: 'min',
        message: 'Installment 2 Amount must be ≥ 0.',
        value: inst2,
      });
    } else if (isFiniteNumber(total) && inst2 > total) {
      errors.push({
        field: 'installment2Amount',
        code: 'max',
        message: `Installment 2 Amount (${inst2}) cannot exceed Total Grant Allocation (${total}).`,
        value: inst2,
      });
    }

    if (errors.length > 0) return errors;

    // 3. Business rules
    const allocationErrors = this.validateAllocations(inst1, inst2, total, installment);
    errors.push(...allocationErrors);

    return errors;
  }

  /**
   * Validates that inst1 + inst2 === total within floating point tolerance.
   * If installment is 1, inst2 may be 0 (not yet disbursed), but the math still must hold.
   */
  validateAllocations(inst1: number, inst2: number, total: number, _installment?: DfInstallment): DfRowError[] {
    const errors: DfRowError[] = [];
    const sum = inst1 + inst2;
    if (Math.abs(sum - total) > ALLOCATION_TOLERANCE) {
      errors.push({
        field: 'installment1Amount',
        code: 'allocationMismatch',
        message: `Installment 1 Amount (${inst1}) + Installment 2 Amount (${inst2}) must equal Total Grant Allocation (${total}).`,
        value: { inst1, inst2, total, sum },
      });
    }
    return errors;
  }

  /**
   * Validates editable fields submitted via the portal row-edit endpoint.
   * Only validates what was provided; missing optional fields are not flagged.
   */
  validatePortalRowEdit(
    dto: {
      totalGrantAllocation?: number;
      installment1Amount?: number;
      installment2Amount?: number;
      devolutionFormula?: string;
    },
    _installment: DfInstallment,
    maxFormulaLength: number,
    context?: { totalMoHUAAllocation?: number },
  ): DfRowError[] {
    const errors: DfRowError[] = [];

    if (dto.devolutionFormula !== undefined) {
      if (!String(dto.devolutionFormula).trim()) {
        errors.push({ field: 'devolutionFormula', code: 'required', message: 'Devolution Formula cannot be empty.' });
      } else if (String(dto.devolutionFormula).trim().length > maxFormulaLength) {
        errors.push({
          field: 'devolutionFormula',
          code: 'maxlength',
          message: `Devolution Formula cannot exceed ${maxFormulaLength} characters.`,
          value: dto.devolutionFormula,
        });
      }
    }

    const hasTotal = dto.totalGrantAllocation !== undefined;
    const hasInst1 = dto.installment1Amount !== undefined;
    const hasInst2 = dto.installment2Amount !== undefined;

    if ((hasTotal && !isFiniteNumber(dto.totalGrantAllocation)) || (hasTotal && dto.totalGrantAllocation! < 0)) {
      errors.push({
        field: 'totalGrantAllocation',
        code: 'number',
        message: 'Total Grant Allocation must be a finite number ≥ 0.',
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
        message: `Total Grant Allocation cannot exceed the MoHUA grant allocation (${context.totalMoHUAAllocation}Cr.).`,
      });
    }
    if (hasInst1 && (!isFiniteNumber(dto.installment1Amount) || dto.installment1Amount < 0)) {
      errors.push({
        field: 'installment1Amount',
        code: 'number',
        message: 'Installment 1 Amount must be a finite number ≥ 0.',
      });
    }
    if (hasInst2 && (!isFiniteNumber(dto.installment2Amount) || dto.installment2Amount < 0)) {
      errors.push({
        field: 'installment2Amount',
        code: 'number',
        message: 'Installment 2 Amount must be a finite number ≥ 0.',
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
      totalMoHUAAllocation,
      totalAllocatedSum,
      activeDatasetVersion,
    } = params;
    const allUlbsCovered = missingUlbCount === 0;
    const allocationBalanced = Math.abs(totalAllocatedSum - totalMoHUAAllocation) <= ALLOCATION_TOLERANCE;
    const isValid = errorRowCount === 0 && allUlbsCovered && allocationBalanced;

    return {
      excelRowCount,
      validRowCount,
      errorRowCount,
      missingUlbCount,
      newUlbCount,
      totalMoHUAAllocation,
      totalAllocatedSum,
      allUlbsCovered,
      allocationBalanced,
      validationStatus: isValid ? 'VALID' : excelRowCount === 0 ? 'NOT_VALIDATED' : 'INVALID',
      activeDatasetVersion,
    };
  }
}
