import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FcUnspentMohuaRowsService } from './fc-unspent-mohua-rows.service';
import { FcUnspentRowReviewDomainService } from './fc-unspent-row-review-domain.service';
import { XviFcUnspentStateFormRow } from 'src/schemas/xvi-fc/state/fc-unspent-state-form-row.schema';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { GetFcUnspentMohuaRowsQueryDto } from '../dto/get-fc-unspent-mohua-rows-query.dto';
import type { BulkApproveFcUnspentRowsDto } from '../dto/bulk-approve-fc-unspent-rows.dto';
import type { BulkRejectFcUnspentRowsDto } from '../dto/bulk-reject-fc-unspent-rows.dto';
import type { FcUnspentMohuaFormLean, FcUnspentMohuaRowLean } from '../types/fc-unspent-mohua-review.types';

function q<T>(value: T) {
  const chain: Record<string, unknown> = {};
  for (const m of ['lean', 'select', 'sort', 'skip', 'limit']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

const YEAR_2026_27 = '67d7d136d3d038946a5239e9';

const stateOid = new Types.ObjectId();
const yearOid = new Types.ObjectId(YEAR_2026_27);
const userOid = new Types.ObjectId();
const formOid = new Types.ObjectId();
const ulbOid1 = new Types.ObjectId();

const mohuaUser: AuthUser = {
  _id: userOid.toString(),
  scope: Scope.MOHUA,
  xviFcSubrole: 'admin',
} as unknown as AuthUser;
const stateUser: AuthUser = { _id: userOid.toString(), scope: Scope.STATE, state: stateOid } as unknown as AuthUser;

function makeForm(overrides: Partial<FcUnspentMohuaFormLean> = {}): FcUnspentMohuaFormLean {
  return {
    _id: formOid,
    state: stateOid,
    year: yearOid,
    currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
    isFcUnspent: true,
    fcDeclaration: null,
    checkboxConfirmation: true,
    auditRevision: 1,
    ...overrides,
  };
}

function makeRow(overrides: Partial<FcUnspentMohuaRowLean> = {}): FcUnspentMohuaRowLean {
  return {
    _id: new Types.ObjectId(),
    form: formOid,
    rowNumber: 1,
    ulbId: ulbOid1,
    censusCode: '111',
    sbCode: 'A1',
    ulbName: 'Alpha ULB',
    allocationAmount: 100,
    unspentAmount: 5,
    allocationPerc: 5,
    eligibility: true,
    rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
    rejectionRemark: null,
    ...overrides,
  };
}

describe('FcUnspentMohuaRowsService', () => {
  let service: FcUnspentMohuaRowsService;
  let rowModel: Record<string, jest.Mock>;
  let domainService: Record<string, jest.Mock>;
  let mockSession: Record<string, jest.Mock>;

  beforeEach(async () => {
    mockSession = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      abortTransaction: jest.fn().mockResolvedValue(undefined),
      endSession: jest.fn().mockResolvedValue(undefined),
    };

    rowModel = {
      find: jest.fn().mockReturnValue(q([])),
      countDocuments: jest.fn().mockReturnValue(q(0)),
      db: { startSession: jest.fn().mockResolvedValue(mockSession) } as unknown as Record<string, jest.Mock>,
    };
    domainService = {
      findForm: jest.fn().mockResolvedValue(makeForm()),
      loadActiveRowsByIds: jest.fn().mockResolvedValue({ rows: [], missingIds: [] }),
      filterNotInStatus: jest.fn().mockReturnValue([]),
      transitionRows: jest.fn().mockResolvedValue(undefined),
      maybeAcknowledgeAfterBulkAction: jest
        .fn()
        .mockResolvedValue({ acknowledged: false, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }),
      getRowSummary: jest.fn().mockResolvedValue({
        total: 0,
        active: 0,
        updatePending: 0,
        rejected: 0,
        needsUpdate: 0,
        eligible: 0,
        ineligible: 0,
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FcUnspentMohuaRowsService,
        { provide: getModelToken(XviFcUnspentStateFormRow.name), useValue: rowModel },
        { provide: FcUnspentRowReviewDomainService, useValue: domainService },
      ],
    }).compile();

    service = module.get(FcUnspentMohuaRowsService);
  });

  // ─── Access control ─────────────────────────────────────────────────────────

  describe('access control', () => {
    it('blocks a STATE user from all row-review operations', async () => {
      await expect(
        service.getRows(stateOid.toString(), yearOid.toString(), {} as GetFcUnspentMohuaRowsQueryDto, stateUser),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── getRows ────────────────────────────────────────────────────────────────

  describe('getRows', () => {
    it('404s when the form does not exist', async () => {
      domainService['findForm'] = jest.fn().mockResolvedValue(null);
      await expect(
        service.getRows(stateOid.toString(), yearOid.toString(), {} as GetFcUnspentMohuaRowsQueryDto, mohuaUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('scopes the query to the form and isActive:true', async () => {
      await service.getRows(stateOid.toString(), yearOid.toString(), {} as GetFcUnspentMohuaRowsQueryDto, mohuaUser);
      expect(rowModel['find']).toHaveBeenCalledWith(expect.objectContaining({ form: formOid, isActive: true }));
    });

    it('applies a rowStatus filter', async () => {
      await service.getRows(
        stateOid.toString(),
        yearOid.toString(),
        { rowStatus: FORM_STATUS.RETURNED_BY_MOHUA } as GetFcUnspentMohuaRowsQueryDto,
        mohuaUser,
      );
      expect(rowModel['find']).toHaveBeenCalledWith(expect.objectContaining({ rowStatus: FORM_STATUS.RETURNED_BY_MOHUA }));
    });

    it('applies an eligibility filter', async () => {
      await service.getRows(
        stateOid.toString(),
        yearOid.toString(),
        { eligibility: true } as GetFcUnspentMohuaRowsQueryDto,
        mohuaUser,
      );
      expect(rowModel['find']).toHaveBeenCalledWith(expect.objectContaining({ eligibility: true }));
    });

    it('applies a search filter over ulbName/censusCode/sbCode', async () => {
      await service.getRows(
        stateOid.toString(),
        yearOid.toString(),
        { search: 'Alpha' } as GetFcUnspentMohuaRowsQueryDto,
        mohuaUser,
      );
      const filterArg = (rowModel['find'].mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(filterArg['$and']).toBeDefined();
    });

    it('paginates via page/limit and returns pagination meta', async () => {
      rowModel['countDocuments'] = jest.fn().mockReturnValue(q(37));
      const result = await service.getRows(
        stateOid.toString(),
        yearOid.toString(),
        { page: 2, limit: 10 } as GetFcUnspentMohuaRowsQueryDto,
        mohuaUser,
      );
      expect(result.meta).toEqual({ page: 2, limit: 10, total: 37 });
    });

    it('sets row permissions.canApprove/canReject true only for UPDATE_PENDING rows on a mutable form', async () => {
      rowModel['find'] = jest
        .fn()
        .mockReturnValue(
          q([makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }), makeRow({ rowStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA })]),
        );

      const result = await service.getRows(
        stateOid.toString(),
        yearOid.toString(),
        {} as GetFcUnspentMohuaRowsQueryDto,
        mohuaUser,
      );

      expect(result.data!.rows[0].permissions).toEqual({ canApprove: true, canReject: true });
      expect(result.data!.rows[1].permissions).toEqual({ canApprove: false, canReject: false });
    });

    it('sets row permissions to false when the parent form is no longer mutable', async () => {
      domainService['findForm'] = jest
        .fn()
        .mockResolvedValue(makeForm({ currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA }));
      rowModel['find'] = jest.fn().mockReturnValue(q([makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA })]));

      const result = await service.getRows(
        stateOid.toString(),
        yearOid.toString(),
        {} as GetFcUnspentMohuaRowsQueryDto,
        mohuaUser,
      );

      expect(result.data!.rows[0].permissions).toEqual({ canApprove: false, canReject: false });
    });
  });

  // ─── bulkApproveRows ────────────────────────────────────────────────────────

  describe('bulkApproveRows', () => {
    function approveDto(rowIds: string[] = [new Types.ObjectId().toString()]): BulkApproveFcUnspentRowsDto {
      return { stateId: stateOid.toString(), yearId: yearOid.toString(), rowIds };
    }

    it('blocks a STATE user', async () => {
      await expect(service.bulkApproveRows(approveDto(), stateUser, '127.0.0.1', 'jest')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('404s when the form does not exist', async () => {
      domainService['findForm'] = jest.fn().mockResolvedValue(null);
      await expect(service.bulkApproveRows(approveDto(), mohuaUser, '127.0.0.1', 'jest')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('blocks when the form is not UNDER_REVIEW_BY_MOHUA', async () => {
      domainService['findForm'] = jest
        .fn()
        .mockResolvedValue(makeForm({ currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA }));
      await expect(service.bulkApproveRows(approveDto(), mohuaUser, '127.0.0.1', 'jest')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('blocks a No-branch form', async () => {
      domainService['findForm'] = jest.fn().mockResolvedValue(makeForm({ isFcUnspent: false }));
      await expect(service.bulkApproveRows(approveDto(), mohuaUser, '127.0.0.1', 'jest')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects foreign-form/nonexistent row IDs', async () => {
      domainService['loadActiveRowsByIds'] = jest
        .fn()
        .mockResolvedValue({ rows: [], missingIds: [new Types.ObjectId().toString()] });
      await expect(service.bulkApproveRows(approveDto(), mohuaUser, '127.0.0.1', 'jest')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects when a selected row is already ACTIVE (not UPDATE_PENDING)', async () => {
      const row = makeRow({ rowStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA });
      domainService['loadActiveRowsByIds'] = jest.fn().mockResolvedValue({ rows: [row], missingIds: [] });
      domainService['filterNotInStatus'] = jest.fn().mockReturnValue([row]);
      await expect(
        service.bulkApproveRows(approveDto([row._id.toString()]), mohuaUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow(BadRequestException);
    });

    it('transitions valid rows to ACTIVE with rejectionRemark cleared', async () => {
      const row = makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA });
      domainService['loadActiveRowsByIds'] = jest.fn().mockResolvedValue({ rows: [row], missingIds: [] });
      domainService['filterNotInStatus'] = jest.fn().mockReturnValue([]);

      await service.bulkApproveRows(approveDto([row._id.toString()]), mohuaUser, '127.0.0.1', 'jest');

      const transitionArgs = domainService['transitionRows'].mock.calls[0] as unknown[];
      const transitions = transitionArgs[3] as Array<{ newStatus: string; rejectionRemark: string | null }>;
      expect(transitions).toEqual([{ row, newStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA, rejectionRemark: null }]);
    });

    it('acknowledges the parent atomically when the domain service reports full resolution', async () => {
      const row = makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA });
      domainService['loadActiveRowsByIds'] = jest.fn().mockResolvedValue({ rows: [row], missingIds: [] });
      domainService['maybeAcknowledgeAfterBulkAction'] = jest
        .fn()
        .mockResolvedValue({ acknowledged: true, currentFormStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA });

      const result = await service.bulkApproveRows(approveDto([row._id.toString()]), mohuaUser, '127.0.0.1', 'jest');

      expect(result.data!.parentAcknowledged).toBe(true);
      expect(result.data!.currentFormStatus).toBe(FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA);
      expect(mockSession.commitTransaction).toHaveBeenCalled();
    });

    it('keeps the parent under review when rows remain unresolved', async () => {
      const row = makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA });
      domainService['loadActiveRowsByIds'] = jest.fn().mockResolvedValue({ rows: [row], missingIds: [] });

      const result = await service.bulkApproveRows(approveDto([row._id.toString()]), mohuaUser, '127.0.0.1', 'jest');

      expect(result.data!.parentAcknowledged).toBe(false);
      expect(result.data!.currentFormStatus).toBe(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
    });

    it('rolls back the transaction when a domain-service call throws', async () => {
      const row = makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA });
      domainService['loadActiveRowsByIds'] = jest.fn().mockResolvedValue({ rows: [row], missingIds: [] });
      domainService['transitionRows'] = jest.fn().mockRejectedValue(new Error('db error'));

      await expect(
        service.bulkApproveRows(approveDto([row._id.toString()]), mohuaUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow('db error');

      expect(mockSession.abortTransaction).toHaveBeenCalled();
      expect(mockSession.commitTransaction).not.toHaveBeenCalled();
    });
  });

  // ─── bulkRejectRows ─────────────────────────────────────────────────────────

  describe('bulkRejectRows', () => {
    function rejectDto(
      rows: { rowId: string; rejectionRemark: string }[] = [
        { rowId: new Types.ObjectId().toString(), rejectionRemark: 'Bad allocation.' },
      ],
    ): BulkRejectFcUnspentRowsDto {
      return { stateId: stateOid.toString(), yearId: yearOid.toString(), rows };
    }

    it('rejects duplicate rowIds', async () => {
      const id = new Types.ObjectId().toString();
      await expect(
        service.bulkRejectRows(
          rejectDto([
            { rowId: id, rejectionRemark: 'x' },
            { rowId: id, rejectionRemark: 'y' },
          ]),
          mohuaUser,
          '127.0.0.1',
          'jest',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('requires every trimmed rejection remark to be non-empty', async () => {
      const id = new Types.ObjectId().toString();
      await expect(
        service.bulkRejectRows(rejectDto([{ rowId: id, rejectionRemark: '   ' }]), mohuaUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow(BadRequestException);
    });

    it('404s when the form does not exist', async () => {
      domainService['findForm'] = jest.fn().mockResolvedValue(null);
      await expect(service.bulkRejectRows(rejectDto(), mohuaUser, '127.0.0.1', 'jest')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects when a selected row is not UPDATE_PENDING', async () => {
      const row = makeRow({ rowStatus: FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA });
      domainService['loadActiveRowsByIds'] = jest.fn().mockResolvedValue({ rows: [row], missingIds: [] });
      domainService['filterNotInStatus'] = jest.fn().mockReturnValue([row]);
      await expect(
        service.bulkRejectRows(
          rejectDto([{ rowId: row._id.toString(), rejectionRemark: 'x' }]),
          mohuaUser,
          '127.0.0.1',
          'jest',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('transitions selected rows to REJECTED, each with its own remark, and never acknowledges the parent', async () => {
      const row = makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA });
      domainService['loadActiveRowsByIds'] = jest.fn().mockResolvedValue({ rows: [row], missingIds: [] });
      domainService['filterNotInStatus'] = jest.fn().mockReturnValue([]);

      const result = await service.bulkRejectRows(
        rejectDto([{ rowId: row._id.toString(), rejectionRemark: 'Allocation mismatch.' }]),
        mohuaUser,
        '127.0.0.1',
        'jest',
      );

      const transitionArgs = domainService['transitionRows'].mock.calls[0] as unknown[];
      const transitions = transitionArgs[3] as Array<{ newStatus: string; rejectionRemark: string }>;
      expect(transitions).toEqual([{ row, newStatus: FORM_STATUS.RETURNED_BY_MOHUA, rejectionRemark: 'Allocation mismatch.' }]);
      expect(domainService['maybeAcknowledgeAfterBulkAction']).not.toHaveBeenCalled();
      expect(result.data!.parentAcknowledged).toBe(false);
    });

    it('does not change parent auditRevision or write parent history', async () => {
      const row = makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA });
      domainService['loadActiveRowsByIds'] = jest.fn().mockResolvedValue({ rows: [row], missingIds: [] });

      const result = await service.bulkRejectRows(
        rejectDto([{ rowId: row._id.toString(), rejectionRemark: 'x' }]),
        mohuaUser,
        '127.0.0.1',
        'jest',
      );

      expect(result.data!.currentFormStatus).toBe(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
    });

    it('rolls back the transaction when a domain-service call throws', async () => {
      const row = makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA });
      domainService['loadActiveRowsByIds'] = jest.fn().mockResolvedValue({ rows: [row], missingIds: [] });
      domainService['transitionRows'] = jest.fn().mockRejectedValue(new Error('db error'));

      await expect(
        service.bulkRejectRows(
          rejectDto([{ rowId: row._id.toString(), rejectionRemark: 'x' }]),
          mohuaUser,
          '127.0.0.1',
          'jest',
        ),
      ).rejects.toThrow('db error');

      expect(mockSession.abortTransaction).toHaveBeenCalled();
    });
  });
});
