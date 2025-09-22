import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { Model } from 'mongoose';
import { AnnualAccountsService } from './annualaccounts.service';

describe('AnnualAccountsService - getRawFiles()', () => {
  let service: AnnualAccountsService;
  let ulbModel: Model<any>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AnnualAccountsService,
        {
          provide: getModelToken('Ulb'),
          useValue: {
            aggregate: jest.fn().mockReturnThis(),
            exec: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AnnualAccountsService>(AnnualAccountsService);
    ulbModel = module.get<Model<any>>(getModelToken('Ulb'));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Test Case 1
  it('should build pipeline and return data', async () => {
    const query = {
      ulb: '5dd006d4ffbcc50cfd92c87c',
      state: '5dcf9d7316a06aed41c748ec',
      ulbType: '5dcfa67543263a0e75c71697',
      popCat: '500K-1M',
      year: '606aaf854dff55e6c075d219',
      auditType: 'audited',
    };

    const mockData = [{ ulbName: 'Test City' }];

    const mockExec = jest.fn().mockResolvedValue(mockData);
    const mockAggregate = jest.fn().mockReturnValue({ exec: mockExec });

    ulbModel.aggregate = mockAggregate;

    const result = await service.getRawFiles(query);

    expect(mockAggregate).toHaveBeenCalledTimes(1);
    expect(mockExec).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ success: true, data: mockData });
  });
});
