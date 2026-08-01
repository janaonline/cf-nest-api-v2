import { Test, TestingModule } from '@nestjs/testing';
import { InternalServerErrorException } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ClaimEligibilityEvaluatorService } from './claim-eligibility-evaluator.service';
import type { IFormJson } from 'src/form-json/interfaces/form-json.interface';
import type { ClaimEligibilityConfig } from 'src/module/xvi-fc/common/types/claim-eligibility.type';

describe('ClaimEligibilityEvaluatorService', () => {
  let service: ClaimEligibilityEvaluatorService;
  let findOne: jest.Mock;
  let collection: jest.Mock;
  let connection: { collection: jest.Mock };

  const stateId = new Types.ObjectId();
  const designYearId = new Types.ObjectId().toString();

  const devolutionConfig: ClaimEligibilityConfig = {
    enabled: true,
    ruleVersion: 1,
    ownerLevel: 'STATE',
    evaluationLevel: 'FORM',
    yearScope: 'CURRENT_DESIGN_YEAR',
    applicableInstallments: [1],
    acceptedFormStatuses: [5, 7],
    source: {
      collection: 'xvifc_devolution_forms',
      fields: { designYear: 'year', state: 'state', currentFormStatus: 'currentFormStatus' },
    },
    evaluator: { type: 'FORM_STATUS', config: { installmentField: 'installment' } },
    exemption: { allowed: false },
    approval: { action: 'NO_ACTION' },
    rejection: { action: 'NO_ACTION' },
  };

  function sourceFormJson(overrides: Partial<IFormJson> = {}): IFormJson {
    return {
      _id: new Types.ObjectId(),
      design_year: new Types.ObjectId(designYearId),
      formId: 24,
      type: 'DEVOLUTION_FORMULA',
      isActive: true,
      createdAt: new Date(),
      modifiedAt: new Date(),
      claimEligibility: devolutionConfig,
      ...overrides,
    };
  }

  beforeEach(async () => {
    findOne = jest.fn();
    collection = jest.fn().mockReturnValue({ findOne });
    connection = { collection };

    const module: TestingModule = await Test.createTestingModule({
      providers: [ClaimEligibilityEvaluatorService, { provide: getConnectionToken(), useValue: connection }],
    }).compile();

    service = module.get<ClaimEligibilityEvaluatorService>(ClaimEligibilityEvaluatorService);
  });

  it('throws when the formJson has no enabled claimEligibility config', async () => {
    const doc = sourceFormJson({ claimEligibility: null });
    await expect(service.evaluate(doc, { stateId, designYearId, installment: 1 })).rejects.toThrow(
      InternalServerErrorException,
    );
  });

  it('throws for an unsupported evaluator.type rather than silently passing', async () => {
    const doc = sourceFormJson({
      claimEligibility: { ...devolutionConfig, evaluator: { type: 'ONE_TIME_FORM_STATUS' } },
    });
    await expect(service.evaluate(doc, { stateId, designYearId, installment: 1 })).rejects.toThrow(
      /Unsupported claim-eligibility evaluator type/,
    );
  });

  it('queries the configured collection scoped by design year, state, and installment', async () => {
    findOne.mockResolvedValue({ _id: new Types.ObjectId(), currentFormStatus: 5 });

    await service.evaluate(sourceFormJson(), { stateId, designYearId, installment: 1 });

    expect(collection).toHaveBeenCalledWith('xvifc_devolution_forms');
    const [query] = findOne.mock.calls[0] as [Record<string, unknown>];
    expect((query['year'] as Types.ObjectId).toString()).toBe(designYearId);
    expect(query['state']).toBe(stateId);
    expect(query['installment']).toBe(1);
  });

  it('returns PASSED when the resolved form status is in acceptedFormStatuses', async () => {
    const formDocId = new Types.ObjectId();
    findOne.mockResolvedValue({ _id: formDocId, currentFormStatus: 5 });

    const result = await service.evaluate(sourceFormJson(), { stateId, designYearId, installment: 1 });

    expect(result.result).toBe('PASSED');
    expect(result.statusAtEvaluation).toBe(5);
    expect(result.formDocumentId).toBe(String(formDocId));
    expect(result.evidence).toMatchObject({
      evidenceVersion: 1,
      resolvedFormStatus: 5,
      sourceFormDocumentId: String(formDocId),
    });
  });

  it('returns FAILED when the resolved form status is not in acceptedFormStatuses', async () => {
    findOne.mockResolvedValue({ _id: new Types.ObjectId(), currentFormStatus: 2 });

    const result = await service.evaluate(sourceFormJson(), { stateId, designYearId, installment: 1 });

    expect(result.result).toBe('FAILED');
    expect(result.reasonCode).toBe('FORM_STATUS_2_NOT_ACCEPTED');
  });

  it('returns FAILED with null identity fields when no source document exists yet', async () => {
    findOne.mockResolvedValue(null);

    const result = await service.evaluate(sourceFormJson(), { stateId, designYearId, installment: 1 });

    expect(result.result).toBe('FAILED');
    expect(result.reasonCode).toBe('SOURCE_FORM_NOT_FOUND');
    expect(result.formDocumentId).toBeNull();
    expect(result.statusAtEvaluation).toBeNull();
    expect(result.evidence).toMatchObject({ resolvedFormStatus: null, sourceFormDocumentId: null });
  });

  it('copies displayLabel/displayDescription from the config onto both PASSED and not-found results', async () => {
    const withDisplayCopy = sourceFormJson({
      claimEligibility: {
        ...devolutionConfig,
        displayLabel: 'Devolution Formula',
        displayDescription: 'Devolution Formula must be submitted by the state.',
      },
    });

    findOne.mockResolvedValue({ _id: new Types.ObjectId(), currentFormStatus: 5 });
    const passed = await service.evaluate(withDisplayCopy, { stateId, designYearId, installment: 1 });
    expect(passed.displayLabel).toBe('Devolution Formula');
    expect(passed.displayDescription).toBe('Devolution Formula must be submitted by the state.');

    findOne.mockResolvedValue(null);
    const notFound = await service.evaluate(withDisplayCopy, { stateId, designYearId, installment: 1 });
    expect(notFound.displayLabel).toBe('Devolution Formula');
    expect(notFound.displayDescription).toBe('Devolution Formula must be submitted by the state.');
  });

  it('leaves displayLabel/displayDescription undefined when the config has neither', async () => {
    findOne.mockResolvedValue({ _id: new Types.ObjectId(), currentFormStatus: 5 });

    const result = await service.evaluate(sourceFormJson(), { stateId, designYearId, installment: 1 });

    expect(result.displayLabel).toBeUndefined();
    expect(result.displayDescription).toBeUndefined();
  });

  it('never branches on a hardcoded formId anywhere in its evaluation logic', () => {
    // Structural guard against reintroducing `if (formId === 24)`-style special-casing (brain
    // §3.1) — the evaluator must stay driven entirely by the passed-in config.
    const serviceSource = ClaimEligibilityEvaluatorService.toString();
    expect(serviceSource).not.toMatch(/formId\s*===\s*24/);
  });

  // ─── evaluateUlbBulk ────────────────────────────────────────────────────────

  describe('evaluateUlbBulk', () => {
    const expectedUlbIds = [new Types.ObjectId().toString(), new Types.ObjectId().toString()];
    const [ulbA, ulbB] = expectedUlbIds;

    /** name -> {findOne, find} — lets one test query two different collections (row +
     *  parent) with independent mocked responses, unlike the outer file's single shared mock. */
    let byCollection: Record<string, { findOne: jest.Mock; find: jest.Mock }>;

    function mockCollection(name: string, docs: Record<string, unknown>[] = []): void {
      byCollection[name] = {
        findOne: jest.fn().mockResolvedValue(null),
        find: jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue(docs) }),
      };
    }

    beforeEach(() => {
      byCollection = {};
      collection.mockImplementation((name: string) => byCollection[name] ?? mockCollection(name));
    });

    const slbConfig: ClaimEligibilityConfig = {
      enabled: true,
      ruleVersion: 1,
      ownerLevel: 'ULB',
      evaluationLevel: 'FORM',
      yearScope: 'CURRENT_DESIGN_YEAR',
      applicableInstallments: [1],
      acceptedFormStatuses: [3],
      source: {
        collection: 'xvifc_slb_forms',
        fields: { designYear: 'year', ulb: 'ulb', currentFormStatus: 'currentFormStatus' },
      },
      evaluator: { type: 'FORM_STATUS' },
      exemption: { allowed: false },
      approval: { action: 'NO_ACTION' },
      rejection: { action: 'NO_ACTION' },
    };

    it('FORM_STATUS bulk: buckets by acceptedFormStatuses and defaults a missing ULB to ineligible', async () => {
      mockCollection('xvifc_slb_forms', [
        { ulb: new Types.ObjectId(ulbA), currentFormStatus: 3 },
        { ulb: new Types.ObjectId(ulbB), currentFormStatus: 2 },
      ]);
      const doc = sourceFormJson({ formId: 32, type: 'SLB', claimEligibility: slbConfig });
      const thirdUlb = new Types.ObjectId().toString();

      const { perUlb, tally } = await service.evaluateUlbBulk(doc, {
        stateId,
        designYearId,
        expectedUlbIds: [...expectedUlbIds, thirdUlb],
      });

      expect(perUlb.get(ulbA)).toBe('ELIGIBLE');
      expect(perUlb.get(ulbB)).toBe('INELIGIBLE'); // status 2, not accepted
      expect(perUlb.get(thirdUlb)).toBe('INELIGIBLE'); // no SLB document at all
      expect(tally).toEqual({ eligible: 1, ineligible: 2, exempted: 0, total: 3 });
    });

    it('FORM_STATUS bulk: bounds the query to expectedUlbIds via $in (SLB has no state field to filter by)', async () => {
      mockCollection('xvifc_slb_forms', []);
      const doc = sourceFormJson({ formId: 32, type: 'SLB', claimEligibility: slbConfig });

      await service.evaluateUlbBulk(doc, { stateId, designYearId, expectedUlbIds });

      const [query] = byCollection['xvifc_slb_forms'].find.mock.calls[0] as [Record<string, unknown>];
      const ulbFilter = query['ulb'] as { $in: Types.ObjectId[] };
      expect(ulbFilter.$in.map((id) => id.toString())).toEqual(expectedUlbIds);
    });

    it('FORM_STATUS bulk: resolves a dotted currentFormStatus path (Annual Accounts style)', async () => {
      mockCollection('xvifc_annualaccounts', [
        { ulb: new Types.ObjectId(ulbA), auditedData: { form_status_id: 5 } },
        { ulb: new Types.ObjectId(ulbB), auditedData: { form_status_id: 2 } },
      ]);
      const auditedConfig: ClaimEligibilityConfig = {
        ...slbConfig,
        acceptedFormStatuses: [5, 7],
        source: {
          collection: 'xvifc_annualaccounts',
          fields: {
            designYear: 'design_year',
            state: 'state',
            ulb: 'ulb',
            currentFormStatus: 'auditedData.form_status_id',
          },
        },
      };
      const doc = sourceFormJson({ formId: 30, type: 'ANNUAL_ACCOUNT_AUDITED', claimEligibility: auditedConfig });

      const { perUlb } = await service.evaluateUlbBulk(doc, { stateId, designYearId, expectedUlbIds });

      expect(perUlb.get(ulbA)).toBe('ELIGIBLE');
      expect(perUlb.get(ulbB)).toBe('INELIGIBLE');
    });

    const electedBodyRowConfig: ClaimEligibilityConfig = {
      enabled: true,
      ruleVersion: 1,
      ownerLevel: 'ULB',
      evaluationLevel: 'ROW',
      yearScope: 'CURRENT_DESIGN_YEAR',
      applicableInstallments: [1],
      acceptedFormStatuses: [],
      source: {
        rowCollection: 'xvifc_elected_ulb_rows',
        rowFields: {
          ulb: 'ulbId',
          designYear: 'year',
          state: 'state',
          isActive: 'isActive',
          datasetVersion: 'datasetVersion',
        },
        parentCollection: 'xvifc_elected_ulb_forms',
        parentFields: { designYear: 'year', state: 'state', activeDatasetVersion: 'activeDatasetVersion' },
      },
      evaluator: {
        type: 'ROW_STATUS_AND_FIELDS',
        config: {
          rowStatusField: 'electedBodyStatus',
          rowEligibleValues: ['Constituted'],
          rowIneligibleValues: ['Not Constituted'],
          rowExemptedValues: ['Exempt'],
          defaultWhenNoRow: 'INELIGIBLE',
        },
      },
      exemption: { allowed: false },
      approval: { action: 'NO_ACTION' },
      rejection: { action: 'NO_ACTION' },
    };

    it('ROW_STATUS_AND_FIELDS bulk: buckets Constituted/Not Constituted/Exempt into eligible/ineligible/exempted', async () => {
      const ulbC = new Types.ObjectId().toString();
      mockCollection('xvifc_elected_ulb_forms', [{ activeDatasetVersion: 2 }]);
      mockCollection('xvifc_elected_ulb_rows', [
        { ulbId: new Types.ObjectId(ulbA), electedBodyStatus: 'Constituted' },
        { ulbId: new Types.ObjectId(ulbB), electedBodyStatus: 'Not Constituted' },
        { ulbId: new Types.ObjectId(ulbC), electedBodyStatus: 'Exempt' },
      ]);
      const doc = sourceFormJson({ formId: 23, type: 'ELECTED_BODY', claimEligibility: electedBodyRowConfig });

      const { perUlb, tally } = await service.evaluateUlbBulk(doc, {
        stateId,
        designYearId,
        expectedUlbIds: [ulbA, ulbB, ulbC],
      });

      expect(perUlb.get(ulbA)).toBe('ELIGIBLE');
      expect(perUlb.get(ulbB)).toBe('INELIGIBLE');
      expect(perUlb.get(ulbC)).toBe('EXEMPTED');
      expect(tally).toEqual({ eligible: 1, ineligible: 1, exempted: 1, total: 3 });
    });

    it('ROW_STATUS_AND_FIELDS bulk: resolves the parent form’s activeDatasetVersion and filters rows by it', async () => {
      const formFindOne = jest.fn().mockResolvedValue({ activeDatasetVersion: 4 });
      byCollection['xvifc_elected_ulb_forms'] = { findOne: formFindOne, find: jest.fn() };
      const rowFind = jest.fn().mockReturnValue({ toArray: jest.fn().mockResolvedValue([]) });
      byCollection['xvifc_elected_ulb_rows'] = { findOne: jest.fn(), find: rowFind };
      const doc = sourceFormJson({ formId: 23, type: 'ELECTED_BODY', claimEligibility: electedBodyRowConfig });

      await service.evaluateUlbBulk(doc, { stateId, designYearId, expectedUlbIds });

      expect(formFindOne).toHaveBeenCalled();
      const [rowQuery] = rowFind.mock.calls[0] as [Record<string, unknown>];
      expect(rowQuery['datasetVersion']).toBe(4);
    });

    it('defaults a ULB with no row to defaultWhenNoRow, per source', async () => {
      mockCollection('xvifc_elected_ulb_forms', [{ activeDatasetVersion: 1 }]);
      mockCollection('xvifc_elected_ulb_rows', []); // no rows for anyone
      const doc = sourceFormJson({ formId: 23, type: 'ELECTED_BODY', claimEligibility: electedBodyRowConfig });

      const { perUlb } = await service.evaluateUlbBulk(doc, { stateId, designYearId, expectedUlbIds: [ulbA] });

      expect(perUlb.get(ulbA)).toBe('INELIGIBLE'); // Elected Body's configured default
    });

    it('FC-Unspent-shaped source (no parentCollection, boolean field, defaultWhenNoRow: ELIGIBLE) skips the dataset-version lookup entirely', async () => {
      const fcUnspentRowConfig: ClaimEligibilityConfig = {
        ...electedBodyRowConfig,
        source: {
          rowCollection: 'xvifc_unspent_state_form_rows',
          rowFields: { ulb: 'ulbId', designYear: 'year', state: 'state', isActive: 'isActive' },
        },
        evaluator: {
          type: 'ROW_STATUS_AND_FIELDS',
          config: { rowStatusField: 'eligibility', rowEligibleValues: [true], defaultWhenNoRow: 'ELIGIBLE' },
        },
      };
      const parentFindOne = jest.fn();
      byCollection['xvifc_unspent_state_forms'] = { findOne: parentFindOne, find: jest.fn() };
      mockCollection('xvifc_unspent_state_form_rows', [{ ulbId: new Types.ObjectId(ulbA), eligibility: false }]);
      const doc = sourceFormJson({ formId: 25, type: 'FC_UNSPENT_STATE', claimEligibility: fcUnspentRowConfig });

      const { perUlb } = await service.evaluateUlbBulk(doc, { stateId, designYearId, expectedUlbIds });

      expect(parentFindOne).not.toHaveBeenCalled();
      expect(perUlb.get(ulbA)).toBe('INELIGIBLE'); // eligibility: false
      expect(perUlb.get(ulbB)).toBe('ELIGIBLE'); // no row at all -> defaultWhenNoRow
    });

    it('dispatches on source shape, not evaluator.type — a FORM_STATUS config with rowCollection set still runs the row bucketing', async () => {
      // Mirrors Elected Body's real config: evaluator.type stays 'FORM_STATUS' (used by the
      // single-result evaluate() path for the state-level pass/fail line), but this method must
      // still route to row logic based on source.rowCollection being present.
      mockCollection('xvifc_elected_ulb_forms', [{ activeDatasetVersion: 1 }]);
      mockCollection('xvifc_elected_ulb_rows', [
        { ulbId: new Types.ObjectId(ulbA), electedBodyStatus: 'Constituted' },
      ]);
      const combinedConfig: ClaimEligibilityConfig = {
        ...electedBodyRowConfig,
        evaluator: { type: 'FORM_STATUS', config: electedBodyRowConfig.evaluator.config },
      };
      const doc = sourceFormJson({ formId: 23, type: 'ELECTED_BODY', claimEligibility: combinedConfig });

      const { perUlb } = await service.evaluateUlbBulk(doc, { stateId, designYearId, expectedUlbIds: [ulbA] });

      expect(perUlb.get(ulbA)).toBe('ELIGIBLE');
    });

    it('throws when a config has neither source.collection nor source.rowCollection', async () => {
      const doc = sourceFormJson({ claimEligibility: { ...slbConfig, source: {} } });
      await expect(service.evaluateUlbBulk(doc, { stateId, designYearId, expectedUlbIds })).rejects.toThrow(
        /has neither source.collection nor source.rowCollection/,
      );
    });

    it('throws when a ROW_STATUS_AND_FIELDS config is missing rowStatusField/defaultWhenNoRow', async () => {
      const doc = sourceFormJson({
        claimEligibility: {
          ...electedBodyRowConfig,
          evaluator: { type: 'ROW_STATUS_AND_FIELDS', config: { rowEligibleValues: ['Constituted'] } },
        },
      });
      await expect(service.evaluateUlbBulk(doc, { stateId, designYearId, expectedUlbIds })).rejects.toThrow(
        /missing evaluator.config.rowStatusField/,
      );
    });

    describe('rowFormStatusField / rowAcceptedFormStatuses AND-condition', () => {
      const fcUnspentRowConfigWithFormStatus: ClaimEligibilityConfig = {
        ...electedBodyRowConfig,
        source: {
          rowCollection: 'xvifc_unspent_state_form_rows',
          rowFields: { ulb: 'ulbId', designYear: 'year', state: 'state', isActive: 'isActive' },
        },
        evaluator: {
          type: 'ROW_STATUS_AND_FIELDS',
          config: {
            rowStatusField: 'eligibility',
            rowEligibleValues: [true],
            defaultWhenNoRow: 'ELIGIBLE',
            rowFormStatusField: 'rowStatus',
            rowAcceptedFormStatuses: [5, 7],
          },
        },
      };

      it('buckets INELIGIBLE when the domain value is eligible but rowStatus is not accepted', async () => {
        mockCollection('xvifc_unspent_state_form_rows', [
          { ulbId: new Types.ObjectId(ulbA), eligibility: true, rowStatus: null },
        ]);
        const doc = sourceFormJson({
          formId: 25,
          type: 'FC_UNSPENT_STATE',
          claimEligibility: fcUnspentRowConfigWithFormStatus,
        });

        const { perUlb } = await service.evaluateUlbBulk(doc, { stateId, designYearId, expectedUlbIds: [ulbA] });

        expect(perUlb.get(ulbA)).toBe('INELIGIBLE');
      });

      it('buckets ELIGIBLE when the domain value is eligible and rowStatus is accepted', async () => {
        mockCollection('xvifc_unspent_state_form_rows', [
          { ulbId: new Types.ObjectId(ulbA), eligibility: true, rowStatus: 7 },
        ]);
        const doc = sourceFormJson({
          formId: 25,
          type: 'FC_UNSPENT_STATE',
          claimEligibility: fcUnspentRowConfigWithFormStatus,
        });

        const { perUlb } = await service.evaluateUlbBulk(doc, { stateId, designYearId, expectedUlbIds: [ulbA] });

        expect(perUlb.get(ulbA)).toBe('ELIGIBLE');
      });

      it('buckets an exempted row INELIGIBLE when rowStatus is not accepted — no exemption bypass', async () => {
        const exemptConfig: ClaimEligibilityConfig = {
          ...electedBodyRowConfig,
          evaluator: {
            type: 'ROW_STATUS_AND_FIELDS',
            config: {
              ...(electedBodyRowConfig.evaluator.config as Record<string, unknown>),
              rowFormStatusField: 'rowStatus',
              rowAcceptedFormStatuses: [7],
            },
          },
        };
        mockCollection('xvifc_elected_ulb_forms', [{ activeDatasetVersion: 1 }]);
        mockCollection('xvifc_elected_ulb_rows', [
          { ulbId: new Types.ObjectId(ulbA), electedBodyStatus: 'Exempt', rowStatus: 5 },
        ]);
        const doc = sourceFormJson({ formId: 23, type: 'ELECTED_BODY', claimEligibility: exemptConfig });

        const { perUlb } = await service.evaluateUlbBulk(doc, { stateId, designYearId, expectedUlbIds: [ulbA] });

        expect(perUlb.get(ulbA)).toBe('INELIGIBLE');
      });

      it('leaves a ULB with no row at all governed by defaultWhenNoRow, unaffected by the FORM_STATUS check', async () => {
        mockCollection('xvifc_unspent_state_form_rows', []);
        const doc = sourceFormJson({
          formId: 25,
          type: 'FC_UNSPENT_STATE',
          claimEligibility: fcUnspentRowConfigWithFormStatus,
        });

        const { perUlb } = await service.evaluateUlbBulk(doc, { stateId, designYearId, expectedUlbIds: [ulbA] });

        expect(perUlb.get(ulbA)).toBe('ELIGIBLE'); // defaultWhenNoRow, unchanged by this check
      });

      it('is fully config-driven — changing rowAcceptedFormStatuses changes the outcome with no code change', async () => {
        mockCollection('xvifc_unspent_state_form_rows', [
          { ulbId: new Types.ObjectId(ulbA), eligibility: true, rowStatus: 5 },
        ]);
        const doc = sourceFormJson({
          formId: 25,
          type: 'FC_UNSPENT_STATE',
          claimEligibility: fcUnspentRowConfigWithFormStatus,
        });

        const first = await service.evaluateUlbBulk(doc, { stateId, designYearId, expectedUlbIds: [ulbA] });
        expect(first.perUlb.get(ulbA)).toBe('ELIGIBLE'); // 5 is in [5, 7]

        const narrowedConfig: ClaimEligibilityConfig = {
          ...fcUnspentRowConfigWithFormStatus,
          evaluator: {
            type: 'ROW_STATUS_AND_FIELDS',
            config: {
              ...(fcUnspentRowConfigWithFormStatus.evaluator.config as Record<string, unknown>),
              rowAcceptedFormStatuses: [7],
            },
          },
        };
        mockCollection('xvifc_unspent_state_form_rows', [
          { ulbId: new Types.ObjectId(ulbA), eligibility: true, rowStatus: 5 },
        ]);
        const narrowedDoc = sourceFormJson({
          formId: 25,
          type: 'FC_UNSPENT_STATE',
          claimEligibility: narrowedConfig,
        });

        const second = await service.evaluateUlbBulk(narrowedDoc, { stateId, designYearId, expectedUlbIds: [ulbA] });
        expect(second.perUlb.get(ulbA)).toBe('INELIGIBLE'); // 5 no longer in [7]
      });
    });

    describe('rowEvidenceByUlbId', () => {
      it('carries rowDocumentId/rowStatusAtEvaluation/datasetVersion:null for a dataset-versionless source (FC Unspent)', async () => {
        const rowId = new Types.ObjectId();
        const fcUnspentRowConfigWithFormStatus: ClaimEligibilityConfig = {
          ...electedBodyRowConfig,
          source: {
            rowCollection: 'xvifc_unspent_state_form_rows',
            rowFields: { ulb: 'ulbId', designYear: 'year', state: 'state', isActive: 'isActive' },
          },
          evaluator: {
            type: 'ROW_STATUS_AND_FIELDS',
            config: {
              rowStatusField: 'eligibility',
              rowEligibleValues: [true],
              defaultWhenNoRow: 'ELIGIBLE',
              rowFormStatusField: 'rowStatus',
              rowAcceptedFormStatuses: [5, 7],
            },
          },
        };
        mockCollection('xvifc_unspent_state_form_rows', [
          { _id: rowId, ulbId: new Types.ObjectId(ulbA), eligibility: true, rowStatus: 7 },
        ]);
        const doc = sourceFormJson({
          formId: 25,
          type: 'FC_UNSPENT_STATE',
          claimEligibility: fcUnspentRowConfigWithFormStatus,
        });

        const { rowEvidenceByUlbId } = await service.evaluateUlbBulk(doc, {
          stateId,
          designYearId,
          expectedUlbIds: [ulbA],
        });

        expect(rowEvidenceByUlbId?.get(ulbA)).toEqual({
          bucket: 'ELIGIBLE',
          rowDocumentId: rowId.toString(),
          rowStatusAtEvaluation: 7,
          datasetVersion: null,
        });
      });

      it('carries the resolved activeDatasetVersion for a dataset-versioned source (Elected Body)', async () => {
        const rowId = new Types.ObjectId();
        // mockCollection's findOne always resolves null (it only wires up find/toArray from
        // `docs`) — the parent-version lookup goes through findOne, so it needs the manual
        // byCollection wiring, same as the existing "resolves the parent form's
        // activeDatasetVersion" test above.
        byCollection['xvifc_elected_ulb_forms'] = {
          findOne: jest.fn().mockResolvedValue({ activeDatasetVersion: 4 }),
          find: jest.fn(),
        };
        mockCollection('xvifc_elected_ulb_rows', [
          { _id: rowId, ulbId: new Types.ObjectId(ulbA), electedBodyStatus: 'Constituted', rowStatus: 5 },
        ]);
        const configWithFormStatus: ClaimEligibilityConfig = {
          ...electedBodyRowConfig,
          evaluator: {
            type: 'ROW_STATUS_AND_FIELDS',
            config: {
              ...(electedBodyRowConfig.evaluator.config as Record<string, unknown>),
              rowFormStatusField: 'rowStatus',
              rowAcceptedFormStatuses: [5, 7],
            },
          },
        };
        const doc = sourceFormJson({ formId: 23, type: 'ELECTED_BODY', claimEligibility: configWithFormStatus });

        const { rowEvidenceByUlbId } = await service.evaluateUlbBulk(doc, {
          stateId,
          designYearId,
          expectedUlbIds: [ulbA],
        });

        expect(rowEvidenceByUlbId?.get(ulbA)).toEqual({
          bucket: 'ELIGIBLE',
          rowDocumentId: rowId.toString(),
          rowStatusAtEvaluation: 5,
          datasetVersion: 4,
        });
      });

      it('has no entry for a ULB with no row at all (defaultWhenNoRow applied — nothing to freeze)', async () => {
        mockCollection('xvifc_elected_ulb_forms', [{ activeDatasetVersion: 1 }]);
        mockCollection('xvifc_elected_ulb_rows', []);
        const doc = sourceFormJson({ formId: 23, type: 'ELECTED_BODY', claimEligibility: electedBodyRowConfig });

        const { rowEvidenceByUlbId } = await service.evaluateUlbBulk(doc, {
          stateId,
          designYearId,
          expectedUlbIds: [ulbA],
        });

        expect(rowEvidenceByUlbId?.has(ulbA)).toBe(false);
      });

      it('is undefined for the FORM_STATUS-bulk (flat-document, ownerLevel: ULB) path — no row concept there', async () => {
        mockCollection('xvifc_slb_forms', [{ ulb: new Types.ObjectId(ulbA), currentFormStatus: 3 }]);
        const doc = sourceFormJson({ formId: 32, type: 'SLB', claimEligibility: slbConfig });

        const result = await service.evaluateUlbBulk(doc, { stateId, designYearId, expectedUlbIds: [ulbA] });

        expect(result.rowEvidenceByUlbId).toBeUndefined();
      });
    });
  });
});
