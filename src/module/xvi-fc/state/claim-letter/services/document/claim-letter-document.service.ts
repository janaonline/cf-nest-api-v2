import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { xviFcSuccess } from 'src/module/xvi-fc/common/response/xvi-fc-response.util';
import type { XviFcApiResponse } from 'src/module/xvi-fc/common/response/xvi-fc-api-response';
import { State, StateDocument } from 'src/schemas/state.schema';
import { Year, YearDocument } from 'src/schemas/year.schema';
import { User, UserDocument } from 'src/schemas/user/user.schema';
import {
  FC_UNSPENT_STATE_FORM_TYPE,
  XviFcUnspentStateForm,
  XviFcUnspentStateFormDocument,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form.schema';
import {
  XviFcUnspentStateFormRow,
  XviFcUnspentStateFormRowDocument,
} from 'src/schemas/xvi-fc/state/fc-unspent-state-form-row.schema';
import { resolvePriorFcCycleLabel } from 'src/module/xvi-fc/state/fc-unspent-declaration/helpers/fc-unspent-declaration-cycle.helpers';
import { buildClaimLetterRefNo, sumAmountsExactly } from '../../helpers/claim-letter-financial.helpers';
import { ClaimLetterUlbRowsService } from '../ulb-rows/claim-letter-ulb-rows.service';
import type {
  ClaimLetterDocumentAnnexure1Row,
  ClaimLetterDocumentAnnexure2Column,
  ClaimLetterDocumentAnnexure2Row,
  ClaimLetterDocumentCoveringLetterRow,
  ClaimLetterDocumentData,
} from '../../types/claim-letter.types';

/** Formjson criterion `type` Annexure 1's "Eligible (<10%)" column is specifically about — that
 *  annexure *is* the FC-disclosure check, so it stays tied to this one named criterion by design.
 *  Annexure 2, by contrast, is a general checklist and is built dynamically from whichever criteria
 *  are currently enabled — see `ClaimLetterUlbLevelEligibility.criteriaColumns`, never a hardcoded
 *  list here. */
const CRITERION_TYPE_FC_UNSPENT = 'FC_UNSPENT_STATE';

/**
 * Assembles the claim letter document — Covering Letter + Annexure 1 (FC Disclosures) + Annexure 2
 * (City Conditions) — consumed by both the Preview Template dialog and the Download Template PDF
 * builder on the frontend (one fetch, two renderers). This is the live, batch-specific letter a
 * State prints, signs, and re-uploads via `signedClaimFile` — not a generic blank template.
 *
 * Reuses `ClaimLetterUlbRowsService.getAllUlbRows()` for the batch's ULBs, claimed amounts, and
 * resolved per-ULB eligibility criteria rather than re-querying `ClaimLetterBatchUlb` or
 * re-resolving eligibility here — see that method's own doc comment.
 */
@Injectable()
export class ClaimLetterDocumentService {
  constructor(
    private readonly ulbRowsService: ClaimLetterUlbRowsService,
    @InjectModel(State.name) private readonly stateModel: Model<StateDocument>,
    @InjectModel(Year.name) private readonly yearModel: Model<YearDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(XviFcUnspentStateForm.name)
    private readonly unspentFormModel: Model<XviFcUnspentStateFormDocument>,
    @InjectModel(XviFcUnspentStateFormRow.name)
    private readonly unspentRowModel: Model<XviFcUnspentStateFormRowDocument>,
  ) {}

  async getDocumentData(claimLetterId: string, user: AuthUser): Promise<XviFcApiResponse<ClaimLetterDocumentData>> {
    const { parent, rows, ulbLevelEligibility } = await this.ulbRowsService.getAllUlbRows(claimLetterId, user);

    const [stateDoc, yearDoc, userDoc] = await Promise.all([
      this.stateModel.findById(parent.state).select('name code').lean<{ name: string; code: string } | null>().exec(),
      this.yearModel.findById(parent.year).select('year').lean<{ year: string } | null>().exec(),
      this.userModel
        .findById(user._id)
        .select('name designation departmentName')
        .lean<{ name: string; designation: string; departmentName: string } | null>()
        .exec(),
    ]);
    if (!stateDoc) throw new NotFoundException(`State ${String(parent.state)} not found`);
    if (!yearDoc) throw new NotFoundException(`Year ${String(parent.year)} not found`);
    if (!userDoc) throw new NotFoundException(`User ${user._id} not found`);

    const designYearLabel = yearDoc.year;
    const priorFcCycleLabel = resolvePriorFcCycleLabel(designYearLabel);

    const unspentByUlbId = await this.resolveUnspentAmounts(
      parent.state,
      parent.year,
      rows.map((r) => r.ulbId),
    );

    const coveringLetterRows: ClaimLetterDocumentCoveringLetterRow[] = rows.map((row, index) => ({
      slNo: index + 1,
      ulbId: row.ulbId,
      ulbName: row.ulbName,
      claimAmount: row.claimAmount,
    }));
    const totalClaimAmount = sumAmountsExactly(rows.map((r) => r.claimAmount));

    // Both annexures read the same per-ULB failed-criteria set — Annexure 1's "Eligible (<10%)" and
    // Annexure 2's "FC Disclosure" both trace back to the one FC_UNSPENT_STATE criterion; no reason
    // to compute the threshold check twice with two different formulas.
    const annexure1Rows: ClaimLetterDocumentAnnexure1Row[] = rows.map((row, index) => {
      const failedTypes = new Set((ulbLevelEligibility.perUlbFailedCriteria.get(row.ulbId) ?? []).map((f) => f.type));
      return {
        slNo: index + 1,
        ulbId: row.ulbId,
        ulbName: row.ulbName,
        priorFcUnspentAmount: unspentByUlbId.get(row.ulbId) ?? 0,
        claimedAmount: row.claimAmount,
        eligible: !failedTypes.has(CRITERION_TYPE_FC_UNSPENT),
      };
    });

    // Dynamic, not a fixed 4 — one column per currently-enabled ULB-bulk criterion (see
    // `ClaimLetterUlbLevelEligibility.criteriaColumns`'s own docblock for why this is safe to read
    // as the canonical column set rather than deriving it from who happened to fail what).
    const annexure2Columns: ClaimLetterDocumentAnnexure2Column[] = ulbLevelEligibility.criteriaColumns.map((c) => ({
      type: c.type,
      label: c.label,
      shortLabel: c.shortLabel,
    }));
    const annexure2Rows: ClaimLetterDocumentAnnexure2Row[] = rows.map((row, index) => {
      const failedTypes = new Set((ulbLevelEligibility.perUlbFailedCriteria.get(row.ulbId) ?? []).map((f) => f.type));
      return {
        slNo: index + 1,
        ulbId: row.ulbId,
        ulbName: row.ulbName,
        criteria: ulbLevelEligibility.criteriaColumns.map((col) => ({
          type: col.type,
          met: !failedTypes.has(col.type),
        })),
      };
    });

    const refNo = buildClaimLetterRefNo({
      stateCode: stateDoc.code,
      designYearLabel,
      installment: parent.installment,
      batchNumber: parent.batchNumber,
    });

    const document: ClaimLetterDocumentData = {
      refNo,
      letterDate: new Date().toISOString(),
      stateName: stateDoc.name,
      departmentName: userDoc.departmentName || '',
      designYearLabel,
      installment: parent.installment,
      batchNumber: parent.batchNumber as ClaimLetterDocumentData['batchNumber'],
      priorFcCycleLabel,
      subjectLine: this.buildSubjectLine(stateDoc.name, designYearLabel, parent.installment, parent.batchNumber),
      introParagraph: this.buildIntroParagraph(stateDoc.name, userDoc.departmentName, designYearLabel, rows.length),
      closingParagraph: this.buildClosingParagraph(),
      signatoryName: userDoc.name,
      signatoryDesignation: userDoc.designation || '',
      coveringLetterRows,
      totalClaimAmount,
      annexure1Rows,
      annexure2Columns,
      annexure2Rows,
    };

    return xviFcSuccess('Claim letter document fetched.', document);
  }

  /** `undefined` form or missing row → `0` (graceful degrade — a state with no FC-Unspent
   *  declaration on file yet shouldn't block letter generation). */
  private async resolveUnspentAmounts(
    state: Types.ObjectId,
    year: Types.ObjectId,
    ulbIds: string[],
  ): Promise<Map<string, number>> {
    const form = await this.unspentFormModel
      .findOne({ state, year, formType: FC_UNSPENT_STATE_FORM_TYPE, isDeleted: false })
      .select('_id')
      .lean<{ _id: Types.ObjectId } | null>()
      .exec();
    if (!form) return new Map();

    const rows = await this.unspentRowModel
      .find({ form: form._id, ulbId: { $in: ulbIds.map((id) => new Types.ObjectId(id)) }, isActive: true })
      .select('ulbId unspentAmount')
      .lean<{ ulbId: Types.ObjectId; unspentAmount: number }[]>()
      .exec();

    return new Map(rows.map((r) => [String(r.ulbId), r.unspentAmount]));
  }

  private buildSubjectLine(
    stateName: string,
    designYearLabel: string,
    installment: 1 | 2,
    batchNumber: number,
  ): string {
    return (
      `Claim Letter - State of ${stateName} recommends the following Urban Local Bodies for release ` +
      `of 16th Finance Commission Basic Grants (FY ${designYearLabel}) - Instalment ${installment} · Batch ${batchNumber}.`
    );
  }

  private buildIntroParagraph(
    stateName: string,
    departmentName: string,
    designYearLabel: string,
    ulbCount: number,
  ): string {
    const dept = departmentName || 'the designated nodal department';
    const ulbNoun = ulbCount === 1 ? 'Urban Local Body' : 'Urban Local Bodies';
    return (
      `The State Government of ${stateName}, through ${dept}, hereby certifies that the ${ulbNoun} listed ` +
      `below have fulfilled all eligibility conditions prescribed by the 16th Finance Commission for the ` +
      `release of Basic Grants for FY ${designYearLabel}. The State has completed its review and recommends ` +
      `these ${ulbNoun.toLowerCase()} for MoHUA's consideration and release processing.`
    );
  }

  private buildClosingParagraph(): string {
    return (
      'This letter is issued in accordance with the guidelines of the Ministry of Housing and Urban Affairs ' +
      'and is forwarded to MoHUA for further review and onward processing. Detailed supporting information is ' +
      'provided in Annexure 1 (FC Unspent Balance Disclosures) and Annexure 2 (City-wise Eligibility Conditions).'
    );
  }
}
