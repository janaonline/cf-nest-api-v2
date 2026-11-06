import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateClaimLetterDraftDto } from './create-claim-letter-draft.dto';

const ulbId = '6a630b5e773b6e7bf21f8b6c';

/** Through the parent DTO, as the ValidationPipe sees a create body. */
async function selectionFor(claimedAmount: unknown) {
  const dto = plainToInstance(CreateClaimLetterDraftDto, { ulbSelections: [{ ulbId, claimedAmount }] });
  const errors = await validate(dto);
  return { selection: dto.ulbSelections[0], errorCount: errors.length };
}

describe('ClaimLetterUlbSelectionDto claimedAmount', () => {
  it('reads null as omitted, so every path treats it like a missing amount', async () => {
    const { selection, errorCount } = await selectionFor(null);
    expect(errorCount).toBe(0);
    expect(selection.claimedAmount).toBeUndefined();
  });

  it('keeps a whole-rupee amount as sent', async () => {
    const { selection, errorCount } = await selectionFor(250000);
    expect(errorCount).toBe(0);
    expect(selection.claimedAmount).toBe(250000);
  });

  it.each([0, 12.5, 'abc'])('rejects %p', async (claimedAmount) => {
    expect((await selectionFor(claimedAmount)).errorCount).toBe(1);
  });
});
