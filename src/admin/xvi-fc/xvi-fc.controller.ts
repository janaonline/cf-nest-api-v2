/* eslint-disable prettier/prettier */
import { Controller, Get, Param, Query } from '@nestjs/common';

import { XviFcService } from './xvi-fc.service';
import { StateWiseResponseDto } from './dto/state-wise-response.dto';
import { SideMenuResponseDto } from './dto/side-menu.dto';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import type { MenuRole } from './config/side-menu.config';
import { ApiBearerAuth } from '@nestjs/swagger/dist/decorators';
import { Public } from '../../module/auth/decorators/public.decorator';

@Controller('xvi-fc')
export class XviFcController {
  constructor(private readonly xviFcService: XviFcService) {}

  @ApiBearerAuth()
  @Get('state/:stateId')
  async getStateWiseData(@Param('stateId', ParseObjectIdPipe) stateId: string): Promise<StateWiseResponseDto> {
    return this.xviFcService.getStateWiseData(stateId);
  }

  @Get('sidebar/:role')
  async getSideMenu(@Param('role') role: MenuRole, @Query('yearId') yearId: string): Promise<SideMenuResponseDto> {
    return this.xviFcService.getSideMenu(role, yearId);
  }

  @ApiBearerAuth()
  @Get('years')
  async getYears(): Promise<{ _id: string; year: string }[]> {
    return this.xviFcService.getYears();
  }

  @ApiBearerAuth()
  @Get('ulb/:ulbId')
  async getUlbById(@Param('ulbId', ParseObjectIdPipe) ulbId: string) {
    return this.xviFcService.getUlbById(ulbId);
  }

  @ApiBearerAuth()
  @Get('state-info/:stateId')
  async getStateById(@Param('stateId', ParseObjectIdPipe) stateId: string) {
    return this.xviFcService.getStateById(stateId);
  }

  @Public()
  @Get('support-hours')
  getSupportHours(): ReturnType<XviFcService['getSupportHours']> {
    return this.xviFcService.getSupportHours();
  }
}
