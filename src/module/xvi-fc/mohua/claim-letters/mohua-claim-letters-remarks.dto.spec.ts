import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { ReturnMohuaClaimLetterDto } from './mohua-claim-letters-return.dto';
import { DecideMohuaClaimLetterUlbDto } from './mohua-claim-letters-ulb-decision.dto';

/** The properties that failed, after the same transform + validation the global ValidationPipe runs. */
function failed<T extends object>(cls: new () => T, body: Record<string, unknown>): string[] {
  return validateSync(plainToInstance(cls, body)).map((e) => e.property);
}

describe('SO return remarks (at least 10 characters, trimmed)', () => {
  describe('letter return', () => {
    const body = (stateRemark?: unknown) => ({ expectedRevision: 1, stateFormIds: [22], stateRemark });

    it('requires a remark', () => {
      expect(failed(ReturnMohuaClaimLetterDto, body())).toContain('stateRemark');
    });

    it('refuses fewer than 10 characters once trimmed, even padded with spaces', () => {
      expect(failed(ReturnMohuaClaimLetterDto, body('Fix SFC'))).toContain('stateRemark');
      expect(failed(ReturnMohuaClaimLetterDto, body('   Fix SFC      '))).toContain('stateRemark');
    });

    it('accepts 10 or more characters and trims them', () => {
      expect(failed(ReturnMohuaClaimLetterDto, body('  Fix the SFC status  '))).toEqual([]);
      expect(plainToInstance(ReturnMohuaClaimLetterDto, body('  Fix the SFC status  ')).stateRemark).toBe(
        'Fix the SFC status',
      );
    });
  });

  describe('marking one ULB', () => {
    it('requires 10+ characters when RETURNED', () => {
      expect(failed(DecideMohuaClaimLetterUlbDto, { status: 'RETURNED', ulbFormIds: [33] })).toContain('remark');
      expect(failed(DecideMohuaClaimLetterUlbDto, { status: 'RETURNED', ulbFormIds: [33], remark: 'IFSC' })).toContain(
        'remark',
      );
      expect(failed(DecideMohuaClaimLetterUlbDto, { status: 'RETURNED', ulbFormIds: [33], remark: 'Wrong IFSC' })).toEqual(
        [],
      );
    });

    it('needs no remark to clear a mark (PENDING)', () => {
      expect(failed(DecideMohuaClaimLetterUlbDto, { status: 'PENDING' })).toEqual([]);
    });
  });
});
