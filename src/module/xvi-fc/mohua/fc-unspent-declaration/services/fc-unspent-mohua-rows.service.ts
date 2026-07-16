import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Permission, Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { getEffectivePermissions } from 'src/module/auth/permissions.map';
import { getFormStatusLabel } from 'src/common/constants/form-status.constants';
import { ROW_STATUS } from 'src/common/constants/row-status.constants';
import {
  assertCanMohuaMutateForm,
  canMohuaMutateForm,
} from 'src/module/xvi-fc/common/utils/xvi-fc-form-status-access.util';
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
import { FcUnspentRowReviewDomainService } from './fc-unspent-row-review-domain.service';
import { GetFcUnspentMohuaRowsQueryDto } from '../dto/get-fc-unspent-mohua-rows-query.dto';
import { BulkApproveFcUnspentRowsDto } from '../dto/bulk-approve-fc-unspent-rows.dto';
import { BulkRejectFcUnspentRowsDto } from '../dto/bulk-reject-fc-unspent-rows.dto';
import type {
  FcUnspentMohuaBulkActionData,
  FcUnspentMohuaRow,
  FcUnspentMohuaRowLean,
  FcUnspentMohuaRowsData,
} from '../types/fc-unspent-mohua-review.types';

/**
 * FC Unspent Declaration MoHUA review — row-level concerns: the paginated row list and the two
 * bulk row-decision endpoints. Row transitions/history/parent-completion are delegated to
 * `FcUnspentRowReviewDomainService`, shared with the complete-form approve/reject flow.
 */
@Injectable()
export class FcUnspentMohuaRowsService {
  constructor(
    @InjectModel(XviFcUnspentStateFormRow.name)
    private readonly rowModel: Model<XviFcUnspentStateFormRowDocument>,
    private readonly domainService: FcUnspentRowReviewDomainService,
  ) {}

  /** Paginated, searchable, filterable list of a form's active rows for MoHUA review. */
  async getRows(
    stateId: string,
    yearId: string,
    query: GetFcUnspentMohuaRowsQueryDto,
    user: AuthUser,
  ): Promise<XviFcApiResponse<FcUnspentMohuaRowsData>> {
    this.assertReviewAccess(user);

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
          'rowNumber ulbId censusCode sbCode ulbName allocationAmount unspentAmount allocationPerc eligibility rowStatus rejectionRemark',
        )
        .lean<FcUnspentMohuaRowLean[]>()
        .exec(),
      this.rowModel.countDocuments(filter).exec(),
    ]);

    const canReview =
      getEffectivePermissions(user).includes(Permission.APPROVE_STATE_SUBMISSIONS) &&
      canMohuaMutateForm(form.currentFormStatus);

    const rows: FcUnspentMohuaRow[] = rawRows.map((row) => this.mapRowToResponse(row, canReview));

    const data: FcUnspentMohuaRowsData = { rows };
    return xviFcSuccess('FC Unspent Declaration rows fetched.', data, { page, limit, total });
  }

  /**
   * Bulk-approves the given row IDs (must currently be UPDATE_PENDING). Acknowledges the Yes-branch
   * parent atomically if this transition leaves every active row ACTIVE.
   */
  async bulkApproveRows(
    dto: BulkApproveFcUnspentRowsDto,
    user: AuthUser,
    ip: string,
    userAgent: string,
  ): Promise<XviFcApiResponse<FcUnspentMohuaBulkActionData>> {
    this.assertReviewAccess(user);

    const designYear = YearIdToLabel[dto.yearId];
    if (!designYear) throw new NotFoundException(`Design year not found for yearId: ${dto.yearId}`);
    const applicableFc = FC_UNSPENT_APPLICABLE_FC_BY_YEAR_LABEL[designYear];
    if (!applicableFc) throw new NotFoundException(`No applicable FC mapping for design year: ${designYear}`);

    const form = await this.domainService.findForm(dto.stateId, dto.yearId);
    if (!form) throw new NotFoundException('FC Unspent Declaration form not found for this state and year.');
    assertCanMohuaMutateForm(form.currentFormStatus);
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

    const notPending = this.domainService.filterNotInStatus(rows, ROW_STATUS.UPDATE_PENDING);
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
    let acknowledged = false;
    let currentFormStatus = form.currentFormStatus;
    try {
      session.startTransaction();

      await this.domainService.transitionRows(
        form._id,
        stateOid,
        yearOid,
        rows.map((row) => ({ row, newStatus: ROW_STATUS.ACTIVE, rejectionRemark: null })),
        userOid,
        ip,
        userAgent,
        session,
      );

      const ackResult = await this.domainService.maybeAcknowledgeAfterBulkAction(
        form,
        applicableFc,
        userOid,
        ip,
        userAgent,
        session,
      );
      acknowledged = ackResult.acknowledged;
      currentFormStatus = ackResult.currentFormStatus;

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
      parentAcknowledged: acknowledged,
    });
  }

  /**
   * Bulk-rejects the given rows (each with its own required remark; rows must currently be
   * UPDATE_PENDING). Never acknowledges the parent — rejection can only ever keep it under review.
   */
  async bulkRejectRows(
    dto: BulkRejectFcUnspentRowsDto,
    user: AuthUser,
    ip: string,
    userAgent: string,
  ): Promise<XviFcApiResponse<FcUnspentMohuaBulkActionData>> {
    this.assertReviewAccess(user);

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
    assertCanMohuaMutateForm(form.currentFormStatus);
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

    const notPending = this.domainService.filterNotInStatus(rows, ROW_STATUS.UPDATE_PENDING);
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
          newStatus: ROW_STATUS.REJECTED,
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

  private mapRowToResponse(row: FcUnspentMohuaRowLean, canReview: boolean): FcUnspentMohuaRow {
    const isPending = row.rowStatus === ROW_STATUS.UPDATE_PENDING;
    return {
      _id: String(row._id),
      rowNumber: row.rowNumber,
      ulbId: String(row.ulbId),
      censusCode: row.censusCode || null,
      sbCode: row.sbCode || null,
      ulbName: row.ulbName,
      allocationAmount: row.allocationAmount,
      unspentAmount: row.unspentAmount,
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

  private assertReviewAccess(user: AuthUser): void {
    if (user.scope !== Scope.MOHUA && user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Only MoHUA or admin users may review state submissions.');
    }
  }
}
