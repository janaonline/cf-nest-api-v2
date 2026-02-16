import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { DataCollectionService } from './data-collection.service';
import { DataCollectionDto } from './dto/data-collection.dto';

@Controller('data-collection')
export class DataCollectionController {
  constructor(private readonly dataCollectionService: DataCollectionService) {}

  @Get('financial-data-template')
  getFinancialDataTemplate() {
    return this.dataCollectionService.getFinancialDataTemplate();
  }

  @Get('ulbs')
  getUlbsList() {
    return this.dataCollectionService.getUlbsList();
  }

  @Get('years')
  getYearsList() {
    return this.dataCollectionService.getYearsList();
  }

  @Post('submit-financial-data')
  create(@Body() payload: DataCollectionDto) {
    return this.dataCollectionService.create(payload);
  }

  @Patch('modify-financial-data')
  update(@Body() payload: DataCollectionDto) {
    return this.dataCollectionService.update(payload);
  }
}
