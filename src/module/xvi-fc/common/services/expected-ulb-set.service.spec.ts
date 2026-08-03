import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ExpectedUlbSetService } from './expected-ulb-set.service';
import { Ulb } from 'src/schemas/ulb.schema';
import { Year } from 'src/schemas/year.schema';

/** Chainable Mongoose Query-like mock resolving to `value` once `.exec()` is called. */
function q<T>(value: T) {
  const chain: Record<string, jest.Mock> = {};
  for (const m of ['select', 'lean']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

describe('ExpectedUlbSetService', () => {
  let service: ExpectedUlbSetService;
  let ulbModel: { find: jest.Mock };
  let yearModel: { findById: jest.Mock };

  const stateId = new Types.ObjectId().toString();
  const designYearId = new Types.ObjectId().toString();

  beforeEach(async () => {
    ulbModel = { find: jest.fn() };
    yearModel = { findById: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpectedUlbSetService,
        { provide: getModelToken(Ulb.name), useValue: ulbModel },
        { provide: getModelToken(Year.name), useValue: yearModel },
      ],
    }).compile();

    service = module.get<ExpectedUlbSetService>(ExpectedUlbSetService);
  });

  it('throws NotFoundException when the design year does not exist', async () => {
    yearModel.findById.mockReturnValue(q(null));

    await expect(service.resolve(stateId, designYearId)).rejects.toThrow(NotFoundException);
    expect(ulbModel.find).not.toHaveBeenCalled();
  });

  it('queries active ULBs for the State, grandfathering a null dateOfConstitution', async () => {
    yearModel.findById.mockReturnValue(q({ _id: designYearId, year: '2026-27' }));
    ulbModel.find.mockReturnValue(q([]));

    await service.resolve(stateId, designYearId);

    const [filter] = ulbModel.find.mock.calls[0] as [Record<string, unknown>];
    expect((filter['state'] as Types.ObjectId).toString()).toBe(stateId);
    expect(filter['isActive']).toBe(true);
    expect(filter['$or']).toEqual([
      { dateOfConstitution: null },
      { dateOfConstitution: { $lte: new Date('2027-03-31T23:59:59.999Z') } },
    ]);
  });

  it('maps ULB documents to the ExpectedUlb shape, defaulting missing codes to null', async () => {
    yearModel.findById.mockReturnValue(q({ _id: designYearId, year: '2026-27' }));
    const ulbId = new Types.ObjectId();
    ulbModel.find.mockReturnValue(q([{ _id: ulbId, name: 'Test ULB', censusCode: '123456' }]));

    const result = await service.resolve(stateId, designYearId);

    expect(result).toEqual([{ ulbId: String(ulbId), name: 'Test ULB', censusCode: '123456', sbCode: null }]);
  });
});
