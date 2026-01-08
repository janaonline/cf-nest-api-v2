import { Test, TestingModule } from '@nestjs/testing';
import { AfsDigitizationController } from './afs-digitization.controller';
import { AfsDigitizationService } from './afs-digitization.service';

describe('AfsDigitizationController', () => {
  let controller: AfsDigitizationController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AfsDigitizationController],
      providers: [AfsDigitizationService],
    }).compile();

    controller = module.get<AfsDigitizationController>(AfsDigitizationController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
