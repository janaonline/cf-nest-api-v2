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
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { Roles } from 'src/module/auth/decorators/roles.decorator';
import { Role } from 'src/module/auth/enum/role.enum';
import { RolesGuard } from 'src/module/auth/guards/roles.guard';
import { CreateUlbTypeDto } from './dto/create-ulb-type.dto';
import { UpdateUlbTypeDto } from './dto/update-ulb-type.dto';
import { UlbTypesService } from './ulb-types.service';

@ApiTags('admin-ulb-types')
@ApiBearerAuth()
@Roles([Role.ADMIN])
@UseGuards(RolesGuard)
@Controller('ulb-types')
export class UlbTypesController {
  constructor(private readonly service: UlbTypesService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new ULB type (ADMIN only)' })
  @ApiResponse({ status: 409, description: 'A ULB type with this name and isActive already exists' })
  create(@Body() dto: CreateUlbTypeDto) {
    return this.service.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all ULB types, paginated (ADMIN only)' })
  findAll(@Query() pagination: PaginationDto) {
    return this.service.findAll(pagination.page, pagination.limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a ULB type by id (ADMIN only)' })
  @ApiResponse({ status: 404, description: 'Not found' })
  findOne(@Param('id', ParseObjectIdPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Update a ULB type (ADMIN only), including `ineligibleForGrantCycles`. Any change to that field ' +
      "instantly invalidates UlbEligibilityService's cache for the affected grant cycle(s) — there is no " +
      'propagation delay to wait out.',
  })
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateUlbTypeDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Deactivate a ULB type (ADMIN only). Soft-delete via isActive=false.' })
  remove(@Param('id', ParseObjectIdPipe) id: string) {
    return this.service.remove(id);
  }
}
