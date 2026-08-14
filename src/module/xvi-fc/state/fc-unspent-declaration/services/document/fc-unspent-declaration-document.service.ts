import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { FORM_STATUS, getFormStatusLabel } from 'src/common/constants/form-status.constants';
import { YearIdToLabel } from 'src/core/constants/years';
import { XvifcFormActorsService } from 'src/module/xvi-fc/common/services/xvifc-form-actors.service';
import type { XvifcActorSourceDocument } from 'src/module/xvi-fc/common/types/xvifc-form-actors.type';
import { throwXviFcValidationError } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import {
  FC_UNSPENT_STATE_FORM_TYPE,
  XviFcUnspentStateForm,
  XviFcUnspentStateFormDocument,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form.schema';
import {
  resolvePriorFcCycleFullLabel,
  resolvePriorFcCycleLabel,
} from 'src/module/xvi-fc/state/fc-unspent-declaration/helpers/fc-unspent-declaration-cycle.helpers';
import { FcUnspentDeclarationService } from 'src/module/xvi-fc/state/fc-unspent-declaration/services/main/fc-unspent-declaration.service';
import { FcUnspentDeclarationRowService } from 'src/module/xvi-fc/state/fc-unspent-declaration/services/rows/fc-unspent-declaration-row.service';
import type {
  FcUnspentDeclarationDocumentData,
  FcUnspentDeclarationDocumentRow,
} from 'src/module/xvi-fc/state/fc-unspent-declaration/types/fc-unspent-declaration-document.types';

type FcUnspentDeclarationSourceDoc = XvifcActorSourceDocument & {
  _id: Types.ObjectId;
  currentFormStatus?: number;
  isFcUnspent?: boolean | null;
};

/**
 * Assembles the data behind the FC Unspent Declaration letter (Word doc), consumed only by
 * FcUnspentDeclarationDocxService's `GET :stateId/:yearId/fc-unspent-declaration-document` route.
 * Same document/docx-service split as elected-urban-local-bodies' equivalent feature.
 *
 * Gating reuses FcUnspentDeclarationService's `assertStateAccess`/`resolveDevolutionDependency`/
 * `buildFormPermissions` as-is (those are the same three the GET/save-draft/final-submit paths
 * already share) rather than re-deriving the Devolution dependency logic a second time — see that
 * service's own doc comment on `resolveDevolutionDependency`.
 */
@Injectable()
export class FcUnspentDeclarationDocumentService {
  constructor(
    @InjectModel(XviFcUnspentStateForm.name)
    private readonly model: Model<XviFcUnspentStateFormDocument>,
    private readonly mainService: FcUnspentDeclarationService,
    private readonly rowService: FcUnspentDeclarationRowService,
    private readonly xvifcFormActorsService: XvifcFormActorsService,
  ) {}

  async getDocumentData(stateId: string, yearId: string, user: AuthUser): Promise<FcUnspentDeclarationDocumentData> {
    this.mainService.assertStateAccess(user, stateId);

    const designYearLabel = YearIdToLabel[yearId];
    if (!designYearLabel) throw new NotFoundException(`Design year not found for yearId: ${yearId}`);

    const stateOid = new Types.ObjectId(stateId);
    const yearOid = new Types.ObjectId(yearId);

    const doc = await this.model
      .findOne({ state: stateOid, year: yearOid, formType: FC_UNSPENT_STATE_FORM_TYPE, isDeleted: false })
      .populate('state', 'name')
      .select('_id currentFormStatus isFcUnspent state')
      .lean<FcUnspentDeclarationSourceDoc>()
      .exec();

    const currentFormStatus = doc?.currentFormStatus ?? FORM_STATUS.NOT_STARTED;
    const gates = await this.mainService.resolveDevolutionDependency(stateOid, yearOid);
    const permissions = this.mainService.buildFormPermissions(user, stateId, currentFormStatus, gates);
    if (!permissions.canEdit) {
      throw new ForbiddenException(`Form cannot be edited when status is ${getFormStatusLabel(currentFormStatus)}.`);
    }

    const isFcUnspent = doc?.isFcUnspent ?? null;
    if (isFcUnspent === null) {
      throwXviFcValidationError({
        _form: [
          {
            message: 'Answer whether any ULBs have unspent balance before downloading the declaration.',
            code: 'branchNotChosen',
          },
        ],
      });
    }

    const { stateName } = this.xvifcFormActorsService.buildActorsAndStateName(doc);
    const priorFcCycleLabel = resolvePriorFcCycleLabel(designYearLabel);
    const priorFcCycleFullLabel = resolvePriorFcCycleFullLabel(designYearLabel);

    if (!isFcUnspent) {
      return { isFcUnspent: false, stateName, designYearLabel, priorFcCycleLabel, priorFcCycleFullLabel };
    }

    const activeRows = doc ? await this.rowService.getActiveRows(doc._id) : [];
    if (activeRows.length === 0) {
      throwXviFcValidationError({
        fcUnspentDeclaration: [
          {
            field: 'fcUnspentDeclaration',
            code: 'noRows',
            message: 'No ULB rows found. Add at least one ULB row before downloading the declaration.',
          },
        ],
      });
    }

    const rows: FcUnspentDeclarationDocumentRow[] = activeRows.map((row, index) => ({
      slNo: index + 1,
      censusCode: row.censusCode || '-',
      ulbName: row.ulbName,
      allocationAmount: row.allocationAmount,
      unspentAmount: row.unspentAmount,
      allocationPerc: row.allocationPerc,
      eligibility: row.eligibility,
    }));

    return { isFcUnspent: true, stateName, designYearLabel, priorFcCycleLabel, priorFcCycleFullLabel, rows };
  }
}
