import { XviFcUlbOptionsService } from './xvi-fc-ulb-options.service';
import type { ExpectedUlbSetService, ExpectedUlb } from './expected-ulb-set.service';

const ULB_A: ExpectedUlb = { ulbId: 'ulb-a', name: 'Agra Nagar Nigam', censusCode: '900001', sbCode: null };
const ULB_B: ExpectedUlb = { ulbId: 'ulb-b', name: 'Bareilly Nagar Nigam', censusCode: '900002', sbCode: 'SB-42' };

describe('XviFcUlbOptionsService', () => {
  let service: XviFcUlbOptionsService;
  let expectedUlbSetService: { resolve: jest.Mock };

  beforeEach(() => {
    expectedUlbSetService = { resolve: jest.fn().mockResolvedValue([ULB_A, ULB_B]) };
    service = new XviFcUlbOptionsService(expectedUlbSetService as unknown as ExpectedUlbSetService);
  });

  it('returns the expected-ULB set as-is when no search/limit is given beyond the default', async () => {
    const options = await service.getOptions('state-1', 'year-1');

    expect(expectedUlbSetService.resolve).toHaveBeenCalledWith('state-1', 'year-1');
    expect(options).toEqual([ULB_A, ULB_B]);
  });

  it('excludes XVIFC-ineligible ULB types (e.g. Cantonment Boards) because they never appear in the expected set', async () => {
    // ExpectedUlbSetService.resolve already excludes ineligible ULB types via UlbEligibilityService -
    // this service adds no eligibility logic of its own, so a Cantonment Board never reaches here.
    expectedUlbSetService.resolve.mockResolvedValue([ULB_A]);

    const options = await service.getOptions('state-1', 'year-1');

    expect(options).toEqual([ULB_A]);
  });

  it('filters by a case-insensitive match against name, censusCode, or sbCode', async () => {
    const options = await service.getOptions('state-1', 'year-1', 'bareilly');

    expect(options).toEqual([ULB_B]);
  });

  it('matches by sbCode too', async () => {
    const options = await service.getOptions('state-1', 'year-1', 'sb-42');

    expect(options).toEqual([ULB_B]);
  });

  it('caps results to the given limit', async () => {
    const options = await service.getOptions('state-1', 'year-1', undefined, 1);

    expect(options).toEqual([ULB_A]);
  });

  it('sorts results by name regardless of input order', async () => {
    expectedUlbSetService.resolve.mockResolvedValue([ULB_B, ULB_A]);

    const options = await service.getOptions('state-1', 'year-1');

    expect(options).toEqual([ULB_A, ULB_B]);
  });

  it('defaults the limit to 10 when none is given', async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({ ...ULB_A, ulbId: `ulb-${i}` }));
    expectedUlbSetService.resolve.mockResolvedValue(many);

    const options = await service.getOptions('state-1', 'year-1');

    expect(options).toHaveLength(10);
  });
});
