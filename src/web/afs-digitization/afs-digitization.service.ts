import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { State, StateDocument } from 'src/schemas/state.schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { Year, YearDocument } from 'src/schemas/year.schema';

@Injectable()
export class AfsDigitizationService {
  constructor(
    @InjectModel(State.name)
    private stateModel: Model<StateDocument>,

    @InjectModel(Ulb.name)
    private ulbModel: Model<UlbDocument>,

    @InjectModel(Year.name)
    private yearModel: Model<YearDocument>,
  ) {}

  async getAfsFilters() {
    const [states, ulbs, years] = await Promise.all([
      this.stateModel.find({ isActive: true }, { _id: 1, name: 1 }).sort({ name: 1 }),
      this.ulbModel
        .find({ isActive: true }, { _id: 1, name: 1, population: 1, state: 1, code: 1 })
        .populate('state', 'name')
        .sort({ name: 1 }),
      this.yearModel.find({ isActive: true }, { _id: 1, name: 1 }).sort({ name: -1 }),
    ]);

    // TODO: migration pending.
    return { states, ulbs, years };
  }
}
