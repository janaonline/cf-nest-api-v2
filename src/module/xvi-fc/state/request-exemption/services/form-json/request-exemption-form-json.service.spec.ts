import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { FormJsonService } from 'src/master/form-json/form-json.service';
import {
  REASON_FIELD_KEY_STATE,
  REASON_FIELD_KEY_ULB,
  REQUEST_EXEMPTION_FORM_ID,
  REQUEST_EXEMPTION_FORM_TYPE,
} from 'src/schemas/xvi-fc/state/xvi-fc-eligibility-exemption.schema';
import { RequestExemptionFormJsonConfigService } from './request-exemption-form-json.service';

const REASON_OPTIONS_FIXTURE = [
  { id: '23', label: 'Election / duly constituted ULB exemption' },
  { id: '30', label: 'Audited Financial Statement' },
  { id: '31', label: 'Provisional Financial Statement' },
];

const VALID_RE_FIELDS = [
  { fieldTypes: ['RE_MAIN_FORM_FIELDS'], formFieldType: 'autocomplete', key: 'ulb', label: 'ULB' },
  {
    fieldTypes: ['RE_MAIN_FORM_FIELDS'],
    formFieldType: 'select',
    key: 'reasonForExemption',
    label: 'Reason for Exemption',
    options: REASON_OPTIONS_FIXTURE,
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
    await expect(service.loadFields(yearId)).rejects.toThrow(
      "Request Exemption form field 'ulb' is missing fieldTypes.",
    );
  });

  it('throws when a field has an empty fieldTypes array', async () => {
    const emptyFieldTypes = [{ key: 'ulb', fieldTypes: [] }];
    formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({ data: emptyFieldTypes });
    await expect(service.loadFields(yearId)).rejects.toThrow(
      "Request Exemption form field 'ulb' is missing fieldTypes.",
    );
  });

  it('throws when a field has an unknown fieldType', async () => {
    const unknownFieldType = [{ key: 'ulb', fieldTypes: ['SOME_UNKNOWN_TYPE'] }];
    formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({ data: unknownFieldType });
    await expect(service.loadFields(yearId)).rejects.toThrow(
      "Request Exemption form field 'ulb' has unknown fieldType 'SOME_UNKNOWN_TYPE'.",
    );
  });

  // ─── loadReasonOptions ────────────────────────────────────────────────────

  describe('loadReasonOptions', () => {
    it("extracts and number-converts the 'reasonForExemption' field's options", async () => {
      const options = await service.loadReasonOptions(yearId, REASON_FIELD_KEY_ULB);
      expect(options).toEqual([
        { id: 23, label: 'Election / duly constituted ULB exemption' },
        { id: 30, label: 'Audited Financial Statement' },
        { id: 31, label: 'Provisional Financial Statement' },
      ]);
    });

    it('reflects whatever this year’s formjson actually offers, not a fixed set', async () => {
      formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({
        data: [
          {
            fieldTypes: ['RE_MAIN_FORM_FIELDS'],
            formFieldType: 'select',
            key: 'reasonForExemption',
            label: 'Reason for Exemption',
            options: [{ id: '99', label: 'A brand new next-year reason' }],
          },
        ],
      });

      const options = await service.loadReasonOptions(yearId, REASON_FIELD_KEY_ULB);
      expect(options).toEqual([{ id: 99, label: 'A brand new next-year reason' }]);
    });

    it('throws InternalServerErrorException when the reasonForExemption field is missing (required defaults to true)', async () => {
      formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({
        data: [{ fieldTypes: ['RE_MAIN_FORM_FIELDS'], formFieldType: 'autocomplete', key: 'ulb', label: 'ULB' }],
      });
      await expect(service.loadReasonOptions(yearId, REASON_FIELD_KEY_ULB)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    it('throws InternalServerErrorException when its options are missing/malformed', async () => {
      formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({
        data: [
          {
            fieldTypes: ['RE_MAIN_FORM_FIELDS'],
            formFieldType: 'select',
            key: 'reasonForExemption',
            label: 'Reason for Exemption',
          },
        ],
      });
      await expect(service.loadReasonOptions(yearId, REASON_FIELD_KEY_ULB)).rejects.toThrow(
        InternalServerErrorException,
      );
    });

    describe('whole-state field key (reasonForExemptionState)', () => {
      it('extracts its options when present', async () => {
        formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({
          data: [
            ...VALID_RE_FIELDS,
            {
              fieldTypes: ['RE_MAIN_FORM_FIELDS'],
              formFieldType: 'select',
              key: 'reasonForExemptionState',
              label: 'Reason for Exemption',
              options: [{ id: '22', label: 'State Finance Commission extension/compliance' }],
            },
          ],
        });

        const options = await service.loadReasonOptions(yearId, REASON_FIELD_KEY_STATE, false);
        expect(options).toEqual([{ id: 22, label: 'State Finance Commission extension/compliance' }]);
      });

      it('returns [] (not a throw) when missing and required=false — lets the backend deploy before the formjsons document gains this field', async () => {
        const options = await service.loadReasonOptions(yearId, REASON_FIELD_KEY_STATE, false);
        expect(options).toEqual([]);
      });

      it('still throws when missing and required is left at its true default', async () => {
        await expect(service.loadReasonOptions(yearId, REASON_FIELD_KEY_STATE)).rejects.toThrow(
          InternalServerErrorException,
        );
      });
    });
  });
});
