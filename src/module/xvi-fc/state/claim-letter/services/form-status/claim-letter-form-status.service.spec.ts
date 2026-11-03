import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { ClaimLetterFormStatusService } from './claim-letter-form-status.service';

const oid = () => new Types.ObjectId();

describe('ClaimLetterFormStatusService', () => {
  const claimLetterId = oid();
  const userOid = oid();
  const session = { id: 'session' } as never;
  const stateId = oid();
  const yearId = oid();

  let updateMany: jest.Mock;
  let countDocuments: jest.Mock;
  let collections: string[];
  let service: ClaimLetterFormStatusService;
  let parentSources: unknown[];
  /** One entry per selected ULB: that ULB's id and its frozen sources. */
  let children: { ulbId: Types.ObjectId; sources: unknown[]; devolutionRowId?: Types.ObjectId }[];
  /** What `find` returns per collection, for the ULB forms found live. */
  let findDocs: Record<string, Record<string, unknown>[]>;
  let enabledSources: unknown[];

  const withChildren = (...sourceLists: unknown[][]) => {
    children = sourceLists.map((sources) => ({ ulbId: oid(), sources }));
  };

  const build = () => {
    const connection = {
      collection: jest.fn((name: string) => {
        collections.push(name);
        return {
          updateMany,
          countDocuments,
          find: () => ({ toArray: () => Promise.resolve(findDocs[name] ?? []) }),
        };
      }),
    };
    const batchModel = {
      findById: jest.fn().mockReturnValue({
        select: () => ({
          session: () => ({
            lean: () => ({
              exec: () =>
                Promise.resolve({ state: stateId, year: yearId, stateEligibilitySources: parentSources }),
            }),
          }),
        }),
      }),
    };
    const batchUlbModel = {
      find: jest.fn().mockReturnValue({
        select: () => ({
          session: () => ({
            lean: () => ({
              cursor: () =>
                (async function* () {
                  await Promise.resolve();
                  for (const child of children) {
                    yield {
                      ulbId: child.ulbId,
                      devolutionSource: child.devolutionRowId ? { rowDocumentId: child.devolutionRowId } : undefined,
                      eligibilitySources: child.sources,
                    };
                  }
                })(),
            }),
          }),
        }),
      }),
    };
    const formJsonService = { findEnabledClaimEligibilitySources: jest.fn(() => Promise.resolve(enabledSources)) };
    service = new ClaimLetterFormStatusService(
      connection as never,
      batchModel as never,
      batchUlbModel as never,
      formJsonService as never,
    );
  };

  beforeEach(() => {
    collections = [];
    countDocuments = jest.fn().mockResolvedValue(0);
    parentSources = [];
    children = [];
    findDocs = {};
    enabledSources = [];
    updateMany = jest
      .fn()
      .mockImplementation((filter: { _id: { $in: unknown[] } }) =>
        Promise.resolve({ modifiedCount: filter._id.$in.length }),
      );
    build();
  });

  it('moves State forms from 15 and ULB forms from 8 to 5, one conditional write per collection', async () => {
    const sfc = oid();
    const bankA = oid();
    const bankB = oid();
    parentSources = [{ formId: 22, result: 'PASSED', formDocumentId: sfc }];
    withChildren(
      [{ formId: 33, result: 'PASSED', formDocumentId: bankA }],
      [{ formId: 33, result: 'PASSED', formDocumentId: bankB }],
    );

    const summary = await service.moveFormsToMohuaReview(claimLetterId, userOid, session);

    expect(collections).toEqual(expect.arrayContaining(['xvifc_sfc', 'xvifc_bankaccounts']));
    const sfcCall = updateMany.mock.calls.find(([f]) => f._id.$in.length === 1);
    expect(sfcCall?.[0]).toEqual({ _id: { $in: [sfc] }, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_SO });
    expect(sfcCall?.[1].$set).toMatchObject({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA });
    const bankCall = updateMany.mock.calls.find(([f]) => f._id.$in.length === 2);
    expect(bankCall?.[0]).toEqual({ _id: { $in: [bankA, bankB] }, currentFormStatus: FORM_STATUS.APPROVED_BY_STATE });
    expect(bankCall?.[1].$set).toMatchObject({
      currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
      currentFormStatusLabel: 'Under Review by MoHUA',
    });
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany.mock.calls[0][2]).toEqual({ session });
    expect(summary.moved).toEqual({ 22: 1, 33: 2 });
  });

  it('writes Annual Accounts through form_status_id and the status text, both sections in one write', async () => {
    const audited = oid();
    const unaudited = oid();
    withChildren([
      { formId: 30, result: 'PASSED', formDocumentId: audited },
      { formId: 31, result: 'PASSED', formDocumentId: unaudited },
    ]);

    await service.moveFormsToMohuaReview(claimLetterId, userOid, session);

    expect(updateMany).toHaveBeenCalledTimes(1);
    const [filter, update] = updateMany.mock.calls[0];
    expect(filter).toEqual({ _id: { $in: [audited, unaudited] }, form_status_id: FORM_STATUS.APPROVED_BY_STATE });
    expect(update.$set).toMatchObject({ form_status_id: 5, form_status: 'UNDER_REVIEW_BY_MOHUA' });
  });

  it("moves a letter ULB's Elected Body and FC Unspent rows from 15 to 5 as well", async () => {
    const row = oid();
    withChildren([{ formId: 23, result: 'PASSED', formDocumentId: oid(), rowDocumentId: row }]);

    await service.moveFormsToMohuaReview(claimLetterId, userOid, session);

    expect(collections).toContain('xvifc_elected_ulb_rows');
    const rowCall = updateMany.mock.calls.find(([f]) => 'rowStatus' in f);
    expect(rowCall?.[0]).toEqual({ _id: { $in: [row] }, rowStatus: { $in: [FORM_STATUS.UNDER_REVIEW_BY_SO] } });
    expect(rowCall?.[1].$set).toMatchObject({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA });
  });

  it("moves each selected ULB's Devolution row (unset or 15) to 5 and guards it like the other rows", async () => {
    const rowA = oid();
    const rowB = oid();
    parentSources = [{ formId: 24, result: 'PASSED', formDocumentId: oid() }];
    withChildren([], []);
    children[0].devolutionRowId = rowA;
    children[1].devolutionRowId = rowB;

    const summary = await service.moveFormsToMohuaReview(claimLetterId, userOid, session);

    expect(collections).toContain('xvifc_devolution_rows');
    expect(countDocuments).toHaveBeenCalledWith(
      { _id: { $in: [rowA, rowB] }, rowStatus: { $nin: [null, FORM_STATUS.UNDER_REVIEW_BY_SO, 5, 7] } },
      { session },
    );
    const rowCall = updateMany.mock.calls.find(([f]) => 'rowStatus' in f);
    expect(rowCall?.[0]).toEqual({ _id: { $in: [rowA, rowB] }, rowStatus: { $in: [null, FORM_STATUS.UNDER_REVIEW_BY_SO] } });
    expect(rowCall?.[1].$set).toMatchObject({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA });
    expect(summary.moved[24]).toBe(1 + 2);
  });

  it('leaves exempted sources, a missing document and unknown forms alone', async () => {
    parentSources = [
      { formId: 22, result: 'EXEMPTED', formDocumentId: oid() },
      { formId: 24, result: 'PASSED', formDocumentId: null },
      { formId: 99, result: 'PASSED', formDocumentId: oid() },
    ];

    const summary = await service.moveFormsToMohuaReview(claimLetterId, userOid, session);

    expect(updateMany).not.toHaveBeenCalled();
    expect(summary.moved).toEqual({});
  });

  it('splits a very large letter into chunked writes and counts only what was really modified', async () => {
    withChildren(...Array.from({ length: 2500 }, () => [{ formId: 32, result: 'PASSED', formDocumentId: oid() }]));
    // The conditional filter skips forms that already moved: report half as modified.
    updateMany.mockImplementation((filter: { _id: { $in: unknown[] } }) =>
      Promise.resolve({ modifiedCount: Math.floor(filter._id.$in.length / 2) }),
    );

    const summary = await service.moveFormsToMohuaReview(claimLetterId, userOid, session);

    expect(updateMany).toHaveBeenCalledTimes(3);
    expect(summary.moved[32]).toBe(500 + 500 + 250);
  });

  it('refuses the whole move, writing nothing, when a form changed since the letter was submitted', async () => {
    const bank = oid();
    withChildren([{ formId: 33, result: 'PASSED', formDocumentId: bank }]);
    countDocuments.mockResolvedValue(1);

    await expect(service.moveFormsToMohuaReview(claimLetterId, userOid, session)).rejects.toThrow(ConflictException);

    expect(countDocuments).toHaveBeenCalledWith(
      { _id: { $in: [bank] }, currentFormStatus: { $nin: [FORM_STATUS.APPROVED_BY_STATE, 5, 7] } },
      { session },
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  describe('ULB forms found live, for a letter built before they were configured as conditions', () => {
    const bankFormJson = {
      formId: 33,
      claimEligibility: {
        yearScope: 'SUBMISSION_PERIOD_SINGLETON',
        source: {
          collection: 'xvifc_bankaccounts',
          fields: { designYear: 'designYear', state: 'state', ulb: 'ulb', currentFormStatus: 'currentFormStatus' },
        },
      },
    };
    const slbFormJson = {
      formId: 32,
      claimEligibility: {
        yearScope: 'CURRENT_DESIGN_YEAR',
        source: {
          collection: 'xvifc_slb_forms',
          fields: { designYear: 'year', ulb: 'ulb', currentFormStatus: 'currentFormStatus' },
        },
      },
    };

    it("moves the selected ULB's forms at 8 although the letter's evidence has no ULB-form source", async () => {
      const bank = oid();
      const slb = oid();
      withChildren([{ formId: 23, result: 'PASSED', formDocumentId: oid() }]);
      enabledSources = [bankFormJson, slbFormJson];
      findDocs = {
        xvifc_bankaccounts: [{ _id: bank, ulb: children[0].ulbId, currentFormStatus: 8 }],
        xvifc_slb_forms: [{ _id: slb, ulb: children[0].ulbId, currentFormStatus: 8 }],
      };

      const summary = await service.moveFormsToMohuaReview(claimLetterId, userOid, session);

      const bankCall = updateMany.mock.calls.find(([f]) => f._id.$in.some((id: Types.ObjectId) => id.equals(bank)));
      expect(bankCall?.[0].currentFormStatus).toBe(FORM_STATUS.APPROVED_BY_STATE);
      expect(bankCall?.[1].$set).toMatchObject({
        currentFormStatus: 5,
        currentFormStatusLabel: 'Under Review by MoHUA',
      });
      expect(summary.moved[32]).toBe(1);
      expect(summary.moved[33]).toBe(1);
    });

    it('skips a live form that is not at 8 and does not refuse the approval for it', async () => {
      withChildren([]);
      enabledSources = [bankFormJson];
      findDocs = { xvifc_bankaccounts: [{ _id: oid(), ulb: children[0].ulbId, currentFormStatus: 3 }] };

      const summary = await service.moveFormsToMohuaReview(claimLetterId, userOid, session);

      expect(updateMany).not.toHaveBeenCalled();
      expect(summary.moved).toEqual({});
    });

    it("leaves a ULB's form alone when the letter recorded that ULB as exempt for it", async () => {
      withChildren([{ formId: 33, result: 'EXEMPTED', formDocumentId: null }]);
      enabledSources = [bankFormJson];
      findDocs = { xvifc_bankaccounts: [{ _id: oid(), ulb: children[0].ulbId, currentFormStatus: 8 }] };

      await service.moveFormsToMohuaReview(claimLetterId, userOid, session);

      expect(updateMany).not.toHaveBeenCalled();
    });
  });

  describe('returnFormsForCorrection (SO return)', () => {
    const decision = {
      status: 'RETURNED' as const,
      note: 'Wrong IFSC',
      decidedBy: { userId: userOid, role: 'MoHUA', name: null, ipAddress: null, userAgent: null },
      decidedAt: new Date(),
    };
    const selection = (extra: Record<string, unknown> = {}) => ({
      ulbReturns: [] as {
        ulbId: Types.ObjectId;
        ulbFormIds: number[];
        rowFormIds: number[];
        remark: string | null;
        decision: typeof decision;
      }[],
      stateFormIds: [] as number[],
      stateRemark: 'Fix this' as string | null,
      ...extra,
    });
    const ulbReturn = (ulbId: Types.ObjectId, extra: Record<string, unknown> = {}) => ({
      ulbId,
      ulbFormIds: [] as number[],
      rowFormIds: [] as number[],
      remark: 'Wrong IFSC',
      decision,
      ...extra,
    });
    const callOn = (id: Types.ObjectId) =>
      updateMany.mock.calls.find(([f]) => f._id.$in.some((x: Types.ObjectId) => x.equals(id)));

    it("returns only the marked ULB's Elected Body row (its own remark) and the form to 16; other rows untouched", async () => {
      const form = oid();
      const rowA = oid();
      const rowB = oid();
      parentSources = [{ formId: 23, result: 'PASSED', formDocumentId: form }];
      withChildren(
        [{ formId: 23, result: 'PASSED', formDocumentId: form, rowDocumentId: rowA }],
        [{ formId: 23, result: 'PASSED', formDocumentId: form, rowDocumentId: rowB }],
      );

      const returned = await service.returnFormsForCorrection(
        claimLetterId,
        selection({ ulbReturns: [ulbReturn(children[0].ulbId, { rowFormIds: [23], remark: 'Wrong ward count' })] }),
        decision,
        session,
      );

      expect(callOn(form)?.[0].currentFormStatus).toEqual({ $in: [15, 5, 7] });
      expect(callOn(form)?.[1].$set).toMatchObject({
        currentFormStatus: FORM_STATUS.RETURNED_BY_SO,
        rejectionRemarks: 'Fix this',
      });
      expect(callOn(rowA)?.[1].$set).toMatchObject({
        rowStatus: FORM_STATUS.RETURNED_BY_SO,
        rejectionRemark: 'Wrong ward count',
      });
      expect(callOn(rowB)).toBeUndefined();
      expect(returned.map((r) => [r.formId, r.rowDocumentId])).toEqual([
        [23, rowA],
        [23, null],
      ]);
    });

    it("gives a row form a pointer to its rows as its reason when the SO wrote nothing for the State", async () => {
      const form = oid();
      parentSources = [{ formId: 23, result: 'PASSED', formDocumentId: form }];
      withChildren([{ formId: 23, result: 'PASSED', formDocumentId: form, rowDocumentId: oid() }]);

      await service.returnFormsForCorrection(
        claimLetterId,
        selection({ stateRemark: null, ulbReturns: [ulbReturn(children[0].ulbId, { rowFormIds: [23] })] }),
        decision,
        session,
      );

      expect(callOn(form)?.[1].$set.rejectionRemarks).toContain("see each row's remark");
    });

    it("returns a marked ULB's own form from 8 to 16 with that ULB's decision, and no other ULB's", async () => {
      const bankA = oid();
      const bankB = oid();
      withChildren([], []);
      enabledSources = [
        {
          formId: 33,
          claimEligibility: {
            yearScope: 'SUBMISSION_PERIOD_SINGLETON',
            source: { collection: 'xvifc_bankaccounts', fields: { ulb: 'ulb', currentFormStatus: 'currentFormStatus' } },
          },
        },
      ];
      // The query filters by the marked ULB; the mock returns only that ULB's document.
      findDocs = { xvifc_bankaccounts: [{ _id: bankA, ulb: children[0].ulbId, currentFormStatus: 8 }] };

      const returned = await service.returnFormsForCorrection(
        claimLetterId,
        selection({ ulbReturns: [ulbReturn(children[0].ulbId, { ulbFormIds: [33] })] }),
        decision,
        session,
      );

      expect(callOn(bankA)?.[0].currentFormStatus).toBe(FORM_STATUS.APPROVED_BY_STATE);
      expect(callOn(bankA)?.[1].$set).toMatchObject({
        currentFormStatus: FORM_STATUS.RETURNED_BY_SO,
        currentFormStatusLabel: 'Returned for Correction',
        mohuaDecision: decision,
      });
      expect(callOn(bankB)).toBeUndefined();
      expect(returned).toEqual([expect.objectContaining({ formId: 33, formDocumentId: bankA, remark: 'Wrong IFSC' })]);
    });

    it('refuses a ULB outside the letter or a State form the letter did not use', async () => {
      parentSources = [{ formId: 22, result: 'EXEMPTED', formDocumentId: null }];
      withChildren([]);

      await expect(
        service.returnFormsForCorrection(
          claimLetterId,
          selection({ ulbReturns: [ulbReturn(oid(), { ulbFormIds: [33] })] }),
          decision,
          session,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.returnFormsForCorrection(claimLetterId, selection({ stateFormIds: [22] }), decision, session),
      ).rejects.toThrow(BadRequestException);
      expect(updateMany).not.toHaveBeenCalled();
    });
  });
});
