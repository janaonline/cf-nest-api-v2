import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { getFormStatusLabel } from 'src/common/constants/form-status.constants';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { XviFcSfcStatusHistory } from 'src/schemas/xvi-fc/state/sfc-status-history.schema';
import { XviFcGtcHistory } from 'src/schemas/xvi-fc/state/gtc-form-history.schema';
import { DevolutionFormulaForm } from 'src/schemas/xvi-fc/state/devolution-formula-form.schema';
import { DevolutionFormulaFormHistory } from 'src/schemas/xvi-fc/state/devolution-formula-form-history.schema';
import { ElectedUrbanLocalBodiesFormHistory } from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form-history.schema';
import { XviFcUnspentStateFormHistory } from 'src/schemas/xvi-fc/state/fc-unspent-state-form-history.schema';
import { throwXviFcValidationError, xviFcSuccess } from '../response/xvi-fc-response.util';
import type { XviFcApiResponse } from '../response/xvi-fc-api-response';
import { hasReviewerAccess } from '../utils/xvi-fc-reviewer-access.util';
import { isMohuaViewScope } from '../utils/xvi-fc-scope.util';
import {
  STATE_FORM_HISTORY_DEFAULT_PAGE_SIZE,
  STATE_FORM_HISTORY_MAX_PAGE_SIZE,
  StateFormHistoryActorRole,
  StateFormHistoryForm,
} from './state-form-history.constants';
import { decodeHistoryCursor, deriveActorRole, encodeHistoryCursor, isReturnedStatus } from './state-form-history.util';

export interface StateFormHistoryEntry {
  id: string;
  fromStatusLabel: string | null;
  /** Raw status code — lets any client colour/group entries with its own status mapping. */
  toStatus: number;
  toStatusLabel: string;
  actorRole: StateFormHistoryActorRole;
  /** ISO-8601 UTC. Formatting for the viewer's timezone is the client's job. */
  changedAt: string;
  /** Only present on "returned" entries. */
  remarks?: string;
}

export interface StateFormHistoryData {
  entries: StateFormHistoryEntry[];
  /** True when older entries exist beyond this page. */
  hasMore: boolean;
  /** Pass back as `cursor` to fetch the next (older) page; `null` on the last page. */
  nextCursor: string | null;
}

interface HistoryRow {
  _id: Types.ObjectId;
  fromStatus?: number;
  toStatus: number;
  changedAt?: Date;
  createdAt?: Date;
  remarks?: string;
}

// The 5 history schemas share only the projected fields above, so the model type is intentionally loose.
type AnyModel = Model<any>;

interface FormConfig {
  historyModel: AnyModel;
  installmentScoped: boolean;
  /** Builds the history filter. Most histories carry state/year (+ installment) themselves; Devolution's
   *  history has no installment column, so it resolves the per-installment form document first. */
  buildFilter: (
    state: Types.ObjectId,
    year: Types.ObjectId,
    installment?: number,
  ) => Promise<FilterQuery<unknown> | null>;
}

/**
 * Role-neutral, read-only "how did this form get here" lookup over the 5 state forms' form-level history
 * collections. Reused by any reviewer table (PMU today, MoHUA later) — a new form is one entry in `configs`.
 * Never returns who/where (`changedBy`, ip, userAgent) or the data snapshots.
 */
@Injectable()
export class StateFormHistoryService {
  private readonly configs: Record<StateFormHistoryForm, FormConfig>;

  constructor(
    @InjectModel(XviFcSfcStatusHistory.name) sfcHistory: AnyModel,
    @InjectModel(XviFcGtcHistory.name) gtcHistory: AnyModel,
    @InjectModel(DevolutionFormulaFormHistory.name) devolutionHistory: AnyModel,
    @InjectModel(DevolutionFormulaForm.name) devolutionForm: AnyModel,
    @InjectModel(ElectedUrbanLocalBodiesFormHistory.name) eulbHistory: AnyModel,
    @InjectModel(XviFcUnspentStateFormHistory.name) unspentHistory: AnyModel,
  ) {
    const byStateYear = (state: Types.ObjectId, year: Types.ObjectId) => Promise.resolve({ state, year });
    this.configs = {
      [StateFormHistoryForm.SFC_STATUS]: {
        historyModel: sfcHistory,
        installmentScoped: false,
        buildFilter: byStateYear,
      },
      [StateFormHistoryForm.ELECTED_BODY]: {
        historyModel: eulbHistory,
        installmentScoped: false,
        buildFilter: byStateYear,
      },
      [StateFormHistoryForm.FC_UNSPENT]: {
        historyModel: unspentHistory,
        installmentScoped: false,
        buildFilter: byStateYear,
      },
      [StateFormHistoryForm.GTC]: {
        historyModel: gtcHistory,
        installmentScoped: true,
        buildFilter: (state, year, installment) => Promise.resolve({ state, year, installment }),
      },
      [StateFormHistoryForm.DEVOLUTION_FORMULA]: {
        historyModel: devolutionHistory,
        installmentScoped: true,
        buildFilter: async (state, year, installment) => {
          const form = (await devolutionForm.findOne({ state, year, installment }).select('_id').lean()) as {
            _id: Types.ObjectId;
          } | null;
          return form ? { devolutionFormulaForm: form._id } : null;
        },
      },
    };
  }

  async getHistory(
    form: StateFormHistoryForm,
    stateId: string,
    yearId: string,
    installment: number | undefined,
    user: AuthUser,
    paging: { limit?: number; cursor?: string } = {},
  ): Promise<XviFcApiResponse<StateFormHistoryData>> {
    // Read-only history: PMU, MoHUA and DoE (which only views these forms) or admin.
    if (!hasReviewerAccess(user, Scope.PMU) && !hasReviewerAccess(user, Scope.MOHUA) && !isMohuaViewScope(user)) {
      throw new ForbiddenException('Only PMU, MoHUA, DoE or admin users may view form history.');
    }

    const config = this.configs[form];
    if (config.installmentScoped && installment === undefined) {
      throwXviFcValidationError({
        installment: [{ field: 'installment', code: 'required', message: 'Installment is required for this form.' }],
      });
    }

    const filter = await config.buildFilter(
      new Types.ObjectId(stateId),
      new Types.ObjectId(yearId),
      config.installmentScoped ? installment : undefined,
    );
    if (!filter) return xviFcSuccess('Form history fetched.', { entries: [], hasMore: false, nextCursor: null });

    // The DTO already caps `limit`; clamp again so no other caller can exceed the ceiling either.
    const pageSize = Math.min(
      Math.max(Math.trunc(paging.limit ?? STATE_FORM_HISTORY_DEFAULT_PAGE_SIZE), 1),
      STATE_FORM_HISTORY_MAX_PAGE_SIZE,
    );

    let query: FilterQuery<unknown> = filter;
    if (paging.cursor) {
      const cursor = decodeHistoryCursor(paging.cursor);
      if (!cursor) {
        throwXviFcValidationError({ cursor: [{ field: 'cursor', code: 'invalid', message: 'cursor is invalid.' }] });
      }
      // Strictly older than the last row the client has: earlier time, or same time with a smaller id.
      query = {
        $and: [
          filter,
          { $or: [{ changedAt: { $lt: cursor.changedAt } }, { changedAt: cursor.changedAt, _id: { $lt: cursor.id } }] },
        ],
      };
    }

    // One extra row tells us whether another page exists without a separate count query.
    const fetched = (await config.historyModel
      .find(query)
      .select('fromStatus toStatus changedAt createdAt remarks')
      .sort({ changedAt: -1, _id: -1 })
      .limit(pageSize + 1)
      .lean()) as unknown as HistoryRow[];

    const hasMore = fetched.length > pageSize;
    const rows = hasMore ? fetched.slice(0, pageSize) : fetched;
    const last = rows[rows.length - 1];
    const nextCursor =
      hasMore && last ? encodeHistoryCursor(last.changedAt ?? last.createdAt ?? new Date(0), last._id) : null;

    const entries = rows.map<StateFormHistoryEntry>((row) => {
      const entry: StateFormHistoryEntry = {
        id: row._id.toString(),
        fromStatusLabel: row.fromStatus === undefined ? null : getFormStatusLabel(row.fromStatus),
        toStatus: row.toStatus,
        toStatusLabel: getFormStatusLabel(row.toStatus),
        actorRole: deriveActorRole(row.fromStatus, row.toStatus),
        changedAt: (row.changedAt ?? row.createdAt ?? new Date(0)).toISOString(),
      };
      const remarks = row.remarks?.trim();
      if (remarks && isReturnedStatus(row.toStatus)) entry.remarks = remarks;
      return entry;
    });

    return xviFcSuccess('Form history fetched.', { entries, hasMore, nextCursor });
  }
}
