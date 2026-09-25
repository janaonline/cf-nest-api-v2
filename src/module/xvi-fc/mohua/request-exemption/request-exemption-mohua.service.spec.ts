import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { XviFcEligibilityExemption } from 'src/schemas/xvi-fc/state/xvi-fc-eligibility-exemption.schema';
import { XviFcEligibilityExemptionFormLog } from 'src/schemas/xvi-fc/state/xvi-fc-eligibility-exemption-form-log.schema';
import { XviFcAnnualAccount } from 'src/schemas/xvi-fc/annual-account.schema';
import { XviFcSfcStatus } from 'src/schemas/xvi-fc/state/sfc-status.schema';
import { RequestExemptionMohuaService } from './request-exemption-mohua.service';

/** find/findById/findOne().lean().session().exec() chain mock. */
function q<T>(value: T) {
  const chain: Record<string, unknown> = {
    lean: jest.fn(() => chain),
    session: jest.fn(() => chain),
    exec: jest.fn().mockResolvedValue(value),
  };
  return chain;
}

function makeSession() {
  return {
    startTransaction: jest.fn(),
    commitTransaction: jest.fn().mockResolvedValue(undefined),
    abortTransaction: jest.fn().mockResolvedValue(undefined),
    endSession: jest.fn().mockResolvedValue(undefined),
  };
}

describe('RequestExemptionMohuaService', () => {
  const requestId = new Types.ObjectId();
  const ulbId = new Types.ObjectId();
  const stateId = new Types.ObjectId();
  const yearId = new Types.ObjectId();
  const mohuaUser: AuthUser = {
    _id: new Types.ObjectId().toString(),
    role: UserRole.ADMIN,
    scope: Scope.MOHUA,
  } as AuthUser;

  let service: RequestExemptionMohuaService;
  let exemptionModel: { findById: jest.Mock; findOneAndUpdate: jest.Mock };
  let exemptionLogModel: { create: jest.Mock };
  let annualAccountModel: { findOne: jest.Mock };
  let sfcStatusModel: { findOne: jest.Mock };
  let session: ReturnType<typeof makeSession>;
  let connection: { startSession: jest.Mock };

  function pendingDoc(formId: number, overrides: Record<string, unknown> = {}) {
    return {
      _id: requestId,
      state: stateId,
      year: yearId,
      ulb: ulbId,
      data: [{ formId, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA, ...overrides }],
    };
  }

  /** A whole-state (ulb: null) request document — e.g. an SFC (formId 22) exemption. */
  function pendingStateDoc(formId: number, overrides: Record<string, unknown> = {}) {
    return {
      _id: requestId,
      state: stateId,
      year: yearId,
      ulb: null,
      data: [{ formId, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA, ...overrides }],
    };
  }

  beforeEach(async () => {
    session = makeSession();
    connection = { startSession: jest.fn().mockResolvedValue(session) };

    exemptionModel = {
      findById: jest.fn().mockReturnValue(q(pendingDoc(30))),
      findOneAndUpdate: jest.fn().mockReturnValue(q({ _id: requestId })),
    };
    exemptionLogModel = { create: jest.fn().mockResolvedValue([{}]) };
    annualAccountModel = { findOne: jest.fn().mockReturnValue(q(null)) };
    sfcStatusModel = { findOne: jest.fn().mockReturnValue(q(null)) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestExemptionMohuaService,
        { provide: getModelToken(XviFcEligibilityExemption.name), useValue: exemptionModel },
        { provide: getModelToken(XviFcEligibilityExemptionFormLog.name), useValue: exemptionLogModel },
        { provide: getModelToken(XviFcAnnualAccount.name), useValue: annualAccountModel },
        { provide: getModelToken(XviFcSfcStatus.name), useValue: sfcStatusModel },
        { provide: getConnectionToken(), useValue: connection },
      ],
    }).compile();

    service = module.get(RequestExemptionMohuaService);
  });

  describe('approve', () => {
    it('rejects a non-MoHUA/ADMIN caller before touching any model', async () => {
      const stateUser: AuthUser = { _id: 'u-1', role: UserRole.ADMIN, scope: Scope.STATE } as AuthUser;

      await expect(service.approve(requestId.toString(), 30, stateUser, '127.0.0.1', 'jest')).rejects.toThrow(
        ForbiddenException,
      );
      expect(exemptionModel.findById).not.toHaveBeenCalled();
    });

    it('404s when the request document does not exist', async () => {
      exemptionModel.findById.mockReturnValue(q(null));

      await expect(service.approve(requestId.toString(), 30, mohuaUser, '127.0.0.1', 'jest')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('404s when no data[] entry matches the given formId', async () => {
      exemptionModel.findById.mockReturnValue(q(pendingDoc(30)));

      await expect(service.approve(requestId.toString(), 99, mohuaUser, '127.0.0.1', 'jest')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('blocks (409, not 403) an entry that is not currently UNDER_REVIEW_BY_MOHUA, without starting a transaction', async () => {
      exemptionModel.findById.mockReturnValue(
        q(pendingDoc(30, { currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA })),
      );

      await expect(service.approve(requestId.toString(), 30, mohuaUser, '127.0.0.1', 'jest')).rejects.toThrow(
        ConflictException,
      );
      expect(connection.startSession).not.toHaveBeenCalled();
    });

    it('never writes to xvifc_annualaccounts - approving only flips the exemption entry itself', async () => {
      annualAccountModel.findOne.mockReturnValue(
        q({ _id: new Types.ObjectId(), form_status_id: FORM_STATUS.NOT_STARTED }),
      );

      await service.approve(requestId.toString(), 30, mohuaUser, '127.0.0.1', 'jest');

      expect(annualAccountModel.findOne).toHaveBeenCalledWith(
        { ulb: ulbId, design_year: yearId, sectionType: 'audited' },
        { form_status_id: 1 },
      );
      expect(exemptionModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: requestId, data: { $elemMatch: { formId: 30, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA } } },
        {
          $set: expect.objectContaining({
            'data.$.currentFormStatus': FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
            'data.$.mohuaRemarks': null,
          }),
        },
        { session },
      );
      expect(exemptionLogModel.create).toHaveBeenCalledWith(
        [expect.objectContaining({ action: 'APPROVED', formId: 30 })],
        { session },
      );
      expect(session.commitTransaction).toHaveBeenCalled();
      expect(session.abortTransaction).not.toHaveBeenCalled();
    });

    it('blocks with ConflictException when the entry was already decided by a racing call, without creating a log entry', async () => {
      exemptionModel.findOneAndUpdate.mockReturnValue(q(null));

      await expect(service.approve(requestId.toString(), 30, mohuaUser, '127.0.0.1', 'jest')).rejects.toThrow(
        ConflictException,
      );
      expect(exemptionLogModel.create).not.toHaveBeenCalled();
      expect(session.abortTransaction).toHaveBeenCalled();
      expect(session.commitTransaction).not.toHaveBeenCalled();
    });

    it('approves fine when no Annual Accounts section document exists yet at all (nothing to check, nothing to create)', async () => {
      annualAccountModel.findOne.mockReturnValue(q(null));

      await service.approve(requestId.toString(), 30, mohuaUser, '127.0.0.1', 'jest');

      expect(exemptionModel.findOneAndUpdate).toHaveBeenCalled();
      expect(session.commitTransaction).toHaveBeenCalled();
    });

    it('blocks with ConflictException, before ever starting a transaction, when the section already has real progress', async () => {
      annualAccountModel.findOne.mockReturnValue(
        q({ _id: new Types.ObjectId(), form_status_id: FORM_STATUS.UNDER_REVIEW_BY_STATE }),
      );

      await expect(service.approve(requestId.toString(), 30, mohuaUser, '127.0.0.1', 'jest')).rejects.toThrow(
        ConflictException,
      );
      expect(connection.startSession).not.toHaveBeenCalled();
      expect(exemptionModel.findOneAndUpdate).not.toHaveBeenCalled();
    });

    it('skips the Annual Accounts eligibility check entirely for formId 23 (Elected Body) - no per-ULB document to check', async () => {
      exemptionModel.findById.mockReturnValue(q(pendingDoc(23)));

      await service.approve(requestId.toString(), 23, mohuaUser, '127.0.0.1', 'jest');

      expect(annualAccountModel.findOne).not.toHaveBeenCalled();
      expect(exemptionModel.findOneAndUpdate).toHaveBeenCalled();
      expect(session.commitTransaction).toHaveBeenCalled();
    });

    it('aborts the transaction and rethrows if a write fails', async () => {
      exemptionLogModel.create.mockRejectedValue(new Error('boom'));

      await expect(service.approve(requestId.toString(), 30, mohuaUser, '127.0.0.1', 'jest')).rejects.toThrow('boom');
      expect(session.abortTransaction).toHaveBeenCalled();
      expect(session.commitTransaction).not.toHaveBeenCalled();
    });

    it('approves a whole-state (ulb: null) request fine when SFC Status has no real progress', async () => {
      exemptionModel.findById.mockReturnValue(q(pendingStateDoc(22)));

      await service.approve(requestId.toString(), 22, mohuaUser, '127.0.0.1', 'jest');

      // formId 22 isn't in AFS_SECTION_TYPE_BY_FORM_ID, so the Annual Accounts check never even
      // needs `ulb` to be non-null in the first place - it's checked against SFC Status instead.
      expect(annualAccountModel.findOne).not.toHaveBeenCalled();
      expect(sfcStatusModel.findOne).toHaveBeenCalledWith(
        { state: stateId, year: yearId, formType: 'SFC_STATUS', isDeleted: false },
        { currentFormStatus: 1 },
      );
      expect(exemptionLogModel.create).toHaveBeenCalledWith(
        [expect.objectContaining({ ulb: null, action: 'APPROVED', formId: 22 })],
        { session },
      );
      expect(session.commitTransaction).toHaveBeenCalled();
      expect(session.abortTransaction).not.toHaveBeenCalled();
    });

    it('blocks approving a whole-state (formId 22) request with ConflictException when SFC Status already has real progress', async () => {
      exemptionModel.findById.mockReturnValue(q(pendingStateDoc(22)));
      sfcStatusModel.findOne.mockReturnValue(q({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }));

      await expect(service.approve(requestId.toString(), 22, mohuaUser, '127.0.0.1', 'jest')).rejects.toThrow(
        ConflictException,
      );
      expect(exemptionModel.findOneAndUpdate).not.toHaveBeenCalled();
      expect(connection.startSession).not.toHaveBeenCalled();
    });

    it('approves a whole-state (formId 22) request fine when SFC Status is still in an editable status', async () => {
      exemptionModel.findById.mockReturnValue(q(pendingStateDoc(22)));
      sfcStatusModel.findOne.mockReturnValue(q({ currentFormStatus: FORM_STATUS.IN_PROGRESS }));

      await service.approve(requestId.toString(), 22, mohuaUser, '127.0.0.1', 'jest');

      expect(exemptionModel.findOneAndUpdate).toHaveBeenCalled();
      expect(session.commitTransaction).toHaveBeenCalled();
    });

    it('never checks SFC Status for a per-ULB request (formId 30/31)', async () => {
      await service.approve(requestId.toString(), 30, mohuaUser, '127.0.0.1', 'jest');

      expect(sfcStatusModel.findOne).not.toHaveBeenCalled();
    });
  });

  describe('reject', () => {
    it('requires a non-empty mohuaRemarks before touching any model', async () => {
      await expect(service.reject(requestId.toString(), 30, '   ', mohuaUser, '127.0.0.1', 'jest')).rejects.toThrow(
        BadRequestException,
      );
      expect(exemptionModel.findById).not.toHaveBeenCalled();
    });

    it('blocks an entry that is not currently UNDER_REVIEW_BY_MOHUA', async () => {
      exemptionModel.findById.mockReturnValue(q(pendingDoc(30, { currentFormStatus: FORM_STATUS.RETURNED_BY_MOHUA })));

      await expect(service.reject(requestId.toString(), 30, 'No.', mohuaUser, '127.0.0.1', 'jest')).rejects.toThrow(
        ConflictException,
      );
    });

    it('updates only the exemption entry and its own log - never touches Annual Accounts at all', async () => {
      await service.reject(requestId.toString(), 30, 'Missing signature.', mohuaUser, '127.0.0.1', 'jest');

      expect(exemptionModel.findOneAndUpdate).toHaveBeenCalledWith(
        { _id: requestId, data: { $elemMatch: { formId: 30, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA } } },
        {
          $set: expect.objectContaining({
            'data.$.currentFormStatus': FORM_STATUS.RETURNED_BY_MOHUA,
            'data.$.mohuaRemarks': 'Missing signature.',
          }),
        },
        { session },
      );
      expect(exemptionLogModel.create).toHaveBeenCalledWith(
        [expect.objectContaining({ action: 'RETURNED', formId: 30, mohuaRemarks: 'Missing signature.' })],
        { session },
      );
      expect(annualAccountModel.findOne).not.toHaveBeenCalled();
      expect(session.commitTransaction).toHaveBeenCalled();
    });

    it('blocks with ConflictException when the entry was already decided by a racing call, without creating a log entry', async () => {
      exemptionModel.findOneAndUpdate.mockReturnValue(q(null));

      await expect(service.reject(requestId.toString(), 30, 'No.', mohuaUser, '127.0.0.1', 'jest')).rejects.toThrow(
        ConflictException,
      );
      expect(exemptionLogModel.create).not.toHaveBeenCalled();
      expect(session.abortTransaction).toHaveBeenCalled();
      expect(session.commitTransaction).not.toHaveBeenCalled();
    });

    it('trims mohuaRemarks before persisting', async () => {
      await service.reject(requestId.toString(), 30, '  Needs another look.  ', mohuaUser, '127.0.0.1', 'jest');

      expect(exemptionModel.findOneAndUpdate).toHaveBeenCalledWith(
        expect.anything(),
        { $set: expect.objectContaining({ 'data.$.mohuaRemarks': 'Needs another look.' }) },
        expect.anything(),
      );
    });

    it('rejects a whole-state (ulb: null) request fine — same schema-nullability fix as approve', async () => {
      exemptionModel.findById.mockReturnValue(q(pendingStateDoc(22)));

      await service.reject(requestId.toString(), 22, 'Needs the extension order.', mohuaUser, '127.0.0.1', 'jest');

      expect(exemptionLogModel.create).toHaveBeenCalledWith(
        [expect.objectContaining({ ulb: null, action: 'RETURNED', formId: 22 })],
        { session },
      );
      expect(session.commitTransaction).toHaveBeenCalled();
    });
  });
});
