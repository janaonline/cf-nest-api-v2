import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import type { AuthUser } from '../../../auth/auth-user.interface';
import { AccessLevel, Scope, UserRole } from '../../../auth/enum/roles-xvi-fc.enum';
import { UnspentBalanceDisclosureController } from './unspent-balance-disclosure.controller';
import { UnspentBalanceDisclosureService } from './unspent-balance-disclosure.service';
import type { SubmitDisclosureDto } from './dto/submit-disclosure.dto';
import type { UpdateDisclosureDto } from './dto/update-disclosure.dto';

describe('UnspentBalanceDisclosureController', () => {
  let controller: UnspentBalanceDisclosureController;
  let service: {
    submit: jest.Mock;
    getByUlbAndYear: jest.Mock;
    update: jest.Mock;
    getDocumentSignedUrl: jest.Mock;
  };

  const ulbId = new Types.ObjectId();
  const yearId = new Types.ObjectId().toString();

  const makeUser = (overrides: Partial<AuthUser> = {}): AuthUser =>
    ({
      _id: new Types.ObjectId().toString(),
      role: UserRole.ULB,
      scope: Scope.ULB,
      accessLevel: AccessLevel.ADMIN,
      ulb: ulbId,
      state: null,
      ...overrides,
    }) as AuthUser;

  beforeEach(() => {
    service = {
      submit: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(), formStatus: 'SUBMITTED' }),
      getByUlbAndYear: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(), formStatus: 'DRAFT' }),
      update: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(), formStatus: 'DRAFT' }),
      getDocumentSignedUrl: jest.fn().mockResolvedValue({ signedUrl: 'https://signed.example/doc.pdf' }),
    };

    controller = new UnspentBalanceDisclosureController(service as unknown as UnspentBalanceDisclosureService);
  });

  afterEach(() => jest.clearAllMocks());

  it('delegates submit to the service with the dto and current user', async () => {
    const dto = { designYearId: yearId } as unknown as SubmitDisclosureDto;
    const user = makeUser();

    const result = await controller.submit(dto, user);

    expect(service.submit).toHaveBeenCalledWith(dto, user);
    expect(result).toMatchObject({ formStatus: 'SUBMITTED' });
  });

  it('getByYear resolves ulbId from the authenticated user when present', async () => {
    const user = makeUser({ ulb: ulbId });

    await controller.getByYear(yearId, undefined, user);

    expect(service.getByUlbAndYear).toHaveBeenCalledWith(ulbId, yearId);
  });

  it('getByYear falls back to the query ulbId when the user has none (e.g. ADMIN)', async () => {
    const user = makeUser({ ulb: null, role: UserRole.ADMIN, scope: Scope.ADMIN });
    const queryUlbId = new Types.ObjectId().toString();

    await controller.getByYear(yearId, queryUlbId, user);

    expect(service.getByUlbAndYear).toHaveBeenCalledWith(queryUlbId, yearId);
  });

  it('getByYear throws BadRequestException when no ulbId can be resolved', () => {
    const user = makeUser({ ulb: null, role: UserRole.ADMIN, scope: Scope.ADMIN });

    expect(() => controller.getByYear(yearId, undefined, user)).toThrow(BadRequestException);
    expect(service.getByUlbAndYear).not.toHaveBeenCalled();
  });

  it('delegates update to the service with id, dto and current user', async () => {
    const dto = { fc14: undefined } as unknown as UpdateDisclosureDto;
    const user = makeUser();
    const id = new Types.ObjectId().toString();

    const result = await controller.update(id, dto, user);

    expect(service.update).toHaveBeenCalledWith(id, dto, user);
    expect(result).toMatchObject({ formStatus: 'DRAFT' });
  });

  it('delegates getDocumentSignedUrl to the service with id, filepath and current user', async () => {
    const user = makeUser();
    const id = new Types.ObjectId().toString();
    const filepath = 'xvi-fc/unspent-balance-disclosure/proof.pdf';

    const result = await controller.getDocumentSignedUrl(id, filepath, user);

    expect(service.getDocumentSignedUrl).toHaveBeenCalledWith(id, filepath, user);
    expect(result).toEqual({ signedUrl: 'https://signed.example/doc.pdf' });
  });
});
