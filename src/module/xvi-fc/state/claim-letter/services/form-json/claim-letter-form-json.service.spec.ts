import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { FormJsonService } from 'src/master/form-json/form-json.service';
import { ClaimLetterFormJsonService } from './claim-letter-form-json.service';
import { CLAIM_LETTER_FORM_ID } from '../../constants/claim-letter.constants';
import {
  CLAIM_LETTER_VARIANCE_LOWER_PERCENT,
  CLAIM_LETTER_VARIANCE_UPPER_PERCENT,
} from '../../helpers/claim-letter-financial.helpers';

const CLAIM_LETTER_FORM_JSON = {
  design_year: '67d7d136d3d038946a5239e9',
  formId: CLAIM_LETTER_FORM_ID,
  type: 'CLAIM_LETTER',
  isActive: true,
  data: [{ key: 'signedClaimFile', formFieldType: 'file' }],
};

describe('ClaimLetterFormJsonService', () => {
  let service: ClaimLetterFormJsonService;
  let formJsonService: Record<string, jest.Mock>;

  const yearId = '67d7d136d3d038946a5239e9';

  beforeEach(async () => {
    formJsonService = {
      findActiveByDesignYearAndFormId: jest.fn().mockResolvedValue(CLAIM_LETTER_FORM_JSON),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ClaimLetterFormJsonService, { provide: FormJsonService, useValue: formJsonService }],
    }).compile();

    service = module.get(ClaimLetterFormJsonService);
  });

  describe('loadFormConfig', () => {
    it('fetches the form-json document exactly once and returns questions plus the default variance band', async () => {
      const config = await service.loadFormConfig(yearId);
      expect(formJsonService['findActiveByDesignYearAndFormId']).toHaveBeenCalledWith(yearId, CLAIM_LETTER_FORM_ID);
      expect(formJsonService['findActiveByDesignYearAndFormId']).toHaveBeenCalledTimes(1);
      expect(config.questions).toEqual(CLAIM_LETTER_FORM_JSON.data);
      expect(config.varianceLowerPercent).toBe(CLAIM_LETTER_VARIANCE_LOWER_PERCENT);
      expect(config.varianceUpperPercent).toBe(CLAIM_LETTER_VARIANCE_UPPER_PERCENT);
    });

    it('returns the configured meta.varianceLowerPercent/varianceUpperPercent override', async () => {
      formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({
        ...CLAIM_LETTER_FORM_JSON,
        meta: { varianceLowerPercent: 80, varianceUpperPercent: 120 },
      });
      const config = await service.loadFormConfig(yearId);
      expect(config.varianceLowerPercent).toBe(80);
      expect(config.varianceUpperPercent).toBe(120);
    });

    it.each([
      ['a negative number', -1],
      ['a non-numeric string', '90'],
      ['null', null],
    ])('falls back to the default when meta.varianceLowerPercent is %s', async (_label, value) => {
      formJsonService['findActiveByDesignYearAndFormId'] = jest
        .fn()
        .mockResolvedValue({ ...CLAIM_LETTER_FORM_JSON, meta: { varianceLowerPercent: value } });
      const config = await service.loadFormConfig(yearId);
      expect(config.varianceLowerPercent).toBe(CLAIM_LETTER_VARIANCE_LOWER_PERCENT);
    });

    it('degrades gracefully to empty questions and default variance when no active document exists (never throws)', async () => {
      formJsonService['findActiveByDesignYearAndFormId'] = jest
        .fn()
        .mockRejectedValue(new NotFoundException(`FormJson for year ${yearId} and formId 26 not found`));
      const config = await service.loadFormConfig(yearId);
      expect(config).toEqual({
        questions: [],
        varianceLowerPercent: CLAIM_LETTER_VARIANCE_LOWER_PERCENT,
        varianceUpperPercent: CLAIM_LETTER_VARIANCE_UPPER_PERCENT,
      });
    });

    it('propagates non-NotFoundException errors', async () => {
      formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockRejectedValue(new Error('db down'));
      await expect(service.loadFormConfig(yearId)).rejects.toThrow('db down');
    });
  });

  describe('loadVarianceConfig', () => {
    it('fetches the form-json document exactly once and returns only the variance band', async () => {
      formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({
        ...CLAIM_LETTER_FORM_JSON,
        meta: { varianceLowerPercent: 85, varianceUpperPercent: 115 },
      });
      const variance = await service.loadVarianceConfig(yearId);
      expect(formJsonService['findActiveByDesignYearAndFormId']).toHaveBeenCalledTimes(1);
      expect(variance).toEqual({ lowerPercent: 85, upperPercent: 115 });
    });

    it('degrades gracefully to default variance when no active document exists', async () => {
      formJsonService['findActiveByDesignYearAndFormId'] = jest
        .fn()
        .mockRejectedValue(new NotFoundException('not found'));
      const variance = await service.loadVarianceConfig(yearId);
      expect(variance).toEqual({
        lowerPercent: CLAIM_LETTER_VARIANCE_LOWER_PERCENT,
        upperPercent: CLAIM_LETTER_VARIANCE_UPPER_PERCENT,
      });
    });
  });
});
