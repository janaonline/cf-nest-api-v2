import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { UlbService } from './ulb.service';
import { CreateUlbDto } from './dto/create-ulb.dto';
import { UpdateUlbDto } from './dto/update-ulb.dto';

@Controller('ulb')
export class UlbController {
  constructor(private readonly ulbService: UlbService) {}

  @Post()
  create(@Body() createUlbDto: CreateUlbDto) {
    return this.ulbService.create(createUlbDto);
  }

  @Get()
  findAll() {
    return this.ulbService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ulbService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUlbDto: UpdateUlbDto) {
    return this.ulbService.update(+id, updateUlbDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.ulbService.remove(+id);
  }
}
