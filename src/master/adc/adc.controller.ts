import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import { Roles } from 'src/module/auth/decorators/roles.decorator';
import { RolesGuard } from 'src/module/auth/guards/roles.guard';
import { Role } from 'src/module/auth/enum/role.enum';
import type { IAuthUser } from 'src/common/interfaces/auth-user.interface';
import { AdcService } from './adc.service';
import { QueryAdcDto } from './dto/query-adc.dto';

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
}
