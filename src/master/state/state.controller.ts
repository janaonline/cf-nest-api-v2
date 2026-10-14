import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { RolesGuard } from 'src/module/auth/guards/roles.guard';
import { QueryStateDto } from './dto/query-state.dto';
import { StateService } from './state.service';

@ApiTags('Master - State')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('master/state')
export class StateController {
  constructor(private readonly stateService: StateService) {}

  @Get()
  @ApiOperation({ summary: 'List active, published states for populating a State select/filter.' })
  findAll(@Query() query: QueryStateDto) {
    return this.stateService.findAll(query.excludeUT);
  }
}
