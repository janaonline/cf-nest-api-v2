import { Test, TestingModule } from '@nestjs/testing';
import { AnnualAccountsService } from './annualaccounts.service';

describe('AnnualAccountsService', () => {
  let service: AnnualAccountsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AnnualAccountsService],
    }).compile();

    service = module.get<AnnualAccountsService>(AnnualAccountsService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
