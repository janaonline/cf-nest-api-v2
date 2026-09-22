import { DurService } from './dur.service';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import type { AuthUser } from 'src/module/auth/auth-user.interface';

/** Mimics a Mongoose query chain — `.select()`/`.lean()` are no-ops, `.exec()` resolves the value. */
function mockQuery<T>(result: T) {
  const query: Record<string, unknown> = { exec: () => Promise.resolve(result) };
  query.select = () => query;
  query.lean = () => query;
  query.sort = () => query;
  return query;
}

describe('DurService', () => {
  let service: DurService;
  let mockDurModel: { findById: jest.Mock; findByIdAndUpdate: jest.Mock };
  let mockFormLogModel: { create: jest.Mock; find: jest.Mock };
  let mockUlbModel: { findById: jest.Mock; aggregate: jest.Mock };
  let mockUserModel: { findById: jest.Mock };
  let mockFormJsonService: { findActiveByDesignYearAndFormId: jest.Mock };
  let mockFormReturnedNotification: { notifyReturned: jest.Mock };

  const ulbId = '507f1f77bcf86cd799439001';
  const stateId = '507f1f77bcf86cd799439002';
  const durId = '507f1f77bcf86cd799439011';
  const designYearId = '507f1f77bcf86cd799439099';

  const stateUser: AuthUser = {
    _id: '507f1f77bcf86cd799439091',
    role: 'STATE',
    scope: Scope.STATE,
    state: stateId,
    xviFcSubrole: 'admin',
  } as AuthUser;
  const adminUser: AuthUser = {
    _id: '507f1f77bcf86cd799439092',
    role: 'ADMIN',
    scope: Scope.ADMIN,
  } as AuthUser;

  const baseDur = {
    _id: durId,
    ulb: ulbId,
    design_year: designYearId,
    currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE,
    currentFormStatusLabel: 'Under Review By State',
  };

  beforeEach(() => {
    mockDurModel = { findById: jest.fn(), findByIdAndUpdate: jest.fn() };
    mockFormLogModel = { create: jest.fn().mockResolvedValue(undefined), find: jest.fn().mockReturnValue(mockQuery([])) };
    mockUlbModel = {
      findById: jest.fn().mockReturnValue(mockQuery({ state: stateId })),
      aggregate: jest.fn().mockReturnValue({ exec: () => Promise.resolve([{ data: [], totalCount: [], counts: [] }]) }),
    };
    mockUserModel = { findById: jest.fn().mockReturnValue(mockQuery({ name: 'Reviewer' })) };
    mockFormJsonService = { findActiveByDesignYearAndFormId: jest.fn() };
    mockFormReturnedNotification = { notifyReturned: jest.fn().mockResolvedValue(undefined) };

    service = new DurService(
      mockDurModel as any,
      mockFormLogModel as any,
      mockUlbModel as any,
      mockUserModel as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      mockFormJsonService as any,
      mockFormReturnedNotification as any,
      { signFileUrl: jest.fn().mockReturnValue('https://signed.example.com/file.pdf') } as any,
    );
  });

  describe('getFormConfig', () => {
    it('fetches formId 36 for the given year and returns its meta/data', async () => {
      mockFormJsonService.findActiveByDesignYearAndFormId.mockResolvedValue({
        meta: { note: 'DUR' },
        data: [{ key: 'tiedGrant', label: 'Tied Grant' }],
      });

      const result = await service.getFormConfig('year-1');

      expect(mockFormJsonService.findActiveByDesignYearAndFormId).toHaveBeenCalledWith('year-1', 36);
      expect(result).toEqual({ meta: { note: 'DUR' }, data: [{ key: 'tiedGrant', label: 'Tied Grant' }] });
    });

    it('defaults meta/data to empty when the formjson document omits them', async () => {
      mockFormJsonService.findActiveByDesignYearAndFormId.mockResolvedValue({});

      const result = await service.getFormConfig('year-1');

      expect(result).toEqual({ meta: {}, data: [] });
    });
  });

  describe('decideDur', () => {
    it('rejects non-STATE/ADMIN users', async () => {
      mockDurModel.findById.mockReturnValue(mockQuery(baseDur));
      const ulbUser = { _id: 'u1', role: 'ULB', scope: Scope.ULB } as AuthUser;

      await expect(service.decideDur(durId, { decision: 'APPROVED' }, ulbUser)).rejects.toThrow(
        'Only STATE or ADMIN users may decide DUR forms',
      );
    });

    it('rejects when the STATE user is in a different state than the ULB', async () => {
      mockDurModel.findById.mockReturnValue(mockQuery(baseDur));
      mockUlbModel.findById.mockReturnValue(mockQuery({ state: 'other-state' }));

      await expect(service.decideDur(durId, { decision: 'APPROVED' }, stateUser)).rejects.toThrow(
        'You can only decide DUR forms within your own state',
      );
    });

    it('rejects deciding a form that is not UNDER_REVIEW_BY_STATE', async () => {
      mockDurModel.findById.mockReturnValue(mockQuery({ ...baseDur, currentFormStatus: FORM_STATUS.NOT_STARTED }));

      await expect(service.decideDur(durId, { decision: 'APPROVED' }, stateUser)).rejects.toThrow(
        'This form cannot be decided while its status is',
      );
    });

    it('approves the form, writes stateDecision + log, and sends no return notification', async () => {
      mockDurModel.findById.mockReturnValue(mockQuery(baseDur));
      mockDurModel.findByIdAndUpdate.mockReturnValue(
        mockQuery({ _id: durId, currentFormStatus: FORM_STATUS.APPROVED_BY_STATE, currentFormStatusLabel: 'Approved By State' }),
      );

      const result = await service.decideDur(durId, { decision: 'APPROVED' }, stateUser);

      expect(mockDurModel.findByIdAndUpdate).toHaveBeenCalledWith(
        durId,
        expect.objectContaining({
          $set: expect.objectContaining({ currentFormStatus: FORM_STATUS.APPROVED_BY_STATE }),
        }),
        { new: true },
      );
      expect(mockFormLogModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'APPROVED', toStatus: FORM_STATUS.APPROVED_BY_STATE }),
      );
      expect(mockFormReturnedNotification.notifyReturned).not.toHaveBeenCalled();
      expect(result.data.currentFormStatus).toBe(FORM_STATUS.APPROVED_BY_STATE);
    });

    it('returns the form and fires the return notification', async () => {
      mockDurModel.findById.mockReturnValue(mockQuery(baseDur));
      mockDurModel.findByIdAndUpdate.mockReturnValue(
        mockQuery({ _id: durId, currentFormStatus: FORM_STATUS.RETURNED_BY_STATE, currentFormStatusLabel: 'Returned By State' }),
      );

      await service.decideDur(durId, { decision: 'RETURNED', note: 'Please fix the tied grant document.' }, stateUser);

      expect(mockFormReturnedNotification.notifyReturned).toHaveBeenCalledWith(
        expect.objectContaining({ formName: 'Detailed Utilisation Report', note: 'Please fix the tied grant document.' }),
      );
    });
  });

  describe('undoDurApproval', () => {
    it('rejects undo when the form is not APPROVED_BY_STATE', async () => {
      mockDurModel.findById.mockReturnValue(mockQuery({ ...baseDur, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE }));

      await expect(service.undoDurApproval(durId, stateUser)).rejects.toThrow(
        "This form's approval cannot be undone while its status is",
      );
    });

    it('resets the form to UNDER_REVIEW_BY_STATE, clears stateDecision, and writes two log entries', async () => {
      mockDurModel.findById.mockReturnValue(mockQuery({ ...baseDur, currentFormStatus: FORM_STATUS.APPROVED_BY_STATE }));
      mockDurModel.findByIdAndUpdate.mockReturnValue(
        mockQuery({ _id: durId, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE, currentFormStatusLabel: 'Under Review By State' }),
      );

      await service.undoDurApproval(durId, stateUser);

      expect(mockDurModel.findByIdAndUpdate).toHaveBeenCalledWith(
        durId,
        expect.objectContaining({ $set: expect.objectContaining({ stateDecision: null, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE }) }),
        { new: true },
      );
      expect(mockFormLogModel.create).toHaveBeenCalledTimes(2);
      expect(mockFormLogModel.create).toHaveBeenNthCalledWith(1, expect.objectContaining({ toStatus: FORM_STATUS.UNDO }));
      expect(mockFormLogModel.create).toHaveBeenNthCalledWith(2, expect.objectContaining({ toStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE }));
    });
  });

  describe('bulkDecideDur', () => {
    it('decides each id independently and tallies success/failure', async () => {
      mockDurModel.findById
        .mockReturnValueOnce(mockQuery(baseDur))
        .mockReturnValueOnce(mockQuery(null));
      mockDurModel.findByIdAndUpdate.mockReturnValue(
        mockQuery({ _id: durId, currentFormStatus: FORM_STATUS.APPROVED_BY_STATE, currentFormStatusLabel: 'Approved By State' }),
      );

      const idA = '507f1f77bcf86cd799439021';
      const idB = '507f1f77bcf86cd799439022';
      const result = await service.bulkDecideDur({ decision: 'APPROVED', ids: [idA, idB] }, adminUser);

      expect(result.data.total).toBe(2);
      expect(result.data.succeeded).toBe(1);
      expect(result.data.failed).toBe(1);
      expect(result.data.results[1]).toMatchObject({ id: idB, success: false });
    });
  });

  describe('listUlbSubmissions', () => {
    it('rejects non-STATE/ADMIN users', async () => {
      const ulbUser = { _id: 'u1', role: 'ULB', scope: Scope.ULB } as AuthUser;
      await expect(service.listUlbSubmissions({ designYearId: 'year-1', page: 1, pageSize: 20 }, ulbUser)).rejects.toThrow(
        'Only STATE or ADMIN users may list ULB submissions',
      );
    });

    it('returns rows/total/counts from the aggregation', async () => {
      const row = {
        ulbId: 'ulb-1',
        ulbCode: 'C1',
        censusCode: 'CN1',
        ulbName: 'Test ULB',
        formStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE,
        lastUpdatedAt: null,
        enteredReviewAt: null,
        durId: durId,
      };
      mockUlbModel.aggregate.mockReturnValue({
        exec: () => Promise.resolve([{ data: [row], totalCount: [{ count: 1 }], counts: [] }]),
      });

      const result = await service.listUlbSubmissions({ designYearId, page: 1, pageSize: 20 }, stateUser);

      expect(result.data.total).toBe(1);
      expect(result.data.rows).toEqual([row]);
    });
  });

  describe('getDurFormLogs', () => {
    it('rejects an invalid id', async () => {
      await expect(service.getDurFormLogs('not-an-id', stateUser)).rejects.toThrow('Invalid DUR id.');
    });

    it('returns the mapped log history for a valid id', async () => {
      mockDurModel.findById.mockReturnValue(mockQuery({ ulb: ulbId }));
      mockFormLogModel.find.mockReturnValue(
        mockQuery([
          {
            action: 'SUBMITTED',
            toStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE,
            toStatusLabel: 'Under Review By State',
            actorStage: 'ULB',
            userInfo: { role: 'ULB' },
            note: undefined,
            batchId: undefined,
            createdAt: new Date('2026-01-01'),
          },
        ]),
      );

      const result = await service.getDurFormLogs('507f1f77bcf86cd799439011', stateUser);

      expect(result.data).toEqual([
        expect.objectContaining({ action: 'SUBMITTED', actorRole: 'ULB', note: null, batchId: null }),
      ]);
    });
  });
});
