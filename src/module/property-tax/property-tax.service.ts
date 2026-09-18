import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { AuthUser } from '../auth/auth-user.interface';
import { Scope } from '../auth/enum/roles-xvi-fc.enum';
import { PropertyTaxOpMapper, PropertyTaxOpMapperDocument } from '../../schemas/property-tax-op-mapper.schema';
import { Year, YearDocument } from '../../schemas/year.schema';
import { PROPERTY_TAX_CHART_YEARS, PROPERTY_TAX_COLLECTION_DISPLAY_PRIORITY } from './property-tax.constants';

export interface PropertyTaxCollectionTrendPoint {
  financialYear: string;
  valueInRupees: number | null;
}

@Injectable()
export class PropertyTaxService {
  constructor(
    @InjectModel(PropertyTaxOpMapper.name) private readonly mapperModel: Model<PropertyTaxOpMapperDocument>,
    @InjectModel(Year.name) private readonly yearModel: Model<YearDocument>,
  ) {}

  /** Backs the "Property Tax* (Cr.)" trend chart — one Total Property Tax Collection figure per
   * chart year, in raw rupees (not pre-converted to crores) — FE owns the crore conversion
   * (÷1,00,00,000), whether per year for the chart or on a summed total for some other KPI, so it
   * isn't baked into a single division here. Missing years (no propertytaxopmappers row yet) come
   * back as `null`, not 0 — collapsing that distinction would make "not yet available"
   * indistinguishable from "we looked and it's genuinely zero". */
  async getCollectionTrend(ulbId: string, user: AuthUser): Promise<PropertyTaxCollectionTrendPoint[]> {
    this.validateUlbAccess(ulbId, user);

    // Both queries are independent (the mapper query is scoped by ulb + displayPriority alone,
    // not by yearIds) so they run concurrently rather than paying two sequential round-trips —
    // the join against PROPERTY_TAX_CHART_YEARS happens in memory below.
    const [yearDocs, mapperDocs] = await Promise.all([
      this.yearModel
        .find({ year: { $in: PROPERTY_TAX_CHART_YEARS } })
        .select('_id year')
        .lean()
        .exec(),
      this.mapperModel
        .find({
          ulb: new Types.ObjectId(ulbId),
          displayPriority: PROPERTY_TAX_COLLECTION_DISPLAY_PRIORITY,
        })
        .select('year value')
        .lean()
        .exec(),
    ]);
    const yearIdToYear = new Map(yearDocs.map((y) => [y._id.toString(), y.year]));

    const rupeeValueByYear = new Map<string, number | null>();
    for (const doc of mapperDocs) {
      const financialYear = yearIdToYear.get(doc.year?.toString());
      if (financialYear) rupeeValueByYear.set(financialYear, this.toRupees(doc.value));
    }

    return PROPERTY_TAX_CHART_YEARS.map((financialYear) => ({
      financialYear,
      valueInRupees: rupeeValueByYear.get(financialYear) ?? null,
    }));
  }

  // propertytaxopmappers.value is stored already expressed in LAKHS, not raw rupees — verified
  // against real data (a demand/collection of "851.45" is ₹85.145 lakh, not ₹851.45).
  // 1 lakh = 1,00,000 rupees, so multiplying by 100,000 converts directly.
  private toRupees(rawValue: string | null | undefined): number | null {
    if (rawValue === null || rawValue === undefined || rawValue === '') return null;
    const num = Number(rawValue);
    if (Number.isNaN(num)) return null;
    return Math.round(num * 100000);
  }

  private validateUlbAccess(ulbId: string, user: AuthUser) {
    if (user.scope === Scope.ULB && user.ulb?.toString() !== ulbId) {
      throw new ForbiddenException('You can only access your own ULB data');
    }
  }
}
