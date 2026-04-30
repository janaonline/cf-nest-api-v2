import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';

import { GrantAllocation, GrantAllocationDocument } from './schemas/grant-allocation.schema';
import { StateWiseResponseDto } from './dto/state-wise-response.dto';
import { buildGetStateWiseDataPipeline } from './quires/get-state-wise-data.query';
import { SIDE_MENU_CONFIG } from './config/side-menu.config';
import type { MenuRole } from './config/side-menu.config';
import { SideMenuResponseDto } from './dto/side-menu.dto';
import { Year, YearDocument } from './schemas/year.schema';

@Injectable()
export class XviFcService {
  constructor(
    @InjectModel(GrantAllocation.name)
    private readonly grantAllocationModel: Model<GrantAllocationDocument>,
    @InjectModel(Year.name)
    private readonly yearModel: Model<YearDocument>,
  ) {}

  async getStateWiseData(stateId: string): Promise<StateWiseResponseDto> {
    const stateObjectId = new Types.ObjectId(stateId);
    const pipeline = buildGetStateWiseDataPipeline(stateObjectId);
    const [result] = await this.grantAllocationModel.aggregate<StateWiseResponseDto>(pipeline);
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

  async getYears(): Promise<{ _id: string; year: string }[]> {
    const YEAR_RANGE = ['2026-27', '2027-28', '2028-29', '2029-30', '2030-31'];
    const results = await this.yearModel
      .find({ year: { $in: YEAR_RANGE } }, { _id: 1, year: 1 })
      .lean()
      .exec();
    return results.map((r) => ({ _id: r._id.toString(), year: r.year }));
  }

  getSupportHours(): {
    nextSupportHour: { date: string; description: string; time: string; hostedBy: string };
    upcomingSupportHours: { date: string; details: string; status: 'UPCOMING' | 'SCHEDULED' }[];
  } {
    const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
    const istNow = new Date(Date.now() + IST_OFFSET_MS);

    const dayOfWeek = istNow.getUTCDay();
    const istMinutesOfDay = istNow.getUTCHours() * 60 + istNow.getUTCMinutes();

    // Thursday = 4; if today is Thursday but past 4 PM IST, roll to next week
    let daysUntilThursday = (4 - dayOfWeek + 7) % 7;
    if (dayOfWeek === 4 && istMinutesOfDay >= 16 * 60) {
      daysUntilThursday = 7;
    }

    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const thursdays = Array.from({ length: 3 }, (_, i) => {
      const d = new Date(istNow);
      d.setUTCDate(istNow.getUTCDate() + daysUntilThursday + i * 7);
      return d;
    });

    const formatLong = (d: Date) =>
      `Thursday, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

    const formatShort = (d: Date) =>
      `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;

    const NEXT_DETAILS =
      'Open Q&A session for ULB teams. Bring your questions about audited financial statements, submissions, or validation errors.';

    return {
      nextSupportHour: {
        date: formatLong(thursdays[0]),
        description: NEXT_DETAILS,
        time: '3:00 PM - 4:00 PM IST',
        hostedBy: 'CityFinance Product & PMU Team',
      },
      upcomingSupportHours: thursdays.slice(1).map((d, i) => ({
        date: formatShort(d),
        details: 'Open support hour',
        status: i === 0 ? 'UPCOMING' : 'SCHEDULED',
      })),
    };
  }
}
