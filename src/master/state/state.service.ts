import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { State, StateDocument } from 'src/schemas/state.schema';

@Injectable()
export class StateService {
  constructor(@InjectModel(State.name) private readonly stateModel: Model<StateDocument>) {}

  /** Lists active, published states for populating a State select/filter. */
  findAll() {
    return this.stateModel
      .find(
        { isActive: true, isPublish: true },
        { name: 1, slug: 1, code: 1, regionalName: 1, censusCode: 1 },
      )
      .sort({ name: 1 })
      .lean();
  }
}
