import { Controller, Get, Query } from '@nestjs/common';
import { AnnualAccountsService } from './annualaccounts.service';
import { QueryAnnualAccountsDto } from './dto/query-annualaccounts.dto';

@Controller('data-sets')
export class AnnualAccountsController {
  constructor(private readonly annualAccountsService: AnnualAccountsService) {}

  @Get('annualaccounts')
  async getAnnualAccounts(@Query() query: QueryAnnualAccountsDto) {
    return this.annualAccountsService.getRawFiles(query);
  }
}
