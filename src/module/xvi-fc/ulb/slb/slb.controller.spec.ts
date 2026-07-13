import { Test, TestingModule } from '@nestjs/testing';
import { SlbController } from './slb.controller';
import { SlbService } from './slb.service';

describe('SlbController', () => {
  let controller: SlbController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SlbController],
      providers: [SlbService],
    }).compile();

    controller = module.get<SlbController>(SlbController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
