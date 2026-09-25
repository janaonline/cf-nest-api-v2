import { BadRequestException } from '@nestjs/common';
import { assertInstallmentSupported } from './claim-letter-installment.helpers';

describe('assertInstallmentSupported', () => {
  it('does not throw for installment 1', () => {
    expect(() => assertInstallmentSupported(1)).not.toThrow();
  });

  it('throws BadRequestException for installment 2', () => {
    expect(() => assertInstallmentSupported(2)).toThrow(BadRequestException);
  });

  it('throws for any other value', () => {
    expect(() => assertInstallmentSupported(3)).toThrow(BadRequestException);
  });
});
