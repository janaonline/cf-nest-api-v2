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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FcUnspentUlbOptionsService,
        { provide: getModelToken(DevolutionFormulaForm.name), useValue: devolutionFormModel },
        { provide: getModelToken(DevolutionFormulaRow.name), useValue: devolutionRowModel },
        { provide: getModelToken(Ulb.name), useValue: ulbModel },
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
      currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
    });
  });

  it('passes the search term through to the aggregation pipeline, matching name, censusCode and sbCode', async () => {
    await service.getOptions(stateOid.toString(), yearOid.toString(), { search: 'alpha' }, stateUser);
    const pipeline = getPipeline(devolutionRowModel['aggregate']);
    const searchStage = pipeline.find(
      (stage: Record<string, unknown>) => '$match' in stage && '$or' in (stage['$match'] as Record<string, unknown>),
    );
    expect(searchStage).toBeDefined();
    const orClauses = (searchStage!['$match'] as { $or: Record<string, unknown>[] }).$or;
    const matchedKeys = orClauses.map((clause) => Object.keys(clause)[0]);
    expect(matchedKeys).toEqual(expect.arrayContaining(['ulb.censusCode', 'ulb.sbCode', 'ulb.name']));
  });

  it('escapes regex metacharacters in the search term so it cannot inject regex behavior', async () => {
    await service.getOptions(stateOid.toString(), yearOid.toString(), { search: 'a.b*c(' }, stateUser);
    const pipeline = getPipeline(devolutionRowModel['aggregate']);
    const searchStage = pipeline.find(
      (stage: Record<string, unknown>) => '$match' in stage && '$or' in (stage['$match'] as Record<string, unknown>),
    );
    const orClauses = (searchStage!['$match'] as { $or: Record<string, unknown>[] }).$or;
    const regex = orClauses[0]['ulb.censusCode'] as RegExp;
    expect(regex.source).toBe('a\\.b\\*c\\(');
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
});
