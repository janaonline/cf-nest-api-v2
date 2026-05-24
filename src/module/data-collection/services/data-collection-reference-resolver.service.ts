import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { Year, YearDocument } from 'src/schemas/year.schema';

/** Resolved ULB identifiers needed for data-collection storage and authorization. */
export type ResolvedUlb = { ulbId: Types.ObjectId; stateId: Types.ObjectId };

/** Resolved year identifiers needed for data-collection storage. */
export type ResolvedYear = { yearId: Types.ObjectId; yearCode: string };

@Injectable()
export class DataCollectionReferenceResolverService {
  constructor(
    @InjectModel(Ulb.name) private readonly ulbModel: Model<UlbDocument>,
    @InjectModel(Year.name) private readonly yearModel: Model<YearDocument>,
  ) {}

  /**
   * Resolves a public ULB code (censusCode or sbCode) to its internal ObjectId and stateId.
   * Throws NotFoundException for no match and ConflictException for multiple matches.
   */
  async resolveUlbByCode(ulbCode: string): Promise<ResolvedUlb> {
    const ulbs = await this.ulbModel
      .find({ $or: [{ censusCode: ulbCode }, { sbCode: ulbCode }] }, { _id: 1, state: 1 })
      .lean<{ _id: Types.ObjectId; state: Types.ObjectId }[]>();

    if (ulbs.length === 0) throw new NotFoundException(`ULB with code '${ulbCode}' not found.`);
    if (ulbs.length > 1) throw new ConflictException(`Multiple ULBs found for code '${ulbCode}'.`);
    return { ulbId: ulbs[0]._id, stateId: ulbs[0].state };
  }

  /**
   * Resolves a financial year code string to its internal ObjectId and canonical yearCode.
   * Throws NotFoundException when no active year matches.
   */
  async resolveYearByCode(yearCode: string): Promise<ResolvedYear> {
    const year = await this.yearModel
      .findOne({ year: yearCode }, { _id: 1, year: 1 })
      .lean<{ _id: Types.ObjectId; year: string } | null>();
    if (!year) throw new NotFoundException(`Year '${yearCode}' not found.`);
    return { yearId: year._id, yearCode: year.year };
  }
}
