import { Test, TestingModule } from '@nestjs/testing';
import { DigitizationQueueService } from './digitization-queue.service';

describe('DigitizationQueueService', () => {
  let service: DigitizationQueueService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [DigitizationQueueService],
    }).compile();

    service = module.get<DigitizationQueueService>(DigitizationQueueService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
