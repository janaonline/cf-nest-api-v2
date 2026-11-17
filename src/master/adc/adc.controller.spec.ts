import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { ROLES_KEY } from 'src/module/auth/decorators/roles.decorator';
import { Role } from 'src/module/auth/enum/role.enum';
import { AdcController } from './adc.controller';
import { AdcService } from './adc.service';
import { AdcListQueryDto } from './dto/adc-list-query.dto';
import { CreateAdcDto } from './dto/create-adc.dto';

describe('AdcController', () => {
  let controller: AdcController;
  let service: Record<string, jest.Mock>;
  const user = { _id: 'admin-1', role: 'ADMIN' } as AuthUser;

  beforeEach(async () => {
    service = {
      findAll: jest.fn(),
      listForAdmin: jest.fn(),
      members: jest.fn(),
      create: jest.fn(),
      rename: jest.fn(),
      setAdmin: jest.fn(),
      remove: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AdcController],
      providers: [{ provide: AdcService, useValue: service }],
    }).compile();
    controller = module.get(AdcController);
  });

  it('keeps every management route ADMIN-only, and the picker open to the State DMA', () => {
    const reflector = new Reflector();
    const handlers = AdcController.prototype as unknown as Record<string, () => unknown>;
    const rolesOf = (name: string) => reflector.get<Role[]>(ROLES_KEY, handlers[name]);

    for (const name of ['listForAdmin', 'members', 'create', 'rename', 'setAdmin', 'remove']) {
      expect(rolesOf(name)).toEqual([Role.ADMIN]);
    }
    expect(rolesOf('findAll')).toEqual([Role.ADMIN, Role.STATE]);
  });

  it('delegates each route to the service', async () => {
    const createDto = {
      stateId: 's1',
      name: 'BTC',
      admin: { name: 'A', email: 'a@x.in', mobile: '9876543210', designation: 'D' },
    };
    await controller.listForAdmin({ page: 1, limit: 20 });
    await controller.members('a1');
    await controller.create(createDto, user);
    await controller.rename('a1', { name: 'New' }, user);
    await controller.setAdmin('a1', { mode: 'promote', userId: 'u1' }, user);
    await controller.remove('a1', user);

    expect(service.listForAdmin).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(service.members).toHaveBeenCalledWith('a1');
    expect(service.create).toHaveBeenCalledWith(createDto, user);
    expect(service.rename).toHaveBeenCalledWith('a1', { name: 'New' }, user);
    expect(service.setAdmin).toHaveBeenCalledWith('a1', { mode: 'promote', userId: 'u1' }, user);
    expect(service.remove).toHaveBeenCalledWith('a1', user);
  });

  it('CreateAdcDto takes `action` at the top level, next to `admin`, not inside it', async () => {
    const admin = { name: 'A Das', email: 'a@x.gov.in', mobile: '9876543210', designation: 'Secretary' };
    const body = { stateId: '65f000000000000000000001', name: 'BTC', admin };
    const opts = { whitelist: true, forbidNonWhitelisted: true };

    expect(await validate(plainToInstance(CreateAdcDto, { ...body, action: 'restore' }), opts)).toHaveLength(0);
    const nested = await validate(
      plainToInstance(CreateAdcDto, { ...body, admin: { ...admin, action: 'restore' } }),
      opts,
    );
    expect(nested.map((e) => e.property)).toEqual(['admin']);
  });

  describe('AdcListQueryDto', () => {
    const toDto = (query: Record<string, unknown>) => plainToInstance(AdcListQueryDto, query);

    it('defaults to page 1 and 20 rows', async () => {
      const dto = toDto({});
      expect(await validate(dto)).toHaveLength(0);
      expect(dto).toEqual(expect.objectContaining({ page: 1, limit: 20 }));
    });

    it('cuts a larger page size to 20 instead of refusing it', async () => {
      const dto = toDto({ limit: '50' });
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.limit).toBe(20);
      expect(toDto({ limit: '10' }).limit).toBe(10);
    });

    it('still refuses a page size below 1 or not a number', async () => {
      expect((await validate(toDto({ limit: '0' }))).map((e) => e.property)).toEqual(['limit']);
      expect((await validate(toDto({ limit: 'abc' }))).map((e) => e.property)).toEqual(['limit']);
    });

    it('trims the search and caps it at 100 characters', async () => {
      expect(toDto({ search: '  bodo  ' }).search).toBe('bodo');
      const errors = await validate(toDto({ search: 'x'.repeat(101) }));
      expect(errors.map((e) => e.property)).toEqual(['search']);
    });
  });
});
