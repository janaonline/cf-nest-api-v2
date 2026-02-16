import { Test, TestingModule } from '@nestjs/testing';
import { DataCollectionController } from './data-collection.controller';
import { DataCollectionService } from './data-collection.service';

describe('DataCollectionController', () => {
  let controller: DataCollectionController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [DataCollectionController],
      providers: [DataCollectionService],
    }).compile();

    controller = module.get<DataCollectionController>(DataCollectionController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
