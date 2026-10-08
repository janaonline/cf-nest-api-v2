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
import { throwXviFcValidationError, xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import {
  ElectedUrbanLocalBodiesRow,
  EulbRowDocument,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import {
  EULB_PMU_PAGINATION_DEFAULT_LIMIT,
  EULB_PMU_PAGINATION_DEFAULT_PAGE,
} from '../constants/elected-urban-local-bodies-pmu-review.constants';
import { ElectedUrbanLocalBodiesPmuRowReviewDomainService } from './elected-urban-local-bodies-pmu-row-review-domain.service';
import { GetEulbPmuRowsQueryDto } from '../dto/get-eulb-pmu-rows-query.dto';
import { BulkApprovePmuRowsDto } from 'src/module/xvi-fc/common/dto/bulk-approve-pmu-rows.dto';
import { BulkRejectPmuRowsDto } from 'src/module/xvi-fc/common/dto/bulk-reject-pmu-rows.dto';
import type {
  EulbPmuBulkActionData,
  EulbPmuRow,
  EulbPmuRowLean,
  EulbPmuRowsData,
} from '../types/elected-urban-local-bodies-pmu-review.types';

/**
 * Row-level PMU review concerns: the paginated row list and the two bulk row-decision endpoints.
 * Modeled on `FcUnspentPmuRowsService`, with every row query additionally scoped to the form's
 * `activeDatasetVersion` — EULB rows are dataset-versioned, unlike FC Unspent's.
 */
@Injectable()
export class ElectedUrbanLocalBodiesPmuRowsService {
  constructor(
    @InjectModel(ElectedUrbanLocalBodiesRow.name)
    private readonly rowModel: Model<EulbRowDocument>,
    private readonly domainService: ElectedUrbanLocalBodiesPmuRowReviewDomainService,
  ) {}

  /** Paginated, searchable, filterable list of a form's active (current dataset version) rows for
   *  PMU review. */
  async getRows(
    stateId: string,
    yearId: string,
    query: GetEulbPmuRowsQueryDto,
    user: AuthUser,
  ): Promise<XviFcApiResponse<EulbPmuRowsData>> {
    assertPmuReviewerAccess(user);

    const form = await this.domainService.findForm(stateId, yearId);
    if (!form) throw new NotFoundException('Elected Urban Local Bodies form not found for this state and year.');

    const page = query.page ?? EULB_PMU_PAGINATION_DEFAULT_PAGE;
    const limit = query.limit ?? EULB_PMU_PAGINATION_DEFAULT_LIMIT;
    const skip = (page - 1) * limit;

    const filter: FilterQuery<EulbRowDocument> = {
      form: form._id,
      datasetVersion: form.activeDatasetVersion,
      isActive: true,
    };
    if (query.rowStatus) filter['rowStatus'] = query.rowStatus;
    if (query.search) {
      const regex = new RegExp(query.search, 'i');
      filter['$or'] = [{ ulbName: regex }, { censusCode: regex }];
    }

    const [rawRows, total] = await Promise.all([
      this.rowModel
        .find(filter)
        .sort({ rowNumber: 1 })
        .skip(skip)
        .limit(limit)
        .select(
          'rowNumber ulbId censusCode ulbName electedBodyStatus dateOfConstitution dateOfExpiry remarks rowStatus rejectionRemark',
        )
        .lean<EulbPmuRowLean[]>()
        .exec(),
      this.rowModel.countDocuments(filter).exec(),
    ]);

    const canReview =
      getEffectivePermissions(user).includes(Permission.APPROVE_STATE_SUBMISSIONS_PMU) &&
      canPmuMutateForm(form.currentFormStatus);

    const rows: EulbPmuRow[] = rawRows.map((row) => this.mapRowToResponse(row, canReview));

    const data: EulbPmuRowsData = { rows };
    return xviFcSuccess('Elected Urban Local Bodies rows fetched.', data, { page, limit, total });
  }

  /** Pending-status requirement and auto-approve rule mirror `FcUnspentPmuRowsService.bulkApproveRows`. */
  async bulkApproveRows(
    dto: BulkApprovePmuRowsDto,
    user: AuthUser,
    ip: string,
    userAgent: string,
  ): Promise<XviFcApiResponse<EulbPmuBulkActionData>> {
    assertPmuReviewerAccess(user);

    const form = await this.domainService.findForm(dto.stateId, dto.yearId);
    if (!form) throw new NotFoundException('Elected Urban Local Bodies form not found for this state and year.');
    assertCanPmuMutateForm(form.currentFormStatus);

    const rowOids = dto.rowIds.map((id) => new Types.ObjectId(id));
    const { rows, missingIds } = await this.domainService.loadActiveRowsByIds(
      form._id,
      form.activeDatasetVersion,
      rowOids,
    );
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

      const result = await this.domainService.maybeApproveAfterBulkAction(form, userOid, ip, userAgent, session);
      approved = result.approved;
      currentFormStatus = result.currentFormStatus;

      await session.commitTransaction();
    } catch (err) {
      await session.abortTransaction();
      throw err;
    } finally {
      await session.endSession();
    }

    const rowSummary = await this.domainService.getRowSummary(form._id, form.activeDatasetVersion);

    return xviFcSuccess('Selected rows approved.', {
      updatedRowCount: rows.length,
      rowSummary,
      currentFormStatus,
      currentFormStatusLabel: getFormStatusLabel(currentFormStatus),
      parentAcknowledged: approved,
    });
  }

  /** Each row needs its own required remark; rejection never auto-approves the parent — mirrors
   *  `FcUnspentPmuRowsService.bulkRejectRows`. */
  async bulkRejectRows(
    dto: BulkRejectPmuRowsDto,
    user: AuthUser,
    ip: string,
    userAgent: string,
  ): Promise<XviFcApiResponse<EulbPmuBulkActionData>> {
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
    if (!form) throw new NotFoundException('Elected Urban Local Bodies form not found for this state and year.');
    assertCanPmuMutateForm(form.currentFormStatus);

    const rowOids = rowIds.map((id) => new Types.ObjectId(id));
    const { rows, missingIds } = await this.domainService.loadActiveRowsByIds(
      form._id,
      form.activeDatasetVersion,
      rowOids,
    );
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

    const rowSummary = await this.domainService.getRowSummary(form._id, form.activeDatasetVersion);

    return xviFcSuccess('Selected rows rejected.', {
      updatedRowCount: rows.length,
      rowSummary,
      currentFormStatus: form.currentFormStatus,
      currentFormStatusLabel: getFormStatusLabel(form.currentFormStatus),
      parentAcknowledged: false,
    });
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  private mapRowToResponse(row: EulbPmuRowLean, canReview: boolean): EulbPmuRow {
    const isPending = row.rowStatus === FORM_STATUS.UNDER_REVIEW_BY_PMU;
    return {
      _id: String(row._id),
      rowNumber: row.rowNumber,
      ulbId: row.ulbId ? String(row.ulbId) : null,
      censusCode: row.censusCode || null,
      ulbName: row.ulbName,
      electedBodyStatus: row.electedBodyStatus ?? null,
      dateOfConstitution: row.dateOfConstitution ?? null,
      dateOfExpiry: row.dateOfExpiry ?? null,
      remarks: row.remarks ?? null,
      rowStatus: row.rowStatus,
      rejectionRemark: row.rejectionRemark ?? null,
      permissions: {
        canApprove: canReview && isPending,
        canReject: canReview && isPending,
      },
    };
  }
}
