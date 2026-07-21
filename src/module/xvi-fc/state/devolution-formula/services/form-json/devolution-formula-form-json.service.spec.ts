import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { FormJsonService } from 'src/form-json/form-json.service';
import { DfFormJsonConfigService } from './devolution-formula-form-json.service';
import { DF_FORM_ID, DF_FORM_TYPE } from '../../constants/devolution-formula.constants';

const VALID_DF_FIELDS = [
  {
    fieldTypes: ['DF_MAIN_FORM_FIELDS'],
    formFieldType: 'file',
    key: 'excelFile',
    label: 'Upload Devolution Formula Excel',
    validations: [],
  },
  {
    fieldTypes: ['DF_ROW_EDIT_FIELDS'],
    formFieldType: 'number',
    key: 'totalGrantAllocation',
    label: 'Total Grant Allocation',
    validations: [],
  },
];

describe('DfFormJsonConfigService', () => {
  let service: DfFormJsonConfigService;
  let formJsonService: Record<string, jest.Mock>;

  const yearId = '67d7d136d3d038946a5239e9';

  beforeEach(async () => {
    formJsonService = {
      findActiveByDesignYearAndFormId: jest.fn().mockResolvedValue({ data: VALID_DF_FIELDS }),
      findByType: jest.fn().mockResolvedValue({ data: VALID_DF_FIELDS }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [DfFormJsonConfigService, { provide: FormJsonService, useValue: formJsonService }],
    }).compile();

    service = module.get(DfFormJsonConfigService);
  });

  // ─── Redis-backed path (yearId present) ─────────────────────────────────────

  it('with yearId: calls findActiveByDesignYearAndFormId(yearId, DF_FORM_ID)', async () => {
    const fields = await service.loadFields(yearId);
    expect(formJsonService['findActiveByDesignYearAndFormId']).toHaveBeenCalledWith(yearId, DF_FORM_ID);
    expect(formJsonService['findByType']).not.toHaveBeenCalled();
    expect(fields).toEqual(VALID_DF_FIELDS);
  });

  it('propagates NotFoundException thrown by findActiveByDesignYearAndFormId', async () => {
    formJsonService['findActiveByDesignYearAndFormId'] = jest
      .fn()
      .mockRejectedValue(new NotFoundException('FormJson not found'));
    await expect(service.loadFields(yearId)).rejects.toThrow(NotFoundException);
  });

  // ─── Fallback path (no yearId) ───────────────────────────────────────────────

  it('without yearId: falls back to findByType(DF_FORM_TYPE)', async () => {
    const fields = await service.loadFields();
    expect(formJsonService['findByType']).toHaveBeenCalledWith(DF_FORM_TYPE);
    expect(formJsonService['findActiveByDesignYearAndFormId']).not.toHaveBeenCalled();
    expect(fields).toEqual(VALID_DF_FIELDS);
  });

  it('propagates NotFoundException thrown by findByType', async () => {
    formJsonService['findByType'] = jest.fn().mockRejectedValue(new NotFoundException('FormJson type not found'));
    await expect(service.loadFields()).rejects.toThrow(NotFoundException);
  });

  // ─── validateDfFormJsonData structural checks ────────────────────────────────

  it('throws InternalServerErrorException when data is an empty array', async () => {
    formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({ data: [] });
    await expect(service.loadFields(yearId)).rejects.toThrow(InternalServerErrorException);
  });

  it('throws InternalServerErrorException when data is not an array', async () => {
    formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({ data: null });
    await expect(service.loadFields(yearId)).rejects.toThrow(InternalServerErrorException);
  });

  it('throws when a field is missing a key', async () => {
    const withoutKey = [{ fieldTypes: ['DF_MAIN_FORM_FIELDS'] }];
    formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({ data: withoutKey });
    await expect(service.loadFields(yearId)).rejects.toThrow("DF form field is missing a key.");
  });

  it('throws when a field is missing fieldTypes', async () => {
    const withoutFieldTypes = [{ key: 'excelFile' }];
    formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({ data: withoutFieldTypes });
    await expect(service.loadFields(yearId)).rejects.toThrow("DF form field 'excelFile' is missing fieldTypes.");
  });

  it('throws when a field has an empty fieldTypes array', async () => {
    const emptyFieldTypes = [{ key: 'excelFile', fieldTypes: [] }];
    formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({ data: emptyFieldTypes });
    await expect(service.loadFields(yearId)).rejects.toThrow("DF form field 'excelFile' is missing fieldTypes.");
  });

  it('throws when a field has an unknown fieldType', async () => {
    const unknownFieldType = [{ key: 'excelFile', fieldTypes: ['SOME_UNKNOWN_TYPE'] }];
    formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({ data: unknownFieldType });
    await expect(service.loadFields(yearId)).rejects.toThrow(
      "DF form field 'excelFile' has unknown fieldType 'SOME_UNKNOWN_TYPE'.",
    );
  });

  it('accepts fields whose fieldTypes mix DF_MAIN_FORM_FIELDS and DF_ROW_EDIT_FIELDS', async () => {
    const mixed = [{ key: 'excelFile', fieldTypes: ['DF_MAIN_FORM_FIELDS', 'DF_ROW_EDIT_FIELDS'] }];
    formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({ data: mixed });
    await expect(service.loadFields(yearId)).resolves.toEqual(mixed);
  });
});
