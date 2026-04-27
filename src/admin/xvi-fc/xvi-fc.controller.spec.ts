import { Test, TestingModule } from '@nestjs/testing';
import { XviFcController } from './xvi-fc.controller';
import { XviFcService } from './xvi-fc.service';

describe('XviFcController', () => {
  let controller: XviFcController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [XviFcController],
      providers: [XviFcService],
    }).compile();

    controller = module.get<XviFcController>(XviFcController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
