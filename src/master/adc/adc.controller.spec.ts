import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { IAuthUser } from 'src/common/interfaces/auth-user.interface';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { ROLES_KEY } from 'src/module/auth/decorators/roles.decorator';
import { Role } from 'src/module/auth/enum/role.enum';
import { AdcController } from './adc.controller';
import { AdcService } from './adc.service';
import { AdcListQueryDto } from './dto/adc-list-query.dto';
import { AdcMembersQueryDto } from './dto/adc-members-query.dto';
import { AdcPageQueryDto } from './dto/adc-page-query.dto';
import { AdcUlbsQueryDto } from './dto/adc-ulbs-query.dto';
import { CreateAdcDto } from './dto/create-adc.dto';

describe('AdcController', () => {
  let controller: AdcController;
  let service: Record<string, jest.Mock>;
  const user = { _id: 'admin-1', role: 'ADMIN' } as AuthUser;

  beforeEach(async () => {
    service = {
      findAll: jest.fn(),
      listForAdmin: jest.fn(),
      detail: jest.fn(),
      members: jest.fn(),
      ulbs: jest.fn(),
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

    for (const name of ['listForAdmin', 'detail', 'members', 'ulbs', 'create', 'rename', 'setAdmin', 'remove']) {
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
    await controller.detail('a1');
    await controller.members('a1', { page: 1, limit: 20, status: 'ACTIVE' });
    await controller.ulbs('a1', { page: 1, limit: 10 }, user as unknown as IAuthUser);
    await controller.create(createDto, user);
    await controller.rename('a1', { name: 'New' }, user);
    await controller.setAdmin('a1', { mode: 'promote', userId: 'u1' }, user);
    await controller.remove('a1', user);

    expect(service.listForAdmin).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(service.detail).toHaveBeenCalledWith('a1');
    expect(service.members).toHaveBeenCalledWith('a1', { page: 1, limit: 20, status: 'ACTIVE' });
    expect(service.ulbs).toHaveBeenCalledWith('a1', { page: 1, limit: 10 }, user);
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

  describe('AdcPageQueryDto (shared by every ADC table)', () => {
    const toDto = (query: Record<string, unknown>) => plainToInstance(AdcPageQueryDto, query);

    it('defaults to page 1 and 20 rows, and cuts a larger page size to 20', async () => {
      expect(toDto({})).toEqual(expect.objectContaining({ page: 1, limit: 20 }));
      const dto = toDto({ limit: '50' });
      expect(await validate(dto)).toHaveLength(0);
      expect(dto.limit).toBe(20);
    });

    it('takes only 1 or -1 as the sort direction', async () => {
      expect(toDto({ sortDir: '-1' }).sortDir).toBe(-1);
      expect((await validate(toDto({ sortDir: '2' }))).map((e) => e.property)).toEqual(['sortDir']);
    });

    it('applies the same paging to the members and ULBs queries', () => {
      expect(plainToInstance(AdcMembersQueryDto, { limit: '99' }).limit).toBe(20);
      expect(plainToInstance(AdcUlbsQueryDto, { limit: '99' }).limit).toBe(20);
    });
  });

  describe('members and ULBs query DTOs', () => {
    it('parse the boolean flags from query strings and refuse unknown values', async () => {
      const members = plainToInstance(AdcMembersQueryDto, { excludeAdmin: 'true', level: 'EDITOR', status: 'INVITED' });
      expect(members.excludeAdmin).toBe(true);
      expect(await validate(members)).toHaveLength(0);
      const bad = await validate(plainToInstance(AdcMembersQueryDto, { level: 'OWNER', sortBy: 'email' }));
      expect(bad.map((e) => e.property).sort()).toEqual(['level', 'sortBy']);

      const ulbs = plainToInstance(AdcUlbsQueryDto, { isActive: 'false', approvalStatus: 'EXISTING', sortBy: 'code' });
      expect(ulbs.isActive).toBe(false);
      expect(await validate(ulbs)).toHaveLength(0);
      const badUlbs = await validate(plainToInstance(AdcUlbsQueryDto, { ulbType: 'x', approvalStatus: 'DONE' }));
      expect(badUlbs.map((e) => e.property).sort()).toEqual(['approvalStatus', 'ulbType']);
    });
  });

  describe('AdcListQueryDto', () => {
    const toDto = (query: Record<string, unknown>) => plainToInstance(AdcListQueryDto, query);

    it('takes the Admin status and sort columns of the list, and nothing else', async () => {
      expect(await validate(toDto({ adminStatus: 'NOT_SET', sortBy: 'memberCount', sortDir: '-1' }))).toHaveLength(0);
      const errors = await validate(toDto({ adminStatus: 'PENDING', sortBy: 'admin' }));
      expect(errors.map((e) => e.property).sort()).toEqual(['adminStatus', 'sortBy']);
    });

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
