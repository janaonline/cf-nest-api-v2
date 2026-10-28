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
        letterQuestions: [],
        letterSkipPrefill: new Set(),
        letterConfigured: false,
        mergeDocuments: [],
      });
    });

    it('propagates non-NotFoundException errors', async () => {
      formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockRejectedValue(new Error('db down'));
      await expect(service.loadFormConfig(yearId)).rejects.toThrow('db down');
    });
  });

  describe('letter-detail keys (meta.letterDetailKeys)', () => {
    const letterNo = { key: 'letterNo', formFieldType: 'text', label: 'Letter No.' };
    const letterDate = { key: 'letterDate', formFieldType: 'date', label: 'Letter date' };
    const atrDate = { key: 'sfcAtrDate', formFieldType: 'date', label: 'ATR date' };

    function withMeta(meta: Record<string, unknown>) {
      formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({
        ...CLAIM_LETTER_FORM_JSON,
        data: [...CLAIM_LETTER_FORM_JSON.data, letterNo, letterDate, atrDate],
        meta,
      });
    }

    it('resolves the letter questions in key order and reads the skip-prefill keys', async () => {
      withMeta({
        letterDetailKeys: ['sfcAtrDate', 'letterNo', 'letterDate'],
        letterDetailSkipPrefill: ['letterNo', 'letterDate'],
      });

      const config = await service.loadFormConfig(yearId);

      expect(config.letterConfigured).toBe(true);
      expect(config.letterQuestions.map((q) => q.key)).toEqual(['sfcAtrDate', 'letterNo', 'letterDate']);
      expect(config.letterSkipPrefill).toEqual(new Set(['letterNo', 'letterDate']));
    });

    it('skips unknown, duplicate, reserved and non-string keys', async () => {
      withMeta({ letterDetailKeys: ['letterNo', 'unknownKey', 'signedClaimFile', 'letterNo', 7, 'sfcAtrDate'] });

      const config = await service.loadFormConfig(yearId);

      expect(config.letterQuestions.map((q) => q.key)).toEqual(['letterNo', 'sfcAtrDate']);
    });

    it.each([
      ['no meta at all', undefined],
      ['letterDetailKeys not an array', { letterDetailKeys: 'oops' }],
      ['only invalid keys', { letterDetailKeys: ['nope'] }],
      ['only the old letterDetailSteps', { letterDetailSteps: [{ title: 'X', keys: ['letterNo'] }] }],
    ])('is not configured with %s', async (_label, meta) => {
      formJsonService['findActiveByDesignYearAndFormId'] = jest
        .fn()
        .mockResolvedValue({ ...CLAIM_LETTER_FORM_JSON, meta });
      const config = await service.loadFormConfig(yearId);
      expect(config.letterConfigured).toBe(false);
      expect(config.letterQuestions).toEqual([]);
    });
  });

  describe('merge documents (meta.mergeDocuments)', () => {
    it('keeps valid entries in order and skips incomplete ones', async () => {
      formJsonService['findActiveByDesignYearAndFormId'] = jest.fn().mockResolvedValue({
        ...CLAIM_LETTER_FORM_JSON,
        meta: {
          mergeDocuments: [
            { label: 'Copy of Elected Body', formId: 23, fileKeys: ['signedElectedbodyFile'] },
            { label: '', formId: 35, fileKeys: ['i2GtcFile'] }, // no label
            { label: 'Copy of GTC', formId: '35', fileKeys: ['i2GtcFile'] }, // formId not a number
            { label: 'ATR', formId: 22, fileKeys: [] }, // no file keys
            { label: 'Other Supporting Documents (ATR)', formId: 22, fileKeys: ['atrReport'], optional: true },
          ],
        },
      });

      const config = await service.loadFormConfig(yearId);

      expect(config.mergeDocuments).toEqual([
        { label: 'Copy of Elected Body', formId: 23, fileKeys: ['signedElectedbodyFile'], optional: false },
        { label: 'Other Supporting Documents (ATR)', formId: 22, fileKeys: ['atrReport'], optional: true },
      ]);
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
