import { BadRequestException, ConflictException, HttpException } from '@nestjs/common';
import { Types } from 'mongoose';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { DynamicFormValidationService } from 'src/module/xvi-fc/common/dynamic-form-validation/dynamic-form-validation.service';
import type { FieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';
import type { ClaimLetterFormConfig, ClaimLetterFormJsonService } from '../form-json/claim-letter-form-json.service';
import type { FormQuestionHydratorService } from 'src/module/xvi-fc/common/services/form-question-hydrator.service';
import type { ClaimLetterActiveBatchService } from '../active-batch/claim-letter-active-batch.service';
import {
  ClaimLetterLetterDetailsService,
  LETTER_DETAILS_CHANGED,
  LETTER_DETAILS_INCOMPLETE,
  SIGNED_FILE_REMOVAL_NOT_CONFIRMED,
} from './claim-letter-letter-details.service';

function q<T>(value: T) {
  const chain: Record<string, jest.Mock> = {};
  for (const m of ['select', 'sort', 'lean']) chain[m] = jest.fn().mockReturnValue(chain);
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

const required = { name: 'required', validator: null, message: 'This field is required.' };
const QUESTIONS = {
  departmentEmail: {
    key: 'departmentEmail',
    formFieldType: 'text',
    label: 'Email',
    validations: [
      {
        name: 'pattern',
        validator: '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}$',
        message: 'Enter a valid email.',
      },
    ],
  },
  letterNo: {
    key: 'letterNo',
    formFieldType: 'text',
    label: 'Letter No.',
    validations: [{ name: 'maxlength', validator: 10, message: 'At most 10 characters.' }],
  },
  letterDate: { key: 'letterDate', formFieldType: 'date', label: 'Letter date' },
  gtcTransferredInTime: {
    key: 'gtcTransferredInTime',
    formFieldType: 'radio',
    label: 'Amount transferred within stipulated time',
    options: [
      { label: 'Yes', id: 'yes' },
      { label: 'No', id: 'no' },
    ],
    validations: [required],
  },
  sfcAtrDate: {
    key: 'sfcAtrDate',
    formFieldType: 'date',
    label: 'ATR date',
    validations: [required, { name: 'maxDate', validator: 'TODAY', message: 'Cannot be in the future.' }],
  },
} as Record<string, FieldConfig>;

function formConfig(overrides: Partial<ClaimLetterFormConfig> = {}): ClaimLetterFormConfig {
  const letterQuestions = Object.values(QUESTIONS);
  return {
    questions: letterQuestions,
    varianceLowerPercent: 90,
    varianceUpperPercent: 110,
    letterQuestions,
    letterSkipPrefill: new Set(['letterNo', 'letterDate']),
    letterConfigured: true,
    mergeDocuments: [],
    ...overrides,
  };
}

describe('ClaimLetterLetterDetailsService', () => {
  const stateOid = new Types.ObjectId();
  const claimLetterId = new Types.ObjectId().toString();
  const editor: AuthUser = {
    _id: new Types.ObjectId().toString(),
    role: 'STATE',
    scope: Scope.STATE,
    accessLevel: null,
    state: String(stateOid),
    xviFcSubrole: 'admin',
  } as AuthUser;

  let parent: Record<string, unknown>;
  let batchModel: { findOne: jest.Mock; findOneAndUpdate: jest.Mock; findById: jest.Mock };
  let formJson: { loadFormConfig: jest.Mock };
  let activeBatch: { resolveBlockingBatchNumber: jest.Mock; assertActive: jest.Mock };
  let service: ClaimLetterLetterDetailsService;

  beforeEach(() => {
    parent = {
      _id: new Types.ObjectId(claimLetterId),
      state: stateOid,
      year: new Types.ObjectId(),
      currentFormStatus: 2,
      isAbandoned: false,
      signedClaimFile: null,
      letterDetails: { letterNo: 'A/1', gtcTransferredInTime: 'yes' },
      letterDetailsUpdatedAt: new Date('2026-10-20T10:00:00.000Z'),
    };
    batchModel = {
      findOne: jest.fn((filter: Record<string, unknown>) =>
        q('_id' in filter && filter['_id'] === claimLetterId ? parent : null),
      ),
      findOneAndUpdate: jest.fn((_f, update: { $set: Record<string, unknown> }) => q({ ...parent, ...update.$set })),
      findById: jest.fn(() => q({ currentFormStatus: 2, isAbandoned: false })),
    };
    formJson = { loadFormConfig: jest.fn().mockResolvedValue(formConfig()) };
    activeBatch = {
      resolveBlockingBatchNumber: jest.fn().mockResolvedValue(null),
      assertActive: jest.fn().mockResolvedValue(undefined),
    };
    const hydrator = {
      hydrate: (questions: FieldConfig[], saved: Record<string, unknown>) =>
        questions.map((f) => ({ ...f, value: saved[f.key] })),
    };
    service = new ClaimLetterLetterDetailsService(
      formJson as unknown as ClaimLetterFormJsonService,
      new DynamicFormValidationService({} as never),
      hydrator as unknown as FormQuestionHydratorService,
      activeBatch as unknown as ClaimLetterActiveBatchService,
      batchModel as never,
    );
  });

  async function caught(promise: Promise<unknown>): Promise<HttpException> {
    try {
      await promise;
    } catch (err) {
      return err as HttpException;
    }
    throw new Error('expected a rejection');
  }

  describe('get', () => {
    it('returns hydrated fields in key order, completeness and editability', async () => {
      const { data } = await service.get(claimLetterId, editor);

      expect(data!.fields.map((f) => f.key)).toEqual([
        'departmentEmail',
        'letterNo',
        'letterDate',
        'gtcTransferredInTime',
        'sfcAtrDate',
      ]);
      expect(data!.fields[1]).toMatchObject({ key: 'letterNo', value: 'A/1' });
      expect(data!.isComplete).toBe(false);
      expect(data!.missingFields).toEqual(['ATR date']);
      expect(data!.canEdit).toBe(true);
      expect(data!.previous).toBeNull();
    });

    it('is read-only while another batch is the active one', async () => {
      activeBatch.resolveBlockingBatchNumber.mockResolvedValue(1);
      const { data } = await service.get(claimLetterId, editor);
      expect(data!.canEdit).toBe(false);
    });

    it('offers the latest other batch as prefill, minus skip-prefill and unconfigured keys', async () => {
      batchModel.findOne.mockImplementation((filter: Record<string, unknown>) =>
        q(
          '_id' in filter && filter['_id'] === claimLetterId
            ? parent
            : {
                year: new Types.ObjectId('606aaf854dff55e6c075d219'),
                installment: 1,
                batchNumber: 1,
                letterDetails: {
                  letterNo: 'OLD/9',
                  departmentEmail: 'a@b.in',
                  legacyKey: 'x',
                  sfcAtrDate: '2026-03-14T00:00:00.000Z',
                },
              },
        ),
      );

      const { data } = await service.get(claimLetterId, editor);

      expect(data!.previous!.values).toEqual({ departmentEmail: 'a@b.in', sfcAtrDate: '2026-03-14T00:00:00.000Z' });
      expect(data!.previous!.source).toMatchObject({ installment: 1, batchNumber: 1 });
      const [prevFilter] = batchModel.findOne.mock.calls[1] as [Record<string, unknown>];
      expect(prevFilter).toMatchObject({ state: stateOid, isAbandoned: false, letterDetailsUpdatedAt: { $ne: null } });
    });
  });

  describe('save', () => {
    it('trims, merges into saved values and pins the update on the last save time', async () => {
      const { data } = await service.save(
        claimLetterId,
        { data: { letterNo: '  B/2 ', sfcAtrDate: '2026-03-14T00:00:00.000Z' } },
        editor,
      );

      const [filter, update] = batchModel.findOneAndUpdate.mock.calls[0] as [
        Record<string, unknown>,
        { $set: Record<string, unknown> },
      ];
      expect(update.$set['letterDetails']).toEqual({
        letterNo: 'B/2',
        gtcTransferredInTime: 'yes',
        sfcAtrDate: '2026-03-14T00:00:00.000Z',
      });
      expect(filter).toMatchObject({
        currentFormStatus: 2,
        letterDetailsUpdatedAt: parent['letterDetailsUpdatedAt'],
        signedClaimFile: null,
      });
      expect(update.$set).not.toHaveProperty('signedClaimFile');
      expect(data!.isComplete).toBe(true);
    });

    it('removes a field that is sent blank', async () => {
      await service.save(claimLetterId, { data: { letterNo: '   ' } }, editor);
      const [, update] = batchModel.findOneAndUpdate.mock.calls[0] as [unknown, { $set: Record<string, unknown> }];
      expect(update.$set['letterDetails']).toEqual({ gtcTransferredInTime: 'yes' });
    });

    it('ignores keys that are not letter fields', async () => {
      await service.save(claimLetterId, { data: { letterNo: 'B/2', signedClaimFile: { path: 'x' } } }, editor);
      const [, update] = batchModel.findOneAndUpdate.mock.calls[0] as [unknown, { $set: Record<string, unknown> }];
      expect(update.$set['letterDetails']).not.toHaveProperty('signedClaimFile');
    });

    it('rejects wrong types, unknown options, invalid dates and formjson rule failures, keyed by field', async () => {
      const err = await caught(
        service.save(
          claimLetterId,
          {
            data: {
              letterNo: 'TOO-LONG-NUMBER',
              departmentEmail: 'not-an-email',
              gtcTransferredInTime: 'maybe',
              letterDate: '05/11/2026',
              sfcAtrDate: 123,
            },
          },
          editor,
        ),
      );

      expect(err).toBeInstanceOf(BadRequestException);
      const errors = (err.getResponse() as { errors: Record<string, { code: string }[]> }).errors;
      expect(Object.fromEntries(Object.entries(errors).map(([k, v]) => [k, v[0].code]))).toEqual({
        letterNo: 'maxlength',
        departmentEmail: 'pattern',
        gtcTransferredInTime: 'option',
        letterDate: 'date',
        sfcAtrDate: 'type',
      });
      expect(batchModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('accepts an email with capitals (pattern, not the UI email validator)', async () => {
      await service.save(claimLetterId, { data: { departmentEmail: 'UDHD@State.Gov.In' } }, editor);
      expect(batchModel.findOneAndUpdate).toHaveBeenCalled();
    });

    it('rejects an ATR date in the future', async () => {
      const err = await caught(
        service.save(claimLetterId, { data: { sfcAtrDate: '2099-01-01T00:00:00.000Z' } }, editor),
      );
      expect((err.getResponse() as { errors: Record<string, unknown> }).errors).toHaveProperty('sfcAtrDate');
    });

    it('does not write when nothing changed', async () => {
      const { message } = await service.save(claimLetterId, { data: { letterNo: 'A/1' } }, editor);
      expect(message).toMatch(/unchanged/);
      expect(batchModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('asks for confirmation before a change removes the uploaded signed letter', async () => {
      parent['signedClaimFile'] = { path: 'x/signed.pdf' };
      const err = await caught(service.save(claimLetterId, { data: { letterNo: 'B/2' } }, editor));

      expect(err).toBeInstanceOf(ConflictException);
      expect((err.getResponse() as { code: string }).code).toBe(SIGNED_FILE_REMOVAL_NOT_CONFIRMED);
      expect(batchModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('removes the signed letter in the same update once confirmed', async () => {
      parent['signedClaimFile'] = { path: 'x/signed.pdf' };
      const { data } = await service.save(
        claimLetterId,
        { data: { letterNo: 'B/2' }, confirmSignedFileRemoval: true },
        editor,
      );

      const [filter, update] = batchModel.findOneAndUpdate.mock.calls[0] as [
        Record<string, unknown>,
        { $set: Record<string, unknown> },
      ];
      expect(filter['signedClaimFile']).toEqual({ $ne: null });
      expect(update.$set['signedClaimFile']).toBeNull();
      expect(data!.signedFileRemoved).toBe(true);
    });

    it('never asks when the change does not touch a signed letter', async () => {
      parent['signedClaimFile'] = { path: 'x/signed.pdf' };
      const { message } = await service.save(claimLetterId, { data: { letterNo: 'A/1' } }, editor);
      expect(message).toMatch(/unchanged/);
    });

    it('reports a concurrent change with LETTER_DETAILS_CHANGED', async () => {
      batchModel.findOneAndUpdate.mockReturnValue(q(null));
      const err = await caught(service.save(claimLetterId, { data: { letterNo: 'B/2' } }, editor));
      expect((err.getResponse() as { code: string }).code).toBe(LETTER_DETAILS_CHANGED);
    });

    it('refuses edits while another batch is the active one', async () => {
      activeBatch.assertActive.mockRejectedValue(new ConflictException('Batch 1 is still in progress'));
      await expect(service.save(claimLetterId, { data: { letterNo: 'B/2' } }, editor)).rejects.toThrow(
        'Batch 1 is still in progress',
      );
      expect(batchModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('refuses edits once the batch is no longer editable', async () => {
      parent['currentFormStatus'] = 5;
      await expect(service.save(claimLetterId, { data: { letterNo: 'B/2' } }, editor)).rejects.toThrow(
        ConflictException,
      );
    });

    it('refuses saves when the letter details are not configured', async () => {
      formJson.loadFormConfig.mockResolvedValue(formConfig({ letterConfigured: false, letterQuestions: [] }));
      await expect(service.save(claimLetterId, { data: { letterNo: 'B/2' } }, editor)).rejects.toThrow(
        /not configured/,
      );
    });
  });

  describe('assertComplete', () => {
    it('names the missing mandatory fields with errors keyed by field', async () => {
      const err = await caught(service.assertComplete(parent as never, 'downloading'));

      expect(err).toBeInstanceOf(BadRequestException);
      const body = err.getResponse() as { message: string; code: string; errors: Record<string, unknown> };
      expect(body.message).toBe('Complete the letter details before downloading: ATR date.');
      expect(body.code).toBe(LETTER_DETAILS_INCOMPLETE);
      expect(Object.keys(body.errors)).toEqual(['sfcAtrDate']);
    });

    it('passes once the mandatory fields are saved', async () => {
      (parent['letterDetails'] as Record<string, unknown>)['sfcAtrDate'] = '2026-03-14T00:00:00.000Z';
      await expect(service.assertComplete(parent as never, 'submitting')).resolves.toBeUndefined();
    });

    it('treats a missing configuration as incomplete', async () => {
      formJson.loadFormConfig.mockResolvedValue(formConfig({ letterConfigured: false }));
      await expect(service.assertComplete(parent as never, 'submitting')).rejects.toThrow(/not configured/);
      expect(service.evaluate({}, formConfig({ letterConfigured: false })).isComplete).toBe(false);
    });
  });
});
