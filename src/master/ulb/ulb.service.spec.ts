import { Test, TestingModule } from '@nestjs/testing';
import { UlbService } from './ulb.service';

describe('UlbService', () => {
  let service: UlbService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [UlbService],
    }).compile();

    service = module.get<UlbService>(UlbService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
