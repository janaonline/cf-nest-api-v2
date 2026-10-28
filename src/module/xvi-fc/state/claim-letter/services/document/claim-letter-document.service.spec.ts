import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { RedisService } from 'src/core/services/redis/redis.service';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { ExpectedUlbSetService } from 'src/module/xvi-fc/common/services/expected-ulb-set.service';
import { ClaimLetterBatch } from 'src/schemas/xvi-fc/state/claim-letter-batch.schema';
import { ClaimLetterBatchUlb } from 'src/schemas/xvi-fc/state/claim-letter-batch-ulb.schema';
import { State } from 'src/schemas/state.schema';
import { Year } from 'src/schemas/year.schema';
import { XviFcUnspentStateForm } from 'src/schemas/xvi-fc/state/fc-unspent-state-form.schema';
import { XviFcUnspentStateFormRow } from 'src/schemas/xvi-fc/state/fc-unspent-state-form-row.schema';
import { XviFcSfcStatus } from 'src/schemas/xvi-fc/state/sfc-status.schema';
import { ClaimLetterEligibilityService } from '../eligibility/claim-letter-eligibility.service';
import { ClaimLetterFormJsonService } from '../form-json/claim-letter-form-json.service';
import { ClaimLetterDocumentService } from './claim-letter-document.service';
import { ClaimLetterActiveBatchService } from '../active-batch/claim-letter-active-batch.service';
import { printedText } from '../../helpers/claim-letter-letter.helpers';
import type { ClaimLetterParagraph } from '../../types/claim-letter-document.types';

function q<T>(value: T) {
  const chain: Record<string, jest.Mock> = {};
  for (const m of ['select', 'sort', 'skip', 'limit', 'lean']) chain[m] = jest.fn().mockReturnValue(chain);
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

const text = (p: ClaimLetterParagraph) => p.runs.map(printedText).join('');
const placeholders = (p: ClaimLetterParagraph) => p.runs.filter((r) => r.placeholder).map((r) => r.text);

describe('ClaimLetterDocumentService', () => {
  const claimLetterId = new Types.ObjectId().toString();
  const stateOid = new Types.ObjectId();
  const yearOid = new Types.ObjectId();
  const [ulbA, ulbB, ulbC, ulbD] = [1, 2, 3, 4].map(() => new Types.ObjectId().toString());
  const stateUser: AuthUser = {
    _id: new Types.ObjectId().toString(),
    role: 'STATE',
    scope: Scope.STATE,
    accessLevel: null,
    state: String(stateOid),
  } as AuthUser;

  const radioYesNo = {
    label: 'b) transferred',
    options: [
      { label: 'Yes', id: 'yes' },
      { label: 'No', id: 'no' },
    ],
  };
  const letterQuestions = [
    { key: 'letterDate', formFieldType: 'date', label: 'Letter date' },
    { key: 'sfcAtrDate', formFieldType: 'date', label: 'ATR date' },
    { key: 'gtcTransferredInTime', formFieldType: 'radio', ...radioYesNo },
    { key: 'mohuaReferenceDate', formFieldType: 'date', label: 'MoHUA date' },
  ];

  let parent: Record<string, unknown>;
  let service: ClaimLetterDocumentService;
  let eligibility: { resolveUlbLevelEligibility: jest.Mock; resolveDevolutionAllocations: jest.Mock };
  let redis: { get: jest.Mock; set: jest.Mock };
  let batchModel: { findOne: jest.Mock };
  let sfcModel: { findOne: jest.Mock };
  let activeBatch: { assertActive: jest.Mock };

  function criterion(
    formId: number,
    type: string,
    letterColumnLabel: string,
    evaluationLevel: 'FORM' | 'FORM_AND_ROW',
    buckets: [string, string][],
    extra: { rowEvidence?: [string, Record<string, unknown>][]; approved?: string[] } = {},
  ) {
    return {
      formId,
      type,
      label: letterColumnLabel,
      letterColumnLabel,
      displayOrder: formId,
      evaluationLevel,
      buckets: new Map(buckets),
      rowEvidence: new Map(extra.rowEvidence ?? []),
      approvedExemptionUlbIds: new Set(extra.approved ?? []),
    };
  }

  const row = (rowValue: string, rowAccepted: boolean | null) => ({
    bucket: rowAccepted === false ? 'INELIGIBLE' : 'ELIGIBLE',
    rowDocumentId: new Types.ObjectId().toString(),
    rowStatusAtEvaluation: 7,
    datasetVersion: 1,
    rowValue,
    rowAccepted,
  });

  beforeEach(async () => {
    parent = {
      _id: new Types.ObjectId(claimLetterId),
      state: stateOid,
      year: yearOid,
      installment: 1,
      batchNumber: 2,
      revision: 3,
      letterDetails: {
        departmentName: 'Urban Development Department',
        departmentAddress: 'Block 4,\nCapital Road',
        letterNo: 'UD/1',
        letterDate: '2026-11-05T00:00:00.000Z',
        gtcTransferredInTime: 'no',
        gtcPenalInterestDetails: 'Not applicable',
        sfcAtrDate: '2026-03-14T00:00:00.000Z',
      },
    };
    batchModel = { findOne: jest.fn(() => q(parent)) };
    sfcModel = { findOne: jest.fn(() => q({ data: { whichAwardPeriod: '6th SFC', awardPeriod: '2026-2031' } })) };
    redis = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined) };
    activeBatch = { assertActive: jest.fn().mockResolvedValue(undefined) };
    eligibility = {
      resolveUlbLevelEligibility: jest.fn().mockResolvedValue({
        perUlbEligible: new Map([
          [ulbA, true],
          [ulbB, true],
          [ulbC, false],
          [ulbD, true],
        ]),
        perCriterion: [
          criterion(
            1,
            'ELECTED_BODY',
            'Election Status',
            'FORM_AND_ROW',
            [
              [ulbA, 'ELIGIBLE'],
              [ulbB, 'ELIGIBLE'],
              [ulbC, 'INELIGIBLE'],
              [ulbD, 'EXEMPTED'],
            ],
            {
              rowEvidence: [
                [ulbA, row('6th Schedule', true)],
                [ulbB, row('Constituted', true)],
                [ulbC, row('Constituted', false)],
              ],
            },
          ),
          criterion(
            3,
            'UPLOAD_CONFIG_AUDITED',
            'Audited Accounts submitted',
            'FORM',
            [
              [ulbA, 'ELIGIBLE'],
              [ulbB, 'EXEMPTED'],
              [ulbC, 'ELIGIBLE'],
              [ulbD, 'ELIGIBLE'],
            ],
            { approved: [ulbB] },
          ),
          criterion(5, 'SLB', '28 SLB published', 'FORM', [
            [ulbA, 'ELIGIBLE'],
            [ulbB, 'ELIGIBLE'],
            [ulbC, 'INELIGIBLE'],
            [ulbD, 'ELIGIBLE'],
          ]),
          criterion(
            7,
            'FC_UNSPENT_STATE',
            '14th FC & previous FC unspent balance',
            'FORM_AND_ROW',
            [
              [ulbA, 'ELIGIBLE'],
              [ulbB, 'ELIGIBLE'],
              [ulbC, 'INELIGIBLE'],
              [ulbD, 'ELIGIBLE'],
            ],
            { approved: [ulbB] },
          ),
        ],
      }),
      resolveDevolutionAllocations: jest.fn().mockResolvedValue(
        new Map([
          [ulbA, { allocatedAmount: 123456789 }],
          [ulbB, { allocatedAmount: 4567891 }],
        ]),
      ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimLetterDocumentService,
        { provide: ClaimLetterEligibilityService, useValue: eligibility },
        {
          provide: ExpectedUlbSetService,
          useValue: {
            resolve: jest.fn().mockResolvedValue([
              { ulbId: ulbD, name: 'ULB D' },
              { ulbId: ulbC, name: 'ULB C' },
              { ulbId: ulbB, name: 'ULB B' },
              { ulbId: ulbA, name: 'ULB A' },
            ]),
          },
        },
        {
          provide: ClaimLetterFormJsonService,
          useValue: { loadFormConfig: jest.fn().mockResolvedValue({ letterQuestions }) },
        },
        { provide: RedisService, useValue: redis },
        { provide: ClaimLetterActiveBatchService, useValue: activeBatch },
        { provide: ConfigService, useValue: { get: () => 'test' } },
        { provide: getModelToken(ClaimLetterBatch.name), useValue: batchModel },
        {
          provide: getModelToken(ClaimLetterBatchUlb.name),
          useValue: {
            find: jest.fn(() =>
              q([
                { ulbId: new Types.ObjectId(ulbB), ulbSnapshot: { name: 'ULB B' }, claimedAmount: 4600000 },
                { ulbId: new Types.ObjectId(ulbA), ulbSnapshot: { name: 'ULB A' }, claimedAmount: 125000000 },
              ]),
            ),
          },
        },
        {
          provide: getModelToken(State.name),
          useValue: { findById: jest.fn(() => q({ name: 'Sample State', code: 'SS' })) },
        },
        { provide: getModelToken(Year.name), useValue: { findById: jest.fn(() => q({ year: '2026-27' })) } },
        {
          provide: getModelToken(XviFcUnspentStateForm.name),
          useValue: { findOne: jest.fn(() => q({ _id: new Types.ObjectId() })) },
        },
        {
          provide: getModelToken(XviFcUnspentStateFormRow.name),
          useValue: {
            find: jest.fn(() =>
              q([
                { ulbId: new Types.ObjectId(ulbA), unspentAmount: 325000 },
                { ulbId: new Types.ObjectId(ulbC), unspentAmount: 1850000 },
              ]),
            ),
          },
        },
        { provide: getModelToken(XviFcSfcStatus.name), useValue: sfcModel },
      ],
    }).compile();

    service = module.get(ClaimLetterDocumentService);
  });

  describe('covering letter', () => {
    it('fills the State-entered slots, formats dates and option labels, and keeps the ref number', async () => {
      const { data } = await service.getDocument(claimLetterId, stateUser);
      const letter = data!.letter;

      expect(data!.refNo).toBe('CL/SS/2026-27/1-2');
      expect(text(letter.letterhead)).toBe(
        'GOVERNMENT OF SAMPLE STATE\nUrban Development Department\nBlock 4,\nCapital Road\nEmail - <Email>',
      );
      expect(placeholders(letter.letterhead)).toEqual(['<Email>']);
      expect(text(letter.letterNo)).toBe('Letter No.: UD/1');
      expect(text(letter.refAndDate)).toBe('CF Ref No.- CL/SS/2026-27/1-2\nDate: 05 Nov 2026');
      expect(text(letter.references[1])).toBe(
        'Ministry of Housing and Urban Affairs letter/guidelines, if applicable.',
      );
      expect(text(letter.signature)).toBe(
        '<Signature>\n<Name of Authorised Officer>\n<Designation>\nGovernment of Sample State',
      );
    });

    it('prints the MoHUA reference date when given', async () => {
      (parent['letterDetails'] as Record<string, unknown>)['mohuaReferenceDate'] = '2026-09-18T00:00:00.000Z';
      const { data } = await service.getDocument(claimLetterId, stateUser);
      expect(text(data!.letter.references[1])).toBe(
        'Ministry of Housing and Urban Affairs letter/guidelines dated 18 Sep 2026, if applicable.',
      );
    });

    it('tags every letter-detail slot with its key, filled or blank, for the inline editor', async () => {
      const { data } = await service.getDocument(claimLetterId, stateUser);
      const letter = data!.letter;
      const paragraphs = [
        letter.letterhead,
        letter.letterNo,
        letter.refAndDate,
        ...letter.references,
        ...letter.compliance.flatMap((row) => row.status),
        letter.signature,
      ];
      const fields = paragraphs.flatMap((p) => p.runs.filter((r) => r.field).map((r) => r.field));

      expect(fields).toEqual([
        'departmentName',
        'departmentAddress',
        'departmentEmail',
        'letterNo',
        'letterDate',
        'mohuaReferenceDate',
        'gtcTransferredInTime',
        'gtcPenalInterestDetails',
        'sfcAtrDate',
        'officerName',
        'officerDesignation',
      ]);
      expect(letter.references[1].runs.find((r) => r.field)).toEqual({
        text: '',
        field: 'mohuaReferenceDate',
        lead: ' dated ',
      });
    });

    it('builds the claim amount in lakh and words from the batch claims', async () => {
      const { data } = await service.getDocument(claimLetterId, stateUser);
      expect(text(data!.letter.body[1])).toContain('₹1,296.00 lakh (Rupees Twelve Crore Ninety-Six Lakh only)');
      expect(text(data!.letter.closing[1])).toContain('₹1,296.00 lakh for FY 2026-27');
    });

    it('rows A and B use the letter details and the SFC form as stored', async () => {
      const { data } = await service.getDocument(claimLetterId, stateUser);
      const [rowA, rowB] = data!.letter.compliance;

      expect(rowA.status.map(text)).toEqual([
        'a) GTC of the 2nd installment of FY 2025-26 submitted by the State.',
        'b) No',
        'c) Not applicable',
      ]);
      expect(text(rowB.status[0])).toBe(
        'State has constituted its 6th SFC and submitted the ATR on its recommendations vide dt. 14 Mar 2026. ' +
          'The recommendations of SFC are applicable till FY 2026-2031.',
      );
    });

    it('row B shows placeholders when the SFC form has no values', async () => {
      sfcModel.findOne.mockReturnValue(q(null));
      const { data } = await service.getDocument(claimLetterId, stateUser);
      expect(placeholders(data!.letter.compliance[1].status[0])).toEqual(['<nth SFC>', '<award period>']);
      expect(data!.letter.compliance[1].status[0].runs.filter((r) => r.placeholder).map((r) => r.hint)).toEqual([
        'Comes from the SFC form',
        'Comes from the SFC form',
      ]);
    });
  });

  describe('rows C-K', () => {
    it('count this proposal over the State total, with Not applicable for disabled criteria', async () => {
      const { data } = await service.getDocument(claimLetterId, stateUser);
      const byKey = Object.fromEntries(data!.letter.compliance.map((r) => [r.key, r.status.map(text)]));

      expect(byKey['C.']).toEqual([
        '2/4 (50%)',
        '',
        'Out of the total 2 ULBs in this proposal, 1 ULB falls within areas covered under the Sixth Schedule of the Constitution and is exempt from this condition.',
      ]);
      expect(byKey['D.']).toEqual(['2/4 (50%)']);
      expect(byKey['E.']).toEqual(['Not applicable']);
      expect(byKey['G.']).toEqual(['1/4 (25%)']);
      expect(byKey['H.']).toEqual(['2/4 (50%)']);
      expect(byKey['J.']).toEqual(['1/4 (25%)', '(list of ineligible ULBs has been attached for record)']);
      expect(byKey['K.']).toEqual(['2/4 (50%)', '(list of eligible ULBs may be perused)']);
      expect(data!.counts).toMatchObject({ stateUlbTotal: 4, proposalUlbs: 2, ineligibleStateWide: 1 });
    });

    it('row J prints Nil without the list line when no ULB is ineligible', async () => {
      const result = (await eligibility.resolveUlbLevelEligibility()) as { perUlbEligible: Map<string, boolean> };
      result.perUlbEligible.set(ulbC, true);
      eligibility.resolveUlbLevelEligibility.mockResolvedValue(result);

      const { data } = await service.getDocument(claimLetterId, stateUser);
      const rowJ = data!.letter.compliance.find((r) => r.key === 'J.')!;
      expect(rowJ.status.map(text)).toEqual(['Nil']);
      expect(data!.annexure.lists[1].total).toBe(0);
    });
  });

  describe('annexure', () => {
    it('orders columns by criterion with the unit on amount headers', async () => {
      const { data } = await service.getDocument(claimLetterId, stateUser);
      expect(data!.annexure.columns).toEqual([
        { header: 'S. No.', kind: 'serial' },
        { header: 'ULB Name', kind: 'name' },
        { header: 'Election Status', kind: 'value' },
        { header: 'Audited Accounts submitted', kind: 'yesNo' },
        { header: '28 SLB published', kind: 'yesNo' },
        { header: '14th FC & previous FC unspent balance (₹ lakh)', kind: 'amount' },
        { header: 'Tied grant Allocation (₹ lakh)', kind: 'amount' },
        { header: 'Untied grant allocation (₹ lakh)', kind: 'amount' },
      ]);
    });

    it('lists this proposal A-Z and State-wide ineligible ULBs with the cell rules applied', async () => {
      const eligible = await service.getDocumentUlbs(claimLetterId, 'ELIGIBLE', 1, stateUser);
      const ineligible = await service.getDocumentUlbs(claimLetterId, 'INELIGIBLE', 1, stateUser);

      expect(eligible.data!.map((r) => r.cells)).toEqual([
        ['1', 'ULB A', '6th Schedule', 'Yes', 'Yes', '3.25', '617.28', '617.28'],
        ['2', 'ULB B', 'Constituted', 'Exemption requested', 'Yes', 'Nil (Exemption requested)', '22.84', '22.84'],
      ]);
      expect(ineligible.data!.map((r) => r.cells)).toEqual([
        ['1', 'ULB C', 'Constituted (pending review)', 'Yes', 'No', '18.50', '-', '-'],
      ]);
      expect(ineligible.meta).toEqual({ page: 1, limit: 20, total: 1 });
    });

    describe('preview cache', () => {
      const base = `claimLetterDocument:test:${claimLetterId}:3`;
      let store: Map<string, string>;

      beforeEach(() => {
        store = new Map();
        redis.set.mockImplementation((key: string, value: string) => {
          store.set(key, value);
          return Promise.resolve();
        });
        redis.get.mockImplementation((key: string) => Promise.resolve(store.get(key) ?? null));
      });

      const keysRead = () => (redis.get.mock.calls as [string][]).map(([key]) => key);

      it('stores the meta and the row chunks for the revision, the chunks outliving the meta', async () => {
        await service.getDocument(claimLetterId, stateUser);

        expect((redis.set.mock.calls as [string, string, number][]).map(([key, , ttl]) => [key, ttl])).toEqual([
          [`${base}:ELIGIBLE:0`, 330],
          [`${base}:INELIGIBLE:0`, 330],
          [`${base}:meta`, 300],
        ]);
        expect(JSON.parse(store.get(`${base}:meta`)!)).not.toHaveProperty('rowsByList');
      });

      it('answers a warm page from the meta and one chunk, without evaluating again', async () => {
        await service.getDocument(claimLetterId, stateUser);
        eligibility.resolveUlbLevelEligibility.mockClear();
        redis.get.mockClear();

        const page = await service.getDocumentUlbs(claimLetterId, 'ELIGIBLE', 1, stateUser);

        expect(eligibility.resolveUlbLevelEligibility).not.toHaveBeenCalled();
        expect(keysRead()).toEqual([`${base}:meta`, `${base}:ELIGIBLE:0`]);
        expect(page.data).toHaveLength(2);
        expect(page.meta).toEqual({ page: 1, limit: 20, total: 2 });
      });

      it('opens the letter from the meta alone on a warm cache', async () => {
        await service.getDocument(claimLetterId, stateUser);
        redis.get.mockClear();

        await service.getDocument(claimLetterId, stateUser);

        expect(keysRead()).toEqual([`${base}:meta`]);
      });

      it('finds a page inside its chunk, and returns an empty page past the end', async () => {
        const rows = (from: number, n: number) => Array.from({ length: n }, (_, i) => ({ cells: [String(from + i)] }));
        const firstCells = (data: { cells: string[] }[] | undefined) => data!.map((r) => r.cells[0]);
        store.set(`${base}:meta`, JSON.stringify({ lists: [{ key: 'INELIGIBLE', total: 250 }] }));
        store.set(`${base}:INELIGIBLE:0`, JSON.stringify(rows(1, 100)));
        store.set(`${base}:INELIGIBLE:1`, JSON.stringify(rows(101, 100)));
        store.set(`${base}:INELIGIBLE:2`, JSON.stringify(rows(201, 50)));

        const page3 = await service.getDocumentUlbs(claimLetterId, 'INELIGIBLE', 3, stateUser);
        const page6 = await service.getDocumentUlbs(claimLetterId, 'INELIGIBLE', 6, stateUser);
        const page14 = await service.getDocumentUlbs(claimLetterId, 'INELIGIBLE', 14, stateUser);

        expect(firstCells(page3.data)).toEqual(firstCells(rows(41, 20)));
        expect(firstCells(page6.data)).toEqual(firstCells(rows(101, 20)));
        expect(page14.data).toEqual([]);
        expect(page14.meta).toEqual({ page: 14, limit: 20, total: 250 });
        expect(eligibility.resolveUlbLevelEligibility).not.toHaveBeenCalled();
      });

      it('shares one build between concurrent first requests', async () => {
        await service.getDocument(claimLetterId, stateUser);
        const callsPerBuild = eligibility.resolveUlbLevelEligibility.mock.calls.length;
        store.clear();
        eligibility.resolveUlbLevelEligibility.mockClear();

        await Promise.all([
          service.getDocument(claimLetterId, stateUser),
          service.getDocumentUlbs(claimLetterId, 'ELIGIBLE', 1, stateUser),
          service.getDocumentUlbs(claimLetterId, 'INELIGIBLE', 1, stateUser),
        ]);

        expect(eligibility.resolveUlbLevelEligibility).toHaveBeenCalledTimes(callsPerBuild);
      });
    });

    it('buildFullDocument always evaluates fresh and carries every row', async () => {
      redis.get.mockResolvedValue('{"stale":true}');
      const full = await service.buildFullDocument(parent as never);

      expect(redis.get).not.toHaveBeenCalled();
      expect(full.rowsByList.ELIGIBLE).toHaveLength(2);
      expect(full.rowsByList.INELIGIBLE).toHaveLength(1);
    });
  });

  describe('access', () => {
    it('404s for an unknown or non-READY claim letter', async () => {
      batchModel.findOne.mockReturnValue(q(null));
      await expect(service.getDocument(claimLetterId, stateUser)).rejects.toThrow(NotFoundException);
    });

    it('blocks every document endpoint while another batch is the active one', async () => {
      activeBatch.assertActive.mockRejectedValue(new ConflictException('Batch 1 is still in progress'));
      await expect(service.getDocument(claimLetterId, stateUser)).rejects.toThrow(ConflictException);
      await expect(service.getDocumentUlbs(claimLetterId, 'ELIGIBLE', 1, stateUser)).rejects.toThrow(ConflictException);
      await expect(service.loadParent(claimLetterId, stateUser)).rejects.toThrow(ConflictException);
    });

    it("forbids another State's user", async () => {
      const other = { ...stateUser, state: new Types.ObjectId().toString() } as AuthUser;
      await expect(service.getDocument(claimLetterId, other)).rejects.toThrow(ForbiddenException);
    });
  });
});
