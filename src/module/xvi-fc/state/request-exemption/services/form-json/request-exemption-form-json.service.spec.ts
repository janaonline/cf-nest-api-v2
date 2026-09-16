import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { FormJsonService } from 'src/master/form-json/form-json.service';
import {
  REQUEST_EXEMPTION_FORM_ID,
  REQUEST_EXEMPTION_FORM_TYPE,
} from 'src/schemas/xvi-fc/state/xvi-fc-eligibility-exemption.schema';
import { RequestExemptionFormJsonConfigService } from './request-exemption-form-json.service';

const VALID_RE_FIELDS = [
  { fieldTypes: ['RE_MAIN_FORM_FIELDS'], formFieldType: 'autocomplete', key: 'ulb', label: 'ULB' },
  {
    fieldTypes: ['RE_MAIN_FORM_FIELDS'],
    formFieldType: 'select',
    key: 'reasonForExemption',
    label: 'Reason for Exemption',
  },
];

describe('RequestExemptionFormJsonConfigService', () => {
  let service: RequestExemptionFormJsonConfigService;
  let formJsonService: Record<string, jest.Mock>;

  const yearId = '67d7d136d3d038946a5239e9';

  beforeEach(async () => {
    formJsonService = {
      findActiveByDesignYearAndFormId: jest.fn().mockResolvedValue({ data: VALID_RE_FIELDS }),
      findByType: jest.fn().mockResolvedValue({ data: VALID_RE_FIELDS }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [RequestExemptionFormJsonConfigService, { provide: FormJsonService, useValue: formJsonService }],
    }).compile();

    service = module.get(RequestExemptionFormJsonConfigService);
  });

  // ─── Redis-backed path (yearId present) ─────────────────────────────────────

  it('with yearId: calls findActiveByDesignYearAndFormId(yearId, REQUEST_EXEMPTION_FORM_ID)', async () => {
    const fields = await service.loadFields(yearId);
    expect(formJsonService['findActiveByDesignYearAndFormId']).toHaveBeenCalledWith(yearId, REQUEST_EXEMPTION_FORM_ID);
    expect(formJsonService['findByType']).not.toHaveBeenCalled();
    expect(fields).toEqual(VALID_RE_FIELDS);
  });

  it('propagates NotFoundException thrown by findActiveByDesignYearAndFormId', async () => {
    formJsonService['findActiveByDesignYearAndFormId'] = jest
      .fn()
      .mockRejectedValue(new NotFoundException('FormJson not found'));
    await expect(service.loadFields(yearId)).rejects.toThrow(NotFoundException);
  });

  // ─── Fallback path (no yearId) ────────────────────────────────────────────

  it('without yearId: falls back to findByType(REQUEST_EXEMPTION_FORM_TYPE)', async () => {
    const fields = await service.loadFields();
    expect(formJsonService['findByType']).toHaveBeenCalledWith(REQUEST_EXEMPTION_FORM_TYPE);
    expect(formJsonService['findActiveByDesignYearAndFormId']).not.toHaveBeenCalled();
    expect(fields).toEqual(VALID_RE_FIELDS);
  });

  it('propagates NotFoundException thrown by findByType', async () => {
    formJsonService['findByType'] = jest.fn().mockRejectedValue(new NotFoundException('FormJson type not found'));
    await expect(service.loadFields()).rejects.toThrow(NotFoundException);
  });

  // ─── validateRequestExemptionFormJsonData structural checks ─────────────────

  it('throws InternalServerErrorException when data is an empty array', async () => {
    formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({ data: [] });
    await expect(service.loadFields(yearId)).rejects.toThrow(InternalServerErrorException);
  });

  it('throws InternalServerErrorException when data is not an array', async () => {
    formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({ data: undefined });
    await expect(service.loadFields(yearId)).rejects.toThrow(InternalServerErrorException);
  });

  it('throws when a field is missing a key', async () => {
    const withoutKey = [{ fieldTypes: ['RE_MAIN_FORM_FIELDS'] }];
    formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({ data: withoutKey });
    await expect(service.loadFields(yearId)).rejects.toThrow('Request Exemption form field is missing a key.');
  });

  it('throws when a field is missing fieldTypes', async () => {
    const withoutFieldTypes = [{ key: 'ulb' }];
    formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({ data: withoutFieldTypes });
    await expect(service.loadFields(yearId)).rejects.toThrow("Request Exemption form field 'ulb' is missing fieldTypes.");
  });

  it('throws when a field has an empty fieldTypes array', async () => {
    const emptyFieldTypes = [{ key: 'ulb', fieldTypes: [] }];
    formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({ data: emptyFieldTypes });
    await expect(service.loadFields(yearId)).rejects.toThrow("Request Exemption form field 'ulb' is missing fieldTypes.");
  });

  it('throws when a field has an unknown fieldType', async () => {
    const unknownFieldType = [{ key: 'ulb', fieldTypes: ['SOME_UNKNOWN_TYPE'] }];
    formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({ data: unknownFieldType });
    await expect(service.loadFields(yearId)).rejects.toThrow(
      "Request Exemption form field 'ulb' has unknown fieldType 'SOME_UNKNOWN_TYPE'.",
    );
  });
});
