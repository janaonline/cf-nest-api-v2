import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { State } from 'src/schemas/state.schema';
import { StateService } from './state.service';

describe('StateService', () => {
  let service: StateService;
  let stateModel: { find: jest.Mock };

  beforeEach(async () => {
    stateModel = { find: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [StateService, { provide: getModelToken(State.name), useValue: stateModel }],
    }).compile();

    service = module.get<StateService>(StateService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('findAll', () => {
    it('queries only active, published states with the projected fields, sorted by name', async () => {
      const lean = jest.fn().mockResolvedValue([]);
      const sort = jest.fn().mockReturnValue({ lean });
      stateModel.find.mockReturnValue({ sort });

      await service.findAll();

      expect(stateModel.find).toHaveBeenCalledWith(
        { isActive: true, isPublish: true },
        { name: 1, slug: 1, code: 1, regionalName: 1, censusCode: 1 },
      );
      expect(sort).toHaveBeenCalledWith({ name: 1 });
      expect(lean).toHaveBeenCalled();
    });

    it('returns the lean list of states resolved from the model', async () => {
      const states = [{ name: 'Andhra Pradesh', slug: 'andhra-pradesh', code: 'AP' }];
      const lean = jest.fn().mockResolvedValue(states);
      const sort = jest.fn().mockReturnValue({ lean });
      stateModel.find.mockReturnValue({ sort });

      const result = await service.findAll();

      expect(result).toBe(states);
    });

    it('returns an empty array when no states match', async () => {
      const lean = jest.fn().mockResolvedValue([]);
      const sort = jest.fn().mockReturnValue({ lean });
      stateModel.find.mockReturnValue({ sort });

      const result = await service.findAll();

      expect(result).toEqual([]);
    });

    it('propagates errors from the model', async () => {
      const lean = jest.fn().mockRejectedValue(new Error('connection lost'));
      const sort = jest.fn().mockReturnValue({ lean });
      stateModel.find.mockReturnValue({ sort });

      await expect(service.findAll()).rejects.toThrow('connection lost');
    });
  });
});
