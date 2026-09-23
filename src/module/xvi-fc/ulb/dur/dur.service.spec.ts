import { DurService } from './dur.service';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { DUR_FORM_ID } from './constants/dur-form.constants';

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
  let mockDurModel: {
    findById: jest.Mock;
    findByIdAndUpdate: jest.Mock;
    findOne: jest.Mock;
    findOneAndUpdate: jest.Mock;
    deleteOne: jest.Mock;
  };
  let mockFormLogModel: { create: jest.Mock; find: jest.Mock };
  let mockUlbModel: { findById: jest.Mock; find: jest.Mock; aggregate: jest.Mock };
  let mockYearModel: { findById: jest.Mock };
  let mockUserModel: { findById: jest.Mock };
  let mockFormJsonService: { findActiveByDesignYearAndFormId: jest.Mock };
  let mockFormReturnedNotification: { notifyReturned: jest.Mock };
  let mockYearAccessService: { isFormExempt: jest.Mock };
  let mockExemptionResolverService: { resolveBulk: jest.Mock };

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
    mockDurModel = {
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      findOne: jest.fn().mockReturnValue(mockQuery(null)),
      findOneAndUpdate: jest.fn().mockResolvedValue(undefined),
      deleteOne: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    };
    mockFormLogModel = { create: jest.fn().mockResolvedValue(undefined), find: jest.fn().mockReturnValue(mockQuery([])) };
    mockUlbModel = {
      findById: jest.fn().mockReturnValue(mockQuery({ state: stateId })),
      find: jest.fn().mockReturnValue(mockQuery([])),
      aggregate: jest.fn().mockReturnValue({ exec: () => Promise.resolve([{ data: [], totalCount: [], counts: [] }]) }),
    };
    mockYearModel = { findById: jest.fn().mockReturnValue(mockQuery({ _id: designYearId, year: '2026-27' })) };
    mockUserModel = { findById: jest.fn().mockReturnValue(mockQuery({ name: 'Reviewer' })) };
    mockFormJsonService = { findActiveByDesignYearAndFormId: jest.fn() };
    mockFormReturnedNotification = { notifyReturned: jest.fn().mockResolvedValue(undefined) };
    mockYearAccessService = { isFormExempt: jest.fn().mockResolvedValue(false) };
    mockExemptionResolverService = { resolveBulk: jest.fn().mockResolvedValue(new Map()) };

    service = new DurService(
      mockDurModel as any,
      mockFormLogModel as any,
      mockUlbModel as any,
      mockYearModel as any,
      mockUserModel as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      mockFormJsonService as any,
      mockFormReturnedNotification as any,
      { signFileUrl: jest.fn().mockReturnValue('https://signed.example.com/file.pdf') } as any,
      mockYearAccessService as any,
      mockExemptionResolverService as any,
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

  describe('findByUlbAndYear', () => {
    const stub = {
      _id: durId,
      ulb: ulbId,
      currentFormStatus: FORM_STATUS.EXEMPTED_ACKNOWLEDGED,
      currentFormStatusLabel: 'Exempted',
      isExemptionStub: true,
      declaredAt: null,
      stateDecision: null,
      mohuaDecision: null,
      documents: [],
    };

    it('returns null without checking exemption when a real record already exists (golden rule)', async () => {
      mockDurModel.findOne.mockReturnValue(mockQuery({ ...baseDur, documents: [] }));
      mockDurModel.findById.mockReturnValue(mockQuery({ ...baseDur, documents: [] }));

      await service.findByUlbAndYear(ulbId, designYearId, stateUser);

      expect(mockYearAccessService.isFormExempt).not.toHaveBeenCalled();
      expect(mockDurModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('does not materialize a stub when the ULB is not exempted (default)', async () => {
      mockDurModel.findOne.mockReturnValue(mockQuery(null));

      const result = await service.findByUlbAndYear(ulbId, designYearId, stateUser);

      expect(mockDurModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(result).toBeNull();
    });

    it('materializes an exemption stub and returns it when the ULB is exempted', async () => {
      mockYearAccessService.isFormExempt.mockResolvedValue(true);
      mockDurModel.findOne
        .mockReturnValueOnce(mockQuery(null)) // findByUlbAndYear's own first read: no record yet
        .mockReturnValueOnce(mockQuery(stub)); // materializeExemptionStubIfNeeded's re-read after upsert
      mockDurModel.findById.mockReturnValue(mockQuery(stub)); // getProcessingStatus's own lookup

      const result = await service.findByUlbAndYear(ulbId, designYearId, stateUser);

      expect(mockYearAccessService.isFormExempt).toHaveBeenCalledWith(
        expect.objectContaining({ state: stateId }),
        expect.objectContaining({ year: '2026-27' }),
        DUR_FORM_ID,
      );
      expect(mockDurModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ ulb: expect.anything(), design_year: expect.anything() }),
        expect.objectContaining({
          $setOnInsert: expect.objectContaining({
            currentFormStatus: FORM_STATUS.EXEMPTED_ACKNOWLEDGED,
            isExemptionStub: true,
          }),
        }),
        { upsert: true },
      );
      expect(result?.currentFormStatus).toBe(FORM_STATUS.EXEMPTED_ACKNOWLEDGED);
    });

    describe('undoing an exemption (existing stub, no longer exempt)', () => {
      it('is a no-op when still exempt - the stub is returned unchanged', async () => {
        mockYearAccessService.isFormExempt.mockResolvedValue(true);
        mockDurModel.findOne.mockReturnValue(mockQuery(stub));
        mockDurModel.findById.mockReturnValue(mockQuery(stub));

        const result = await service.findByUlbAndYear(ulbId, designYearId, stateUser);

        expect(mockDurModel.deleteOne).not.toHaveBeenCalled();
        expect(result?.currentFormStatus).toBe(FORM_STATUS.EXEMPTED_ACKNOWLEDGED);
      });

      it('deletes the stub (filtered on isExemptionStub:true) when the admin has undone the exemption', async () => {
        mockYearAccessService.isFormExempt.mockResolvedValue(false);
        mockDurModel.findOne.mockReturnValue(mockQuery(stub));

        const result = await service.findByUlbAndYear(ulbId, designYearId, stateUser);

        expect(mockDurModel.deleteOne).toHaveBeenCalledWith({ _id: durId, isExemptionStub: true });
        expect(result).toBeNull();
      });

      it('does not revalidate a real (non-stub) record', async () => {
        mockDurModel.findOne.mockReturnValue(mockQuery({ ...baseDur, documents: [] }));
        mockDurModel.findById.mockReturnValue(mockQuery({ ...baseDur, documents: [] }));

        await service.findByUlbAndYear(ulbId, designYearId, stateUser);

        expect(mockYearAccessService.isFormExempt).not.toHaveBeenCalled();
        expect(mockDurModel.deleteOne).not.toHaveBeenCalled();
      });
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

    it('includes an EXEMPTED_ACKNOWLEDGED fallback for a documentless-but-exempt ULB in the aggregation pipeline', async () => {
      const exemptUlbId = 'ulb-exempt-1';
      mockUlbModel.find.mockReturnValue(mockQuery([{ _id: exemptUlbId, startYear: 2026, yearAccess: {} }]));
      mockExemptionResolverService.resolveBulk.mockResolvedValue(
        new Map([[exemptUlbId, { exempted: true, source: 'AUTOMATIC' }]]),
      );

      await service.listUlbSubmissions({ designYearId, page: 1, pageSize: 20 }, stateUser);

      const pipeline = mockUlbModel.aggregate.mock.calls[0][0];
      const addFieldsStage = pipeline.find(
        (stage: Record<string, unknown>) =>
          typeof stage.$addFields === 'object' && stage.$addFields !== null && 'formStatus' in stage.$addFields,
      );
      const exemptIds = addFieldsStage.$addFields.formStatus.$cond[2].$cond[0].$in[1];
      expect(exemptIds).toEqual([exemptUlbId]);
      expect(mockExemptionResolverService.resolveBulk).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ year: '2026-27' }),
        DUR_FORM_ID,
      );
    });

    it('does not trust a stale exemption stub\'s stored status - falls through to the live exemption check', async () => {
      await service.listUlbSubmissions({ designYearId, page: 1, pageSize: 20 }, stateUser);

      const pipeline = mockUlbModel.aggregate.mock.calls[0][0];
      const addFieldsStage = pipeline.find(
        (stage: Record<string, unknown>) =>
          typeof stage.$addFields === 'object' && stage.$addFields !== null && 'formStatus' in stage.$addFields,
      );
      const [condition, trueBranch] = addFieldsStage.$addFields.formStatus.$cond;
      expect(condition).toEqual({ $and: [{ $ne: ['$dur', null] }, { $ne: ['$dur.isExemptionStub', true] }] });
      expect(trueBranch).toBe('$dur.currentFormStatus');
    });

    it('skips the exemption lookup entirely when the design year is not found', async () => {
      mockYearModel.findById.mockReturnValue(mockQuery(null));

      await service.listUlbSubmissions({ designYearId, page: 1, pageSize: 20 }, stateUser);

      expect(mockUlbModel.find).not.toHaveBeenCalled();
      expect(mockExemptionResolverService.resolveBulk).not.toHaveBeenCalled();
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
