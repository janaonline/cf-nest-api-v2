import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { StateFormHistoryForm } from './state-form-history.constants';
import { StateFormHistoryService } from './state-form-history.service';

const stateId = new Types.ObjectId().toString();
const yearId = new Types.ObjectId().toString();

const user = (scope: Scope) => ({ scope }) as unknown as AuthUser;

/** Chainable stand-in for `model.find().select().sort().limit().lean()`. */
function historyModel(rows: unknown[]) {
  const chain = { select: jest.fn(), sort: jest.fn(), limit: jest.fn(), lean: jest.fn().mockResolvedValue(rows) };
  chain.select.mockReturnValue(chain);
  chain.sort.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  return { find: jest.fn().mockReturnValue(chain), chain };
}

describe('StateFormHistoryService', () => {
  const build = (rows: unknown[] = [], devolutionFormId: Types.ObjectId | null = null) => {
    const gtc = historyModel(rows);
    const devolutionHistory = historyModel(rows);
    const devolutionForm = {
      findOne: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          lean: jest.fn().mockResolvedValue(devolutionFormId ? { _id: devolutionFormId } : null),
        }),
      }),
    };
    const other = historyModel(rows);
    const service = new StateFormHistoryService(
      other as never,
      gtc as never,
      devolutionHistory as never,
      devolutionForm as never,
      other as never,
      other as never,
    );
    return { service, gtc, devolutionHistory, devolutionForm, other };
  };

  it('rejects users that are neither PMU, MoHUA nor admin', async () => {
    const { service } = build();
    await expect(
      service.getHistory(StateFormHistoryForm.SFC_STATUS, stateId, yearId, undefined, user(Scope.STATE)),
    ).rejects.toThrow(ForbiddenException);
  });

  it('requires an installment for installment-scoped forms', async () => {
    const { service } = build();
    await expect(
      service.getHistory(StateFormHistoryForm.GTC, stateId, yearId, undefined, user(Scope.PMU)),
    ).rejects.toThrow();
  });

  it('returns newest-first entries with ISO UTC time and no sensitive fields; remarks only on returned entries', async () => {
    const rows = [
      {
        _id: new Types.ObjectId(),
        fromStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU,
        toStatus: FORM_STATUS.RETURNED_BY_PMU,
        changedAt: new Date('2026-09-16T05:35:00Z'),
        remarks: ' Fix row 3 ',
        changedBy: new Types.ObjectId(),
        ip: '1.2.3.4',
      },
      {
        _id: new Types.ObjectId(),
        fromStatus: FORM_STATUS.IN_PROGRESS,
        toStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU,
        changedAt: new Date('2026-09-14T09:45:00Z'),
        remarks: 'should not leak',
      },
    ];
    const { service, gtc } = build(rows);

    const res = await service.getHistory(StateFormHistoryForm.GTC, stateId, yearId, 2, user(Scope.MOHUA));

    expect(gtc.find).toHaveBeenCalledWith({
      state: expect.any(Types.ObjectId),
      year: expect.any(Types.ObjectId),
      installment: 2,
    });
    expect(gtc.chain.sort).toHaveBeenCalledWith({ changedAt: -1, _id: -1 });
    const [first, second] = res.data!.entries;
    expect(first).toMatchObject({
      toStatusLabel: 'Returned by PMU',
      actorRole: 'PMU',
      changedAt: '2026-09-16T05:35:00.000Z',
      remarks: 'Fix row 3',
    });
    expect(second.remarks).toBeUndefined();
    expect(JSON.stringify(res.data)).not.toMatch(/1\.2\.3\.4|changedBy/);
  });

  describe('paging', () => {
    const row = (iso: string) => ({
      _id: new Types.ObjectId(),
      fromStatus: FORM_STATUS.IN_PROGRESS,
      toStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU,
      changedAt: new Date(iso),
    });

    it('asks for one extra row, returns a page, and a cursor to the last returned entry when more exist', async () => {
      const rows = [row('2026-09-03T00:00:00Z'), row('2026-09-02T00:00:00Z'), row('2026-09-01T00:00:00Z')];
      const { service, other } = build(rows);

      const res = await service.getHistory(
        StateFormHistoryForm.SFC_STATUS,
        stateId,
        yearId,
        undefined,
        user(Scope.PMU),
        {
          limit: 2,
        },
      );

      expect(other.chain.limit).toHaveBeenCalledWith(3);
      expect(res.data!.entries).toHaveLength(2);
      expect(res.data!.hasMore).toBe(true);
      expect(res.data!.nextCursor).toBe(`2026-09-02T00:00:00.000Z_${rows[1]._id.toString()}`);
    });

    it('reports no further page when fewer rows than the page size come back', async () => {
      const { service } = build([row('2026-09-01T00:00:00Z')]);
      const res = await service.getHistory(
        StateFormHistoryForm.SFC_STATUS,
        stateId,
        yearId,
        undefined,
        user(Scope.PMU),
      );
      expect(res.data).toMatchObject({ hasMore: false, nextCursor: null });
    });

    it('defaults to 20 and can never exceed the 50 ceiling, even if the DTO is bypassed', async () => {
      const defaults = build([]);
      await defaults.service.getHistory(StateFormHistoryForm.SFC_STATUS, stateId, yearId, undefined, user(Scope.PMU));
      expect(defaults.other.chain.limit).toHaveBeenCalledWith(21);

      const greedy = build([]);
      await greedy.service.getHistory(StateFormHistoryForm.SFC_STATUS, stateId, yearId, undefined, user(Scope.PMU), {
        limit: 10_000,
      });
      expect(greedy.other.chain.limit).toHaveBeenCalledWith(51);
    });

    it('applies the cursor as "strictly older than" (earlier time, or same time with a smaller id)', async () => {
      const { service, other } = build([]);
      const id = new Types.ObjectId();
      await service.getHistory(StateFormHistoryForm.SFC_STATUS, stateId, yearId, undefined, user(Scope.PMU), {
        cursor: `2026-09-02T00:00:00.000Z_${id.toString()}`,
      });

      const at = new Date('2026-09-02T00:00:00.000Z');
      expect(other.find).toHaveBeenCalledWith({
        $and: [
          { state: expect.any(Types.ObjectId), year: expect.any(Types.ObjectId) },
          { $or: [{ changedAt: { $lt: at } }, { changedAt: at, _id: { $lt: id } }] },
        ],
      });
    });

    it('rejects a malformed cursor', async () => {
      const { service } = build([]);
      await expect(
        service.getHistory(StateFormHistoryForm.SFC_STATUS, stateId, yearId, undefined, user(Scope.PMU), {
          cursor: 'garbage',
        }),
      ).rejects.toThrow();
    });
  });

  it('resolves Devolution history through the per-installment form document, and returns empty when none exists', async () => {
    const formId = new Types.ObjectId();
    const withForm = build([], formId);
    await withForm.service.getHistory(StateFormHistoryForm.DEVOLUTION_FORMULA, stateId, yearId, 1, user(Scope.PMU));
    expect(withForm.devolutionHistory.find).toHaveBeenCalledWith({ devolutionFormulaForm: formId });

    const withoutForm = build([], null);
    const res = await withoutForm.service.getHistory(
      StateFormHistoryForm.DEVOLUTION_FORMULA,
      stateId,
      yearId,
      1,
      user(Scope.PMU),
    );
    expect(res.data!.entries).toEqual([]);
    expect(withoutForm.devolutionHistory.find).not.toHaveBeenCalled();
  });
});
