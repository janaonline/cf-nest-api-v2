import { Test, TestingModule } from '@nestjs/testing';
import { StateController } from './state.controller';
import { StateService } from './state.service';

describe('StateController', () => {
  let controller: StateController;
  let stateService: {
    findAll: jest.Mock;
  };

  beforeEach(async () => {
    stateService = {
      findAll: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [StateController],
      providers: [{ provide: StateService, useValue: stateService }],
    }).compile();

    controller = module.get<StateController>(StateController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates findAll to the service', async () => {
    const states = [{ name: 'Andhra Pradesh', slug: 'andhra-pradesh', code: 'AP' }];
    stateService.findAll.mockResolvedValue(states);

    const result = await controller.findAll();

    expect(stateService.findAll).toHaveBeenCalledWith();
    expect(result).toBe(states);
  });

  it('propagates errors thrown by the service', async () => {
    stateService.findAll.mockRejectedValue(new Error('db down'));

    await expect(controller.findAll()).rejects.toThrow('db down');
  });
});
