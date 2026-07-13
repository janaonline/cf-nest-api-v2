import { Test, TestingModule } from '@nestjs/testing';
import { SlbService } from './slb.service';

describe('SlbService', () => {
  let service: SlbService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SlbService],
    }).compile();

    service = module.get<SlbService>(SlbService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
