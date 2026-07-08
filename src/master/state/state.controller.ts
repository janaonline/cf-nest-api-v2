import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from 'src/module/auth/guards/roles.guard';
import { StateService } from './state.service';

@ApiTags('Master - State')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('master/state')
export class StateController {
  constructor(private readonly stateService: StateService) {}

  @Get()
  @ApiOperation({ summary: 'List active, published states for populating a State select/filter.' })
  findAll() {
    return this.stateService.findAll();
  }
}
