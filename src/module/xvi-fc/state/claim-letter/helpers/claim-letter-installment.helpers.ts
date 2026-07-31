import { BadRequestException } from '@nestjs/common';
import { CLAIM_LETTER_SUPPORTED_INSTALLMENT } from '../constants/claim-letter.constants';

/**
 * V1 supports Installment 1 only (plan §1) — Installment 2 stays schema-legal but is rejected
 * here as a simple guard, not dead branching logic elsewhere in the module.
 */
export function assertInstallmentSupported(installment: number): asserts installment is 1 {
  if (installment !== CLAIM_LETTER_SUPPORTED_INSTALLMENT) {
    throw new BadRequestException(
      `Installment ${installment} is not yet available. Only Installment ${CLAIM_LETTER_SUPPORTED_INSTALLMENT} is supported.`,
    );
  }
}
