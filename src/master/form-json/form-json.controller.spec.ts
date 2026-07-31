import { Test, TestingModule } from '@nestjs/testing';
import { FormJsonController } from './form-json.controller';
import { FormJsonService } from './form-json.service';

describe('FormJsonController', () => {
  let controller: FormJsonController;
  let formJsonService: {
    findAll: jest.Mock;
    findByType: jest.Mock;
    findById: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
  };

  beforeEach(async () => {
    formJsonService = {
      findAll: jest.fn(),
      findByType: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [FormJsonController],
      providers: [{ provide: FormJsonService, useValue: formJsonService }],
    }).compile();

    controller = module.get<FormJsonController>(FormJsonController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('delegates findAll to the service with the query', () => {
    const query = { type: 'xvifcSfc' } as any;
    void controller.findAll(query);
    expect(formJsonService.findAll).toHaveBeenCalledWith(query);
  });

  it('delegates findByType to the service', () => {
    void controller.findByType('xvifcSfc');
    expect(formJsonService.findByType).toHaveBeenCalledWith('xvifcSfc');
  });

  it('delegates findById to the service', () => {
    void controller.findById('abc');
    expect(formJsonService.findById).toHaveBeenCalledWith('abc');
  });

  it('delegates create to the service', () => {
    const dto = { design_year: 'abc' } as any;
    void controller.create(dto);
    expect(formJsonService.create).toHaveBeenCalledWith(dto);
  });

  it('delegates update to the service', () => {
    const dto = { type: 'updated' } as any;
    void controller.update('abc', dto);
    expect(formJsonService.update).toHaveBeenCalledWith('abc', dto);
  });

  it('delegates remove to the service', () => {
    void controller.remove('abc');
    expect(formJsonService.remove).toHaveBeenCalledWith('abc');
  });
});
