import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ClaimLetterDocumentService } from './claim-letter-document.service';
import { ClaimLetterUlbRowsService } from '../ulb-rows/claim-letter-ulb-rows.service';
import { State } from 'src/schemas/state.schema';
import { Year } from 'src/schemas/year.schema';
import { User } from 'src/schemas/user/user.schema';
import { XviFcUnspentStateForm } from 'src/schemas/xvi-fc/state/fc-unspent-state-form.schema';
import { XviFcUnspentStateFormRow } from 'src/schemas/xvi-fc/state/fc-unspent-state-form-row.schema';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import type { AuthUser } from 'src/module/auth/auth-user.interface';

function q<T>(value: T) {
  const chain: Record<string, jest.Mock> = {};
  for (const m of ['select', 'sort', 'skip', 'limit', 'lean']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

describe('ClaimLetterDocumentService', () => {
  let service: ClaimLetterDocumentService;
  let ulbRowsService: { getAllUlbRows: jest.Mock };
  let stateModel: { findById: jest.Mock };
  let yearModel: { findById: jest.Mock };
  let userModel: { findById: jest.Mock };
  let unspentFormModel: { findOne: jest.Mock };
  let unspentRowModel: { find: jest.Mock };

  const claimLetterId = new Types.ObjectId().toString();
  const stateOid = new Types.ObjectId();
  const yearOid = new Types.ObjectId();
  const ulbAId = new Types.ObjectId().toString();
  const ulbBId = new Types.ObjectId().toString();
  const authUser: AuthUser = {
    _id: new Types.ObjectId().toString(),
    role: 'STATE',
    scope: Scope.STATE,
    accessLevel: null,
  };

  const parent = {
    _id: claimLetterId,
    state: stateOid,
    year: yearOid,
    installment: 1 as const,
    batchNumber: 1,
    ulbCount: 2,
  };
  const rows = [
    {
      ulbId: ulbAId,
      ulbName: 'ULB A',
      censusCode: null,
      sbCode: null,
      allocationAmount: 5,
      claimAmount: 4.5,
      differencePercentage: 0,
      eligible: true,
    },
    {
      ulbId: ulbBId,
      ulbName: 'ULB B',
      censusCode: null,
      sbCode: null,
      allocationAmount: 3,
      claimAmount: 2.5,
      differencePercentage: 0,
      eligible: true,
    },
  ];
  const fourCriteriaColumns = [
    { type: 'UPLOAD_CONFIG_AUDITED', label: 'Audited Accounts', shortLabel: 'AFS' },
    { type: 'UPLOAD_CONFIG_PROVISIONAL', label: 'Provisional Accounts', shortLabel: 'PFS' },
    { type: 'FC_UNSPENT_STATE', label: '14th FC Unspent Balance Declaration', shortLabel: 'FC' },
    { type: 'ELECTED_BODY', label: 'Elected Body', shortLabel: 'Elected' },
  ];
  const cleanEligibility = { perUlbFailedCriteria: new Map(), criteriaColumns: fourCriteriaColumns };

  /** Flattens a dynamic Annexure 2 row's `criteria` array into `{type: met}` for easy assertions. */
  function criteriaMap(row: { criteria: { type: string; met: boolean }[] }): Record<string, boolean> {
    return Object.fromEntries(row.criteria.map((c) => [c.type, c.met]));
  }

  beforeEach(async () => {
    ulbRowsService = {
      getAllUlbRows: jest.fn().mockResolvedValue({ parent, rows, ulbLevelEligibility: cleanEligibility }),
    };
    stateModel = { findById: jest.fn().mockReturnValue(q({ name: 'Andhra Pradesh', code: 'AP' })) };
    yearModel = { findById: jest.fn().mockReturnValue(q({ year: '2026-27' })) };
    userModel = {
      findById: jest.fn().mockReturnValue(
        q({
          name: 'Vikram Rao',
          designation: 'Finance Analyst',
          departmentName: 'Directorate of Municipal Administration',
        }),
      ),
    };
    unspentFormModel = { findOne: jest.fn().mockReturnValue(q(null)) };
    unspentRowModel = { find: jest.fn().mockReturnValue(q([])) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClaimLetterDocumentService,
        { provide: ClaimLetterUlbRowsService, useValue: ulbRowsService },
        { provide: getModelToken(State.name), useValue: stateModel },
        { provide: getModelToken(Year.name), useValue: yearModel },
        { provide: getModelToken(User.name), useValue: userModel },
        { provide: getModelToken(XviFcUnspentStateForm.name), useValue: unspentFormModel },
        { provide: getModelToken(XviFcUnspentStateFormRow.name), useValue: unspentRowModel },
      ],
    }).compile();

    service = module.get(ClaimLetterDocumentService);
  });

  it('propagates NotFoundException from getAllUlbRows (unknown/non-READY claim letter)', async () => {
    ulbRowsService.getAllUlbRows.mockRejectedValue(new NotFoundException('not found'));
    await expect(service.getDocumentData(claimLetterId, authUser)).rejects.toThrow(NotFoundException);
  });

  it('propagates ForbiddenException from getAllUlbRows (cross-state access)', async () => {
    ulbRowsService.getAllUlbRows.mockRejectedValue(new ForbiddenException('denied'));
    await expect(service.getDocumentData(claimLetterId, authUser)).rejects.toThrow(ForbiddenException);
  });

  it('defaults priorFcUnspentAmount to 0 for every ULB when no FC-Unspent form is on file', async () => {
    const result = await service.getDocumentData(claimLetterId, authUser);
    expect(result.data!.annexure1Rows.every((r) => r.priorFcUnspentAmount === 0)).toBe(true);
    expect(unspentRowModel.find).not.toHaveBeenCalled();
  });

  it('reads priorFcUnspentAmount per ULB from the FC-Unspent form rows when one exists', async () => {
    unspentFormModel.findOne.mockReturnValue(q({ _id: new Types.ObjectId() }));
    unspentRowModel.find.mockReturnValue(
      q([
        { ulbId: new Types.ObjectId(ulbAId), unspentAmount: 0.08 },
        { ulbId: new Types.ObjectId(ulbBId), unspentAmount: 0.21 },
      ]),
    );

    const result = await service.getDocumentData(claimLetterId, authUser);

    const byId = new Map(result.data!.annexure1Rows.map((r) => [r.ulbId, r.priorFcUnspentAmount]));
    expect(byId.get(ulbAId)).toBe(0.08);
    expect(byId.get(ulbBId)).toBe(0.21);
  });

  it('marks every checkmark true when a ULB failed no criteria', async () => {
    const result = await service.getDocumentData(claimLetterId, authUser);
    expect(result.data!.annexure1Rows[0]).toMatchObject({ eligible: true });
    expect(criteriaMap(result.data!.annexure2Rows[0])).toEqual({
      UPLOAD_CONFIG_AUDITED: true,
      UPLOAD_CONFIG_PROVISIONAL: true,
      FC_UNSPENT_STATE: true,
      ELECTED_BODY: true,
    });
  });

  it('derives Annexure 1/2 checkmarks from perUlbFailedCriteria by criterion type, not label', async () => {
    ulbRowsService.getAllUlbRows.mockResolvedValue({
      parent,
      rows,
      ulbLevelEligibility: {
        perUlbFailedCriteria: new Map([
          [
            ulbAId,
            [
              { type: 'UPLOAD_CONFIG_AUDITED', label: 'Audited Accounts', shortLabel: 'AFS' },
              { type: 'FC_UNSPENT_STATE', label: '14th FC Unspent Balance Declaration', shortLabel: 'FC' },
            ],
          ],
        ]),
        criteriaColumns: fourCriteriaColumns,
      },
    });

    const result = await service.getDocumentData(claimLetterId, authUser);

    const annexure1A = result.data!.annexure1Rows.find((r) => r.ulbId === ulbAId)!;
    const annexure2A = result.data!.annexure2Rows.find((r) => r.ulbId === ulbAId)!;
    expect(annexure1A.eligible).toBe(false);
    expect(criteriaMap(annexure2A)).toEqual({
      UPLOAD_CONFIG_AUDITED: false,
      FC_UNSPENT_STATE: false,
      UPLOAD_CONFIG_PROVISIONAL: true,
      ELECTED_BODY: true,
    });

    const annexure2B = result.data!.annexure2Rows.find((r) => r.ulbId === ulbBId)!;
    expect(criteriaMap(annexure2B)).toEqual({
      UPLOAD_CONFIG_AUDITED: true,
      FC_UNSPENT_STATE: true,
      UPLOAD_CONFIG_PROVISIONAL: true,
      ELECTED_BODY: true,
    });
  });

  it('adds a 5th enabled criterion (e.g. SLB) as a 5th Annexure 2 column automatically, with no code change', async () => {
    const fiveCriteriaColumns = [
      ...fourCriteriaColumns,
      { type: 'SLB', label: 'Service Level Benchmarks', shortLabel: 'SLB' },
    ];
    ulbRowsService.getAllUlbRows.mockResolvedValue({
      parent,
      rows,
      ulbLevelEligibility: {
        perUlbFailedCriteria: new Map([
          [ulbAId, [{ type: 'SLB', label: 'Service Level Benchmarks', shortLabel: 'SLB' }]],
        ]),
        criteriaColumns: fiveCriteriaColumns,
      },
    });

    const result = await service.getDocumentData(claimLetterId, authUser);

    expect(result.data!.annexure2Columns).toEqual(fiveCriteriaColumns);
    expect(result.data!.annexure2Rows).toHaveLength(2);
    for (const row of result.data!.annexure2Rows) {
      expect(row.criteria).toHaveLength(5);
      expect(row.criteria.map((c) => c.type)).toEqual(fiveCriteriaColumns.map((c) => c.type));
    }
    const annexure2A = result.data!.annexure2Rows.find((r) => r.ulbId === ulbAId)!;
    expect(criteriaMap(annexure2A)['SLB']).toBe(false);
  });

  it('composes refNo as CL/<stateCode>/<designYear>/<installment>-<batchNumber>', async () => {
    const result = await service.getDocumentData(claimLetterId, authUser);
    expect(result.data!.refNo).toBe('CL/AP/2026-27/1-1');
  });

  it('sums claimAmount across rows for totalClaimAmount', async () => {
    const result = await service.getDocumentData(claimLetterId, authUser);
    expect(result.data!.totalClaimAmount).toBe(7);
  });

  it('labels the prior FC cycle "14th FC" for a 2026-27 design year and "15th FC" for 2028-29', async () => {
    const first = await service.getDocumentData(claimLetterId, authUser);
    expect(first.data!.priorFcCycleLabel).toBe('14th FC');

    yearModel.findById.mockReturnValue(q({ year: '2028-29' }));
    const second = await service.getDocumentData(claimLetterId, authUser);
    expect(second.data!.priorFcCycleLabel).toBe('15th FC');
  });

  it('populates signatory name/designation from the requesting user, not from the ULB rows', async () => {
    const result = await service.getDocumentData(claimLetterId, authUser);
    expect(result.data!.signatoryName).toBe('Vikram Rao');
    expect(result.data!.signatoryDesignation).toBe('Finance Analyst');
  });
});
