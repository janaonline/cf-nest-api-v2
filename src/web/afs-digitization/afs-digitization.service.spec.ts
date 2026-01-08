import { Test, TestingModule } from '@nestjs/testing';
import { AfsDigitizationService } from './afs-digitization.service';

describe('AfsDigitizationService', () => {
  let service: AfsDigitizationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AfsDigitizationService],
    }).compile();

    service = module.get<AfsDigitizationService>(AfsDigitizationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
