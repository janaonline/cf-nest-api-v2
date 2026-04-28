import { Test, TestingModule } from '@nestjs/testing';
import { XviFcService } from './xvi-fc.service';

describe('XviFcService', () => {
  let service: XviFcService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [XviFcService],
    }).compile();

    service = module.get<XviFcService>(XviFcService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
