import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import { FORM_STATUS, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import {
  assertCanPmuMutateForm,
  canPmuMutateForm,
} from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
import { assertPmuReviewerAccess } from 'src/module/xvi-fc/common/utils/xvi-fc-reviewer-access.util';
import { YearIdToLabel } from 'src/core/constants/years';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { throwXviFcValidationError, xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import {
  XviFcUnspentStateFormRow,
  XviFcUnspentStateFormRowDocument,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form-row.schema';
import { FC_UNSPENT_APPLICABLE_FC_BY_YEAR_LABEL } from 'src/module/xvi-fc/state/fc-unspent-declaration/constants/fc-unspent-declaration.constants';
import {
  FC_UNSPENT_PAGINATION_DEFAULT_LIMIT,
  FC_UNSPENT_PAGINATION_DEFAULT_PAGE,
} from 'src/module/xvi-fc/state/fc-unspent-declaration/constants/fc-unspent-declaration.constants';
import { FcUnspentPmuRowReviewDomainService } from './fc-unspent-pmu-row-review-domain.service';
import { GetFcUnspentPmuRowsQueryDto } from '../dto/get-fc-unspent-pmu-rows-query.dto';
import { BulkApprovePmuRowsDto } from 'src/module/xvi-fc/common/dto/bulk-approve-pmu-rows.dto';
import { BulkRejectPmuRowsDto } from 'src/module/xvi-fc/common/dto/bulk-reject-pmu-rows.dto';
import type {
  FcUnspentPmuBulkActionData,
  FcUnspentPmuRow,
  FcUnspentPmuRowLean,
  FcUnspentPmuRowsData,
} from '../types/fc-unspent-pmu-review.types';

/**
 * Row-level PMU review concerns: the paginated row list and the two bulk row-decision endpoints.
 * Modeled on `FcUnspentMohuaRowsService` (mohua/fc-unspent-declaration), left untouched.
 */
@Injectable()
export class FcUnspentPmuRowsService {
  constructor(
    @InjectModel(XviFcUnspentStateFormRow.name)
    private readonly rowModel: Model<XviFcUnspentStateFormRowDocument>,
    private readonly domainService: FcUnspentPmuRowReviewDomainService,
  ) {}

  /** Paginated, searchable, filterable list of a form's active rows for PMU review. */
  async getRows(
    stateId: string,
    yearId: string,
    query: GetFcUnspentPmuRowsQueryDto,
    user: AuthUser,
  ): Promise<XviFcApiResponse<FcUnspentPmuRowsData>> {
    assertPmuReviewerAccess(user);

    const form = await this.domainService.findForm(stateId, yearId);
    if (!form) throw new NotFoundException('FC Unspent Declaration form not found for this state and year.');

    const page = query.page ?? FC_UNSPENT_PAGINATION_DEFAULT_PAGE;
    const limit = query.limit ?? FC_UNSPENT_PAGINATION_DEFAULT_LIMIT;
    const skip = (page - 1) * limit;

    const filter: FilterQuery<XviFcUnspentStateFormRowDocument> = { form: form._id, isActive: true };
    if (query.rowStatus) filter['rowStatus'] = query.rowStatus;
    if (query.eligibility !== undefined) filter['eligibility'] = query.eligibility;
    if (query.search) {
      const regex = new RegExp(query.search, 'i');
      filter['$and'] = [{ $or: [{ ulbName: regex }, { censusCode: regex }, { sbCode: regex }] }];
    }

    const [rawRows, total] = await Promise.all([
      this.rowModel
        .find(filter)
        .sort({ rowNumber: 1 })
        .skip(skip)
        .limit(limit)
        .select(
          'rowNumber ulbId censusCode sbCode ulbName allocationAmount unspentAmount previousFcUnspentBalance allocationPerc eligibility rowStatus rejectionRemark',
        )
        .lean<FcUnspentPmuRowLean[]>()
        .exec(),
      this.rowModel.countDocuments(filter).exec(),
    ]);

    const canReview =
      getEffectivePermissions(user).includes(Permission.APPROVE_STATE_SUBMISSIONS_PMU) &&
      canPmuMutateForm(form.currentFormStatus);

    const rows: FcUnspentPmuRow[] = rawRows.map((row) => this.mapRowToResponse(row, canReview));

    const data: FcUnspentPmuRowsData = { rows };
    return xviFcSuccess('FC Unspent Declaration rows fetched.', data, { page, limit, total });
  }

  /** See CLAUDE.md's "Row-level bulk review and the auto-approve rule" section — mirrors
   *  `FcUnspentMohuaRowsService.bulkApproveRows` one stage earlier. */
  async bulkApproveRows(
    dto: BulkApprovePmuRowsDto,
    user: AuthUser,
    ip: string,
    userAgent: string,
  ): Promise<XviFcApiResponse<FcUnspentPmuBulkActionData>> {
    assertPmuReviewerAccess(user);

    const designYear = YearIdToLabel[dto.yearId];
    if (!designYear) throw new NotFoundException(`Design year not found for yearId: ${dto.yearId}`);
    const applicableFc = FC_UNSPENT_APPLICABLE_FC_BY_YEAR_LABEL[designYear];
    if (!applicableFc) throw new NotFoundException(`No applicable FC mapping for design year: ${designYear}`);

    const form = await this.domainService.findForm(dto.stateId, dto.yearId);
    if (!form) throw new NotFoundException('FC Unspent Declaration form not found for this state and year.');
    assertCanPmuMutateForm(form.currentFormStatus);
    if (form.isFcUnspent !== true) {
      throwXviFcValidationError({
        _form: [{ code: 'notYesBranch', message: 'Row-level review only applies to Yes-branch forms.' }],
      });
    }

    const rowOids = dto.rowIds.map((id) => new Types.ObjectId(id));
    const { rows, missingIds } = await this.domainService.loadActiveRowsByIds(form._id, rowOids);
    if (missingIds.length > 0) {
      throwXviFcValidationError({
        rowIds: [{ field: 'rowIds', code: 'notFound', message: 'One or more row IDs were not found on this form.' }],
      });
    }

    const notPending = this.domainService.filterNotInStatus(rows, FORM_STATUS.UNDER_REVIEW_BY_PMU);
    if (notPending.length > 0) {
      throwXviFcValidationError({
        rowIds: [
          {
            field: 'rowIds',
            code: 'notPending',
            message: 'One or more selected rows are not awaiting review (already decided or not yet submitted).',
          },
        ],
      });
    }

    const stateOid = new Types.ObjectId(dto.stateId);
    const yearOid = new Types.ObjectId(dto.yearId);
    const userOid = new Types.ObjectId(user._id);

    const session = await this.rowModel.db.startSession();
    let approved = false;
    let currentFormStatus = form.currentFormStatus;
    try {
      session.startTransaction();

      await this.domainService.transitionRows(
        form._id,
        stateOid,
        yearOid,
        rows.map((row) => ({ row, newStatus: FORM_STATUS.UNDER_REVIEW_BY_MOHUA, rejectionRemark: null })),
        userOid,
        ip,
        userAgent,
        session,
      );

      const result = await this.domainService.maybeApproveAfterBulkAction(
        form,
        applicableFc,
        userOid,
        ip,
        userAgent,
        session,
      );
      approved = result.approved;
      currentFormStatus = result.currentFormStatus;

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }

    const rowSummary = await this.domainService.getRowSummary(form._id);

    return xviFcSuccess('Selected rows approved.', {
      updatedRowCount: rows.length,
      rowSummary,
      currentFormStatus,
      currentFormStatusLabel: getFormStatusLabel(currentFormStatus),
      parentAcknowledged: approved,
    });
  }

  /** Each row needs its own required remark; rejection never auto-approves the parent. See
   *  CLAUDE.md's "Row-level bulk review and the auto-approve rule" section. */
  async bulkRejectRows(
    dto: BulkRejectPmuRowsDto,
    user: AuthUser,
    ip: string,
    userAgent: string,
  ): Promise<XviFcApiResponse<FcUnspentPmuBulkActionData>> {
    assertPmuReviewerAccess(user);

    const rowIds = dto.rows.map((r) => r.rowId);
    if (new Set(rowIds).size !== rowIds.length) {
      throwXviFcValidationError({
        rows: [{ field: 'rows', code: 'duplicateRowId', message: 'Duplicate row IDs are not allowed.' }],
      });
    }

    const remarkErrors: { field?: string; code?: string; message: string }[] = [];
    dto.rows.forEach((r, i) => {
      if (!r.rejectionRemark?.trim()) {
        remarkErrors.push({
          field: `rows.${i}.rejectionRemark`,
          code: 'required',
          message: 'A rejection remark is required for every selected row.',
        });
      }
    });
    if (remarkErrors.length > 0) {
      throwXviFcValidationError({ 'rows.rejectionRemark': remarkErrors });
    }

    const form = await this.domainService.findForm(dto.stateId, dto.yearId);
    if (!form) throw new NotFoundException('FC Unspent Declaration form not found for this state and year.');
    assertCanPmuMutateForm(form.currentFormStatus);
    if (form.isFcUnspent !== true) {
      throwXviFcValidationError({
        _form: [{ code: 'notYesBranch', message: 'Row-level review only applies to Yes-branch forms.' }],
      });
    }

    const rowOids = rowIds.map((id) => new Types.ObjectId(id));
    const { rows, missingIds } = await this.domainService.loadActiveRowsByIds(form._id, rowOids);
    if (missingIds.length > 0) {
      throwXviFcValidationError({
        rows: [{ field: 'rows', code: 'notFound', message: 'One or more row IDs were not found on this form.' }],
      });
    }

    const notPending = this.domainService.filterNotInStatus(rows, FORM_STATUS.UNDER_REVIEW_BY_PMU);
    if (notPending.length > 0) {
      throwXviFcValidationError({
        rows: [
          {
            field: 'rows',
            code: 'notPending',
            message: 'One or more selected rows are not awaiting review (already decided or not yet submitted).',
          },
        ],
      });
    }

    const remarkByRowId = new Map(dto.rows.map((r) => [r.rowId, r.rejectionRemark.trim()]));
    const stateOid = new Types.ObjectId(dto.stateId);
    const yearOid = new Types.ObjectId(dto.yearId);
    const userOid = new Types.ObjectId(user._id);

    const session = await this.rowModel.db.startSession();
    try {
      session.startTransaction();

      await this.domainService.transitionRows(
        form._id,
        stateOid,
        yearOid,
        rows.map((row) => ({
          row,
          newStatus: FORM_STATUS.RETURNED_BY_PMU,
          rejectionRemark: remarkByRowId.get(String(row._id)) ?? '',
        })),
        userOid,
        ip,
        userAgent,
        session,
      );

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }

    const rowSummary = await this.domainService.getRowSummary(form._id);

    return xviFcSuccess('Selected rows rejected.', {
      updatedRowCount: rows.length,
      rowSummary,
      currentFormStatus: form.currentFormStatus,
      currentFormStatusLabel: getFormStatusLabel(form.currentFormStatus),
      parentAcknowledged: false,
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private mapRowToResponse(row: FcUnspentPmuRowLean, canReview: boolean): FcUnspentPmuRow {
    const isPending = row.rowStatus === FORM_STATUS.UNDER_REVIEW_BY_PMU;
    return {
      _id: String(row._id),
      rowNumber: row.rowNumber,
      ulbId: String(row.ulbId),
      censusCode: row.censusCode || null,
      sbCode: row.sbCode || null,
      ulbName: row.ulbName,
      allocationAmount: row.allocationAmount,
      unspentAmount: row.unspentAmount,
      previousFcUnspentBalance: row.previousFcUnspentBalance,
      allocationPerc: row.allocationPerc,
      eligibility: row.eligibility,
      rowStatus: row.rowStatus,
      rejectionRemark: row.rejectionRemark ?? null,
      permissions: {
        canApprove: canReview && isPending,
        canReject: canReview && isPending,
      },
    };
  }
}
