import { Body, Controller, Get, Post, Put } from '@nestjs/common';
import { DataCollectionService } from './data-collection.service';
import { CreateDataCollectionDto } from './dto/create-data-collection.dto';
import { UpdateDataCollectionDto } from './dto/update-data-collection.dto';

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
  create(@Body() createDataCollectionDto: CreateDataCollectionDto) {
    return this.dataCollectionService.create(createDataCollectionDto);
  }

  @Put('modify-financial-data')
  update(@Body() updateDataCollectionDto: UpdateDataCollectionDto) {
    return this.dataCollectionService.update(updateDataCollectionDto);
  }
}
