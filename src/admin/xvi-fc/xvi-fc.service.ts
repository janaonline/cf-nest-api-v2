import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import {
  GrantAllocation,
  GrantAllocationDocument,
} from './schemas/grant-allocation.schema';
import { StateWiseResponseDto } from './dto/state-wise-response.dto';
import { buildGetStateWiseDataPipeline } from './quires/get-state-wise-data.query';
import { SIDE_MENU_CONFIG } from './config/side-menu.config';
import type { MenuRole } from './config/side-menu.config';
import { SideMenuResponseDto } from './dto/side-menu.dto';

@Injectable()
export class XviFcService {
  constructor(
    @InjectModel(GrantAllocation.name)
    private readonly grantAllocationModel: Model<GrantAllocationDocument>,
  ) {}

  async getStateWiseData(stateId: string): Promise<StateWiseResponseDto> {
    const stateObjectId = new Types.ObjectId(stateId);

    const pipeline = buildGetStateWiseDataPipeline(stateObjectId);

    const [result] =
      await this.grantAllocationModel.aggregate<StateWiseResponseDto>(pipeline);

    if (!result) {
      throw new NotFoundException('No grant allocation data found for this state');
    }

    return result;
  }

  async getSideMenu(role: MenuRole, yearId: string): Promise<SideMenuResponseDto> {
    const menuFactory = SIDE_MENU_CONFIG[role];

    if (!menuFactory) {
      throw new NotFoundException(`No menu found for role ${role}`);
    }

    return menuFactory(yearId);
  }
}