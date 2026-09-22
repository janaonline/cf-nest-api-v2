import { DurService } from './dur.service';

describe('DurService.getFormConfig', () => {
  let service: DurService;
  let mockFormJsonService: { findActiveByDesignYearAndFormId: jest.Mock };

  beforeEach(() => {
    mockFormJsonService = { findActiveByDesignYearAndFormId: jest.fn() };

    service = new DurService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      mockFormJsonService as any,
    );
  });

  it('fetches formId 36 for the given year and returns its meta/data', async () => {
    mockFormJsonService.findActiveByDesignYearAndFormId.mockResolvedValue({
      meta: { note: 'DUR' },
      data: [{ key: 'tiedGrant', label: 'Tied Grant' }],
    });

    const result = await service.getFormConfig('year-1');

    expect(mockFormJsonService.findActiveByDesignYearAndFormId).toHaveBeenCalledWith('year-1', 36);
    expect(result).toEqual({ meta: { note: 'DUR' }, data: [{ key: 'tiedGrant', label: 'Tied Grant' }] });
  });

  it('defaults meta/data to empty when the formjson document omits them', async () => {
    mockFormJsonService.findActiveByDesignYearAndFormId.mockResolvedValue({});

    const result = await service.getFormConfig('year-1');

    expect(result).toEqual({ meta: {}, data: [] });
  });
});
