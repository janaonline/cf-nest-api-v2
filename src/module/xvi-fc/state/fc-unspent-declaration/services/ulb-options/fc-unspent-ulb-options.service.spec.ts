import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { ForbiddenException } from '@nestjs/common';
import { Types } from 'mongoose';
import { FcUnspentUlbOptionsService } from './fc-unspent-ulb-options.service';
import { DevolutionFormulaForm } from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import { DevolutionFormulaRow } from 'src/schemas/xvi-fc/state/devolution-formula-row.schema';
import { Ulb } from 'src/schemas/ulb.schema';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { UlbEligibilityService } from 'src/module/ulb-eligibility/ulb-eligibility.service';
import { FcUnspentDeclarationFormJsonService } from '../form-json/fc-unspent-declaration-form-json.service';
import type { FcUnspentPolicy } from '../../helpers/fc-unspent-policy.helpers';

function q<T>(value: T) {
  const chain: Record<string, unknown> = {};
  for (const m of ['lean', 'select', 'sort', 'skip', 'limit']) {
    chain[m] = jest.fn().mockReturnValue(chain);
  }
  chain['exec'] = jest.fn().mockResolvedValue(value);
  return chain;
}

const stateOid = new Types.ObjectId();
const yearOid = new Types.ObjectId('67d7d136d3d038946a5239e9');
const devolutionFormOid = new Types.ObjectId();
const userOid = new Types.ObjectId();

type TestPipelineStage = Record<string, Record<string, unknown>>;

/** Reads the aggregation pipeline array from the first `aggregate()` call, typed for assertions. */
function getPipeline(mockFn: jest.Mock): TestPipelineStage[] {
  const calls = mockFn.mock.calls as unknown as Array<[TestPipelineStage[]]>;
  return calls[0][0];
}

/** Reads the filter object from the first call of a `findOne` mock, typed for assertions. */
function getFindOneFilter(mockFn: jest.Mock): Record<string, unknown> {
  const calls = mockFn.mock.calls as unknown as Array<[Record<string, unknown>]>;
  return calls[0][0];
}

const LINKED_POLICY: FcUnspentPolicy = {
  devolutionLinked: true,
  eligibilityRule: { type: 'MAX_PERCENT_OF_ALLOCATION', thresholdPercent: 10 },
};
const INDEPENDENT_POLICY: FcUnspentPolicy = {
  devolutionLinked: false,
  eligibilityRule: { type: 'NO_UNSPENT_ALLOWED' },
};

const stateUser: AuthUser = { _id: userOid.toString(), scope: Scope.STATE, state: stateOid } as unknown as AuthUser;
const otherStateUser: AuthUser = {
  _id: userOid.toString(),
  scope: Scope.STATE,
  state: new Types.ObjectId(),
} as unknown as AuthUser;

describe('FcUnspentUlbOptionsService', () => {
  let service: FcUnspentUlbOptionsService;
  let devolutionFormModel: Record<string, jest.Mock>;
  let devolutionRowModel: Record<string, jest.Mock>;
  let ulbModel: Record<string, jest.Mock>;
  let ulbEligibilityService: Record<string, jest.Mock>;
  let formJsonConfigService: Record<string, jest.Mock>;

  beforeEach(async () => {
    devolutionFormModel = {
      findOne: jest.fn().mockReturnValue(q({ _id: devolutionFormOid, activeDatasetVersion: 1 })),
    };
    devolutionRowModel = {
      aggregate: jest.fn().mockReturnValue(
        q([
          {
            data: [
              {
                ulbId: new Types.ObjectId(),
                censusCode: '111',
                sbCode: 'A1',
                ulbName: 'Alpha ULB',
                allocationAmount: 100,
              },
            ],
            totalCount: [{ count: 1 }],
          },
        ]),
      ),
    };
    ulbModel = { collection: { name: 'ulbs' } };
    ulbEligibilityService = {
      getIneligibleUlbTypeIds: jest.fn().mockResolvedValue([]),
      getEligibleUlbFilter: jest.fn().mockResolvedValue({ state: stateOid, isActive: true }),
    };
    formJsonConfigService = {
      loadFormConfig: jest.fn().mockResolvedValue({ fields: [], thresholdPercent: 10, policy: LINKED_POLICY }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FcUnspentUlbOptionsService,
        { provide: getModelToken(DevolutionFormulaForm.name), useValue: devolutionFormModel },
        { provide: getModelToken(DevolutionFormulaRow.name), useValue: devolutionRowModel },
        { provide: getModelToken(Ulb.name), useValue: ulbModel },
        { provide: UlbEligibilityService, useValue: ulbEligibilityService },
        { provide: FcUnspentDeclarationFormJsonService, useValue: formJsonConfigService },
      ],
    }).compile();

    service = module.get(FcUnspentUlbOptionsService);
  });

  it('blocks a STATE user from requesting another state', async () => {
    await expect(service.getOptions(stateOid.toString(), yearOid.toString(), {}, otherStateUser)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('returns a state-scoped, paginated list of ULB options with the active-dataset allocation', async () => {
    const result = await service.getOptions(stateOid.toString(), yearOid.toString(), { page: 2, limit: 10 }, stateUser);
    expect(result.data).toHaveLength(1);
    expect(result.data![0]).toMatchObject({ censusCode: '111', ulbName: 'Alpha ULB', allocationAmount: 100 });
    expect(result.meta).toEqual({ page: 2, limit: 10, total: 1 });

    const findOneFilter = getFindOneFilter(devolutionFormModel['findOne']);
    expect(findOneFilter).toMatchObject({
      state: stateOid,
      year: yearOid,
      installment: 1,
      currentFormStatus: { $in: [FORM_STATUS.UNDER_REVIEW_BY_PMU, FORM_STATUS.UNDER_REVIEW_BY_MOHUA] },
    });
  });

  it('passes the search term through to the aggregation pipeline, matching name, censusCode and sbCode', async () => {
    await service.getOptions(stateOid.toString(), yearOid.toString(), { search: 'alpha' }, stateUser);
    const pipeline = getPipeline(devolutionRowModel['aggregate']);
    const searchStage = pipeline.find(isSearchMatchStage);
    expect(searchStage).toBeDefined();
    const orClauses = (searchStage!['$match'] as { $or: Record<string, unknown>[] }).$or;
    const matchedKeys = orClauses.map((clause) => Object.keys(clause)[0]);
    expect(matchedKeys).toEqual(expect.arrayContaining(['ulb.censusCode', 'ulb.sbCode', 'ulb.name']));
  });

  it('escapes regex metacharacters in the search term so it cannot inject regex behavior', async () => {
    await service.getOptions(stateOid.toString(), yearOid.toString(), { search: 'a.b*c(' }, stateUser);
    const pipeline = getPipeline(devolutionRowModel['aggregate']);
    const searchStage = pipeline.find(isSearchMatchStage);
    const orClauses = (searchStage!['$match'] as { $or: Record<string, unknown>[] }).$or;
    const regex = orClauses[0]['ulb.censusCode'] as RegExp;
    expect(regex.source).toBe('a\\.b\\*c\\(');
  });

  it('only offers ULBs that have a census code or SB code (the same rule the save enforces)', async () => {
    await service.getOptions(stateOid.toString(), yearOid.toString(), {}, stateUser);
    const pipeline = getPipeline(devolutionRowModel['aggregate']);
    const codeStage = pipeline.find((stage: Record<string, unknown>) => {
      const match = stage['$match'] as { $or?: Record<string, unknown>[] } | undefined;
      return !!match?.$or?.some((clause) => 'ulb.censusCode' in clause) && !isSearchMatchStage(stage);
    });
    expect(codeStage).toBeDefined();
    const clauses = (codeStage!['$match'] as { $or: Record<string, { $regex: RegExp }>[] }).$or;
    expect(clauses.map((c) => Object.keys(c)[0])).toEqual(['ulb.censusCode', 'ulb.sbCode']);
    expect(clauses[0]['ulb.censusCode'].$regex.test('   ')).toBe(false);
    expect(clauses[0]['ulb.censusCode'].$regex.test('111')).toBe(true);
  });

  it('sorts the $facet data stage deterministically by ULB name, then _id', async () => {
    await service.getOptions(stateOid.toString(), yearOid.toString(), {}, stateUser);
    const pipeline = getPipeline(devolutionRowModel['aggregate']);
    const facetStage = pipeline.find((stage: Record<string, unknown>) => '$facet' in stage) as unknown as {
      $facet: { data: Record<string, unknown>[] };
    };
    const sortStage = facetStage.$facet.data.find((s) => '$sort' in s)!;
    expect(sortStage['$sort']).toEqual({ 'ulb.name': 1, _id: 1 });
  });

  it('returns an empty page (not an error) when no Devolution form is under review', async () => {
    devolutionFormModel['findOne'] = jest.fn().mockReturnValue(q(null));
    const result = await service.getOptions(stateOid.toString(), yearOid.toString(), {}, stateUser);
    expect(result.data).toEqual([]);
    expect(result.meta).toEqual({ page: 1, limit: 20, total: 0 });
    expect(devolutionRowModel['aggregate']).not.toHaveBeenCalled();
  });

  it('excludes ULBs with missing/non-positive allocation via the $gt:0 match stage', async () => {
    await service.getOptions(stateOid.toString(), yearOid.toString(), {}, stateUser);
    const pipeline = getPipeline(devolutionRowModel['aggregate']);
    const matchStage = pipeline[0]['$match'];
    expect(matchStage.totalGrantAllocation).toEqual({ $gt: 0 });
    expect(matchStage.ulbId).toEqual({ $ne: null });
  });

  describe('independent of Devolution (policy.devolutionLinked = false, 14th FC years)', () => {
    const registryUlbs = [
      { _id: new Types.ObjectId(), name: 'Alpha ULB', censusCode: '111', sbCode: 'A1' },
      { _id: new Types.ObjectId(), name: 'Beta ULB', censusCode: '', sbCode: 'B1' },
    ];

    beforeEach(() => {
      formJsonConfigService['loadFormConfig'] = jest
        .fn()
        .mockResolvedValue({ fields: [], thresholdPercent: 0, policy: INDEPENDENT_POLICY });
      ulbModel['find'] = jest.fn().mockReturnValue(q(registryUlbs));
      ulbModel['countDocuments'] = jest.fn().mockReturnValue(q(2));
    });

    it('lists the eligible ULBs of the state from the registry with no allocation, and never touches Devolution', async () => {
      const result = await service.getOptions(
        stateOid.toString(),
        yearOid.toString(),
        { page: 1, limit: 20 },
        stateUser,
      );

      expect(devolutionFormModel['findOne']).not.toHaveBeenCalled();
      expect(devolutionRowModel['aggregate']).not.toHaveBeenCalled();
      expect(ulbEligibilityService['getEligibleUlbFilter']).toHaveBeenCalledWith(stateOid, 'XVIFC');
      // Only ULBs with a census/SB code are offered (the save rejects the rest).
      expect(ulbModel['find']).toHaveBeenCalledWith({
        state: stateOid,
        isActive: true,
        $and: [{ $or: [{ censusCode: { $regex: /\S/ } }, { sbCode: { $regex: /\S/ } }] }],
      });
      expect(result.data).toEqual([
        {
          ulbId: String(registryUlbs[0]._id),
          censusCode: '111',
          sbCode: 'A1',
          ulbName: 'Alpha ULB',
          allocationAmount: null,
        },
        {
          ulbId: String(registryUlbs[1]._id),
          censusCode: null,
          sbCode: 'B1',
          ulbName: 'Beta ULB',
          allocationAmount: null,
        },
      ]);
      expect(result.meta).toEqual({ page: 1, limit: 20, total: 2 });
    });

    it('works even when no Devolution form exists (the case that used to return an empty page)', async () => {
      devolutionFormModel['findOne'] = jest.fn().mockReturnValue(q(null));
      const result = await service.getOptions(stateOid.toString(), yearOid.toString(), {}, stateUser);
      expect(result.data).toHaveLength(2);
    });

    it('searches name, censusCode and sbCode with regex metacharacters escaped, and pages deterministically', async () => {
      await service.getOptions(
        stateOid.toString(),
        yearOid.toString(),
        { search: 'a.b', page: 3, limit: 5 },
        stateUser,
      );

      const filter = (
        ulbModel['find'].mock.calls as unknown as Array<[{ $and: { $or: Record<string, RegExp>[] }[] }]>
      )[0][0];
      // $and = [code-presence condition, search condition] - neither overwrites the other.
      expect(filter.$and).toHaveLength(2);
      const searchOr = filter.$and[1].$or;
      expect(searchOr.map((c) => Object.keys(c)[0])).toEqual(['censusCode', 'sbCode', 'name']);
      expect(searchOr[0]['censusCode'].source).toBe('a\\.b');

      const chain = ulbModel['find'].mock.results[0].value as Record<string, jest.Mock>;
      expect(chain['sort']).toHaveBeenCalledWith({ name: 1, _id: 1 });
      expect(chain['skip']).toHaveBeenCalledWith(10);
      expect(chain['limit']).toHaveBeenCalledWith(5);
    });

    it('still blocks a STATE user from requesting another state', async () => {
      await expect(service.getOptions(stateOid.toString(), yearOid.toString(), {}, otherStateUser)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });
});

/** The search $match stage: the $or over ulb.censusCode / ulb.sbCode / ulb.name (not the code-presence $or). */
function isSearchMatchStage(stage: Record<string, unknown>): boolean {
  const match = stage['$match'] as { $or?: Record<string, unknown>[] } | undefined;
  return !!match?.$or?.some((clause) => 'ulb.name' in clause);
}
