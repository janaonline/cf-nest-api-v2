import { Test, TestingModule } from '@nestjs/testing';
import { UlbController } from './ulb.controller';
import { UlbService } from './ulb.service';

describe('UlbController', () => {
  let controller: UlbController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UlbController],
      providers: [UlbService],
    }).compile();

    controller = module.get<UlbController>(UlbController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
