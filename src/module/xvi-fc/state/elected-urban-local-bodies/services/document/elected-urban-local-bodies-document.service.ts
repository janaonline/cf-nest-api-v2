import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { toObjectIdString } from 'src/common/utils/objectid.util';
import { Year, YearDocument } from 'src/schemas/year.schema';
import { XvifcFormActorsService } from 'src/module/xvi-fc/common/services/xvifc-form-actors.service';
import { keyByFieldKey, requireField } from 'src/module/xvi-fc/common/utils/xvi-fc-field-lookup.util';
import { throwXviFcValidationError } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import {
  EULB_FORM_TYPE,
  ElectedUrbanLocalBodiesForm,
  EulbFormDocument,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-form.schema';
import {
  ElectedUrbanLocalBodiesRow,
  EulbRowDocument,
  EulbRowValidationStatus,
} from 'src/schemas/xvi-fc/state/elected-urban-local-bodies-row.schema';
import { EulbFormJsonConfigService } from 'src/module/xvi-fc/state/elected-urban-local-bodies/services/form-json/elected-urban-local-bodies-form-json.service';
import { getFieldsByType } from 'src/module/xvi-fc/state/elected-urban-local-bodies/helpers/elected-urban-local-bodies-form-json.helpers';
import type {
  EulbListDocumentColumn,
  EulbListDocumentData,
  EulbListDocumentRow,
} from 'src/module/xvi-fc/state/elected-urban-local-bodies/types/elected-urban-local-bodies-document.types';

/** Ordered keys of the row fields shown as table columns in the generated document — order here is
 *  the column order in the letter. Labels are resolved from the live form-json config, never
 *  hardcoded (see EulbListDocumentColumn's doc comment). */
const EULB_LIST_DOCUMENT_COLUMN_KEYS = [
  'censusCode',
  'ulbName',
  'electedBodyStatus',
  'dateOfConstitution',
  'dateOfExpiry',
  'remarks',
] as const;

interface EulbListSourceRow {
  rowNumber: number;
  censusCode?: string | null;
  ulbName: string;
  electedBodyStatus?: string | null;
  dateOfConstitution?: Date | string | null;
  dateOfExpiry?: Date | string | null;
  remarks?: string | null;
  validationStatus: EulbRowValidationStatus;
}

interface EulbListSourceForm {
  _id: Types.ObjectId;
  activeDatasetVersion?: number;
  state?: unknown;
}

/**
 * Assembles the data behind the "Elected Bodies List" declaration letter (Word doc) —
 * consumed only by ElectedUrbanLocalBodiesDocxService's `GET :stateId/:yearId/elected-bodies-list-document`
 * route.
 *
 * Uses the same active-dataset-version row query as dumpToExcel(),
 * but only generates the certification when all active rows have validationStatus: 'VALID'.
 * Partial or invalid datasets must never be downloadable as final.
 */
@Injectable()
export class ElectedUrbanLocalBodiesDocumentService {
  constructor(
    @InjectModel(ElectedUrbanLocalBodiesForm.name)
    private readonly formModel: Model<EulbFormDocument>,
    @InjectModel(ElectedUrbanLocalBodiesRow.name)
    private readonly rowModel: Model<EulbRowDocument>,
    @InjectModel(Year.name)
    private readonly yearModel: Model<YearDocument>,
    private readonly xvifcFormActorsService: XvifcFormActorsService,
    private readonly eulbFormJsonConfig: EulbFormJsonConfigService,
  ) {}

  async getDocumentData(stateId: string, yearId: string, user: AuthUser): Promise<EulbListDocumentData> {
    this.assertStateAccess(user, stateId);

    const stateOid = new Types.ObjectId(stateId);
    const yearOid = new Types.ObjectId(yearId);

    const formDoc = await this.formModel
      .findOne({ state: stateOid, year: yearOid, formType: EULB_FORM_TYPE, isDeleted: false })
      .populate('state', 'name')
      .select('_id activeDatasetVersion state')
      .lean<EulbListSourceForm>()
      .exec();

    const activeVersion = formDoc?.activeDatasetVersion ?? 0;
    const rows =
      formDoc && activeVersion > 0
        ? await this.rowModel
            .find({ form: formDoc._id, state: stateOid, year: yearOid, datasetVersion: activeVersion, isActive: true })
            .select(
              'rowNumber censusCode ulbName electedBodyStatus dateOfConstitution dateOfExpiry remarks validationStatus',
            )
            .sort({ rowNumber: 1 })
            .lean<EulbListSourceRow[]>()
            .exec()
        : [];

    if (rows.length === 0) {
      throwXviFcValidationError({
        signedElectedbodyFile: [
          {
            field: 'signedElectedbodyFile',
            code: 'noRows',
            message:
              'No elected-body rows found for this state and year. Upload and validate the elected bodies Excel before downloading the list.',
          },
        ],
      });
    }
    if (rows.some((row) => row.validationStatus !== 'VALID')) {
      throwXviFcValidationError({
        signedElectedbodyFile: [
          {
            field: 'signedElectedbodyFile',
            code: 'rowsNotValid',
            message:
              'All elected-body rows must pass validation before the list can be downloaded. Review and correct the flagged rows.',
          },
        ],
      });
    }

    const { stateName } = this.xvifcFormActorsService.buildActorsAndStateName(formDoc);

    const [columns, yearDoc] = await Promise.all([
      this.resolveColumns(yearId),
      this.yearModel.findById(yearOid).select('year').lean<{ year: string } | null>().exec(),
    ]);
    if (!yearDoc) throw new NotFoundException(`Year ${yearId} not found`);

    const documentRows: EulbListDocumentRow[] = rows.map((row, index) => ({
      slNo: index + 1,
      censusCode: row.censusCode ?? '',
      ulbName: row.ulbName,
      electedBodyStatus: row.electedBodyStatus ?? '',
      dateOfConstitution: row.dateOfConstitution ?? null,
      dateOfExpiry: row.dateOfExpiry ?? null,
      remarks: row.remarks ?? '',
    }));

    return {
      stateName,
      ulbCount: rows.length,
      designYearLabel: yearDoc.year,
      columns,
      rows: documentRows,
    };
  }

  /** Resolves the 6 table column labels from the live EULB_EXTRA_ULB_PORTAL_FIELDS form-json
   *  config — never hardcoded, so an editor changing a field's `label` in formjsons is reflected
   *  in the next download without a code change. */
  private async resolveColumns(yearId: string): Promise<EulbListDocumentColumn[]> {
    const fields = await this.eulbFormJsonConfig.loadFields(yearId);
    const extraFields = keyByFieldKey(getFieldsByType(fields, 'EULB_EXTRA_ULB_PORTAL_FIELDS'));

    return EULB_LIST_DOCUMENT_COLUMN_KEYS.map((key) => {
      const field = requireField(extraFields, key, 'ElectedUrbanLocalBodiesDocumentService.resolveColumns');
      return { key, label: field.label };
    });
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
