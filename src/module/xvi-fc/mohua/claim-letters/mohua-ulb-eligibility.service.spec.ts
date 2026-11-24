import { NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { ClaimLetterCriterionDetail } from 'src/module/xvi-fc/state/claim-letter/services/eligibility/claim-letter-eligibility.service';
import type {
  FormEligibilityEvidence,
  RowEligibilityEvidence,
  UlbEligibilityBucket,
} from 'src/module/xvi-fc/common/types/claim-eligibility.type';
import { MohuaUlbEligibilityService } from './mohua-ulb-eligibility.service';
import type { MohuaUlbEligibilityBuild } from './mohua-claim-letters.types';

const STATE = new Types.ObjectId().toString();
const YEAR = new Types.ObjectId().toString();
const LETTER_1 = new Types.ObjectId();
const LETTER_3 = new Types.ObjectId();

const [U1, U2, U3, U4] = ['a', 'b', 'c', 'd'].map((c) => c.repeat(24));

const ULBS = [
  { ulbId: U1, name: 'Agra (East)', censusCode: '802001', sbCode: null },
  { ulbId: U2, name: 'Etah', censusCode: '802010', sbCode: 'SB10' },
  { ulbId: U3, name: 'Hapur', censusCode: '802020', sbCode: null },
  // Mau has no census code, so its SB code is the one shown and searched.
  { ulbId: U4, name: 'Mau', censusCode: null, sbCode: 'SB33' },
];

/** Agra and Hapur filed audited accounts, Etah has it in progress, Mau has no document. */
const AUDITED_EVIDENCE: Record<string, [UlbEligibilityBucket, number | null]> = {
  [U1]: ['ELIGIBLE', FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA],
  [U2]: ['INELIGIBLE', FORM_STATUS.IN_PROGRESS],
  [U3]: ['ELIGIBLE', FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA],
  [U4]: ['INELIGIBLE', null],
};

function formEvidence(entries: Record<string, [UlbEligibilityBucket, number | null]>) {
  return new Map<string, FormEligibilityEvidence>(
    Object.entries(entries).map(([ulbId, [bucket, status]]) => [
      ulbId,
      {
        bucket,
        formDocumentId: status === null ? null : `doc-${ulbId}`,
        statusAtEvaluation: status as never,
        exemptionId: null,
        exemptionStatus: null,
        exemptionKind: null,
      },
    ]),
  );
}

function criterion(overrides: Partial<ClaimLetterCriterionDetail>): ClaimLetterCriterionDetail {
  return {
    formId: 30,
    type: 'AUDITED',
    label: 'Audited accounts',
    letterColumnLabel: 'Audited',
    displayOrder: 1,
    formJsonId: 'fj',
    ruleVersion: 1,
    ownerLevel: 'ULB',
    evaluationLevel: 'FORM',
    acceptedFormStatuses: [FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA],
    buckets: new Map(),
    rowEvidence: new Map(),
    formEvidence: new Map(),
    discretionaryExemptions: new Map(),
    ...overrides,
  };
}

function criteria(audited = AUDITED_EVIDENCE): ClaimLetterCriterionDetail[] {
  const elected = new Map<string, RowEligibilityEvidence>(
    ULBS.map((u) => [
      u.ulbId,
      {
        bucket: 'ELIGIBLE',
        rowDocumentId: `row-${u.ulbId}`,
        rowStatusAtEvaluation: null,
        datasetVersion: 1,
        rowValue: 'Elected',
        rowAccepted: true,
        exemptionId: null,
        exemptionStatus: null,
        exemptionKind: null,
      },
    ]),
  );
  return [
    criterion({
      buckets: new Map(Object.entries(audited).map(([id, [bucket]]) => [id, bucket])),
      formEvidence: formEvidence(audited),
    }),
    criterion({
      formId: 23,
      type: 'ELECTED_BODY',
      label: 'Elected body',
      letterColumnLabel: 'Elected body',
      ownerLevel: 'STATE',
      evaluationLevel: 'FORM_AND_ROW',
      buckets: new Map(ULBS.map((u) => [u.ulbId, 'ELIGIBLE' as const])),
      rowEvidence: elected,
    }),
  ];
}

const chain = <T>(value: T) => {
  const q = { select: () => q, lean: () => q, exec: () => Promise.resolve(value) };
  return q;
};

describe('MohuaUlbEligibilityService', () => {
  let redisStore: Map<string, string>;
  let redis: { get: jest.Mock; set: jest.Mock };
  let eligibility: {
    evaluateStateLevelGate: jest.Mock;
    resolveDevolutionAllocations: jest.Mock;
    resolveUlbLevelEligibility: jest.Mock;
  };
  let lockModel: { find: jest.Mock };
  let batchModel: { find: jest.Mock };
  let unspentAmounts: Map<string, number>;
  let service: MohuaUlbEligibilityService;

  beforeEach(() => {
    unspentAmounts = new Map();
    redisStore = new Map();
    redis = {
      get: jest.fn((key: string) => Promise.resolve(redisStore.get(key) ?? null)),
      set: jest.fn((key: string, value: string) => {
        redisStore.set(key, value);
        return Promise.resolve('OK');
      }),
    };
    eligibility = {
      evaluateStateLevelGate: jest.fn().mockResolvedValue({ passed: true, sources: [] }),
      // Hapur has no allocation.
      resolveDevolutionAllocations: jest.fn().mockResolvedValue(
        new Map([
          [U1, { allocatedAmount: 2_000_000 }],
          [U2, { allocatedAmount: 1_000_000 }],
          [U4, { allocatedAmount: 600_000 }],
        ]),
      ),
      resolveUlbLevelEligibility: jest.fn().mockResolvedValue({ perCriterion: criteria() }),
    };
    // Agra is in Batch 1 under SO review; Hapur in a Batch 3 draft.
    lockModel = {
      find: jest.fn().mockReturnValue(
        chain([
          { ulbId: new Types.ObjectId(U1), claimLetter: LETTER_1 },
          { ulbId: new Types.ObjectId(U3), claimLetter: LETTER_3 },
        ]),
      ),
    };
    batchModel = {
      find: jest.fn().mockReturnValue(
        chain([
          { _id: LETTER_1, batchNumber: 1, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_SO },
          { _id: LETTER_3, batchNumber: 3, currentFormStatus: FORM_STATUS.IN_PROGRESS },
        ]),
      ),
    };
    service = new MohuaUlbEligibilityService(
      { findById: () => chain({ name: 'Uttar Pradesh' }) } as never,
      { findById: () => chain({ year: '2026-27' }) } as never,
      batchModel as never,
      lockModel as never,
      eligibility as never,
      { resolve: jest.fn().mockResolvedValue(ULBS) } as never,
      { resolveUnspentAmounts: jest.fn(() => Promise.resolve(unspentAmounts)) } as never,
      redis as never,
      { get: () => 'test' } as never,
    );
  });

  const get = (query = {}) => service.getUlbEligibility(STATE, YEAR, 1, query);

  it('refuses an installment other than 1', async () => {
    await expect(service.getUlbEligibility(STATE, YEAR, 2, {})).rejects.toThrow(NotFoundException);
  });

  it('builds on a cache miss, stores it for 15 minutes, and reads the cache next time', async () => {
    await get();
    expect(redis.set).toHaveBeenCalledWith(`mohuaUlbEligibility:test:${STATE}:${YEAR}:1`, expect.any(String), 900);
    await get();
    expect(eligibility.resolveUlbLevelEligibility).toHaveBeenCalledTimes(1);
  });

  it('ignores a refresh within a minute of the last check', async () => {
    await get();
    await get({ refresh: true });
    expect(eligibility.resolveUlbLevelEligibility).toHaveBeenCalledTimes(1);
  });

  it('rebuilds on refresh once the cached check is over a minute old', async () => {
    await get();
    const [key, value] = [...redisStore][0];
    const stale = {
      ...(JSON.parse(value) as MohuaUlbEligibilityBuild),
      asOn: new Date(Date.now() - 61_000).toISOString(),
    };
    redisStore.set(key, JSON.stringify(stale));
    await get({ refresh: true });
    expect(eligibility.resolveUlbLevelEligibility).toHaveBeenCalledTimes(2);
  });

  it('still answers when Redis cannot be read or written', async () => {
    redis.get.mockRejectedValue(new Error('Redis down'));
    redis.set.mockRejectedValue(new Error('Redis down'));
    expect((await get()).items).toHaveLength(4);
  });

  it('reads the holding letters live on every request', async () => {
    await get();
    await get();
    expect(lockModel.find).toHaveBeenCalledTimes(2);
  });

  it('reads only letters that still hold ULBs', async () => {
    await get();
    expect(batchModel.find).toHaveBeenCalledWith(
      expect.objectContaining({
        currentFormStatus: { $in: [2, 15, 5, 7] },
        isAbandoned: false,
      }),
    );
  });

  it('shows a ULB in no letter when its letter was returned between the two reads', async () => {
    // The lock query still saw Agra's lock; the letter query no longer finds its letter.
    batchModel.find.mockReturnValue(
      chain([{ _id: LETTER_3, batchNumber: 3, currentFormStatus: FORM_STATUS.IN_PROGRESS }]),
    );
    const result = await get();
    expect(result.items.find((r) => r.ulbId === U1)?.batch).toBeNull();
    expect(result.counts).toMatchObject({ inLetter: 1, notInLetter: 3 });
  });

  it('lists eligible ULBs first, then ineligible ones, each A to Z', async () => {
    // Agra now fails audited accounts and Mau passes it, so Mau (eligible) comes before Agra.
    eligibility.resolveUlbLevelEligibility.mockResolvedValue({
      perCriterion: criteria({
        ...AUDITED_EVIDENCE,
        [U1]: ['INELIGIBLE', FORM_STATUS.IN_PROGRESS],
        [U4]: ['ELIGIBLE', FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA],
      }),
    });
    const items = (await get()).items;
    expect(items.map((i) => [i.slNo, i.name, i.eligible])).toEqual([
      [1, 'Mau', true],
      [2, 'Agra (East)', false],
      [3, 'Etah', false],
      [4, 'Hapur', false],
    ]);
  });

  it('lists every ULB with the letter columns, status cells and batches', async () => {
    const result = await get();
    expect(result.stateName).toBe('Uttar Pradesh');
    expect(result.columns.map((c) => c.key)).toEqual(['AUDITED', 'ELECTED_BODY']);
    expect(result.items.map((i) => [i.name, i.cells, i.eligible])).toEqual([
      ['Agra (East)', ['Yes', 'Elected'], true],
      ['Etah', ['In Progress', 'Elected'], false],
      ['Hapur', ['Yes', 'Elected'], false],
      ['Mau', ['Not Started', 'Elected'], false],
    ]);
    expect(result.items[0].batch).toMatchObject({ batchNumber: 1, linkable: true });
    expect(result.items[2].batch).toMatchObject({ batchNumber: 3, statusLabel: 'Draft', linkable: false });
    expect(result.items[1].batch).toBeNull();
  });

  it('shows a form the SO returned as just "Returned"', async () => {
    eligibility.resolveUlbLevelEligibility.mockResolvedValue({
      perCriterion: criteria({ ...AUDITED_EVIDENCE, [U4]: ['INELIGIBLE', FORM_STATUS.RETURNED_BY_SO] }),
    });
    expect((await get()).items.find((i) => i.name === 'Mau')?.cells).toEqual(['Returned', 'Elected']);
  });

  it("uses the letter's column header without the unit the letter prints", async () => {
    eligibility.resolveUlbLevelEligibility.mockResolvedValue({
      perCriterion: [
        criterion({
          type: 'FC_UNSPENT_STATE',
          letterColumnLabel: '14th FC unspent balance',
          evaluationLevel: 'FORM_AND_ROW',
        }),
      ],
    });
    expect((await get()).columns).toEqual([
      { key: 'FC_UNSPENT_STATE', label: 'Audited accounts', header: '14th FC unspent balance', kind: 'amount' },
    ]);
  });

  it('sends the 14th FC unspent amount as Rupees, with only its exemption note as text', async () => {
    unspentAmounts = new Map([[U1, 1_212_000]]);
    eligibility.resolveUlbLevelEligibility.mockResolvedValue({
      perCriterion: [
        criterion({
          type: 'FC_UNSPENT_STATE',
          evaluationLevel: 'FORM_AND_ROW',
          discretionaryExemptions: new Map([[U2, FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA]]),
        }),
      ],
    });
    const items = (await get()).items;
    expect(items.map((i) => [i.name, i.amounts, i.cells])).toEqual([
      ['Agra (East)', [1_212_000], ['']],
      ['Etah', [0], ['Exempted']],
      ['Mau', [0], ['']],
      // Hapur has no allocation, so it is ineligible and listed after the eligible ULBs.
      ['Hapur', [0], ['']],
    ]);
  });

  it('marks a ULB with no allocation ineligible with NO_ALLOCATION and no amounts', async () => {
    const hapur = (await get()).items.find((i) => i.name === 'Hapur')!;
    expect(hapur.failedConditions).toEqual(['NO_ALLOCATION']);
    expect(hapur.tied).toBeNull();
  });

  it('counts an eligible ULB that no letter holds yet', async () => {
    lockModel.find.mockReturnValue(chain([]));
    expect((await get()).counts).toMatchObject({ inLetter: 0, eligibleNotInLetter: 1 });
  });

  it('counts the whole State before filters', async () => {
    const { counts } = await get({ eligibility: 'ELIGIBLE' });
    expect(counts).toMatchObject({
      total: 4,
      eligible: 1,
      ineligible: 3,
      inLetter: 2,
      notInLetter: 2,
      // Agra, the only eligible ULB, is in Batch 1.
      eligibleNotInLetter: 0,
    });
    expect(counts.batches).toEqual([
      { batchNumber: 1, count: 1 },
      { batchNumber: 3, count: 1 },
    ]);
  });

  it.each([
    [{ eligibility: 'INELIGIBLE' }, ['Etah', 'Hapur', 'Mau']],
    [{ batch: 'NONE' }, ['Etah', 'Mau']],
    [{ batch: '1' }, ['Agra (East)']],
    [{ letterStatus: FORM_STATUS.IN_PROGRESS }, ['Hapur']],
    [{ condition: 'AUDITED' }, ['Etah', 'Mau']],
    [{ condition: 'NO_ALLOCATION' }, ['Hapur']],
    [{ search: '802010' }, ['Etah']],
    [{ search: 'sb33' }, ['Mau']],
    // Etah's SB code is not shown (it has a census code), so it is not searched.
    [{ search: 'sb10' }, []],
  ])('filters by %o', async (query, names) => {
    expect((await get(query)).items.map((i) => i.name)).toEqual(names);
  });

  it('escapes regex characters in the search', async () => {
    expect((await get({ search: '(east' })).items.map((i) => i.name)).toEqual(['Agra (East)']);
    expect((await get({ search: 'a.b(' })).items).toEqual([]);
  });

  it('totals tied and untied over every filtered row, across pages', async () => {
    const result = await get({ eligibility: 'INELIGIBLE', limit: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.totals).toEqual({ tied: 800_000, untied: 800_000 });
  });

  it('clamps the page and numbers rows across pages', async () => {
    const result = await get({ page: 99, limit: 3 });
    expect(result.pagination).toEqual({ page: 2, limit: 3, total: 4, totalPages: 2 });
    expect(result.items.map((i) => i.slNo)).toEqual([4]);
  });

  it('names the failing State conditions', async () => {
    eligibility.evaluateStateLevelGate.mockResolvedValue({
      passed: false,
      sources: [
        {
          result: 'FAILED',
          displayLabel: 'SFC Status',
          formType: 'SFC',
          statusAtEvaluation: FORM_STATUS.RETURNED_BY_PMU,
        },
        { result: 'PASSED', displayLabel: 'GTC', formType: 'GTC', statusAtEvaluation: 5 },
      ],
    });
    expect((await get()).stateGate).toEqual({
      passed: false,
      failedConditions: [{ label: 'SFC Status', statusLabel: 'Returned by PMU' }],
    });
  });

  it('flags a State where no ULB has started its forms', async () => {
    expect((await get()).noneStarted).toBe(false);
    redisStore.clear();
    const none = Object.fromEntries(ULBS.map((u) => [u.ulbId, ['INELIGIBLE', null]])) as typeof AUDITED_EVIDENCE;
    eligibility.resolveUlbLevelEligibility.mockResolvedValue({ perCriterion: criteria(none) });
    expect((await get()).noneStarted).toBe(true);
  });

  it('keeps the cached build as plain JSON', async () => {
    await get();
    const cached = JSON.parse([...redisStore.values()][0]) as MohuaUlbEligibilityBuild;
    expect(cached.rows).toHaveLength(4);
    expect(cached.asOn).toEqual(expect.any(String));
  });
});
