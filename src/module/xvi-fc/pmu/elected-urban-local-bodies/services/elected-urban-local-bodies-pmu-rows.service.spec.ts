import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ElectedUrbanLocalBodiesPmuRowsService } from './elected-urban-local-bodies-pmu-rows.service';
import { ElectedUrbanLocalBodiesPmuRowReviewDomainService } from './elected-urban-local-bodies-pmu-row-review-domain.service';
import { ElectedUrbanLocalBodiesRow } from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import type { GetEulbPmuRowsQueryDto } from '../dto/get-eulb-pmu-rows-query.dto';
import type { BulkApprovePmuRowsDto } from 'src/module/xvi-fc/common/dto/bulk-approve-pmu-rows.dto';
import type { BulkRejectPmuRowsDto } from 'src/module/xvi-fc/common/dto/bulk-reject-pmu-rows.dto';
import type { EulbPmuFormLean, EulbPmuRowLean } from '../types/elected-urban-local-bodies-pmu-review.types';

function q<T>(value: T) {
  const chain: Record<string, unknown> = {};
  for (const m of ['lean', 'select', 'sort', 'skip', 'limit']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

const stateOid = new Types.ObjectId();
const yearOid = new Types.ObjectId();
const userOid = new Types.ObjectId();
const formOid = new Types.ObjectId();
const ulbOid1 = new Types.ObjectId();

const pmuUser: AuthUser = {
  _id: userOid.toString(),
  scope: Scope.PMU,
  xviFcSubrole: 'admin',
} as unknown as AuthUser;
const stateUser: AuthUser = { _id: userOid.toString(), scope: Scope.STATE, state: stateOid } as unknown as AuthUser;

function makeForm(overrides: Partial<EulbPmuFormLean> = {}): EulbPmuFormLean {
  return {
    _id: formOid,
    state: stateOid,
    year: yearOid,
    currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU,
    activeDatasetVersion: 1,
    ...overrides,
  };
}

function makeRow(overrides: Partial<EulbPmuRowLean> = {}): EulbPmuRowLean {
  return {
    _id: new Types.ObjectId(),
    form: formOid,
    datasetVersion: 1,
    rowNumber: 1,
    ulbId: ulbOid1,
    censusCode: '111',
    ulbName: 'Alpha ULB',
    electedBodyStatus: 'Constituted',
    dateOfConstitution: new Date('2022-01-01T00:00:00.000Z'),
    dateOfExpiry: new Date('2027-01-01T00:00:00.000Z'),
    remarks: null,
    rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU,
    rejectionRemark: null,
    ...overrides,
  };
}

describe('ElectedUrbanLocalBodiesPmuRowsService', () => {
  let service: ElectedUrbanLocalBodiesPmuRowsService;
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
      loadActiveRowsBySelectAllMatching: jest.fn().mockResolvedValue([]),
      filterNotInStatus: jest.fn().mockReturnValue([]),
      transitionRows: jest.fn().mockResolvedValue(undefined),
      maybeSettleAfterBulkAction: jest
        .fn()
        .mockResolvedValue({ settled: false, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU }),
      getRowSummary: jest
        .fn()
        .mockResolvedValue({ total: 0, active: 0, updatePending: 0, rejected: 0, needsUpdate: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ElectedUrbanLocalBodiesPmuRowsService,
        { provide: getModelToken(ElectedUrbanLocalBodiesRow.name), useValue: rowModel },
        { provide: ElectedUrbanLocalBodiesPmuRowReviewDomainService, useValue: domainService },
      ],
    }).compile();

    service = module.get(ElectedUrbanLocalBodiesPmuRowsService);
  });

  // ─── Access control ─────────────────────────────────────────────────────────

  describe('access control', () => {
    it('blocks a STATE user from all row-review operations', async () => {
      await expect(
        service.getRows(stateOid.toString(), yearOid.toString(), {} as GetEulbPmuRowsQueryDto, stateUser),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  // ─── getRows ────────────────────────────────────────────────────────────────

  describe('getRows', () => {
    it('404s when the form does not exist', async () => {
      domainService['findForm'] = jest.fn().mockResolvedValue(null);
      await expect(
        service.getRows(stateOid.toString(), yearOid.toString(), {} as GetEulbPmuRowsQueryDto, pmuUser),
      ).rejects.toThrow(NotFoundException);
    });

    it('scopes the query to the form, the active dataset version, and isActive:true', async () => {
      await service.getRows(stateOid.toString(), yearOid.toString(), {} as GetEulbPmuRowsQueryDto, pmuUser);
      expect(rowModel['find']).toHaveBeenCalledWith(
        expect.objectContaining({ form: formOid, datasetVersion: 1, isActive: true }),
      );
    });

    it('applies a single-value rowStatus filter', async () => {
      await service.getRows(
        stateOid.toString(),
        yearOid.toString(),
        { rowStatus: [FORM_STATUS.RETURNED_BY_PMU] } as GetEulbPmuRowsQueryDto,
        pmuUser,
      );
      expect(rowModel['find']).toHaveBeenCalledWith(
        expect.objectContaining({ rowStatus: FORM_STATUS.RETURNED_BY_PMU }),
      );
    });

    it('applies a multi-value rowStatus filter via $in (the "Approved" status-filter bucket)', async () => {
      await service.getRows(
        stateOid.toString(),
        yearOid.toString(),
        {
          rowStatus: [
            FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
            FORM_STATUS.RETURNED_BY_MOHUA,
            FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
          ],
        } as GetEulbPmuRowsQueryDto,
        pmuUser,
      );
      expect(rowModel['find']).toHaveBeenCalledWith(
        expect.objectContaining({
          rowStatus: {
            $in: [
              FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
              FORM_STATUS.RETURNED_BY_MOHUA,
              FORM_STATUS.SUBMISSION_ACKNOWLEDGED_BY_MOHUA,
            ],
          },
        }),
      );
    });

    it('sorts by the requested field and direction', async () => {
      await service.getRows(
        stateOid.toString(),
        yearOid.toString(),
        { sortBy: 'ulbName', sortDir: 'desc' } as GetEulbPmuRowsQueryDto,
        pmuUser,
      );
      const chain = rowModel['find']() as { sort: jest.Mock };
      expect(chain.sort).toHaveBeenCalledWith({ ulbName: -1 });
    });

    it('defaults to sorting by rowNumber ascending when no sort is requested', async () => {
      await service.getRows(stateOid.toString(), yearOid.toString(), {} as GetEulbPmuRowsQueryDto, pmuUser);
      const chain = rowModel['find']() as { sort: jest.Mock };
      expect(chain.sort).toHaveBeenCalledWith({ rowNumber: 1 });
    });

    it('applies a search filter over ulbName/censusCode', async () => {
      await service.getRows(
        stateOid.toString(),
        yearOid.toString(),
        { search: 'Alpha' } as GetEulbPmuRowsQueryDto,
        pmuUser,
      );
      const filterArg = (rowModel['find'].mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      expect(filterArg['$or']).toBeDefined();
    });

    it('escapes regex metacharacters in the search term instead of passing them through raw', async () => {
      await service.getRows(
        stateOid.toString(),
        yearOid.toString(),
        { search: 'Alpha (Ward 1)' } as GetEulbPmuRowsQueryDto,
        pmuUser,
      );
      const filterArg = (rowModel['find'].mock.calls[0] as unknown[])[0] as Record<string, unknown>;
      const orClause = filterArg['$or'] as Array<{ ulbName: RegExp }>;
      // An unescaped '(' would make this an invalid/differently-behaving regex; escaped, it matches
      // the literal parenthesis.
      expect(orClause[0].ulbName.test('Alpha (Ward 1) ULB')).toBe(true);
      expect(orClause[0].ulbName.source).toContain('\\(Ward');
    });

    it('paginates via page/limit and returns pagination meta', async () => {
      rowModel['countDocuments'] = jest.fn().mockReturnValue(q(37));
      const result = await service.getRows(
        stateOid.toString(),
        yearOid.toString(),
        { page: 2, limit: 10 } as GetEulbPmuRowsQueryDto,
        pmuUser,
      );
      expect(result.meta).toEqual({ page: 2, limit: 10, total: 37, pendingTotal: 37 });
    });

    it('sets row permissions.canApprove/canReject true only for PENDING rows on a mutable form', async () => {
      rowModel['find'] = jest
        .fn()
        .mockReturnValue(
          q([
            makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU }),
            makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }),
          ]),
        );

      const result = await service.getRows(
        stateOid.toString(),
        yearOid.toString(),
        {} as GetEulbPmuRowsQueryDto,
        pmuUser,
      );

      expect(result.data!.rows[0].permissions).toEqual({ canApprove: true, canReject: true });
      expect(result.data!.rows[1].permissions).toEqual({ canApprove: false, canReject: false });
    });

    it('sets row permissions to false when the parent form is no longer mutable', async () => {
      domainService['findForm'] = jest
        .fn()
        .mockResolvedValue(makeForm({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }));
      rowModel['find'] = jest.fn().mockReturnValue(q([makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU })]));

      const result = await service.getRows(
        stateOid.toString(),
        yearOid.toString(),
        {} as GetEulbPmuRowsQueryDto,
        pmuUser,
      );

      expect(result.data!.rows[0].permissions).toEqual({ canApprove: false, canReject: false });
    });
  });

  // ─── bulkApproveRows ────────────────────────────────────────────────────────

  describe('bulkApproveRows', () => {
    function approveDto(rowIds: string[] = [new Types.ObjectId().toString()]): BulkApprovePmuRowsDto {
      return { stateId: stateOid.toString(), yearId: yearOid.toString(), rowIds };
    }

    it('blocks a STATE user', async () => {
      await expect(service.bulkApproveRows(approveDto(), stateUser, '127.0.0.1', 'jest')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('404s when the form does not exist', async () => {
      domainService['findForm'] = jest.fn().mockResolvedValue(null);
      await expect(service.bulkApproveRows(approveDto(), pmuUser, '127.0.0.1', 'jest')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('blocks when the form is not UNDER_REVIEW_BY_PMU', async () => {
      domainService['findForm'] = jest
        .fn()
        .mockResolvedValue(makeForm({ currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA }));
      await expect(service.bulkApproveRows(approveDto(), pmuUser, '127.0.0.1', 'jest')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('rejects foreign-form/nonexistent row IDs', async () => {
      domainService['loadActiveRowsByIds'] = jest
        .fn()
        .mockResolvedValue({ rows: [], missingIds: [new Types.ObjectId().toString()] });
      await expect(service.bulkApproveRows(approveDto(), pmuUser, '127.0.0.1', 'jest')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('scopes loadActiveRowsByIds by the form’s active dataset version', async () => {
      await service.bulkApproveRows(approveDto(), pmuUser, '127.0.0.1', 'jest');
      expect(domainService['loadActiveRowsByIds']).toHaveBeenCalledWith(formOid, 1, expect.any(Array));
    });

    it('rejects when a selected row is already APPROVED (not PENDING)', async () => {
      const row = makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA });
      domainService['loadActiveRowsByIds'] = jest.fn().mockResolvedValue({ rows: [row], missingIds: [] });
      domainService['filterNotInStatus'] = jest.fn().mockReturnValue([row]);
      await expect(
        service.bulkApproveRows(approveDto([row._id.toString()]), pmuUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow(BadRequestException);
    });

    it('transitions valid rows to APPROVED with rejectionRemark cleared', async () => {
      const row = makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU });
      domainService['loadActiveRowsByIds'] = jest.fn().mockResolvedValue({ rows: [row], missingIds: [] });
      domainService['filterNotInStatus'] = jest.fn().mockReturnValue([]);

      await service.bulkApproveRows(approveDto([row._id.toString()]), pmuUser, '127.0.0.1', 'jest');

      const transitionArgs = domainService['transitionRows'].mock.calls[0] as unknown[];
      const transitions = transitionArgs[3] as Array<{ newStatus: string; rejectionRemark: string | null }>;
      expect(transitions).toEqual([{ row, newStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA, rejectionRemark: null }]);
    });

    it('approves the parent atomically when the domain service reports full resolution', async () => {
      const row = makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU });
      domainService['loadActiveRowsByIds'] = jest.fn().mockResolvedValue({ rows: [row], missingIds: [] });
      domainService['maybeSettleAfterBulkAction'] = jest
        .fn()
        .mockResolvedValue({ settled: true, currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA });

      const result = await service.bulkApproveRows(approveDto([row._id.toString()]), pmuUser, '127.0.0.1', 'jest');

      expect(result.data!.parentAcknowledged).toBe(true);
      expect(result.data!.currentFormStatus).toBe(FORM_STATUS.UNDER_REVIEW_BY_MOHUA);
      expect(mockSession.commitTransaction).toHaveBeenCalled();
    });

    it('keeps the parent under review when rows remain unresolved', async () => {
      const row = makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU });
      domainService['loadActiveRowsByIds'] = jest.fn().mockResolvedValue({ rows: [row], missingIds: [] });

      const result = await service.bulkApproveRows(approveDto([row._id.toString()]), pmuUser, '127.0.0.1', 'jest');

      expect(result.data!.parentAcknowledged).toBe(false);
      expect(result.data!.currentFormStatus).toBe(FORM_STATUS.UNDER_REVIEW_BY_PMU);
    });

    it('rolls back the transaction when a domain-service call throws', async () => {
      const row = makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU });
      domainService['loadActiveRowsByIds'] = jest.fn().mockResolvedValue({ rows: [row], missingIds: [] });
      domainService['transitionRows'] = jest.fn().mockRejectedValue(new Error('db error'));

      await expect(
        service.bulkApproveRows(approveDto([row._id.toString()]), pmuUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow('db error');

      expect(mockSession.abortTransaction).toHaveBeenCalled();
      expect(mockSession.commitTransaction).not.toHaveBeenCalled();
    });

    it('rejects when both rowIds and selectAllMatching are given', async () => {
      await expect(
        service.bulkApproveRows(
          {
            stateId: stateOid.toString(),
            yearId: yearOid.toString(),
            rowIds: [new Types.ObjectId().toString()],
            selectAllMatching: {},
          },
          pmuUser,
          '127.0.0.1',
          'jest',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects when neither rowIds nor selectAllMatching are given', async () => {
      await expect(
        service.bulkApproveRows(
          { stateId: stateOid.toString(), yearId: yearOid.toString() },
          pmuUser,
          '127.0.0.1',
          'jest',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('selectAllMatching: resolves rows by filter instead of an explicit id list, excluding excludeRowIds', async () => {
      const row = makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU });
      domainService['loadActiveRowsBySelectAllMatching'] = jest.fn().mockResolvedValue([row]);
      const excludedId = new Types.ObjectId().toString();

      const result = await service.bulkApproveRows(
        {
          stateId: stateOid.toString(),
          yearId: yearOid.toString(),
          selectAllMatching: { search: 'Alpha' },
          excludeRowIds: [excludedId],
        },
        pmuUser,
        '127.0.0.1',
        'jest',
      );

      expect(domainService['loadActiveRowsByIds']).not.toHaveBeenCalled();
      expect(domainService['loadActiveRowsBySelectAllMatching']).toHaveBeenCalledWith(
        formOid,
        1,
        FORM_STATUS.UNDER_REVIEW_BY_PMU,
        'Alpha',
        [new Types.ObjectId(excludedId)],
      );
      expect(result.data!.updatedRowCount).toBe(1);
    });
  });

  // ─── bulkRejectRows ─────────────────────────────────────────────────────────

  describe('bulkRejectRows', () => {
    function rejectDto(
      rows: { rowId: string; rejectionRemark: string }[] = [
        { rowId: new Types.ObjectId().toString(), rejectionRemark: 'Dates inconsistent with registry.' },
      ],
    ): BulkRejectPmuRowsDto {
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
          pmuUser,
          '127.0.0.1',
          'jest',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('requires every trimmed rejection remark to be non-empty', async () => {
      const id = new Types.ObjectId().toString();
      await expect(
        service.bulkRejectRows(rejectDto([{ rowId: id, rejectionRemark: '   ' }]), pmuUser, '127.0.0.1', 'jest'),
      ).rejects.toThrow(BadRequestException);
    });

    it('404s when the form does not exist', async () => {
      domainService['findForm'] = jest.fn().mockResolvedValue(null);
      await expect(service.bulkRejectRows(rejectDto(), pmuUser, '127.0.0.1', 'jest')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects when a selected row is not PENDING', async () => {
      const row = makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA });
      domainService['loadActiveRowsByIds'] = jest.fn().mockResolvedValue({ rows: [row], missingIds: [] });
      domainService['filterNotInStatus'] = jest.fn().mockReturnValue([row]);
      await expect(
        service.bulkRejectRows(
          rejectDto([{ rowId: row._id.toString(), rejectionRemark: 'x' }]),
          pmuUser,
          '127.0.0.1',
          'jest',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('transitions selected rows to REJECTED, each with its own remark', async () => {
      const row = makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU });
      domainService['loadActiveRowsByIds'] = jest.fn().mockResolvedValue({ rows: [row], missingIds: [] });
      domainService['filterNotInStatus'] = jest.fn().mockReturnValue([]);

      const result = await service.bulkRejectRows(
        rejectDto([{ rowId: row._id.toString(), rejectionRemark: 'Dates inconsistent with registry.' }]),
        pmuUser,
        '127.0.0.1',
        'jest',
      );

      const transitionArgs = domainService['transitionRows'].mock.calls[0] as unknown[];
      const transitions = transitionArgs[3] as Array<{ newStatus: string; rejectionRemark: string }>;
      expect(transitions).toEqual([
        { row, newStatus: FORM_STATUS.RETURNED_BY_PMU, rejectionRemark: 'Dates inconsistent with registry.' },
      ]);
      expect(result.data!.parentAcknowledged).toBe(false);
    });

    it('keeps the parent status unchanged when rows remain unresolved', async () => {
      const row = makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU });
      domainService['loadActiveRowsByIds'] = jest.fn().mockResolvedValue({ rows: [row], missingIds: [] });

      const result = await service.bulkRejectRows(
        rejectDto([{ rowId: row._id.toString(), rejectionRemark: 'x' }]),
        pmuUser,
        '127.0.0.1',
        'jest',
      );

      expect(domainService['maybeSettleAfterBulkAction']).toHaveBeenCalled();
      expect(result.data!.currentFormStatus).toBe(FORM_STATUS.UNDER_REVIEW_BY_PMU);
      expect(result.data!.parentAcknowledged).toBe(false);
    });

    it('settles the form at RETURNED_BY_PMU when this rejection completes row review (the mixed-outcome deadlock fix)', async () => {
      const row = makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU });
      domainService['loadActiveRowsByIds'] = jest.fn().mockResolvedValue({ rows: [row], missingIds: [] });
      domainService['maybeSettleAfterBulkAction'] = jest
        .fn()
        .mockResolvedValue({ settled: true, currentFormStatus: FORM_STATUS.RETURNED_BY_PMU });

      const result = await service.bulkRejectRows(
        rejectDto([{ rowId: row._id.toString(), rejectionRemark: 'x' }]),
        pmuUser,
        '127.0.0.1',
        'jest',
      );

      expect(result.data!.currentFormStatus).toBe(FORM_STATUS.RETURNED_BY_PMU);
      expect(result.data!.parentAcknowledged).toBe(false);
    });

    it('rolls back the transaction when a domain-service call throws', async () => {
      const row = makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU });
      domainService['loadActiveRowsByIds'] = jest.fn().mockResolvedValue({ rows: [row], missingIds: [] });
      domainService['transitionRows'] = jest.fn().mockRejectedValue(new Error('db error'));

      await expect(
        service.bulkRejectRows(
          rejectDto([{ rowId: row._id.toString(), rejectionRemark: 'x' }]),
          pmuUser,
          '127.0.0.1',
          'jest',
        ),
      ).rejects.toThrow('db error');

      expect(mockSession.abortTransaction).toHaveBeenCalled();
    });

    it('rejects when both rows and selectAllMatching are given', async () => {
      await expect(
        service.bulkRejectRows(
          { ...rejectDto(), selectAllMatching: {}, rejectionRemark: 'x' },
          pmuUser,
          '127.0.0.1',
          'jest',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('selectAllMatching: requires a shared rejectionRemark', async () => {
      await expect(
        service.bulkRejectRows(
          { stateId: stateOid.toString(), yearId: yearOid.toString(), selectAllMatching: {} },
          pmuUser,
          '127.0.0.1',
          'jest',
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('selectAllMatching: resolves rows by filter and applies the one shared remark to every row', async () => {
      const row = makeRow({ rowStatus: FORM_STATUS.UNDER_REVIEW_BY_PMU });
      domainService['loadActiveRowsBySelectAllMatching'] = jest.fn().mockResolvedValue([row]);

      await service.bulkRejectRows(
        {
          stateId: stateOid.toString(),
          yearId: yearOid.toString(),
          selectAllMatching: { search: 'Alpha' },
          rejectionRemark: 'Bulk rejected — figures under review.',
        },
        pmuUser,
        '127.0.0.1',
        'jest',
      );

      expect(domainService['loadActiveRowsByIds']).not.toHaveBeenCalled();
      const transitionArgs = domainService['transitionRows'].mock.calls[0] as unknown[];
      const transitions = transitionArgs[3] as Array<{ rejectionRemark: string }>;
      expect(transitions).toEqual([
        {
          row,
          newStatus: FORM_STATUS.RETURNED_BY_PMU,
          rejectionRemark: 'Bulk rejected — figures under review.',
        },
      ]);
    });
  });
});
