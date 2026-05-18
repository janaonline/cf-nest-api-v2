import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentApiClient } from 'src/module/auth/decorators/current-api-client.decorator';
import { Scopes } from 'src/module/auth/decorators/scopes.decorator';
import { IntegrationJwtGuard } from 'src/module/auth/guards/integration-jwt.guard';
import { ScopesGuard } from 'src/module/auth/guards/scopes.guard';
import type { ApiClientContext } from 'src/module/auth/types/api-client-context.type';
import { DATA_COLLECTION_SCOPES } from './constants/data-collection-scopes.constant';
import { DataCollectionDto } from './dto/data-collection.dto';
import { DataCollectionService } from './services/data-collection.service';

@ApiTags('data-collection')
@UseGuards(IntegrationJwtGuard, ScopesGuard)
@Controller('data-collection')
export class DataCollectionController {
  constructor(private readonly dataCollectionService: DataCollectionService) {}

  @Get('financial-data-template')
  @ApiOperation({
    summary: 'Get financial data template',
    description: 'Returns active line items and validation rules for the template version.',
  })
  @Scopes(DATA_COLLECTION_SCOPES.TEMPLATE_READ)
  getFinancialDataTemplate() {
    return this.dataCollectionService.getFinancialDataTemplate();
  }

  @Get('ulbs')
  @ApiOperation({
    summary: 'Get allowed ULBs',
    description: 'Returns ULBs accessible by the client (scoped to state or specific ULB).',
  })
  @Scopes(DATA_COLLECTION_SCOPES.ULBS_READ)
  getUlbsList(@CurrentApiClient() client: ApiClientContext) {
    return this.dataCollectionService.getUlbsList(client);
  }

  @Get('years')
  @ApiOperation({
    summary: 'Get available years',
    description: 'Returns active financial years available for data submission.',
  })
  @Scopes(DATA_COLLECTION_SCOPES.YEARS_READ)
  getYearsList() {
    return this.dataCollectionService.getYearsList();
  }

  @Post('submit-financial-data')
  @ApiOperation({
    summary: 'Submit financial data',
    description: 'Creates a new data collection record for a ULB and financial year.',
  })
  @Scopes(DATA_COLLECTION_SCOPES.FINANCIAL_DATA_SUBMIT)
  create(@Body() payload: DataCollectionDto, @CurrentApiClient() client: ApiClientContext) {
    return this.dataCollectionService.create(payload, client);
  }

  @Patch('modify-financial-data')
  @ApiOperation({
    summary: 'Modify financial data',
    description: 'Updates an existing data collection record by merging new line item values.',
  })
  @Scopes(DATA_COLLECTION_SCOPES.FINANCIAL_DATA_MODIFY)
  update(@Body() payload: DataCollectionDto, @CurrentApiClient() client: ApiClientContext) {
    return this.dataCollectionService.update(payload, client);
  }
}
