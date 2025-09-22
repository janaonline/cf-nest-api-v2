import { Test, TestingModule } from '@nestjs/testing';
import { AnnualAccountsController } from './annualaccounts.controller';

describe('AnnualAccountsController', () => {
  let controller: AnnualAccountsController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AnnualAccountsController],
    }).compile();

    controller = module.get<AnnualAccountsController>(AnnualAccountsController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
