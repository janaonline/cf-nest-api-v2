import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import type { IAuthUser } from 'src/common/interfaces/auth-user.interface';
import { Role } from 'src/module/auth/enum/role.enum';
import { Adc, AdcDocument } from 'src/schemas/adc.schema';

export interface AdcListItem {
  _id: Types.ObjectId;
  name: string;
  state: Types.ObjectId;
}

@Injectable()
export class AdcService {
  constructor(@InjectModel(Adc.name) private readonly adcModel: Model<AdcDocument>) {}

  /**
   * Active ADCs for the pickers (Assign ADC, ADC Teams). ADMIN: the given state's, or every state's when no
   * state is passed. A State user (State DMA): always their own state's — the param is ignored. ADC users and
   * every other role: 403 (an ADC user never picks an ADC; theirs comes from their token).
   */
  async findAll(stateId: string | undefined, user: IAuthUser): Promise<AdcListItem[]> {
    const filter: Record<string, unknown> = { isActive: true };

    if (user.role === Role.ADMIN) {
      if (stateId) filter.state = new Types.ObjectId(stateId);
    } else if (user.role === Role.STATE && !user.adc) {
      if (!user.state) throw new ForbiddenException('Your account has no state assigned.');
      filter.state = new Types.ObjectId(String(user.state));
    } else {
      throw new ForbiddenException('You do not have access to the ADC list.');
    }

    return this.adcModel.find(filter, { name: 1, state: 1 }).sort({ name: 1 }).lean<AdcListItem[]>().exec();
  }
}
