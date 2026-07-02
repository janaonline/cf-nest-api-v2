import { Test, TestingModule } from '@nestjs/testing';
import { UlbController } from './ulb.controller';
import { UlbService } from './ulb.service';

describe('UlbController', () => {
  let controller: UlbController;
  let ulbService: { create: jest.Mock; findAll: jest.Mock; findOne: jest.Mock; update: jest.Mock; remove: jest.Mock };

  beforeEach(async () => {
    ulbService = {
      create: jest.fn(),
      findAll: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
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

  it('delegates create to the service', () => {
    const dto = { data: { name: 'Test ULB' } };
    void controller.create(dto);
    expect(ulbService.create).toHaveBeenCalledWith(dto);
  });

  it('delegates findOne to the service', () => {
    void controller.findOne('123');
    expect(ulbService.findOne).toHaveBeenCalledWith('123');
  });

  it('delegates remove to the service', () => {
    void controller.remove('123');
    expect(ulbService.remove).toHaveBeenCalledWith('123');
  });
});
