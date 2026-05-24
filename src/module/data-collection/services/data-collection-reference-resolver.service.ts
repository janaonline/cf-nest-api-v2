import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { Year, YearDocument } from 'src/schemas/year.schema';

@Injectable()
export class DataCollectionReferenceResolverService {
  constructor(
    @InjectModel(Ulb.name) private readonly ulbModel: Model<UlbDocument>,
    @InjectModel(Year.name) private readonly yearModel: Model<YearDocument>,
  ) {}

  /** Resolves a public ULB code (censusCode or sbCode) to its internal ObjectId. */
  async resolveUlbByCode(ulbCode: string): Promise<{ _id: Types.ObjectId }> {
    const ulbs = await this.ulbModel
      .find({ $or: [{ censusCode: ulbCode }, { sbCode: ulbCode }] }, { _id: 1 })
      .lean<{ _id: Types.ObjectId }[]>();

    if (ulbs.length === 0) throw new NotFoundException(`ULB with code '${ulbCode}' not found.`);
    if (ulbs.length > 1) throw new ConflictException(`Multiple ULBs found for code '${ulbCode}'.`);
    return ulbs[0];
  }

  /** Resolves a financial year code to its internal ObjectId. */
  async resolveYearByCode(yearCode: string): Promise<{ _id: Types.ObjectId }> {
    const year = await this.yearModel.findOne({ year: yearCode }, { _id: 1 }).lean<{ _id: Types.ObjectId } | null>();
    if (!year) throw new NotFoundException(`Year '${yearCode}' not found.`);
    return year;
  }
}
