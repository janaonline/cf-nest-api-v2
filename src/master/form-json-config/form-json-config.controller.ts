import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { Roles } from 'src/module/auth/decorators/roles.decorator';
import { RolesGuard } from 'src/module/auth/guards/roles.guard';
import { Role } from 'src/module/auth/enum/role.enum';
import type { IExemptableFormJsonConfig, IFormJsonConfig } from './interfaces/form-json-config.interface';
import { FormJsonConfigService } from './form-json-config.service';
import { CreateFormJsonConfigDto } from './dto/create-form-json-config.dto';
import { UpdateFormJsonConfigDto } from './dto/update-form-json-config.dto';

@ApiTags('FormJsonConfig')
@ApiBearerAuth()
@Controller('form-json-config')
export class FormJsonConfigController {
  constructor(private readonly service: FormJsonConfigService) {}

  @Get()
  @ApiOperation({ summary: 'List all form behavior configs' })
  findAll(): Promise<IFormJsonConfig[]> {
    return this.service.findAll();
  }

  @Get('exemptable')
  @ApiOperation({ summary: 'List formIds that currently support the new-ULB exemption mechanism' })
  findAllExemptable(): Promise<IExemptableFormJsonConfig[]> {
    return this.service.findAllExemptable();
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles([Role.ADMIN])
  @ApiOperation({ summary: 'Create a form behavior config (ADMIN only)' })
  create(@Body() dto: CreateFormJsonConfigDto): Promise<IFormJsonConfig> {
    return this.service.create(dto);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles([Role.ADMIN])
  @ApiOperation({ summary: 'Update a form behavior config (ADMIN only)' })
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateFormJsonConfigDto): Promise<IFormJsonConfig> {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(RolesGuard)
  @Roles([Role.ADMIN])
  @ApiOperation({ summary: 'Deactivate a form behavior config (ADMIN only)' })
  remove(@Param('id', ParseObjectIdPipe) id: string): Promise<void> {
    return this.service.remove(id);
  }
}
