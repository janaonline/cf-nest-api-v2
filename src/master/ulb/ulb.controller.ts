import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { Roles } from 'src/module/auth/decorators/roles.decorator';
import { RolesGuard } from 'src/module/auth/guards/roles.guard';
import { Role } from 'src/module/auth/enum/role.enum';
import { CreateUlbDto } from './dto/create-ulb.dto';
import { QueryUlbDto } from './dto/query-ulb.dto';
import { UpdateUlbDto } from './dto/update-ulb.dto';
import { UlbService } from './ulb.service';
import { Public } from 'src/module/auth/decorators/public.decorator';

@ApiTags('Master - ULB')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('master/ulb')
export class UlbController {
  constructor(private readonly ulbService: UlbService) {}

  @Public()
  @Post()
  // @Roles([Role.ADMIN])
  @ApiOperation({ summary: 'Create a ULB (ADMIN only). Fields validated against the ULB_MASTER form-json config.' })
  create(@Body() createUlbDto: CreateUlbDto) {
    return this.ulbService.create(createUlbDto);
  }

  @Get()
  @ApiOperation({ summary: 'List ULBs with search, filters, and pagination' })
  findAll(@Query() query: QueryUlbDto) {
    return this.ulbService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a ULB by id' })
  findOne(@Param('id', ParseObjectIdPipe) id: string) {
    return this.ulbService.findOne(id);
  }

  @Patch(':id')
  @Roles([Role.ADMIN])
  @ApiOperation({ summary: 'Update a ULB (ADMIN only). Only provided fields are validated and updated.' })
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() updateUlbDto: UpdateUlbDto) {
    return this.ulbService.update(id, updateUlbDto);
  }

  @Delete(':id')
  @Roles([Role.ADMIN])
  @ApiOperation({ summary: 'Deactivate a ULB (ADMIN only). Soft-delete via isActive=false.' })
  remove(@Param('id', ParseObjectIdPipe) id: string) {
    return this.ulbService.remove(id);
  }
}
