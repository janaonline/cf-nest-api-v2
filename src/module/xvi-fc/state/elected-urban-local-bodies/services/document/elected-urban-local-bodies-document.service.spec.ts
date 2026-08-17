import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import { ElectedUrbanLocalBodiesDocumentService } from './elected-urban-local-bodies-document.service';
import { ElectedUrbanLocalBodiesForm } from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import { ElectedUrbanLocalBodiesRow } from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import { Year } from 'src/schemas/year.schema';
import { XvifcFormActorsService } from 'src/module/xvi-fc/common/services/xvifc-form-actors.service';
import { EulbFormJsonConfigService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/form-json/elected-urban-local-bodies-form-json.service';
import type { EulbTypedFieldConfig } from 'src/module/xvi-fc/state/elected-urban-local-bodies/helpers/elected-urban-local-bodies-form-json.helpers';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { AccessLevel, Scope, UserRole } from 'src/module/auth/enum/roles-xvi-fc.enum';

/** Creates a chainable Mongoose Query-like mock that resolves to `value` (mirrors the sibling
 *  helper in elected-urban-local-bodies.service.spec.ts). */
function q<T>(value: T) {
  const chain: Record<string, unknown> = {};
  for (const m of ['lean', 'select', 'sort', 'skip', 'limit', 'populate']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

const stateOid = new Types.ObjectId();
const yearOid = new Types.ObjectId('67d7d136d3d038946a5239e9');
const formOid = new Types.ObjectId();

const adminUser: AuthUser = {
  _id: new Types.ObjectId().toString(),
  role: UserRole.ADMIN,
  scope: Scope.ADMIN,
  accessLevel: AccessLevel.ADMIN,
  state: null,
};

const stateUser: AuthUser = {
  _id: new Types.ObjectId().toString(),
  role: UserRole.STATE,
  scope: Scope.STATE,
  accessLevel: AccessLevel.EDITOR,
  state: stateOid.toString(),
};

const EXTRA_ULB_PORTAL_FIELDS: EulbTypedFieldConfig[] = [
  {
    key: 'censusCode',
    label: 'Census Code',
    formFieldType: 'text',
    fieldTypes: ['EULB_EXTRA_ULB_PORTAL_FIELDS'],
    validations: [],
  },
  {
    key: 'ulbName',
    label: 'ULB Name',
    formFieldType: 'text',
    fieldTypes: ['EULB_EXTRA_ULB_PORTAL_FIELDS'],
    validations: [],
  },
  {
    key: 'electedBodyStatus',
    label: 'Elected Body Status',
    formFieldType: 'select',
    fieldTypes: ['EULB_EXTRA_ULB_PORTAL_FIELDS'],
    validations: [],
  },
  {
    key: 'dateOfConstitution',
    label: 'Date on which the elected body is in place.',
    formFieldType: 'date',
    fieldTypes: ['EULB_EXTRA_ULB_PORTAL_FIELDS'],
    validations: [],
  },
  {
    key: 'dateOfExpiry',
    label: 'Date of Expiry',
    formFieldType: 'date',
    fieldTypes: ['EULB_EXTRA_ULB_PORTAL_FIELDS'],
    validations: [],
  },
  {
    key: 'remarks',
    label: 'Remarks',
    formFieldType: 'text',
    fieldTypes: ['EULB_EXTRA_ULB_PORTAL_FIELDS'],
    validations: [],
  },
];

const validRows = [
  {
    rowNumber: 1,
    censusCode: 'C001',
    ulbName: 'Alpha City',
    electedBodyStatus: 'Constituted',
    dateOfConstitution: new Date('2022-06-15T00:00:00.000Z'),
    dateOfExpiry: new Date('2027-06-14T00:00:00.000Z'),
    remarks: 'All good',
    validationStatus: 'VALID',
  },
  {
    rowNumber: 2,
    censusCode: 'C002',
    ulbName: 'Beta Town',
    electedBodyStatus: 'Not Constituted',
    dateOfConstitution: null,
    dateOfExpiry: null,
    remarks: '',
    validationStatus: 'VALID',
  },
];

describe('ElectedUrbanLocalBodiesDocumentService', () => {
  let service: ElectedUrbanLocalBodiesDocumentService;
  let mockFormModel: { findOne: jest.Mock };
  let mockRowModel: { find: jest.Mock };
  let mockYearModel: { findById: jest.Mock };
  let mockActorsService: { buildActorsAndStateName: jest.Mock };
  let mockFormJsonConfig: { loadFields: jest.Mock };

  beforeEach(async () => {
    mockFormModel = { findOne: jest.fn() };
    mockRowModel = { find: jest.fn() };
    mockYearModel = { findById: jest.fn().mockReturnValue(q({ year: '2026-27' })) };
    mockActorsService = {
      buildActorsAndStateName: jest.fn().mockReturnValue({ actors: [], stateName: 'Andhra Pradesh' }),
    };
    mockFormJsonConfig = { loadFields: jest.fn().mockResolvedValue(EXTRA_ULB_PORTAL_FIELDS) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ElectedUrbanLocalBodiesDocumentService,
        { provide: getModelToken(ElectedUrbanLocalBodiesForm.name), useValue: mockFormModel },
        { provide: getModelToken(ElectedUrbanLocalBodiesRow.name), useValue: mockRowModel },
        { provide: getModelToken(Year.name), useValue: mockYearModel },
        { provide: XvifcFormActorsService, useValue: mockActorsService },
        { provide: EulbFormJsonConfigService, useValue: mockFormJsonConfig },
      ],
    }).compile();

    service = module.get(ElectedUrbanLocalBodiesDocumentService);
  });

  it('denies a STATE user access to another state’s data', async () => {
    await expect(
      service.getDocumentData(new Types.ObjectId().toString(), yearOid.toString(), stateUser),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects with code noRows when no form record exists yet', async () => {
    mockFormModel.findOne.mockReturnValue(q(null));

    let caught: BadRequestException | undefined;
    try {
      await service.getDocumentData(stateOid.toString(), yearOid.toString(), adminUser);
    } catch (e) {
      caught = e as BadRequestException;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    const response = caught!.getResponse() as { errors: Record<string, Array<{ code: string }>> };
    expect(response.errors['signedElectedbodyFile']).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'noRows' })]),
    );
  });

  it('rejects with code noRows when the form has activeDatasetVersion 0', async () => {
    mockFormModel.findOne.mockReturnValue(q({ _id: formOid, activeDatasetVersion: 0 }));

    let caught: BadRequestException | undefined;
    try {
      await service.getDocumentData(stateOid.toString(), yearOid.toString(), adminUser);
    } catch (e) {
      caught = e as BadRequestException;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    expect(mockRowModel.find).not.toHaveBeenCalled();
  });

  it('rejects with code noRows when there is an active dataset but zero active rows', async () => {
    mockFormModel.findOne.mockReturnValue(q({ _id: formOid, activeDatasetVersion: 1 }));
    mockRowModel.find.mockReturnValue(q([]));

    let caught: BadRequestException | undefined;
    try {
      await service.getDocumentData(stateOid.toString(), yearOid.toString(), adminUser);
    } catch (e) {
      caught = e as BadRequestException;
    }

    const response = caught!.getResponse() as { errors: Record<string, Array<{ code: string }>> };
    expect(response.errors['signedElectedbodyFile']).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'noRows' })]),
    );
  });

  it('rejects with code rowsNotValid when any active row is not validationStatus VALID', async () => {
    mockFormModel.findOne.mockReturnValue(q({ _id: formOid, activeDatasetVersion: 1 }));
    mockRowModel.find.mockReturnValue(q([validRows[0], { ...validRows[1], validationStatus: 'INVALID' }]));

    let caught: BadRequestException | undefined;
    try {
      await service.getDocumentData(stateOid.toString(), yearOid.toString(), adminUser);
    } catch (e) {
      caught = e as BadRequestException;
    }

    expect(caught).toBeInstanceOf(BadRequestException);
    const response = caught!.getResponse() as { errors: Record<string, Array<{ code: string }>> };
    expect(response.errors['signedElectedbodyFile']).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'rowsNotValid' })]),
    );
  });

  it('returns stateName, ulbCount, form-json-sourced column labels, and mapped rows on the happy path', async () => {
    mockFormModel.findOne.mockReturnValue(
      q({ _id: formOid, activeDatasetVersion: 1, state: { name: 'Andhra Pradesh' } }),
    );
    mockRowModel.find.mockReturnValue(q(validRows));

    const data = await service.getDocumentData(stateOid.toString(), yearOid.toString(), adminUser);

    expect(data.stateName).toBe('Andhra Pradesh');
    expect(data.ulbCount).toBe(2);
    expect(data.designYearLabel).toBe('2026-27');
    expect(data.columns).toEqual([
      { key: 'censusCode', label: 'Census Code' },
      { key: 'ulbName', label: 'ULB Name' },
      { key: 'electedBodyStatus', label: 'Elected Body Status' },
      { key: 'dateOfConstitution', label: 'Date on which the elected body is in place.' },
      { key: 'dateOfExpiry', label: 'Date of Expiry' },
      { key: 'remarks', label: 'Remarks' },
    ]);
    expect(data.rows).toHaveLength(2);
    expect(data.rows[0]).toMatchObject({ slNo: 1, censusCode: 'C001', ulbName: 'Alpha City' });
    // Row 2 has null dates and blank remarks — defaulted to '' rather than left null/undefined.
    expect(data.rows[1]).toMatchObject({ slNo: 2, remarks: '' });
  });

  it('reflects a form-json label edit on the next call — labels are never hardcoded', async () => {
    mockFormModel.findOne.mockReturnValue(q({ _id: formOid, activeDatasetVersion: 1 }));
    mockRowModel.find.mockReturnValue(q(validRows));
    mockFormJsonConfig.loadFields.mockResolvedValue(
      EXTRA_ULB_PORTAL_FIELDS.map((f) => (f.key === 'censusCode' ? { ...f, label: 'Renamed Census Label' } : f)),
    );

    const data = await service.getDocumentData(stateOid.toString(), yearOid.toString(), adminUser);

    expect(data.columns.find((c) => c.key === 'censusCode')?.label).toBe('Renamed Census Label');
  });

  it('resolves designYearLabel from the Year document rather than hardcoding it', async () => {
    mockFormModel.findOne.mockReturnValue(q({ _id: formOid, activeDatasetVersion: 1 }));
    mockRowModel.find.mockReturnValue(q(validRows));
    mockYearModel.findById.mockReturnValue(q({ year: '2027-28' }));

    const data = await service.getDocumentData(stateOid.toString(), yearOid.toString(), adminUser);

    expect(mockYearModel.findById).toHaveBeenCalledWith(yearOid);
    expect(data.designYearLabel).toBe('2027-28');
  });

  it('throws NotFoundException when the year record does not exist', async () => {
    mockFormModel.findOne.mockReturnValue(q({ _id: formOid, activeDatasetVersion: 1 }));
    mockRowModel.find.mockReturnValue(q(validRows));
    mockYearModel.findById.mockReturnValue(q(null));

    await expect(service.getDocumentData(stateOid.toString(), yearOid.toString(), adminUser)).rejects.toThrow(
      NotFoundException,
    );
  });
});
