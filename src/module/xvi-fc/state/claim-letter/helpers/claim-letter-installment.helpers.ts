import { BadRequestException } from '@nestjs/common';
import { CLAIM_LETTER_SUPPORTED_INSTALLMENT } from '../constants/claim-letter.constants';

export function assertInstallmentSupported(installment: number): asserts installment is 1 {
  if (installment !== CLAIM_LETTER_SUPPORTED_INSTALLMENT) {
    throw new BadRequestException(
      `Installment ${installment} is not yet available. Only Installment ${CLAIM_LETTER_SUPPORTED_INSTALLMENT} is supported.`,
    );
  }
}
