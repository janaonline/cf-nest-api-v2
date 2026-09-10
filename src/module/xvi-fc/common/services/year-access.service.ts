import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Ulb, UlbDocument, UlbYearAccessEntry } from 'src/schemas/ulb.schema';
import { FormJsonConfigService } from 'src/master/form-json-config/form-json-config.service';
import { formatYearLabel, parseStartCalendarYear } from '../utils/design-year-label.util';

/** Minimal shape YearAccessService needs from a ULB - accepts a full doc, a lean object, or a projection. */
export interface UlbAccessInput {
  _id: Types.ObjectId | string;
  startYear: number | null;
  yearAccess?: Record<string, UlbYearAccessEntry>;
}

/** Minimal shape YearAccessService needs from a Year document. */
export interface YearAccessInput {
  _id: Types.ObjectId | string;
  year: string; // "YYYY-YY"
}

/**
 * Dynamic year access (xvi-fc). Single source of truth: Ulb.yearAccess, lazily materialized
 * one entry at a time. Reads of an already-materialized entry are a direct property lookup -
 * no fallback condition, no live date comparison.
 * Docs: ./CLAUDE.md (mechanics) and ./docs/adr/0001-dynamic-year-access-design.md (why).
 */
@Injectable()
export class YearAccessService {
  constructor(
    @InjectModel(Ulb.name) private readonly ulbModel: Model<UlbDocument>,
    private readonly formJsonConfigService: FormJsonConfigService,
  ) {}

  /** Returns the entry for (ulb, year), materializing and persisting it first if absent. */
  async getEntry(ulb: UlbAccessInput, year: YearAccessInput): Promise<UlbYearAccessEntry> {
    const existing = ulb.yearAccess?.[year.year];
    if (existing) return existing;

    const entry = await this.computeEntry(ulb, year);
    await this.persistEntry(ulb, year, entry);
    return entry;
  }

  /**
   * Read-only variant of getEntry - computes the same result but never writes. Use for bulk/
   * batch read paths (e.g. claim-eligibility evaluation over hundreds of ULBs) where persisting
   * every entry on a single pass would be wasteful; the normal GET flow still materializes it
   * on first touch via getEntry.
   */
  async peekEntry(ulb: UlbAccessInput, year: YearAccessInput): Promise<UlbYearAccessEntry> {
    const existing = ulb.yearAccess?.[year.year];
    if (existing) return existing;
    return this.computeEntry(ulb, year);
  }

  async isYearEnabled(ulb: UlbAccessInput, year: YearAccessInput): Promise<boolean> {
    const entry = await this.getEntry(ulb, year);
    return entry.yearEnabled;
  }

  /** True only when the year is enabled AND formId is listed in that year's disabledFormIds. */
  async isFormExempt(ulb: UlbAccessInput, year: YearAccessInput, formId: number): Promise<boolean> {
    const entry = await this.getEntry(ulb, year);
    return entry.yearEnabled && entry.disabledFormIds.includes(formId);
  }

  /**
   * Admin write path - sets the seed (startYear) entry's disabledFormIds directly. This is the
   * ONLY entry an admin ever edits; every other year is derived from it on next access. Also
   * (re)writes yearEnabled for the seed entry itself (always true - it's the ULB's first year).
   * seedYear must be the Year document matching ulb.startYear (label = formatYearLabel(startYear)).
   */
  async setSeedExemptions(ulb: UlbAccessInput, seedYear: YearAccessInput, disabledFormIds: number[]): Promise<void> {
    if (ulb.startYear == null) return; // nothing to seed without a start year

    const entry: UlbYearAccessEntry = { yearEnabled: true, yearId: seedYear._id, disabledFormIds };
    await this.ulbModel.updateOne({ _id: ulb._id }, { $set: { [`yearAccess.${seedYear.year}`]: entry } });
  }

  private async computeEntry(ulb: UlbAccessInput, year: YearAccessInput): Promise<UlbYearAccessEntry> {
    const yearEnabled = ulb.startYear == null || parseStartCalendarYear(year.year) >= ulb.startYear;
    const disabledFormIds = yearEnabled ? await this.computeDisabledFormIds(ulb, year) : [];
    return { yearEnabled, yearId: year._id, disabledFormIds };
  }

  /**
   * Idempotent - only writes if this exact key is still absent, so a concurrent request that
   * already materialized it wins without a redundant write. Safe either way since the computed
   * value is deterministic for the same (ulb, year) pair.
   */
  private async persistEntry(ulb: UlbAccessInput, year: YearAccessInput, entry: UlbYearAccessEntry): Promise<void> {
    await this.ulbModel.updateOne(
      { _id: ulb._id, [`yearAccess.${year.year}`]: { $exists: false } },
      { $set: { [`yearAccess.${year.year}`]: entry } },
    );
  }

  /**
   * Inherits from the seed (startYear) entry's disabledFormIds, keeping only formIds whose
   * exemptionGraceYears still covers this year. The seed list stays small and bounded (only
   * currently-known exemptable forms), and each config lookup is cached, so this stays cheap
   * even as more forms become exemptable over time.
   */
  private async computeDisabledFormIds(ulb: UlbAccessInput, year: YearAccessInput): Promise<number[]> {
    if (ulb.startYear == null) return [];
    const seedLabel = formatYearLabel(ulb.startYear);
    const seedDisabled = ulb.yearAccess?.[seedLabel]?.disabledFormIds ?? [];
    if (seedDisabled.length === 0) return [];

    // 1-indexed: the seed year itself is index 1.
    const yearIndex = parseStartCalendarYear(year.year) - ulb.startYear + 1;
    if (yearIndex <= 1) return seedDisabled;

    const configs = await Promise.all(seedDisabled.map((formId) => this.formJsonConfigService.findByFormId(formId)));
    return seedDisabled.filter((formId, i) => yearIndex <= (configs[i]?.exemptionGraceYears ?? 1));
  }
}
