import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { FormJsonService } from 'src/master/form-json/form-json.service';
import { EulbFormJsonConfigService } from './elected-urban-local-bodies-form-json.service';
import { EULB_FORM_ID, EULB_FORM_JSON_TYPE } from '../../constants/elected-urban-local-bodies.constants';

const VALID_EULB_FIELDS = [
  {
    fieldTypes: ['EULB_MAIN_FORM_FIELDS'],
    formFieldType: 'file',
    key: 'excelFile',
    label: 'Upload Elected Urban Local Bodies Excel',
    validations: [],
  },
  {
    fieldTypes: ['EULB_ROW_EDIT_FIELDS'],
    formFieldType: 'text',
    key: 'electedBodyStatus',
    label: 'Elected Body Status',
    validations: [],
  },
];

describe('EulbFormJsonConfigService', () => {
  let service: EulbFormJsonConfigService;
  let formJsonService: Record<string, jest.Mock>;

  const yearId = '67d7d136d3d038946a5239e9';

  beforeEach(async () => {
    formJsonService = {
      findActiveByDesignYearAndFormId: jest.fn().mockResolvedValue({ data: VALID_EULB_FIELDS }),
      findByType: jest.fn().mockResolvedValue({ data: VALID_EULB_FIELDS }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [EulbFormJsonConfigService, { provide: FormJsonService, useValue: formJsonService }],
    }).compile();

    service = module.get(EulbFormJsonConfigService);
  });

  // ─── Redis-backed path (yearId present) ─────────────────────────────────────

  it('with yearId: calls findActiveByDesignYearAndFormId(yearId, EULB_FORM_ID)', async () => {
    const fields = await service.loadFields(yearId);
    expect(formJsonService['findActiveByDesignYearAndFormId']).toHaveBeenCalledWith(yearId, EULB_FORM_ID);
    expect(formJsonService['findByType']).not.toHaveBeenCalled();
    expect(fields).toEqual(VALID_EULB_FIELDS);
  });

  it('propagates NotFoundException thrown by findActiveByDesignYearAndFormId', async () => {
    formJsonService['findActiveByDesignYearAndFormId'] = jest
      .fn()
      .mockRejectedValue(new NotFoundException('FormJson not found'));
    await expect(service.loadFields(yearId)).rejects.toThrow(NotFoundException);
  });

  // ─── Fallback path (no yearId, e.g. getQuestions) ────────────────────────────

  it('without yearId: falls back to findByType(EULB_FORM_JSON_TYPE)', async () => {
    const fields = await service.loadFields();
    expect(formJsonService['findByType']).toHaveBeenCalledWith(EULB_FORM_JSON_TYPE);
    expect(formJsonService['findActiveByDesignYearAndFormId']).not.toHaveBeenCalled();
    expect(fields).toEqual(VALID_EULB_FIELDS);
  });

  it('propagates NotFoundException thrown by findByType', async () => {
    formJsonService['findByType'] = jest.fn().mockRejectedValue(new NotFoundException('FormJson type not found'));
    await expect(service.loadFields()).rejects.toThrow(NotFoundException);
  });

  // ─── validateEulbFormJsonData structural checks ──────────────────────────────

  it('throws InternalServerErrorException when data is an empty array', async () => {
    formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({ data: [] });
    await expect(service.loadFields(yearId)).rejects.toThrow(InternalServerErrorException);
  });

  it('throws InternalServerErrorException when data is not an array', async () => {
    formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({ data: undefined });
    await expect(service.loadFields(yearId)).rejects.toThrow(InternalServerErrorException);
  });

  it('throws when a field is missing a key', async () => {
    const withoutKey = [{ fieldTypes: ['EULB_MAIN_FORM_FIELDS'] }];
    formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({ data: withoutKey });
    await expect(service.loadFields(yearId)).rejects.toThrow('EULB form field is missing a key.');
  });

  it('throws when a field is missing fieldTypes', async () => {
    const withoutFieldTypes = [{ key: 'excelFile' }];
    formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({ data: withoutFieldTypes });
    await expect(service.loadFields(yearId)).rejects.toThrow("EULB form field 'excelFile' is missing fieldTypes.");
  });

  it('throws when a field has an empty fieldTypes array', async () => {
    const emptyFieldTypes = [{ key: 'excelFile', fieldTypes: [] }];
    formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({ data: emptyFieldTypes });
    await expect(service.loadFields(yearId)).rejects.toThrow("EULB form field 'excelFile' is missing fieldTypes.");
  });

  it('throws when a field has an unknown fieldType', async () => {
    const unknownFieldType = [{ key: 'excelFile', fieldTypes: ['SOME_UNKNOWN_TYPE'] }];
    formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({ data: unknownFieldType });
    await expect(service.loadFields(yearId)).rejects.toThrow(
      "EULB form field 'excelFile' has unknown fieldType 'SOME_UNKNOWN_TYPE'.",
    );
  });

  it('accepts fields whose fieldTypes include EULB_EXTRA_ULB_PORTAL_FIELDS and EULB_POST_SUBMIT_UPDATE_FIELDS', async () => {
    const mixed = [
      { key: 'remarks', fieldTypes: ['EULB_EXTRA_ULB_PORTAL_FIELDS'] },
      { key: 'postSubmitRemarks', fieldTypes: ['EULB_POST_SUBMIT_UPDATE_FIELDS'] },
    ];
    formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({ data: mixed });
    await expect(service.loadFields(yearId)).resolves.toEqual(mixed);
  });
});
