import { BadRequestException, ConflictException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FORM_STATUS, FormHistoryAction } from 'src/common/constants/form-status.constants';
import { ClaimLetterFormStatusService } from './claim-letter-form-status.service';

const oid = () => new Types.ObjectId();

/** One `collection(...).updateMany(filter, update, options)` call, as the service makes it. */
type UpdateManyCall = [
  { _id: { $in: Types.ObjectId[] }; [field: string]: unknown },
  { $set: Record<string, unknown> },
  { session?: unknown; arrayFilters?: unknown[] }?,
];

describe('ClaimLetterFormStatusService', () => {
  const claimLetterId = oid();
  const userOid = oid();
  const session = { id: 'session' } as never;
  const approval = {
    status: 'APPROVED' as const,
    note: null,
    decidedBy: { userId: userOid, role: 'MoHUA', name: 'SO', ipAddress: '1.2.3.4', userAgent: 'jest' },
    decidedAt: new Date('2026-11-12T10:00:00Z'),
  };
  const stateId = oid();
  const yearId = oid();

  let updateMany: jest.Mock<Promise<{ modifiedCount: number }>, UpdateManyCall>;
  let countDocuments: jest.Mock;
  let collections: string[];
  let service: ClaimLetterFormStatusService;
  let parentSources: unknown[];
  /** One entry per selected ULB: that ULB's id and its frozen sources. */
  let children: { ulbId: Types.ObjectId; sources: unknown[]; devolutionRowId?: Types.ObjectId }[];
  /** What `find` returns per collection, for the ULB forms found live. */
  let findDocs: Record<string, Record<string, unknown>[]>;
  let enabledSources: unknown[];
  /** Fields of a document the status write reads back by id (its status, state, ulb...), keyed by id. */
  let storedDocs: Record<string, Record<string, unknown>>;
  /** Only ids whose stored status equals the filter's are read back (the database's behaviour), when set. */
  let honourStatusFilter: boolean;
  /** History rows written, per collection. */
  let inserted: { collection: string; rows: Record<string, unknown>[]; options: unknown }[];
  const historyIn = (collection: string) => inserted.filter((i) => i.collection === collection).flatMap((i) => i.rows);

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
          // By id: the status write reading back what it will move. Otherwise: the live ULB-form lookup.
          find: (filter: { _id?: { $in: Types.ObjectId[] }; [field: string]: unknown }) => ({
            toArray: () =>
              Promise.resolve(
                filter._id
                  ? filter._id.$in
                      .filter(
                        (id) =>
                          !honourStatusFilter ||
                          Object.entries(storedDocs[String(id)] ?? {}).some(
                            ([field, value]) => filter[field] === value,
                          ),
                      )
                      .map((id) => ({ _id: id, ...(storedDocs[String(id)] ?? {}) }))
                  : (findDocs[name] ?? []),
              ),
          }),
          insertMany: (rows: Record<string, unknown>[], options: unknown) => {
            inserted.push({ collection: name, rows, options });
            return Promise.resolve({ insertedCount: rows.length });
          },
        };
      }),
    };
    const batchModel = {
      findById: jest.fn().mockReturnValue({
        select: () => ({
          session: () => ({
            lean: () => ({
              exec: () => Promise.resolve({ state: stateId, year: yearId, stateEligibilitySources: parentSources }),
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
    // Every id the guard asks about is still in an accepted status, unless a test says otherwise.
    countDocuments = jest.fn((filter: { _id: { $in: unknown[] } }) => Promise.resolve(filter._id.$in.length));
    parentSources = [];
    children = [];
    findDocs = {};
    enabledSources = [];
    storedDocs = {};
    honourStatusFilter = false;
    inserted = [];
    updateMany = jest.fn<Promise<{ modifiedCount: number }>, UpdateManyCall>((filter) =>
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

    const summary = await service.moveFormsToMohuaReview(claimLetterId, approval, session);

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

  it("writes one history row per moved form, in the form's own history collection and the same session", async () => {
    const sfc = oid();
    const bank = oid();
    const ulb = oid();
    parentSources = [{ formId: 22, result: 'PASSED', formDocumentId: sfc }];
    withChildren([{ formId: 33, result: 'PASSED', formDocumentId: bank }]);
    storedDocs = {
      [String(sfc)]: { currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_SO, state: stateId, year: yearId },
      [String(bank)]: { currentFormStatus: FORM_STATUS.APPROVED_BY_STATE, ulb, designYear: yearId },
    };

    await service.moveFormsToMohuaReview(claimLetterId, approval, session);

    expect(historyIn('xvifc_sfc_logs')).toEqual([
      expect.objectContaining({
        sfcStatusForm: sfc,
        state: stateId,
        year: yearId,
        action: FormHistoryAction.SO_APPROVE,
        fromStatus: FORM_STATUS.UNDER_REVIEW_BY_SO,
        toStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        changedBy: userOid,
        data: { claimLetter: claimLetterId },
      }),
    ]);
    expect(historyIn('xvifc_bankaccount_form_logs')).toEqual([
      expect.objectContaining({
        bankAccountId: bank,
        ulb,
        designYear: yearId,
        action: 'APPROVED',
        actorStage: 'MOHUA',
        toStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        toStatusLabel: 'Under Review by MoHUA',
        userInfo: approval.decidedBy,
      }),
    ]);
    expect(inserted.every((i) => (i.options as { session: unknown }).session === session)).toBe(true);
  });

  it('logs and writes nothing for a form the conditional write no longer matches (an earlier letter moved it)', async () => {
    const sfc = oid();
    parentSources = [{ formId: 22, result: 'PASSED', formDocumentId: sfc }];
    storedDocs = { [String(sfc)]: { currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA } };
    honourStatusFilter = true;

    const summary = await service.moveFormsToMohuaReview(claimLetterId, approval, session);

    expect(updateMany).not.toHaveBeenCalled();
    expect(inserted).toEqual([]);
    expect(summary.moved).toEqual({ 22: 0 });
  });

  it('writes Annual Accounts through form_status_id and the status text, both sections in one write', async () => {
    const audited = oid();
    const unaudited = oid();
    withChildren([
      { formId: 30, result: 'PASSED', formDocumentId: audited },
      { formId: 31, result: 'PASSED', formDocumentId: unaudited },
    ]);

    await service.moveFormsToMohuaReview(claimLetterId, approval, session);

    expect(updateMany).toHaveBeenCalledTimes(1);
    const [filter, update] = updateMany.mock.calls[0];
    expect(filter).toEqual({ _id: { $in: [audited, unaudited] }, form_status_id: FORM_STATUS.APPROVED_BY_STATE });
    expect(update.$set).toMatchObject({ form_status_id: 5, form_status: 'UNDER_REVIEW_BY_MOHUA' });
  });

  it("moves a letter ULB's Elected Body and FC Unspent rows from 15 to 5 as well", async () => {
    const row = oid();
    withChildren([{ formId: 23, result: 'PASSED', formDocumentId: oid(), rowDocumentId: row }]);

    await service.moveFormsToMohuaReview(claimLetterId, approval, session);

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

    const summary = await service.moveFormsToMohuaReview(claimLetterId, approval, session);

    expect(collections).toContain('xvifc_devolution_rows');
    expect(countDocuments).toHaveBeenCalledWith(
      { _id: { $in: [rowA, rowB] }, rowStatus: { $in: [null, FORM_STATUS.UNDER_REVIEW_BY_SO, 5, 7] } },
      { session },
    );
    const rowCall = updateMany.mock.calls.find(([f]) => 'rowStatus' in f);
    expect(rowCall?.[0]).toEqual({
      _id: { $in: [rowA, rowB] },
      rowStatus: { $in: [null, FORM_STATUS.UNDER_REVIEW_BY_SO] },
    });
    expect(rowCall?.[1].$set).toMatchObject({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA });
    expect(summary.moved[24]).toBe(1 + 2);
  });

  it('leaves exempted sources, a missing document and unknown forms alone', async () => {
    parentSources = [
      { formId: 22, result: 'EXEMPTED', formDocumentId: oid() },
      { formId: 24, result: 'PASSED', formDocumentId: null },
      { formId: 99, result: 'PASSED', formDocumentId: oid() },
    ];

    const summary = await service.moveFormsToMohuaReview(claimLetterId, approval, session);

    expect(updateMany).not.toHaveBeenCalled();
    expect(summary.moved).toEqual({});
  });

  it('splits a very large letter into chunked writes and counts only what was really modified', async () => {
    withChildren(...Array.from({ length: 2500 }, () => [{ formId: 32, result: 'PASSED', formDocumentId: oid() }]));
    // The conditional filter skips forms that already moved: report half as modified.
    updateMany.mockImplementation((filter: { _id: { $in: unknown[] } }) =>
      Promise.resolve({ modifiedCount: Math.floor(filter._id.$in.length / 2) }),
    );

    const summary = await service.moveFormsToMohuaReview(claimLetterId, approval, session);

    expect(updateMany).toHaveBeenCalledTimes(3);
    expect(summary.moved[32]).toBe(500 + 500 + 250);
  });

  it('refuses the whole move, writing nothing, when a form changed since the letter was submitted', async () => {
    const bank = oid();
    withChildren([{ formId: 33, result: 'PASSED', formDocumentId: bank }]);
    countDocuments.mockResolvedValue(0); // not in an accepted status any more

    await expect(service.moveFormsToMohuaReview(claimLetterId, approval, session)).rejects.toThrow(ConflictException);

    expect(countDocuments).toHaveBeenCalledWith(
      { _id: { $in: [bank] }, currentFormStatus: { $in: [FORM_STATUS.APPROVED_BY_STATE, 5, 7] } },
      { session },
    );
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('refuses the move when a relied-on row was deleted since submit (a missing document counts as changed)', async () => {
    const rowA = oid();
    const rowB = oid();
    parentSources = [{ formId: 24, result: 'PASSED', formDocumentId: oid() }];
    withChildren([], []);
    children[0].devolutionRowId = rowA;
    children[1].devolutionRowId = rowB;
    // Only one of the two rows still exists.
    countDocuments.mockImplementation((filter: { _id: { $in: unknown[] } }) =>
      Promise.resolve(filter._id.$in.length === 2 ? 1 : filter._id.$in.length),
    );

    await expect(service.moveFormsToMohuaReview(claimLetterId, approval, session)).rejects.toThrow(
      /1 form\(s\) in this claim letter changed/,
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

      const summary = await service.moveFormsToMohuaReview(claimLetterId, approval, session);

      const bankCall = updateMany.mock.calls.find(([f]) => f._id.$in.some((id: Types.ObjectId) => id.equals(bank)));
      expect(bankCall?.[0].currentFormStatus).toBe(FORM_STATUS.APPROVED_BY_STATE);
      expect(bankCall?.[1].$set).toMatchObject({
        currentFormStatus: 5,
        currentFormStatusLabel: 'Under Review by MoHUA',
      });
      expect(summary.moved[32]).toBe(1);
      expect(summary.moved[33]).toBe(1);
      // SLB is deemed approved: its status moves, but it keeps no history.
      expect(historyIn('xvifc_slb_form_logs')).toEqual([]);
      expect(historyIn('xvifc_bankaccount_form_logs')).toHaveLength(1);
    });

    it('skips a live form that is not at 8 and does not refuse the approval for it', async () => {
      withChildren([]);
      enabledSources = [bankFormJson];
      findDocs = { xvifc_bankaccounts: [{ _id: oid(), ulb: children[0].ulbId, currentFormStatus: 3 }] };

      const summary = await service.moveFormsToMohuaReview(claimLetterId, approval, session);

      expect(updateMany).not.toHaveBeenCalled();
      expect(summary.moved).toEqual({});
    });

    it("leaves a ULB's form alone when the letter recorded that ULB as exempt for it", async () => {
      withChildren([{ formId: 33, result: 'EXEMPTED', formDocumentId: null }]);
      enabledSources = [bankFormJson];
      findDocs = { xvifc_bankaccounts: [{ _id: oid(), ulb: children[0].ulbId, currentFormStatus: 8 }] };

      await service.moveFormsToMohuaReview(claimLetterId, approval, session);

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

    it('gives a row form a pointer to its rows as its reason when the SO wrote nothing for the State', async () => {
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
            source: {
              collection: 'xvifc_bankaccounts',
              fields: { ulb: 'ulb', currentFormStatus: 'currentFormStatus' },
            },
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

    it('logs each returned form and row with SO_RETURN and the remark that reopened it', async () => {
      const form = oid();
      const row = oid();
      parentSources = [{ formId: 23, result: 'PASSED', formDocumentId: form }];
      withChildren([{ formId: 23, result: 'PASSED', formDocumentId: form, rowDocumentId: row }]);
      storedDocs = {
        [String(form)]: { currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA, state: stateId, year: yearId },
        [String(row)]: { rowStatus: FORM_STATUS.UNDER_REVIEW_BY_SO, form, state: stateId, year: yearId },
      };

      await service.returnFormsForCorrection(
        claimLetterId,
        selection({ ulbReturns: [ulbReturn(children[0].ulbId, { rowFormIds: [23], remark: 'Wrong ward count' })] }),
        decision,
        session,
      );

      expect(historyIn('xvifc_elected_ulb_row_logs')).toEqual([
        expect.objectContaining({
          row,
          form,
          previousStatus: FORM_STATUS.UNDER_REVIEW_BY_SO,
          currentStatus: FORM_STATUS.RETURNED_BY_SO,
          createdBy: userOid,
        }),
      ]);
      expect(historyIn('xvifc_elected_ulb_form_logs')).toEqual([
        expect.objectContaining({
          eulbForm: form,
          action: FormHistoryAction.SO_RETURN,
          fromStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
          toStatus: FORM_STATUS.RETURNED_BY_SO,
          remarks: 'Fix this',
        }),
      ]);
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

    it("refuses SFC an approval of another letter moved on after the dialog loaded (ADR 0009's 409)", async () => {
      const sfc = oid();
      parentSources = [{ formId: 22, result: 'PASSED', formDocumentId: sfc }];
      withChildren([]);
      // Another letter's approval already moved SFC to 5: SFC is returnable only from 15.
      honourStatusFilter = true;
      storedDocs[String(sfc)] = { currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA };

      const err = await service
        .returnFormsForCorrection(claimLetterId, selection({ stateFormIds: [22] }), decision, session)
        .catch((e: unknown) => e);

      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).message).toBe(
        'A State form picked for return was accepted with another claim letter meanwhile. Reload and try again.',
      );
      expect(inserted).toEqual([]);
    });
  });
});

describe('ClaimLetterFormStatusService.assertStateFormsStillReady (submit, ADR 0009)', () => {
  const letterId = oid();
  const session = { id: 'session' } as never;

  /** `readyCount`: how many of the asked ids are still at 15, 5 or 7. */
  const assertWith = (sources: unknown[], readyCount?: number) => {
    const countDocuments = jest.fn((filter: { _id: { $in: unknown[] } }) =>
      Promise.resolve(readyCount ?? filter._id.$in.length),
    );
    const query = {
      select: () => query,
      session: () => query,
      lean: () => ({ exec: () => Promise.resolve({ stateEligibilitySources: sources }) }),
    };
    const service = new ClaimLetterFormStatusService(
      { collection: () => ({ countDocuments }) } as never,
      { findById: () => query } as never,
      {} as never,
      {} as never,
    );
    return { run: () => service.assertStateFormsStillReady(letterId, session), countDocuments };
  };

  it('passes while the State forms the draft relied on are still at 15, 5 or 7, skipping exempted ones', async () => {
    const { run, countDocuments } = assertWith([
      { formId: 22, result: 'PASSED', formDocumentId: oid() },
      { formId: 35, result: 'PASSED', formDocumentId: oid() },
      { formId: 24, result: 'EXEMPTED', formDocumentId: null },
    ]);

    await expect(run()).resolves.toBeUndefined();
    expect(countDocuments).toHaveBeenCalledTimes(2);
    expect(countDocuments).toHaveBeenCalledWith(expect.objectContaining({ currentFormStatus: { $in: [15, 5, 7] } }), {
      session,
    });
  });

  it('refuses with a 409 once one was returned or deleted since the gate check', async () => {
    const { run } = assertWith([{ formId: 22, result: 'PASSED', formDocumentId: oid() }], 0);

    const err = await run().catch((e: unknown) => e);

    expect(err).toBeInstanceOf(ConflictException);
    expect((err as ConflictException).message).toBe(
      'A State form changed while you were working on this letter. Reload and try again.',
    );
  });
});

describe('ClaimLetterFormStatusService.describeReturnableStateForms (ADR 0009)', () => {
  const letterId = oid();
  const sfcId = oid();
  const gtcId = oid();
  const acceptingLetterId = oid();

  /** `statuses`: each State form's live status by collection; `approveRow`: an `SO_APPROVE` row names a letter. */
  const describeWith = (sources: unknown[], statuses: Record<string, number>, approveRow = false) => {
    const leanOf = (value: unknown) => ({ lean: () => ({ exec: () => Promise.resolve(value) }) });
    const connection = {
      collection: (name: string) => ({
        findOne: () =>
          Promise.resolve(
            name in statuses
              ? { currentFormStatus: statuses[name] }
              : approveRow
                ? { data: { claimLetter: acceptingLetterId } }
                : null,
          ),
      }),
    };
    const batchModel = {
      findById: (id: Types.ObjectId) => ({
        select: () =>
          String(id) === String(letterId)
            ? leanOf({ stateEligibilitySources: sources })
            : leanOf({ batchNumber: 1, resubmissionNumber: 0 }),
      }),
    };
    const service = new ClaimLetterFormStatusService(
      connection as never,
      batchModel as never,
      {} as never,
      {} as never,
    );
    return service.describeReturnableStateForms(letterId);
  };
  const passed = (formId: number, formDocumentId: Types.ObjectId) => ({ formId, result: 'PASSED', formDocumentId });

  it('offers a form still at 15, and names the letter whose approval accepted one at 5', async () => {
    const forms = await describeWith(
      [passed(22, sfcId), passed(35, gtcId)],
      { xvifc_sfc: FORM_STATUS.UNDER_REVIEW_BY_SO, xvifc_gtc: FORM_STATUS.UNDER_REVIEW_BY_MOHUA },
      true,
    );

    expect(forms).toEqual([
      { formId: 22, returnable: true, lockReason: null, acceptedWithLetter: null },
      { formId: 35, returnable: false, lockReason: 'ACCEPTED', acceptedWithLetter: 'Claim Letter 1' },
    ]);
  });

  it('still says ACCEPTED at 5 when no approval row names the letter', async () => {
    const forms = await describeWith([passed(22, sfcId)], { xvifc_sfc: FORM_STATUS.UNDER_REVIEW_BY_MOHUA });

    expect(forms[0]).toEqual({ formId: 22, returnable: false, lockReason: 'ACCEPTED', acceptedWithLetter: null });
  });

  it('says EXEMPTED only for an exempted source, and NOT_IN_REVIEW for another status or no source', async () => {
    const forms = await describeWith([{ formId: 22, result: 'EXEMPTED', formDocumentId: null }, passed(35, gtcId)], {
      xvifc_gtc: FORM_STATUS.UNDER_REVIEW_BY_PMU,
    });
    const noSources = await describeWith([], {});

    expect(forms).toEqual([
      { formId: 22, returnable: false, lockReason: 'EXEMPTED', acceptedWithLetter: null },
      { formId: 35, returnable: false, lockReason: 'NOT_IN_REVIEW', acceptedWithLetter: null },
    ]);
    expect(noSources.map((f) => f.lockReason)).toEqual(['NOT_IN_REVIEW', 'NOT_IN_REVIEW']);
  });
});
