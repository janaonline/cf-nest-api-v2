import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { PmuUndoController } from './pmu-undo.controller';
import { PmuUndoDto } from './pmu-undo.dto';

const ID = '507f1f77bcf86cd799439011';

describe('PmuUndoController', () => {
  it('passes the body, caller, ip and user agent straight to the service', async () => {
    const service = { undo: jest.fn().mockResolvedValue('result') };
    const controller = new PmuUndoController(service as never);
    const user = { _id: 'u1' } as unknown as AuthUser;
    const dto = { type: 'SFC_STATUS', stateId: ID, yearId: ID } as PmuUndoDto;

    await expect(controller.undo(dto, user, '1.1.1.1', 'jest')).resolves.toBe('result');
    expect(service.undo).toHaveBeenCalledWith(dto, user, '1.1.1.1', 'jest');
  });
});

describe('PmuUndoDto validation', () => {
  const errorsFor = async (body: Record<string, unknown>) =>
    (await validate(plainToInstance(PmuUndoDto, body))).map((e) => e.property).sort();

  it('accepts every supported form type, with and without an installment', async () => {
    for (const type of ['SFC_STATUS', 'GTC', 'DEVOLUTION_FORMULA', 'ELECTED_BODY', 'FC_UNSPENT']) {
      expect(await errorsFor({ type, stateId: ID, yearId: ID })).toEqual([]);
    }
    expect(await errorsFor({ type: 'GTC', stateId: ID, yearId: ID, installment: 2 })).toEqual([]);
  });

  it('coerces a numeric string installment and rejects one outside 1-2', async () => {
    expect(await errorsFor({ type: 'GTC', stateId: ID, yearId: ID, installment: '1' })).toEqual([]);
    expect(await errorsFor({ type: 'GTC', stateId: ID, yearId: ID, installment: 3 })).toEqual(['installment']);
  });

  it('rejects an unknown type and malformed ids', async () => {
    expect(await errorsFor({ type: 'NOPE', stateId: 'x', yearId: '' })).toEqual(['stateId', 'type', 'yearId']);
  });
});
