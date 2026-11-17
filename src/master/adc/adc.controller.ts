import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import { Roles } from 'src/module/auth/decorators/roles.decorator';
import { RolesGuard } from 'src/module/auth/guards/roles.guard';
import { Role } from 'src/module/auth/enum/role.enum';
import type { IAuthUser } from 'src/common/interfaces/auth-user.interface';
import { AdcService } from './adc.service';
import { AdcListQueryDto } from './dto/adc-list-query.dto';
import { CreateAdcDto } from './dto/create-adc.dto';
import { QueryAdcDto } from './dto/query-adc.dto';
import { RenameAdcDto } from './dto/rename-adc.dto';
import { SetAdcAdminDto } from './dto/set-adc-admin.dto';

@ApiTags('Master - ADC')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('master/adc')
export class AdcController {
  constructor(private readonly adcService: AdcService) {}

  @Get()
  @Roles([Role.ADMIN, Role.STATE])
  @ApiOperation({
    summary:
      'List active Autonomous District Councils. ADMIN: the given state, or all. State DMA: their own state only. ' +
      'ADC users get 403.',
  })
  findAll(@Query() query: QueryAdcDto, @CurrentUser() user: IAuthUser) {
    return this.adcService.findAll(query.stateId, user);
  }

  // ─── Portal Admin: ADC management ─────────────────────────────────────────

  @Get('manage')
  @Roles([Role.ADMIN])
  @ApiOperation({ summary: 'Page of ADCs (max 20) with ULB and member counts and the ADC Admin (ADMIN only)' })
  listForAdmin(@Query() query: AdcListQueryDto) {
    return this.adcService.listForAdmin(query);
  }

  @Get(':id/members')
  @Roles([Role.ADMIN])
  @ApiOperation({ summary: "An ADC's active members, for Change Admin (ADMIN only)" })
  members(@Param('id', ParseObjectIdPipe) id: string) {
    return this.adcService.members(id);
  }

  @Post()
  @Roles([Role.ADMIN])
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create an ADC and invite its ADC Admin (ADMIN only)' })
  @ApiResponse({ status: 409, description: 'ADC_NAME_EXISTS, or an email conflict from the Admin invite' })
  create(@Body() dto: CreateAdcDto, @CurrentUser() user: AuthUser) {
    return this.adcService.create(dto, user);
  }

  @Patch(':id')
  @Roles([Role.ADMIN])
  @ApiOperation({ summary: 'Rename an ADC; its state cannot change (ADMIN only)' })
  @ApiResponse({ status: 409, description: 'ADC_NAME_EXISTS' })
  rename(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: RenameAdcDto, @CurrentUser() user: AuthUser) {
    return this.adcService.rename(id, dto, user);
  }

  @Put(':id/admin')
  @Roles([Role.ADMIN])
  @ApiOperation({
    summary:
      'Replace the ADC Admin: promote a verified member or invite a new person. The old Admin becomes a Reviewer.',
  })
  setAdmin(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: SetAdcAdminDto, @CurrentUser() user: AuthUser) {
    return this.adcService.setAdmin(id, dto, user);
  }

  @Delete(':id')
  @Roles([Role.ADMIN])
  @ApiOperation({
    summary: 'Delete an ADC with no ULBs and no members besides its Admin; removes the Admin (ADMIN only)',
  })
  @ApiResponse({ status: 409, description: 'ADC_IN_USE' })
  remove(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.adcService.remove(id, user);
  }
}
