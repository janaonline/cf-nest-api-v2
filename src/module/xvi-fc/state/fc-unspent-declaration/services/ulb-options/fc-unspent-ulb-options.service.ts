import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { toObjectIdString } from 'src/common/utils/objectid.util';
import { escapeRegex } from 'src/common/utils/regex.util';
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import {
  DevolutionFormulaForm,
  DevolutionFormulaFormDocument,
} from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import {
  DevolutionFormulaRow,
  DevolutionFormulaRowDocument,
} from 'src/schemas/xvi-fc/state/devolution-formula-row.schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { UlbEligibilityService } from 'src/module/ulb-eligibility/ulb-eligibility.service';
import {
  FC_UNSPENT_DEVOLUTION_INSTALLMENT,
  FC_UNSPENT_PAGINATION_DEFAULT_LIMIT,
  FC_UNSPENT_PAGINATION_DEFAULT_PAGE,
} from '../../constants/fc-unspent-declaration.constants';
import type { GetFcUnspentUlbOptionsQueryDto } from '../../dto/get-fc-unspent-ulb-options-query.dto';
import type { FcUnspentUlbOption } from '../../types/fc-unspent-declaration.types';

type FcUnspentUlbOptionAggregationRow = {
  ulbId: Types.ObjectId;
  censusCode?: string;
  sbCode?: string;
  ulbName: string;
  allocationAmount: number;
};

@Injectable()
export class FcUnspentUlbOptionsService {
  constructor(
    @InjectModel(DevolutionFormulaForm.name)
    private readonly devolutionFormModel: Model<DevolutionFormulaFormDocument>,
    @InjectModel(DevolutionFormulaRow.name)
    private readonly devolutionRowModel: Model<DevolutionFormulaRowDocument>,
    @InjectModel(Ulb.name)
    private readonly ulbModel: Model<UlbDocument>,
    private readonly ulbEligibilityService: UlbEligibilityService,
  ) {}

  /**
   * Lazy, paginated, State-scoped ULB options for the "Yes" branch row picker.
   * Allocation source: the active Installment-1 Devolution Formula dataset, only
   * while that form is UNDER_REVIEW_BY_MOHUA. Returns an empty page (not an error)
   * when no such Devolution form exists yet, so the dropdown never hard-fails.
   *
   * Scopes the aggregation by devolution-formula's activeDatasetVersion from outside that module —
   * see devolution-formula/docs/adr/0001-dataset-versioning.md.
   */
  async getOptions(
    stateId: string,
    yearId: string,
    query: GetFcUnspentUlbOptionsQueryDto,
    user: AuthUser,
  ): Promise<XviFcApiResponse<FcUnspentUlbOption[]>> {
    this.assertStateAccess(user, stateId);

    const stateOid = new Types.ObjectId(stateId);
    const yearOid = new Types.ObjectId(yearId);
    const page = query.page ?? FC_UNSPENT_PAGINATION_DEFAULT_PAGE;
    const limit = query.limit ?? FC_UNSPENT_PAGINATION_DEFAULT_LIMIT;
    const skip = (page - 1) * limit;

    const devolutionForm = await this.devolutionFormModel
      .findOne({
        state: stateOid,
        year: yearOid,
        installment: FC_UNSPENT_DEVOLUTION_INSTALLMENT,
        currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA,
      })
      .select('_id activeDatasetVersion')
      .lean<{ _id: Types.ObjectId; activeDatasetVersion: number }>()
      .exec();

    if (!devolutionForm) {
      return xviFcSuccess('ULB options fetched.', [], { page, limit, total: 0 });
    }

    const ulbCollectionName = this.ulbModel.collection.name;
    const ineligibleUlbTypeIds = await this.ulbEligibilityService.getIneligibleUlbTypeIds('XVIFC');

    const pipeline: PipelineStage[] = [
      {
        $match: {
          form: devolutionForm._id,
          datasetVersion: devolutionForm.activeDatasetVersion,
          isActive: true,
          totalGrantAllocation: { $gt: 0 },
          ulbId: { $ne: null },
        },
      },
      {
        $lookup: {
          from: ulbCollectionName,
          let: { rowUlbId: '$ulbId' },
          pipeline: [
            {
              $match: {
                $expr: {
                  $and: [{ $eq: ['$_id', '$$rowUlbId'] }, { $eq: ['$state', stateOid] }, { $eq: ['$isActive', true] }],
                },
                // Plain field condition can coexist with $expr in one $match — excludes
                // Cantonment Board (and any other XVI-FC-ineligible type) from the picker.
                ...(ineligibleUlbTypeIds.length ? { ulbType: { $nin: ineligibleUlbTypeIds } } : {}),
              },
            },
          ],
          as: 'ulb',
        },
      },
      // Inner-join semantics: drops rows whose ULB is inactive, ineligible, or belongs to another state.
      { $unwind: '$ulb' },
    ];

    if (query.search) {
      const regex = new RegExp(escapeRegex(query.search), 'i');
      pipeline.push({
        $match: { $or: [{ 'ulb.censusCode': regex }, { 'ulb.sbCode': regex }, { 'ulb.name': regex }] },
      });
    }

    pipeline.push({
      $facet: {
        data: [
          { $sort: { 'ulb.name': 1, _id: 1 } },
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: 0,
              ulbId: '$ulbId',
              censusCode: '$ulb.censusCode',
              sbCode: '$ulb.sbCode',
              ulbName: '$ulb.name',
              allocationAmount: '$totalGrantAllocation',
            },
          },
        ],
        totalCount: [{ $count: 'count' }],
      },
    });

    const [result] = (await this.devolutionRowModel.aggregate(pipeline).exec()) as Array<{
      data: FcUnspentUlbOptionAggregationRow[];
      totalCount: Array<{ count: number }>;
    }>;

    const rawOptions = result?.data ?? [];
    const total = result?.totalCount?.[0]?.count ?? 0;

    const options: FcUnspentUlbOption[] = rawOptions.map((o) => ({
      ulbId: String(o.ulbId),
      censusCode: o.censusCode || null,
      sbCode: o.sbCode || null,
      ulbName: o.ulbName,
      allocationAmount: o.allocationAmount,
    }));

    return xviFcSuccess('ULB options fetched.', options, { page, limit, total });
  }

  private hasStateAccess(user: AuthUser, stateId: string): boolean {
    if (user.scope === Scope.ADMIN) return true;
    if (user.scope === Scope.STATE) {
      const userStateId = toObjectIdString(user.state);
      return !!userStateId && userStateId === stateId;
    }
    return false;
  }

  private assertStateAccess(user: AuthUser, stateId: string): void {
    if (!this.hasStateAccess(user, stateId)) {
      throw new ForbiddenException(
        user.scope === Scope.STATE ? 'You can only access your own state data' : 'Access denied',
      );
    }
  }
}
