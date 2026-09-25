import { Test, TestingModule } from '@nestjs/testing';
import type { IAuthUser } from 'src/common/interfaces/auth-user.interface';
import { Role } from 'src/module/auth/enum/role.enum';
import { UlbController } from './ulb.controller';
import { UlbService } from './ulb.service';

describe('UlbController', () => {
  let controller: UlbController;
  let ulbService: {
    create: jest.Mock;
    findAll: jest.Mock;
    findOne: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    approve: jest.Mock;
    reject: jest.Mock;
    getRegisterSections: jest.Mock;
    getEditSections: jest.Mock;
  };

  const adminUser: IAuthUser = { _id: '507f1f77bcf86cd799439011', role: Role.ADMIN };

  beforeEach(async () => {
    ulbService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      approve: jest.fn(),
      reject: jest.fn(),
      getRegisterSections: jest.fn(),
      getEditSections: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [UlbController],
      providers: [{ provide: UlbService, useValue: ulbService }],
    }).compile();

    controller = module.get<UlbController>(UlbController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates create to the service with the current user', () => {
    const dto = { data: { name: 'Test ULB' } };
    void controller.create(dto, adminUser);
    expect(ulbService.create).toHaveBeenCalledWith(dto, adminUser);
  });

  it('delegates findAll to the service with the current user', () => {
    const query = { page: 1, limit: 10 };
    void controller.findAll(query, adminUser);
    expect(ulbService.findAll).toHaveBeenCalledWith(query, adminUser);
  });

  it('delegates findOne to the service', () => {
    void controller.findOne('123');
    expect(ulbService.findOne).toHaveBeenCalledWith('123');
  });

  it('delegates update to the service with the current user', () => {
    const dto = { data: { name: 'Renamed ULB' } };
    void controller.update('123', dto, adminUser);
    expect(ulbService.update).toHaveBeenCalledWith('123', dto, adminUser);
  });

  it('delegates approve to the service with the current user', () => {
    void controller.approve('123', adminUser);
    expect(ulbService.approve).toHaveBeenCalledWith('123', adminUser);
  });

  it('delegates reject to the service with the current user', () => {
    const dto = { reason: 'Duplicate' };
    void controller.reject('123', dto, adminUser);
    expect(ulbService.reject).toHaveBeenCalledWith('123', dto, adminUser);
  });

  it('delegates remove to the service', () => {
    void controller.remove('123');
    expect(ulbService.remove).toHaveBeenCalledWith('123');
  });

  it('delegates findRegisterSections to the service', () => {
    void controller.findRegisterSections();
    expect(ulbService.getRegisterSections).toHaveBeenCalled();
  });

  it('delegates findEditSections to the service', () => {
    void controller.findEditSections();
    expect(ulbService.getEditSections).toHaveBeenCalled();
  });
});
