import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { Year } from 'src/schemas/year.schema';
import { UlbEligibilityService } from 'src/module/ulb-eligibility/ulb-eligibility.service';
import { resolveDesignYearApplicabilityCutoff } from '../constants/expected-ulb-set.constants';
import { parseStartCalendarYear } from '../utils/design-year-label.util';

export interface ExpectedUlb {
  ulbId: string;
  name: string;
  censusCode: string | null;
  sbCode: string | null;
}

type LeanYear = { _id: Types.ObjectId; year: string };
type LeanUlb = { _id: Types.ObjectId; name: string; censusCode?: string | null; sbCode?: string | null };

/**
 * Shared "expected active ULB set" helper (brain §6.5) — before this, every feature queried
 * `ulbs` independently with its own ad-hoc filter. Centralizes both the active-registry filter and
 * the design-year applicability cutoff (`expected-ulb-set.constants.ts`) in one place so a future
 * change to the cutoff rule doesn't require touching every consumer.
 *
 * `Model<Year>` (not `Model<YearDocument>`) is used deliberately here: `year.schema.ts`'s
 * `YearDocument` type alias is missing its `Document` import and silently resolves to the
 * unrelated global DOM `Document` type, which would fail `Model<T>`'s type constraint. Fixing that
 * pre-existing schema file is out of scope for this feature; this is a local workaround only.
 */
@Injectable()
export class ExpectedUlbSetService {
  constructor(
    @InjectModel(Ulb.name) private readonly ulbModel: Model<UlbDocument>,
    @InjectModel(Year.name) private readonly yearModel: Model<Year>,
    private readonly ulbEligibilityService: UlbEligibilityService,
  ) {}

  async resolve(stateId: string, designYearId: string): Promise<ExpectedUlb[]> {
    // TODO: Implement cache for years.
    const year = await this.yearModel.findById(designYearId).select('year').lean<LeanYear>().exec();
    if (!year) throw new NotFoundException(`Year ${designYearId} not found`);

    // Delegates the {state, isActive, ulbType-not-excluded} filter to the shared eligibility
    const eligibleUlbFilter = await this.ulbEligibilityService.getEligibleUlbFilter(stateId, 'XVIFC');

    const docs = await this.ulbModel
      .find({ ...eligibleUlbFilter, ...this.applicabilityFilter(year.year) })
      .select('name censusCode sbCode')
      .lean<LeanUlb[]>()
      .exec();

    // TODO: why add map when .lean() is already returning plain objects.
    return docs.map((d) => ({
      ulbId: String(d._id),
      name: d.name,
      censusCode: d.censusCode ?? null,
      sbCode: d.sbCode ?? null,
    }));
  }

  /** Expected-ULB ids for every state at once — one grouped query instead of `resolve()` per state. */
  async idsByState(designYearId: string): Promise<Map<string, string[]>> {
    const year = await this.yearModel.findById(designYearId).select('year').lean<LeanYear>().exec();
    if (!year) throw new NotFoundException(`Year ${designYearId} not found`);

    const ineligibleUlbTypeIds = await this.ulbEligibilityService.getIneligibleUlbTypeIds('XVIFC');
    const rows = await this.ulbModel
      .aggregate<{ _id: Types.ObjectId; ids: Types.ObjectId[] }>([
        {
          $match: {
            isActive: true,
            ...(ineligibleUlbTypeIds.length ? { ulbType: { $nin: ineligibleUlbTypeIds } } : {}),
            ...this.applicabilityFilter(year.year),
          },
        },
        { $group: { _id: '$state', ids: { $push: '$_id' } } },
      ])
      .exec();

    return new Map(rows.map((row) => [String(row._id), row.ids.map(String)]));
  }

  /**
   * Design-year applicability clause shared by `resolve()` and `idsByState()`.
   * XVI-FC dynamic year access — examples (design year "2027-28" -> yearStartCalendarYear = 2027):
   *   - Existing ULB, startYear not set, dateOfConstitution = 2005-04-01 (<= cutoff)
   *       -> included (branch 2: constituted well before this design year).
   *   - Old ULB record, startYear not set, dateOfConstitution = null (never captured)
   *       -> included (branch 2: missing data defaults to include, never excludes).
   *   - New ULB, startYear = 2029, dateOfConstitution = 2029-06-01
   *       -> excluded from "2027-28" (branch 1: 2029 > 2027, ULB didn't exist yet for this year).
   *   - Same new ULB (startYear = 2029), queried for design year "2029-30" (yearStartCalendarYear = 2029)
   *       -> included (branch 1: 2029 <= 2029, this is its first participating year).
   *   - ULB has both startYear and dateOfConstitution set
   *       -> startYear always wins; dateOfConstitution is ignored (branches are mutually
   *          exclusive on startYear being null vs. not null).
   */
  private applicabilityFilter(designYearLabel: string) {
    const cutoff = resolveDesignYearApplicabilityCutoff(designYearLabel);
    const yearStartCalendarYear = parseStartCalendarYear(designYearLabel);
    return {
      $or: [
        { startYear: { $ne: null, $lte: yearStartCalendarYear } },
        { startYear: null, $or: [{ dateOfConstitution: null }, { dateOfConstitution: { $lte: cutoff } }] },
      ],
    };
  }
}
