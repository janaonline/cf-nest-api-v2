import { Test, TestingModule } from '@nestjs/testing';
import { ResourcesSectionController } from './resources-section.controller';

describe('ResourcesSectionController', () => {
  let controller: ResourcesSectionController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ResourcesSectionController],
    }).compile();

    controller = module.get<ResourcesSectionController>(ResourcesSectionController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
