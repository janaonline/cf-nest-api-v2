import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { Roles } from 'src/module/auth/decorators/roles.decorator';
import { RolesGuard } from 'src/module/auth/guards/roles.guard';
import { Role } from 'src/module/auth/enum/role.enum';
import type { IFormJson } from './interfaces/form-json.interface';
import { FormJsonService } from './form-json.service';
import { CreateFormJsonDto } from './dto/create-form-json.dto';
import { UpdateFormJsonDto } from './dto/update-form-json.dto';
import { QueryFormJsonDto } from './dto/query-form-json.dto';

@ApiTags('FormJson')
@ApiBearerAuth()
@Controller('form-json')
export class FormJsonController {
  constructor(private readonly formJsonService: FormJsonService) {}

  @Get()
  @ApiOperation({ summary: 'List FormJson documents', description: 'Optional filters: type, design_year, isActive.' })
  findAll(@Query() query: QueryFormJsonDto): Promise<IFormJson[]> {
    return this.formJsonService.findAll(query);
  }

  @Get('by-type/:type')
  @ApiOperation({ summary: 'Get active FormJson by type key' })
  findByType(@Param('type') type: string): Promise<IFormJson> {
    return this.formJsonService.findByType(type);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get FormJson by _id' })
  findById(@Param('id', ParseObjectIdPipe) id: string): Promise<IFormJson> {
    return this.formJsonService.findById(id);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles([Role.ADMIN])
  @ApiOperation({ summary: 'Create FormJson (ADMIN only)' })
  create(@Body() dto: CreateFormJsonDto): Promise<IFormJson> {
    return this.formJsonService.create(dto);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles([Role.ADMIN])
  @ApiOperation({ summary: 'Update FormJson (ADMIN only)' })
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateFormJsonDto): Promise<IFormJson> {
    return this.formJsonService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(RolesGuard)
  @Roles([Role.ADMIN])
  @ApiOperation({ summary: 'Deactivate FormJson — sets isActive=false (ADMIN only)' })
  remove(@Param('id', ParseObjectIdPipe) id: string): Promise<void> {
    return this.formJsonService.remove(id);
  }
}
