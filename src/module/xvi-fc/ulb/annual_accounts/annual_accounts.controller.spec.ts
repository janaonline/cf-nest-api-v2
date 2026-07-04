import { Test, TestingModule } from '@nestjs/testing';
import { AnnualAccountsController } from './annual_accounts.controller';
import { AnnualAccountsService } from './annual_accounts.service';

describe('AnnualAccountsController', () => {
  let controller: AnnualAccountsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnnualAccountsController],
      providers: [AnnualAccountsService],
    }).compile();

    controller = module.get<AnnualAccountsController>(AnnualAccountsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
