import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { FormJsonService } from 'src/master/form-json/form-json.service';
import { SlbFormJsonConfigService } from './slb-form-json.service';
import { DEFAULT_SLB_FIELDS } from '../constants/slb-form.constants';
import { ConfigService } from '@nestjs/config';

describe('SlbFormJsonConfigService', () => {
  let service: SlbFormJsonConfigService;
  let formJsonService: Partial<Record<keyof FormJsonService, jest.Mock>>;

  async function createService(nodeEnv: string): Promise<SlbFormJsonConfigService> {
    formJsonService = {
      findActiveByDesignYearAndFormId: jest.fn(),
      findByType: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SlbFormJsonConfigService,
        { provide: FormJsonService, useValue: formJsonService },
        { provide: ConfigService, useValue: { get: () => nodeEnv } },
      ],
    }).compile();

    return module.get<SlbFormJsonConfigService>(SlbFormJsonConfigService);
  }

  beforeEach(async () => {
    service = await createService('production');
  });

  it('falls back to DEFAULT_SLB_FIELDS when no FormJson has been seeded for the design year', async () => {
    formJsonService.findActiveByDesignYearAndFormId!.mockRejectedValue(new NotFoundException('FormJson not found'));

    const fields = await service.loadFields('year-id');

    expect(fields).toBe(DEFAULT_SLB_FIELDS);
  });

  it('falls back to DEFAULT_SLB_FIELDS when the FormJson document exists but has no data', async () => {
    formJsonService.findActiveByDesignYearAndFormId!.mockResolvedValue({ data: [] });

    const fields = await service.loadFields('year-id');

    expect(fields).toBe(DEFAULT_SLB_FIELDS);
  });

  it('uses the admin-configured FormJson once it has been seeded', async () => {
    const configured = [
      { key: 'ind1', formFieldType: 'actualTarget', label: 'x', fieldTypes: ['SLB_MAIN_FORM_FIELDS'] },
    ];
    formJsonService.findActiveByDesignYearAndFormId!.mockResolvedValue({ data: configured });

    const fields = await service.loadFields('year-id');

    expect(fields).toEqual(configured);
  });

  it('falls back to DEFAULT_SLB_FIELDS via findByType when called without a yearId and unseeded', async () => {
    formJsonService.findByType!.mockRejectedValue(new NotFoundException('FormJson not found'));

    const fields = await service.loadFields();

    expect(fields).toBe(DEFAULT_SLB_FIELDS);
    expect(formJsonService.findByType).toHaveBeenCalledWith('SLB');
  });

  it('in dev (NODE_ENV !== production), returns DEFAULT_SLB_FIELDS directly and never queries the DB', async () => {
    service = await createService('development');
    const configured = [
      { key: 'ind1', formFieldType: 'actualTarget', label: 'x', fieldTypes: ['SLB_MAIN_FORM_FIELDS'] },
    ];
    formJsonService.findActiveByDesignYearAndFormId!.mockResolvedValue({ data: configured });

    const fields = await service.loadFields('year-id');

    expect(fields).toBe(DEFAULT_SLB_FIELDS);
    expect(formJsonService.findActiveByDesignYearAndFormId).not.toHaveBeenCalled();
  });
});
