import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { FcUnspentDeclarationDocumentService } from './fc-unspent-declaration-document.service';
import { FcUnspentDeclarationService } from 'src/module/xvi-fc/state/fc-unspent-declaration/services/main/fc-unspent-declaration.service';
import { FcUnspentDeclarationRowService } from 'src/module/xvi-fc/state/fc-unspent-declaration/services/rows/fc-unspent-declaration-row.service';
import { XvifcFormActorsService } from 'src/module/xvi-fc/common/services/xvifc-form-actors.service';
import { XviFcUnspentStateForm } from 'src/schemas/xvi-fc/state/fc-unspent-state-form.schema';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';

/** Creates a chainable Mongoose Query-like mock that resolves to `value`. */
function q<T>(value: T) {
  const chain: Record<string, unknown> = {};
  for (const m of ['lean', 'select', 'sort', 'populate']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

const YEAR_2026_27 = '67d7d136d3d038946a5239e9';

const stateOid = new Types.ObjectId();
const yearOid = new Types.ObjectId(YEAR_2026_27);
const formOid = new Types.ObjectId();

const adminUser: AuthUser = {
  _id: new Types.ObjectId().toString(),
  role: UserRole.ADMIN,
  scope: Scope.ADMIN,
  accessLevel: AccessLevel.ADMIN,
  state: null,
} as unknown as AuthUser;

const GRANTED_GATES = {
  dependency: {
    devolutionStatus: 5,
    devolutionDatasetExists: true,
    editableDueToDevolutionReturn: false,
    blockingMessage: null,
  },
  canEditGate: true,
  canSaveDraftGate: true,
  canFinalSubmitGate: true,
  devolutionForm: null,
};

const activeRow = {
  rowNumber: 1,
  ulbId: new Types.ObjectId(),
  censusCode: 'C001',
  sbCode: 'SB1',
  ulbName: 'Alpha ULB',
  allocationAmount: 100,
  unspentAmount: 4,
  allocationPerc: 4,
  eligibility: true,
  rowStatus: null,
};

describe('FcUnspentDeclarationDocumentService', () => {
  let service: FcUnspentDeclarationDocumentService;
  let mockModel: { findOne: jest.Mock };
  let mockMainService: {
    assertStateAccess: jest.Mock;
    resolveDevolutionDependency: jest.Mock;
    buildFormPermissions: jest.Mock;
  };
  let mockRowService: { getActiveRows: jest.Mock };
  let mockActorsService: { buildActorsAndStateName: jest.Mock };

  beforeEach(async () => {
    mockModel = { findOne: jest.fn() };
    mockMainService = {
      assertStateAccess: jest.fn(),
      resolveDevolutionDependency: jest.fn().mockResolvedValue(GRANTED_GATES),
      buildFormPermissions: jest.fn().mockReturnValue({
        canView: true,
        canEdit: true,
        canSaveDraft: true,
        canFinalSubmit: true,
      }),
    };
    mockRowService = { getActiveRows: jest.fn().mockResolvedValue([]) };
    mockActorsService = {
      buildActorsAndStateName: jest.fn().mockReturnValue({ actors: [], stateName: 'Andhra Pradesh' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FcUnspentDeclarationDocumentService,
        { provide: getModelToken(XviFcUnspentStateForm.name), useValue: mockModel },
        { provide: FcUnspentDeclarationService, useValue: mockMainService },
        { provide: FcUnspentDeclarationRowService, useValue: mockRowService },
        { provide: XvifcFormActorsService, useValue: mockActorsService },
      ],
    }).compile();

    service = module.get(FcUnspentDeclarationDocumentService);
  });

  it('delegates access control to FcUnspentDeclarationService.assertStateAccess', async () => {
    mockMainService.assertStateAccess.mockImplementationOnce(() => {
      throw new ForbiddenException('denied');
    });
    mockModel.findOne.mockReturnValue(q(null));
    await expect(service.getDocumentData(stateOid.toString(), yearOid.toString(), adminUser)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('404s for a yearId with no design-year label', async () => {
    const unknownYearId = new Types.ObjectId().toString();
    await expect(service.getDocumentData(stateOid.toString(), unknownYearId, adminUser)).rejects.toThrow(
      NotFoundException,
    );
  });

  it('rejects with ForbiddenException when canEdit is false', async () => {
    mockModel.findOne.mockReturnValue(q(null));
    mockMainService.buildFormPermissions.mockReturnValueOnce({
      canView: true,
      canEdit: false,
      canSaveDraft: false,
      canFinalSubmit: false,
    });
    await expect(service.getDocumentData(stateOid.toString(), yearOid.toString(), adminUser)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rejects with code branchNotChosen when isFcUnspent has not been answered yet (no form doc)', async () => {
    mockModel.findOne.mockReturnValue(q(null));
    let caught: BadRequestException | undefined;
    try {
      await service.getDocumentData(stateOid.toString(), yearOid.toString(), adminUser);
    } catch (e) {
      caught = e as BadRequestException;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    const response = caught!.getResponse() as { errors: Record<string, Array<{ code: string }>> };
    expect(response.errors['_form']).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'branchNotChosen' })]),
    );
  });

  it('rejects with code branchNotChosen when isFcUnspent is explicitly null', async () => {
    mockModel.findOne.mockReturnValue(q({ _id: formOid, isFcUnspent: null, currentFormStatus: 3 }));
    await expect(service.getDocumentData(stateOid.toString(), yearOid.toString(), adminUser)).rejects.toThrow(
      BadRequestException,
    );
  });

  describe('No branch', () => {
    it('returns isFcUnspent false with stateName and FC cycle labels, never touching rows', async () => {
      mockModel.findOne.mockReturnValue(
        q({ _id: formOid, isFcUnspent: false, currentFormStatus: 3, state: { name: 'Andhra Pradesh' } }),
      );

      const data = await service.getDocumentData(stateOid.toString(), yearOid.toString(), adminUser);

      expect(data).toEqual({
        isFcUnspent: false,
        stateName: 'Andhra Pradesh',
        designYearLabel: '2026-27',
        priorFcCycleLabel: '14th FC',
        priorFcCycleFullLabel: '14th Finance Commission',
      });
      expect(mockRowService.getActiveRows).not.toHaveBeenCalled();
    });
  });

  describe('Yes branch', () => {
    it('rejects with code noRows on fcUnspentDeclaration when there are zero active rows', async () => {
      mockModel.findOne.mockReturnValue(q({ _id: formOid, isFcUnspent: true, currentFormStatus: 3 }));
      mockRowService.getActiveRows.mockResolvedValueOnce([]);

      let caught: BadRequestException | undefined;
      try {
        await service.getDocumentData(stateOid.toString(), yearOid.toString(), adminUser);
      } catch (e) {
        caught = e as BadRequestException;
      }
      expect(caught).toBeInstanceOf(BadRequestException);
      const response = caught!.getResponse() as { errors: Record<string, Array<{ code: string }>> };
      expect(response.errors['fcUnspentDeclaration']).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'noRows' })]),
      );
    });

    it('maps active rows into the document rows shape, 1-indexed by slNo', async () => {
      mockModel.findOne.mockReturnValue(
        q({ _id: formOid, isFcUnspent: true, currentFormStatus: 3, state: { name: 'Andhra Pradesh' } }),
      );
      mockRowService.getActiveRows.mockResolvedValueOnce([activeRow, { ...activeRow, rowNumber: 2, censusCode: '' }]);

      const data = await service.getDocumentData(stateOid.toString(), yearOid.toString(), adminUser);

      expect(data.isFcUnspent).toBe(true);
      if (!data.isFcUnspent) throw new Error('expected Yes branch');
      expect(data.rows).toEqual([
        {
          slNo: 1,
          censusCode: 'C001',
          ulbName: 'Alpha ULB',
          allocationAmount: 100,
          unspentAmount: 4,
          allocationPerc: 4,
          eligibility: true,
        },
        {
          slNo: 2,
          censusCode: '-',
          ulbName: 'Alpha ULB',
          allocationAmount: 100,
          unspentAmount: 4,
          allocationPerc: 4,
          eligibility: true,
        },
      ]);
      expect(mockRowService.getActiveRows).toHaveBeenCalledWith(formOid);
    });
  });
});
