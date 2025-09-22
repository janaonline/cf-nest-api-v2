import { Controller, Get, Query } from '@nestjs/common';
import { QueryResourcesSectionDto } from './dto/query-resources-section.dto';
import { ResourcesSectionService } from './resources-section.service';

@Controller('resources-section')
export class ResourcesSectionController {
  constructor(
    private readonly resourcesSectionService: ResourcesSectionService,
  ) {}

  @Get('data-sets')
  async getAnnualAccounts(@Query() query: QueryResourcesSectionDto) {
    return this.resourcesSectionService.getRawFiles(query);
  }
}
