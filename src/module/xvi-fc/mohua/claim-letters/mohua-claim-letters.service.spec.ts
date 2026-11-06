import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { MOHUA_CLAIM_LETTERS_LISTED_STATUSES } from './mohua-claim-letters.constants';
import { MohuaClaimLettersService } from './mohua-claim-letters.service';

/** Mongoose chain: every builder returns the chain, `.exec()` resolves `result`. */
function q<T>(result: T) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'sort', 'skip', 'limit', 'lean', 'session']) chain[m] = jest.fn().mockReturnValue(chain);
  chain['exec'] = jest.fn().mockResolvedValue(result);
  return chain;
}

const yearId = new Types.ObjectId().toString();
const tripura = { _id: new Types.ObjectId(), name: 'Tripura', code: 'TR' };
const kerala = { _id: new Types.ObjectId(), name: 'Kerala', code: 'KL' };
const batchId = new Types.ObjectId();

/** A mongoose write mock's call, `(filter, update)`, as the service makes it. */
type WriteCall = [Record<string, unknown>, { $set: Record<string, unknown>; $inc?: Record<string, unknown> }];

describe('MohuaClaimLettersService', () => {
  let stateModel: { find: jest.Mock; findById: jest.Mock };
  let yearModel: { findById: jest.Mock };
  let batchModel: { find: jest.Mock; findOne: jest.Mock; findOneAndUpdate: jest.Mock<unknown, WriteCall> };
  let batchUlbModel: {
    find: jest.Mock;
    findOne: jest.Mock;
    countDocuments: jest.Mock<Promise<number>, [Record<string, unknown>]>;
    exists: jest.Mock;
    updateOne: jest.Mock<unknown, WriteCall>;
  };
  let exemptionModel: { find: jest.Mock };
  let exemptionService: { approve: jest.Mock; reject: jest.Mock };
  let omUlbModel: { countDocuments: jest.Mock; insertMany: jest.Mock };
  let grantAllocationModel: { find: jest.Mock };
  let lockModel: { deleteMany: jest.Mock };
  let fileTokens: { signFileUrlForSession: jest.Mock };
  let eligibility: { getClaimStatusBreakdown: jest.Mock; resolveRemainingUlbIds: jest.Mock };
  let expectedUlbs: { resolve: jest.Mock };
  let formStatus: { moveFormsToMohuaReview: jest.Mock; returnFormsForCorrection: jest.Mock };
  let history: { recordTransition: jest.Mock; findLatestRejection: jest.Mock };
  let session: {
    startTransaction: jest.Mock;
    commitTransaction: jest.Mock;
    abortTransaction: jest.Mock;
    endSession: jest.Mock;
  };
  let connection: { startSession: jest.Mock };
  let service: MohuaClaimLettersService;

  const batch = (extra: Record<string, unknown> = {}) => ({
    _id: batchId,
    state: tripura._id,
    year: new Types.ObjectId(yearId),
    installment: 1,
    fileBaseName: 'CF_TR_2026-27_1',
    batchNumber: 1,
    version: 1,
    revision: 3,
    submittedAt: new Date('2026-10-26T07:03:52.868Z'),
    ulbCount: 4,
    currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
    financialSummary: { currentSelectedClaim: 130_000_000 },
    signedClaimFile: { originalName: 'Doc1.pdf', path: 'a/b/Doc1.pdf', sizeKb: 67 },
    ...extra,
  });

  beforeEach(() => {
    stateModel = {
      find: jest.fn().mockReturnValue(q([kerala, tripura])),
      findById: jest.fn().mockReturnValue(q({ name: 'Tripura' })),
    };
    yearModel = { findById: jest.fn().mockReturnValue(q({ year: '2026-27' })) };
    batchModel = {
      find: jest.fn().mockReturnValue(q([])),
      findOne: jest.fn().mockReturnValue(q(batch())),
      findOneAndUpdate: jest.fn<unknown, WriteCall>().mockReturnValue(q({ _id: batchId })),
    };
    batchUlbModel = {
      find: jest.fn().mockReturnValue(q([])),
      countDocuments: jest.fn<Promise<number>, [Record<string, unknown>]>().mockResolvedValue(0),
      exists: jest.fn().mockResolvedValue(null),
      updateOne: jest.fn<unknown, WriteCall>().mockReturnValue(q({ matchedCount: 1 })),
      findOne: jest.fn().mockReturnValue(q({ ulbId: new Types.ObjectId(), eligibilitySources: [] })),
    };
    grantAllocationModel = { find: jest.fn().mockReturnValue(q([])) };
    lockModel = { deleteMany: jest.fn().mockResolvedValue({ deletedCount: 4 }) };
    fileTokens = { signFileUrlForSession: jest.fn().mockReturnValue('https://signed/file') };

    eligibility = {
      getClaimStatusBreakdown: jest.fn().mockResolvedValue({
        totalAlreadyAcknowledged: 0,
        totalClaimInProgress: 0,
        totalClaimInDraft: 0,
        availableToClaim: 0,
      }),
      resolveRemainingUlbIds: jest.fn().mockResolvedValue([]),
    };
    expectedUlbs = { resolve: jest.fn().mockResolvedValue([]) };
    formStatus = {
      moveFormsToMohuaReview: jest.fn().mockResolvedValue({ moved: {} }),
      returnFormsForCorrection: jest.fn().mockResolvedValue([]),
    };
    history = {
      recordTransition: jest.fn().mockResolvedValue(undefined),
      findLatestRejection: jest.fn().mockResolvedValue(null),
    };
    session = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      abortTransaction: jest.fn().mockResolvedValue(undefined),
      endSession: jest.fn().mockResolvedValue(undefined),
    };
    connection = { startSession: jest.fn().mockResolvedValue(session) };
    exemptionModel = { find: jest.fn().mockReturnValue(q([])) };
    exemptionService = {
      approve: jest.fn().mockResolvedValue(undefined),
      reject: jest.fn().mockResolvedValue(undefined),
    };
    omUlbModel = {
      countDocuments: jest.fn().mockReturnValue({ session: jest.fn().mockResolvedValue(0) }),
      insertMany: jest.fn().mockResolvedValue([]),
    };

    service = new MohuaClaimLettersService(
      stateModel as never,
      yearModel as never,
      batchModel as never,
      batchUlbModel as never,
      grantAllocationModel as never,
      lockModel as never,
      fileTokens as never,
      eligibility as never,
      expectedUlbs as never,
      formStatus as never,
      history as never,
      connection as never,
      exemptionModel as never,
      exemptionService as never,
      omUlbModel as never,
    );
  });

  describe('listStates', () => {
    it('lists submitted letters under review, returned or acknowledged — never drafts, abandoned or superseded ones', async () => {
      await service.listStates(yearId, 1);

      expect(MOHUA_CLAIM_LETTERS_LISTED_STATUSES).toEqual([
        FORM_STATUS.UNDER_REVIEW_BY_SO,
        FORM_STATUS.RETURNED_BY_SO,
        FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        FORM_STATUS.RETURNED_BY_MOHUA,
        FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
      ]);
      expect(batchModel.find).toHaveBeenCalledWith(
        expect.objectContaining({
          assemblyStatus: 'READY',
          // An SO-returned letter is flagged abandoned to free its slot but is still listed.
          $or: [{ isAbandoned: false }, { currentFormStatus: FORM_STATUS.RETURNED_BY_SO }],
          supersededBy: null,
          currentFormStatus: { $in: MOHUA_CLAIM_LETTERS_LISTED_STATUSES },
          installment: 1,
        }),
      );
    });

    it('marks a state Received with its claimed total and ULBs, and every other state Pending', async () => {
      batchModel.find.mockReturnValue(
        q([
          batch(),
          batch({
            _id: new Types.ObjectId(),
            batchNumber: 2,
            ulbCount: 6,
            financialSummary: { currentSelectedClaim: 50_000_000 },
          }),
        ]),
      );

      const { states, year } = await service.listStates(yearId, 1);

      expect(year).toEqual({ id: yearId, label: '2026-27' });
      expect(states.map((s) => s.name)).toEqual(['Tripura', 'Kerala']);
      expect(states[1]).toMatchObject({
        firstClaimStatus: 'PENDING',
        amountClaimed: null,
        ulbsIncluded: null,
        claimLetterCount: 0,
        latestClaimNumber: null,
      });
      expect(states[0]).toMatchObject({
        firstClaimStatus: 'RECEIVED',
        amountClaimed: 180_000_000,
        ulbsIncluded: 10,
        claimLetterCount: 2,
        latestClaimNumber: 2,
      });
    });

    it('puts states with a claim letter first, and keeps each group alphabetical', async () => {
      const assam = { _id: new Types.ObjectId(), name: 'Assam', code: 'AS' };
      stateModel.find.mockReturnValue(q([assam, kerala, tripura]));
      batchModel.find.mockReturnValue(q([batch({ state: kerala._id })]));

      const { states } = await service.listStates(yearId, 1);

      expect(states.map((s) => s.name)).toEqual(['Kerala', 'Assam', 'Tripura']);
    });

    it("shows half of the year's basic + performance grant as each state's installment allocation, null when it has none", async () => {
      grantAllocationModel.find.mockReturnValue(
        q([{ stateId: tripura._id, basic: 1_000_000_000, performance: 301_000_001 }]),
      );

      const { states } = await service.listStates(yearId, 1);

      expect(grantAllocationModel.find).toHaveBeenCalledWith({ yearId: new Types.ObjectId(yearId) });
      expect(states.find((s) => s.name === 'Tripura')?.installmentAllocation).toBe(650_500_001); // (1,000,000,000 + 301,000,001) / 2, rounded
      expect(states.find((s) => s.name === 'Kerala')?.installmentAllocation).toBeNull();
    });

    it('404s for an unknown year and for an installment that is not supported yet', async () => {
      yearModel.findById.mockReturnValue(q(null));
      await expect(service.listStates(yearId, 1)).rejects.toThrow(NotFoundException);
      await expect(service.listStates(yearId, 2)).rejects.toThrow(NotFoundException);
    });
  });

  describe('listStateClaimLetters', () => {
    it("returns the state's letters with number, received date, ULBs, amount and status", async () => {
      batchModel.find.mockReturnValue(q([batch()]));

      const result = await service.listStateClaimLetters(String(tripura._id), yearId, 1);

      expect(result.state).toEqual({ id: String(tripura._id), name: 'Tripura' });
      expect(result.claimLetters).toEqual([
        {
          id: String(batchId),
          number: 'CF_TR_2026-27_1',
          batchNumber: 1,
          receivedOn: '2026-10-26T07:03:52.868Z',
          ulbCount: 4,
          amount: 130_000_000,
          status: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
          statusLabel: 'Under Review by MoHUA',
        },
      ]);
    });

    it('summarises the state: ULBs claimed and pending, ULBs per status, and the amount claimed against the balance', async () => {
      const allocation = 1_000_000_000; // (basic 1.2bn + performance 0.8bn) / 2
      grantAllocationModel.find.mockReturnValue(
        q([{ stateId: tripura._id, basic: 1_200_000_000, performance: 800_000_000 }]),
      );
      batchModel.find.mockReturnValue(
        q([
          batch({ ulbCount: 40, currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA }),
          batch({ _id: new Types.ObjectId(), ulbCount: 12, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }),
          batch({ _id: new Types.ObjectId(), ulbCount: 10, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_SO }),
          batch({ _id: new Types.ObjectId(), ulbCount: 6, currentFormStatus: FORM_STATUS.RETURNED_BY_MOHUA }),
          batch({ _id: new Types.ObjectId(), ulbCount: 4, currentFormStatus: FORM_STATUS.RETURNED_BY_SO }),
        ]),
      );
      expectedUlbs.resolve.mockResolvedValue(Array.from({ length: 123 }, (_, i) => ({ ulbId: `u${i}` })));
      eligibility.resolveRemainingUlbIds.mockResolvedValue(Array.from({ length: 51 }, (_, i) => `u${i}`));
      eligibility.getClaimStatusBreakdown.mockResolvedValue({
        totalAlreadyAcknowledged: 400_000_000,
        totalClaimInProgress: 200_000_000,
        totalClaimInDraft: 0,
        availableToClaim: 400_000_000,
      });

      const { summary } = await service.listStateClaimLetters(String(tripura._id), yearId, 1);

      expect(eligibility.getClaimStatusBreakdown).toHaveBeenCalledWith(String(tripura._id), yearId, 1, allocation);
      expect(summary).toEqual({
        claimedUlbs: 72,
        pendingUlbs: 51,
        approvedUlbs: 40,
        underReviewUlbs: 22,
        returnedUlbs: 10,
        amountClaimed: 600_000_000,
        balance: 400_000_000,
      });
    });

    it('never shows a negative balance when a state has claimed more than its allocation', async () => {
      grantAllocationModel.find.mockReturnValue(q([{ stateId: tripura._id, basic: 100, performance: 100 }]));
      batchModel.find.mockReturnValue(q([batch()]));
      eligibility.getClaimStatusBreakdown.mockResolvedValue({
        totalAlreadyAcknowledged: 0,
        totalClaimInProgress: 500,
        totalClaimInDraft: 0,
        availableToClaim: -400,
      });

      const { summary } = await service.listStateClaimLetters(String(tripura._id), yearId, 1);

      expect(summary.balance).toBe(0);
    });

    it("leaves a returned letter's amount out of the states table claimed total, but keeps its ULBs", async () => {
      batchModel.find.mockReturnValue(
        q([
          batch({ currentFormStatus: FORM_STATUS.RETURNED_BY_MOHUA }),
          batch({ _id: new Types.ObjectId(), ulbCount: 6, financialSummary: { currentSelectedClaim: 50_000_000 } }),
        ]),
      );

      const { states } = await service.listStates(yearId, 1);

      expect(states[0]).toMatchObject({ amountClaimed: 50_000_000, ulbsIncluded: 10 });
    });

    it('404s for an unknown state', async () => {
      stateModel.findById.mockReturnValue(q(null));
      await expect(service.listStateClaimLetters(String(tripura._id), yearId, 1)).rejects.toThrow(NotFoundException);
    });
  });

  describe('getClaimLetter', () => {
    it('returns the headline numbers and a signed URL for the State-signed file', async () => {
      batchUlbModel.countDocuments.mockResolvedValue(2);

      const detail = await service.getClaimLetter(String(batchId));

      expect(detail.signedClaimFile).toEqual({ name: 'Doc1.pdf', url: 'https://signed/file', sizeKb: 67 });
      expect(fileTokens.signFileUrlForSession).toHaveBeenCalledWith('a/b/Doc1.pdf', 'inline');
      expect(detail.summary).toEqual({ claimAmountReceived: 130_000_000, totalCities: 4, exemptionsApplied: 2 });
      expect(detail.state).toEqual({ id: String(tripura._id), name: 'Tripura' });
    });

    it('has no file when the State attached none, and never signs an empty path', async () => {
      batchModel.findOne.mockReturnValue(q(batch({ signedClaimFile: null })));

      expect((await service.getClaimLetter(String(batchId))).signedClaimFile).toBeNull();
      expect(fileTokens.signFileUrlForSession).not.toHaveBeenCalled();
    });

    it('404s for a letter that is not listed (draft, decided or superseded)', async () => {
      batchModel.findOne.mockReturnValue(q(null));
      await expect(service.getClaimLetter(String(batchId))).rejects.toThrow(NotFoundException);
    });

    it('has no return details while the letter is not returned', async () => {
      expect((await service.getClaimLetter(String(batchId))).returnDetails).toBeNull();
      expect(history.findLatestRejection).not.toHaveBeenCalled();
    });

    it("summarises a returned letter's return: who, when, remarks and what it reopened", async () => {
      const [ulbA, ulbB] = [new Types.ObjectId(), new Types.ObjectId()];
      const form = new Types.ObjectId();
      batchModel.findOne.mockReturnValue(q(batch({ currentFormStatus: FORM_STATUS.RETURNED_BY_SO })));
      history.findLatestRejection.mockResolvedValue({
        reason: 'Fix the elected body list',
        changedBy: { name: 'SO User' },
        changedAt: new Date('2026-10-30T10:00:00.000Z'),
        rejectedSourceRefs: [
          { formId: 23, formDocumentId: form, rowDocumentId: null, ulbId: null, remark: 'Fix the elected body list' },
          { formId: 23, formDocumentId: form, rowDocumentId: new Types.ObjectId(), ulbId: ulbA, remark: 'x' },
          { formId: 33, formDocumentId: new Types.ObjectId(), rowDocumentId: null, ulbId: ulbA, remark: 'Wrong IFSC' },
          { formId: 33, formDocumentId: new Types.ObjectId(), rowDocumentId: null, ulbId: ulbB, remark: 'Wrong IFSC' },
        ],
      });

      const { returnDetails } = await service.getClaimLetter(String(batchId));

      expect(history.findLatestRejection).toHaveBeenCalledWith(batchId);
      expect(returnDetails).toEqual({
        returnedAt: '2026-10-30T10:00:00.000Z',
        returnedBy: 'SO User',
        stateRemark: 'Fix the elected body list',
        stateForms: [{ formId: 23, ulbCount: 1 }],
        ulbForms: [{ formId: 33, ulbCount: 2 }],
        returnedUlbCount: 2,
      });
    });
  });

  describe('getClaimLetterUlbs', () => {
    const row = (name: string, exempt: boolean) => ({
      ulbId: new Types.ObjectId(),
      ulbSnapshot: { name, censusCode: '801523' },
      allocatedAmount: 32_500_000,
      claimedAmount: 32_500_000,
      appliedExemptionIds: exempt ? [new Types.ObjectId()] : [],
    });

    it("pages the letter's ULBs, flagging those that came in through an exemption", async () => {
      batchUlbModel.countDocuments.mockResolvedValue(2);
      batchUlbModel.find.mockReturnValue(q([row('Agartala Municipal Corporation', false), row('Dharmanagar', true)]));

      const result = await service.getClaimLetterUlbs(String(batchId), { limit: 20 });

      expect(result.pagination).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });
      expect(result.items.map((i) => i.ulbStatus)).toEqual(['ELIGIBLE', 'ELIGIBLE_VIA_EXEMPTION']);
      expect(result.items[0]).toMatchObject({
        name: 'Agartala Municipal Corporation',
        installmentShare: 32_500_000,
        claimedAmount: 32_500_000,
        reviewStatusLabel: 'Under Review by MoHUA',
      });
    });

    it('searches by name or census code, escaping regex characters, and clamps a page past the end', async () => {
      batchUlbModel.countDocuments.mockResolvedValue(3);

      const result = await service.getClaimLetterUlbs(String(batchId), { search: 'Agar(tala', limit: 2, page: 9 });

      const filter = batchUlbModel.countDocuments.mock.calls[0][0] as { $or: { [k: string]: RegExp }[] };
      expect(filter.$or).toHaveLength(2);
      expect(filter.$or[0]['ulbSnapshot.name'].test('Agar(tala')).toBe(true);
      expect(result.pagination.page).toBe(2);
    });

    it('404s for a letter that is not listed', async () => {
      batchModel.findOne.mockReturnValue(q(null));
      await expect(service.getClaimLetterUlbs(String(batchId), {})).rejects.toThrow(NotFoundException);
    });

    it('on a returned letter, shows the status and reopened forms only for the ULBs the return touched', async () => {
      const [returned, untouched] = [row('Khowai', false), row('Melaghar', false)];
      batchModel.findOne.mockReturnValue(q(batch({ currentFormStatus: FORM_STATUS.RETURNED_BY_SO })));
      batchUlbModel.find.mockReturnValue(q([returned, untouched]));
      history.findLatestRejection.mockResolvedValue({
        reason: null,
        changedBy: null,
        changedAt: new Date(),
        rejectedSourceRefs: [
          { formId: 30, formDocumentId: new Types.ObjectId(), rowDocumentId: null, ulbId: returned.ulbId, remark: 'r' },
          {
            formId: 23,
            formDocumentId: new Types.ObjectId(),
            rowDocumentId: new Types.ObjectId(),
            ulbId: returned.ulbId,
            remark: 'r',
          },
        ],
      });

      const { items } = await service.getClaimLetterUlbs(String(batchId), {});

      expect(items[0]).toMatchObject({ reviewStatus: FORM_STATUS.RETURNED_BY_SO, returnedFormIds: [30, 23] });
      expect(items[1]).toMatchObject({ reviewStatus: null, reviewStatusLabel: null, returnedFormIds: [] });
    });
  });

  describe('approve', () => {
    const approver = {
      _id: new Types.ObjectId().toString(),
      role: 'MoHUA',
      scope: 'MOHUA',
      accessLevel: null,
    } as never;

    beforeEach(() => {
      batchModel.findOne.mockReturnValue(q(batch({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_SO })));
    });

    it('moves a letter under SO review to MoHUA review, moves its forms and logs it, in one transaction', async () => {
      const result = await service.approve(String(batchId), 3, '  All good  ', approver, '1.2.3.4', 'jest');

      const [filter, update] = batchModel.findOneAndUpdate.mock.calls[0];
      expect(filter).toMatchObject({
        _id: batchId,
        currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_SO,
        revision: 3,
        isAbandoned: false,
      });
      expect(update.$set).toMatchObject({
        currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
        mohuaRemarks: 'All good',
      });
      expect(update.$inc).toEqual({ revision: 1 });
      expect(formStatus.moveFormsToMohuaReview).toHaveBeenCalledWith(batchId, expect.anything(), session);
      expect(history.recordTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          fromStatus: FORM_STATUS.UNDER_REVIEW_BY_SO,
          toStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
          actionSource: 'DIRECT_MOHUA_REVIEW',
          reason: 'All good',
          ipAddress: '1.2.3.4',
        }),
        session,
      );
      expect(session.commitTransaction).toHaveBeenCalled();
      expect(session.endSession).toHaveBeenCalled();
      expect(result.id).toBe(String(batchId));
    });

    it("copies the verified letter's ULBs into the OM rows, in the approval's transaction", async () => {
      const child = {
        _id: new Types.ObjectId(),
        state: tripura._id,
        year: new Types.ObjectId(yearId),
        installment: 1,
        ulbId: new Types.ObjectId(),
        ulbSnapshot: { name: 'Khowai' },
        allocatedAmount: 30,
        claimedAmount: 30,
      };
      batchUlbModel.find.mockReturnValue(q([child]));

      await service.approve(String(batchId), 3, undefined, approver);

      expect(omUlbModel.insertMany).toHaveBeenCalledWith(
        [expect.objectContaining({ claimLetter: batchId, claimLetterUlb: child._id, ulbId: child.ulbId, om: null })],
        { session },
      );
    });

    it('refuses, and writes nothing, when the letter changed since the page loaded', async () => {
      batchModel.findOneAndUpdate.mockReturnValue(q(null));

      await expect(service.approve(String(batchId), 2, undefined, approver)).rejects.toThrow(ConflictException);

      expect(formStatus.moveFormsToMohuaReview).not.toHaveBeenCalled();
      expect(history.recordTransition).not.toHaveBeenCalled();
      expect(session.abortTransaction).toHaveBeenCalled();
      expect(session.commitTransaction).not.toHaveBeenCalled();
    });

    it.each([FORM_STATUS.UNDER_REVIEW_BY_MOHUA, FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA])(
      'is a no-op for a letter already past SO review (status %s)',
      async (currentFormStatus) => {
        batchModel.findOne.mockReturnValue(q(batch({ currentFormStatus })));

        await service.approve(String(batchId), 3, undefined, approver);

        expect(connection.startSession).not.toHaveBeenCalled();
        expect(batchModel.findOneAndUpdate).not.toHaveBeenCalled();
      },
    );

    it.each([FORM_STATUS.RETURNED_BY_SO, FORM_STATUS.RETURNED_BY_MOHUA])(
      'only approves a letter under SO review, not a returned one (status %s)',
      async (currentFormStatus) => {
        batchModel.findOne.mockReturnValue(q(batch({ currentFormStatus })));

        await expect(service.approve(String(batchId), 3, undefined, approver)).rejects.toThrow(ConflictException);
      },
    );

    it('404s for a letter that is not listed', async () => {
      batchModel.findOne.mockReturnValue(q(null));

      await expect(service.approve(String(batchId), 3, undefined, approver)).rejects.toThrow(NotFoundException);
    });

    it('refuses while any ULB is marked returned, and writes nothing', async () => {
      batchUlbModel.exists.mockResolvedValue({ _id: new Types.ObjectId() });

      await expect(service.approve(String(batchId), 3, undefined, approver)).rejects.toThrow(ConflictException);

      expect(batchUlbModel.exists).toHaveBeenCalledWith({ claimLetter: batchId, 'soDecision.status': 'RETURNED' });
      expect(connection.startSession).not.toHaveBeenCalled();
    });
  });

  describe('decideUlb', () => {
    const so = { _id: new Types.ObjectId().toString(), role: 'MoHUA', scope: 'MOHUA', accessLevel: null } as never;
    const ulbId = new Types.ObjectId().toString();

    beforeEach(() => {
      batchModel.findOne.mockReturnValue(q(batch({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_SO })));
    });

    it("saves a RETURNED mark with the ULB's forms, rows and trimmed remark, without touching the letter", async () => {
      const result = await service.decideUlb(
        String(batchId),
        ulbId,
        { status: 'RETURNED', ulbFormIds: [33], rowFormIds: [23], remark: '  Wrong IFSC  ' },
        so,
      );

      const [filter, update] = batchUlbModel.updateOne.mock.calls[0];
      expect(filter).toEqual({ claimLetter: batchId, ulbId: new Types.ObjectId(ulbId) });
      expect(update.$set.soDecision).toMatchObject({
        status: 'RETURNED',
        ulbFormIds: [33],
        rowFormIds: [23],
        remark: 'Wrong IFSC',
      });
      expect(result).toMatchObject({ status: 'RETURNED', remark: 'Wrong IFSC' });
      expect(batchModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('clears the mark for PENDING', async () => {
      expect(await service.decideUlb(String(batchId), ulbId, { status: 'PENDING' }, so)).toBeNull();
      expect(batchUlbModel.updateOne.mock.calls[0][1]).toEqual({ $set: { soDecision: null } });
    });

    it('needs a form for RETURNED, a letter under SO review, and a ULB in the letter', async () => {
      await expect(service.decideUlb(String(batchId), ulbId, { status: 'RETURNED' }, so)).rejects.toThrow(
        BadRequestException,
      );

      batchUlbModel.updateOne.mockReturnValue(q({ matchedCount: 0 }));
      await expect(service.decideUlb(String(batchId), ulbId, { status: 'PENDING' }, so)).rejects.toThrow(
        NotFoundException,
      );

      batchModel.findOne.mockReturnValue(q(batch({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA })));
      await expect(service.decideUlb(String(batchId), ulbId, { status: 'PENDING' }, so)).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('returnForCorrection', () => {
    const so = { _id: new Types.ObjectId().toString(), role: 'MoHUA', scope: 'MOHUA', accessLevel: null } as never;
    const ulbId = new Types.ObjectId();
    const dto = (extra: Record<string, unknown> = {}) =>
      ({ expectedRevision: 3, stateFormIds: [22], stateRemark: ' Fix the SFC status ', ...extra }) as never;
    const returnedUlb = {
      ulbId,
      soDecision: { status: 'RETURNED', ulbFormIds: [33], rowFormIds: [23], remark: 'Wrong IFSC' },
    };

    beforeEach(() => {
      batchModel.findOne.mockReturnValue(q(batch({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_SO })));
      batchUlbModel.find.mockReturnValue(q([returnedUlb]));
    });

    it('closes the letter (16, slot freed), releases its locks, reopens each marked ULB and the picked State items, in one transaction', async () => {
      const reopened = [
        { formId: 22, formDocumentId: new Types.ObjectId(), rowDocumentId: null, ulbId: null, remark: 'x' },
      ];
      formStatus.returnFormsForCorrection.mockResolvedValue(reopened);

      await service.returnForCorrection(String(batchId), dto(), so, '1.2.3.4', 'jest');

      expect(batchUlbModel.find).toHaveBeenCalledWith({ claimLetter: batchId, 'soDecision.status': 'RETURNED' });
      const [filter, update] = batchModel.findOneAndUpdate.mock.calls[0];
      expect(filter).toMatchObject({
        currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_SO,
        revision: 3,
        isAbandoned: false,
      });
      expect(update.$set).toMatchObject({
        currentFormStatus: FORM_STATUS.RETURNED_BY_SO,
        isAbandoned: true,
        mohuaRemarks: 'Fix the SFC status',
      });
      expect(update.$inc).toEqual({ revision: 1 });
      expect(lockModel.deleteMany).toHaveBeenCalledWith({ claimLetter: batchId, lockState: 'ACTIVE' }, { session });
      expect(formStatus.returnFormsForCorrection).toHaveBeenCalledWith(
        batchId,
        {
          ulbReturns: [
            {
              ulbId,
              ulbFormIds: [33],
              rowFormIds: [23],
              remark: 'Wrong IFSC',
              decision: expect.objectContaining({ status: 'RETURNED', note: 'Wrong IFSC' }) as unknown,
            },
          ],
          stateFormIds: [22],
          stateRemark: 'Fix the SFC status',
        },
        expect.objectContaining({ status: 'RETURNED', note: 'Fix the SFC status' }),
        session,
      );
      expect(history.recordTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          fromStatus: FORM_STATUS.UNDER_REVIEW_BY_SO,
          toStatus: FORM_STATUS.RETURNED_BY_SO,
          actionSource: 'CLAIM_LETTER_REJECTION',
          rejectedSourceRefs: reopened,
        }),
        session,
      );
      expect(session.commitTransaction).toHaveBeenCalled();
    });

    it('refuses, and writes nothing else, when the letter changed since the page loaded', async () => {
      batchModel.findOneAndUpdate.mockReturnValue(q(null));

      await expect(service.returnForCorrection(String(batchId), dto(), so)).rejects.toThrow(ConflictException);

      expect(lockModel.deleteMany).not.toHaveBeenCalled();
      expect(formStatus.returnFormsForCorrection).not.toHaveBeenCalled();
      expect(session.abortTransaction).toHaveBeenCalled();
    });

    it('needs a ULB marked returned or a State item picked', async () => {
      batchUlbModel.find.mockReturnValue(q([]));

      await expect(service.returnForCorrection(String(batchId), dto({ stateFormIds: [] }), so)).rejects.toThrow(
        BadRequestException,
      );
      expect(connection.startSession).not.toHaveBeenCalled();
    });

    it('is a no-op for a letter already returned, and refuses one past SO review', async () => {
      batchModel.findOne.mockReturnValue(q(batch({ currentFormStatus: FORM_STATUS.RETURNED_BY_SO })));
      await service.returnForCorrection(String(batchId), dto(), so);
      expect(connection.startSession).not.toHaveBeenCalled();

      batchModel.findOne.mockReturnValue(q(batch({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA })));
      await expect(service.returnForCorrection(String(batchId), dto(), so)).rejects.toThrow(ConflictException);
    });
  });

  describe('"Eligible via exemption" ULBs', () => {
    const so = { _id: new Types.ObjectId().toString(), role: 'MoHUA', scope: 'MOHUA', accessLevel: null } as never;
    const ulbId = new Types.ObjectId();
    const exemptionId = new Types.ObjectId();
    const formDocumentId = new Types.ObjectId();
    const exemptChild = () => ({
      ulbId,
      eligibilitySources: [
        { formId: 23, formDocumentId, exemptionId, exemptionKind: 'DISCRETIONARY_ULB' },
        // An automatic new-ULB exemption has no request: MoHUA has nothing to decide.
        { formId: 30, formDocumentId: null, exemptionId: null, exemptionKind: 'AUTO_NEW_ULB_STUB' },
      ],
    });
    const exemptionAt = (currentFormStatus: number) =>
      exemptionModel.find.mockReturnValue(q([{ _id: exemptionId, data: [{ formId: 23, currentFormStatus }] }]));

    beforeEach(() => {
      batchModel.findOne.mockReturnValue(q(batch({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_SO })));
    });

    it("lists each ULB's own exemptions with their live status", async () => {
      batchUlbModel.find.mockReturnValue(
        q([{ ...exemptChild(), ulbSnapshot: { name: 'Test TT' }, allocatedAmount: 1, claimedAmount: 1 }]),
      );
      exemptionAt(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);

      const { items } = await service.getClaimLetterUlbs(String(batchId), {});

      expect(items[0].exemptions).toEqual([
        { formId: 23, exemptionId: String(exemptionId), status: FORM_STATUS.UNDER_REVIEW_BY_MOHUA },
      ]);
    });

    it('marks an exemption for rejection only while it is under review, with a remark, and never its forms', async () => {
      batchUlbModel.findOne.mockReturnValue(q(exemptChild()));
      exemptionAt(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
      const decide = (dto: Record<string, unknown>) =>
        service.decideUlb(String(batchId), String(ulbId), { status: 'RETURNED', ...dto } as never, so);

      await decide({ rejectExemptionFormIds: [23], remark: ' Election not held ' });
      expect(batchUlbModel.updateOne.mock.calls[0][1].$set.soDecision).toMatchObject({
        rejectExemptionFormIds: [23],
        remark: 'Election not held',
      });

      await expect(decide({ rejectExemptionFormIds: [23] })).rejects.toThrow(BadRequestException);
      await expect(decide({ ulbFormIds: [33] })).rejects.toThrow(BadRequestException);
      await expect(decide({ rejectExemptionFormIds: [30], remark: 'x' })).rejects.toThrow(BadRequestException);

      exemptionAt(FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA);
      await expect(decide({ rejectExemptionFormIds: [23], remark: 'x' })).rejects.toThrow(ConflictException);
    });

    it('approving the letter approves every exemption still under review, before the letter moves', async () => {
      batchUlbModel.find.mockReturnValue(q([exemptChild()]));
      exemptionAt(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);

      await service.approve(String(batchId), 3, undefined, so, '1.2.3.4', 'jest');

      expect(exemptionService.approve).toHaveBeenCalledTimes(1);
      expect(exemptionService.approve).toHaveBeenCalledWith(String(exemptionId), 23, so, '1.2.3.4', 'jest');
      expect(exemptionService.approve.mock.invocationCallOrder[0]).toBeLessThan(
        connection.startSession.mock.invocationCallOrder[0],
      );
    });

    it('does not decide the letter when an exemption approval fails', async () => {
      batchUlbModel.find.mockReturnValue(q([exemptChild()]));
      exemptionAt(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
      exemptionService.approve.mockRejectedValue(new ConflictException('form moved on'));

      await expect(service.approve(String(batchId), 3, undefined, so)).rejects.toThrow(ConflictException);
      expect(connection.startSession).not.toHaveBeenCalled();
    });

    describe('returning the letter', () => {
      const marked = () => ({
        ...exemptChild(),
        soDecision: {
          status: 'RETURNED',
          ulbFormIds: [],
          rowFormIds: [],
          rejectExemptionFormIds: [23],
          remark: 'No election',
        },
      });
      const dto = { expectedRevision: 3, stateFormIds: [] } as never;

      beforeEach(() => batchUlbModel.find.mockReturnValue(q([marked()])));

      it('rejects the picked exemption with the ULB remark and records it in the history', async () => {
        exemptionAt(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);

        await service.returnForCorrection(String(batchId), dto, so, '1.2.3.4', 'jest');

        expect(exemptionService.reject).toHaveBeenCalledTimes(1);
        expect(exemptionService.reject).toHaveBeenCalledWith(
          String(exemptionId),
          23,
          'No election',
          so,
          '1.2.3.4',
          'jest',
        );
        expect(history.recordTransition).toHaveBeenCalledWith(
          expect.objectContaining({
            rejectedSourceRefs: [{ formId: 23, formDocumentId, rowDocumentId: null, ulbId, remark: 'No election' }],
          }),
          session,
        );
      });

      it('skips an exemption already rejected (a retry), and stops on one approved meanwhile', async () => {
        exemptionAt(FORM_STATUS.RETURNED_BY_MOHUA);
        await service.returnForCorrection(String(batchId), dto, so);
        expect(exemptionService.reject).not.toHaveBeenCalled();

        connection.startSession.mockClear();
        exemptionAt(FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA);
        await expect(service.returnForCorrection(String(batchId), dto, so)).rejects.toThrow(ConflictException);
        expect(connection.startSession).not.toHaveBeenCalled();
      });
    });
  });
});
