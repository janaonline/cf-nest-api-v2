import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { PropertyTaxService } from './property-tax.service';
import { PropertyTaxOpMapper } from '../../schemas/property-tax-op-mapper.schema';
import { Year } from '../../schemas/year.schema';
import type { AuthUser } from '../auth/auth-user.interface';
import { Scope } from '../auth/enum/roles-xvi-fc.enum';

function q<T>(value: T) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'lean']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

const ulbOid = new Types.ObjectId();

const ulbUser: AuthUser = {
  _id: new Types.ObjectId().toString(),
  role: 'ULB',
  scope: Scope.ULB,
  ulb: ulbOid,
} as unknown as AuthUser;

const allYearDocs = [
  { _id: new Types.ObjectId(), year: '2018-19' },
  { _id: new Types.ObjectId(), year: '2019-20' },
  { _id: new Types.ObjectId(), year: '2020-21' },
  { _id: new Types.ObjectId(), year: '2021-22' },
  { _id: new Types.ObjectId(), year: '2022-23' },
  { _id: new Types.ObjectId(), year: '2023-24' },
];

describe('PropertyTaxService', () => {
  let service: PropertyTaxService;
  let mapperModel: Record<string, jest.Mock>;
  let yearModel: Record<string, jest.Mock>;

  beforeEach(async () => {
    mapperModel = { find: jest.fn().mockReturnValue(q([])) };
    yearModel = { find: jest.fn().mockReturnValue(q(allYearDocs)) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PropertyTaxService,
        { provide: getModelToken(PropertyTaxOpMapper.name), useValue: mapperModel },
        { provide: getModelToken(Year.name), useValue: yearModel },
      ],
    }).compile();

    service = module.get(PropertyTaxService);
  });

  it('rejects a ULB-scope user reading a different ULB’s data', async () => {
    const otherUlbUser = { ...ulbUser, ulb: new Types.ObjectId() } as AuthUser;
    await expect(service.getCollectionTrend(ulbOid.toString(), otherUlbUser)).rejects.toThrow(ForbiddenException);
  });

  it('returns all 6 chart years, in order, even when there is zero data', async () => {
    const result = await service.getCollectionTrend(ulbOid.toString(), ulbUser);
    expect(result.map((r) => r.financialYear)).toEqual([
      '2018-19',
      '2019-20',
      '2020-21',
      '2021-22',
      '2022-23',
      '2023-24',
    ]);
    expect(result.every((r) => r.valueInRupees === null)).toBe(true);
  });

  it('converts a lakh-denominated value to rupees by multiplying by 1,00,000 — FE does its own crore conversion, per year or summed', async () => {
    mapperModel.find.mockReturnValue(q([{ year: allYearDocs[5]._id, value: '127.56' }]));
    const result = await service.getCollectionTrend(ulbOid.toString(), ulbUser);
    const y2324 = result.find((r) => r.financialYear === '2023-24');
    expect(y2324?.valueInRupees).toBe(12756000); // 127.56 * 100000
  });

  it('leaves a year as null (not 0) when there is no propertytaxopmappers row for it — distinct from a genuine zero', async () => {
    mapperModel.find.mockReturnValue(q([{ year: allYearDocs[5]._id, value: '0' }]));
    const result = await service.getCollectionTrend(ulbOid.toString(), ulbUser);
    expect(result.find((r) => r.financialYear === '2023-24')?.valueInRupees).toBe(0);
    expect(result.find((r) => r.financialYear === '2022-23')?.valueInRupees).toBeNull();
  });

  it('returns null for a non-numeric stored value rather than throwing', async () => {
    mapperModel.find.mockReturnValue(q([{ year: allYearDocs[0]._id, value: 'N/A' }]));
    const result = await service.getCollectionTrend(ulbOid.toString(), ulbUser);
    expect(result.find((r) => r.financialYear === '2018-19')?.valueInRupees).toBeNull();
  });

  it('queries the mapper by displayPriority "1.20" (Total Property Tax Collection), not AFS line-item 11001', async () => {
    await service.getCollectionTrend(ulbOid.toString(), ulbUser);
    const filterArg = mapperModel.find.mock.calls[0][0] as { displayPriority: string };
    expect(filterArg.displayPriority).toBe('1.20');
  });
});
