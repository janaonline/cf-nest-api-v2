import { Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { MohuaOverviewUlbProgressService } from './mohua-overview-ulb-progress.service';

/** Mongoose-style query chain: find().select().lean().exec() resolving to `docs`. */
const query = <T>(docs: T[]) => ({
  find: jest.fn().mockReturnValue({
    select: () => ({ lean: () => ({ exec: () => Promise.resolve(docs) }) }),
  }),
});

describe('MohuaOverviewUlbProgressService.loadFullySubmittedUlbIds', () => {
  const yearId = new Types.ObjectId().toString();
  const ulbA = new Types.ObjectId();
  const ulbB = new Types.ObjectId();
  const { UNDER_REVIEW_BY_STATE, UNDER_REVIEW_BY_MOHUA, IN_PROGRESS, APPROVED_BY_STATE } = FORM_STATUS;

  const build = (opts: {
    annual: { ulb: Types.ObjectId; sectionType: string; form_status_id: number }[];
    dur: { ulb: Types.ObjectId; currentFormStatus: number }[];
    slb: { ulb: Types.ObjectId; currentFormStatus: number }[];
    bank: { ulb: Types.ObjectId; currentFormStatus: number }[];
  }) =>
    new MohuaOverviewUlbProgressService(
      query(opts.annual) as never,
      query(opts.dur) as never,
      query(opts.slb) as never,
      query(opts.bank) as never,
    );

  it('counts a ULB only when all five forms are submitted to the State or beyond', async () => {
    const service = build({
      annual: [
        { ulb: ulbA, sectionType: 'audited', form_status_id: UNDER_REVIEW_BY_STATE },
        { ulb: ulbA, sectionType: 'unaudited', form_status_id: UNDER_REVIEW_BY_MOHUA },
        { ulb: ulbB, sectionType: 'audited', form_status_id: UNDER_REVIEW_BY_STATE },
        { ulb: ulbB, sectionType: 'unaudited', form_status_id: IN_PROGRESS },
      ],
      dur: [
        { ulb: ulbA, currentFormStatus: UNDER_REVIEW_BY_STATE },
        { ulb: ulbB, currentFormStatus: UNDER_REVIEW_BY_STATE },
      ],
      slb: [
        { ulb: ulbA, currentFormStatus: APPROVED_BY_STATE },
        { ulb: ulbB, currentFormStatus: APPROVED_BY_STATE },
      ],
      bank: [
        { ulb: ulbA, currentFormStatus: UNDER_REVIEW_BY_STATE },
        { ulb: ulbB, currentFormStatus: UNDER_REVIEW_BY_STATE },
      ],
    });

    const done = await service.loadFullySubmittedUlbIds(yearId);

    expect([...done]).toEqual([String(ulbA)]);
  });

  it('counts SLB only at Approved by State (8), not at an earlier status', async () => {
    const service = build({
      annual: [
        { ulb: ulbA, sectionType: 'audited', form_status_id: UNDER_REVIEW_BY_STATE },
        { ulb: ulbA, sectionType: 'unaudited', form_status_id: UNDER_REVIEW_BY_STATE },
      ],
      dur: [{ ulb: ulbA, currentFormStatus: UNDER_REVIEW_BY_STATE }],
      slb: [{ ulb: ulbA, currentFormStatus: UNDER_REVIEW_BY_STATE }],
      bank: [{ ulb: ulbA, currentFormStatus: UNDER_REVIEW_BY_STATE }],
    });

    expect((await service.loadFullySubmittedUlbIds(yearId)).size).toBe(0);
  });

  it('does not count a ULB that is missing one of the forms entirely', async () => {
    const service = build({
      annual: [
        { ulb: ulbA, sectionType: 'audited', form_status_id: UNDER_REVIEW_BY_STATE },
        { ulb: ulbA, sectionType: 'unaudited', form_status_id: UNDER_REVIEW_BY_STATE },
      ],
      dur: [{ ulb: ulbA, currentFormStatus: UNDER_REVIEW_BY_STATE }],
      slb: [{ ulb: ulbA, currentFormStatus: APPROVED_BY_STATE }],
      bank: [],
    });

    expect((await service.loadFullySubmittedUlbIds(yearId)).size).toBe(0);
  });

  describe("scoping to a state's ULBs", () => {
    /** A model stub that records the filter of every `find` call. */
    const queryWithSpy = <T>(docs: T[]) => {
      const filters: Record<string, unknown>[] = [];
      const find = jest.fn((filter: Record<string, unknown>) => {
        filters.push(filter);
        return { select: () => ({ lean: () => ({ exec: () => Promise.resolve(docs) }) }) };
      });
      return { find, filters };
    };

    it('reads only the given ULBs from all four collections, and the whole year when none are given', async () => {
      const annual = queryWithSpy<never>([]);
      const dur = queryWithSpy<never>([]);
      const slb = queryWithSpy<never>([]);
      const bank = queryWithSpy<never>([]);
      const service = new MohuaOverviewUlbProgressService(annual as never, dur as never, slb as never, bank as never);

      await service.loadSubmittedUlbIdsByForm(yearId, [ulbA.toString()]);

      for (const model of [annual, dur, slb, bank]) {
        expect(model.find).toHaveBeenCalledWith(expect.objectContaining({ ulb: { $in: [ulbA] } }));
      }

      await service.loadSubmittedUlbIdsByForm(yearId);

      for (const model of [annual, dur, slb, bank]) {
        expect(model.filters.at(-1)).not.toHaveProperty('ulb');
      }
    });
  });
});
