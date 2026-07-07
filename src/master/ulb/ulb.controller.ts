import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import { Roles } from 'src/module/auth/decorators/roles.decorator';
import { RolesGuard } from 'src/module/auth/guards/roles.guard';
import { Role } from 'src/module/auth/enum/role.enum';
import type { IAuthUser } from 'src/common/interfaces/auth-user.interface';
import { CreateUlbDto } from './dto/create-ulb.dto';
import { QueryUlbDto } from './dto/query-ulb.dto';
import { RejectUlbDto } from './dto/reject-ulb.dto';
import { UpdateUlbDto } from './dto/update-ulb.dto';
import { UlbService } from './ulb.service';

@ApiTags('Master - ULB')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Controller('master/ulb')
export class UlbController {
  constructor(private readonly ulbService: UlbService) {}

  @Post()
  @Roles([Role.ADMIN, Role.STATE])
  @ApiOperation({
    summary:
      'Create a ULB (ADMIN or STATE). ADMIN submissions are auto-approved; STATE submissions are scoped to ' +
      "the requester's own state and start PENDING until an ADMIN approves them.",
  })
  create(@Body() createUlbDto: CreateUlbDto, @CurrentUser() user: IAuthUser) {
    return this.ulbService.create(createUlbDto, user);
  }

  @Get()
  @ApiOperation({
    summary: 'List ULBs with search, filters, and pagination. STATE users are always scoped to their own state.',
  })
  findAll(@Query() query: QueryUlbDto, @CurrentUser() user: IAuthUser) {
    return this.ulbService.findAll(query, user);
  }

  @Get('types')
  @ApiOperation({ summary: 'List ULB types (id + name) for populating a ULB Type select' })
  findTypes() {
    return this.ulbService.findTypes();
  }

  @Get('register-sections')
  @ApiOperation({ summary: 'Section/grid layout config for the Register ULB page.' })
  findRegisterSections() {
    return this.ulbService.getRegisterSections();
  }

  @Get('edit-sections')
  @Roles([Role.ADMIN])
  @ApiOperation({ summary: 'Section/grid layout config for the Edit ULB dialog (ADMIN only).' })
  findEditSections() {
    return this.ulbService.getEditSections();
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

  @Patch(':id/approve')
  @Roles([Role.ADMIN])
  @ApiOperation({ summary: 'Approve a PENDING ULB submission (ADMIN only).' })
  approve(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: IAuthUser) {
    return this.ulbService.approve(id, user);
  }

  @Patch(':id/reject')
  @Roles([Role.ADMIN])
  @ApiOperation({ summary: 'Reject a PENDING ULB submission (ADMIN only).' })
  reject(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: RejectUlbDto, @CurrentUser() user: IAuthUser) {
    return this.ulbService.reject(id, dto, user);
  }

  @Delete(':id')
  @Roles([Role.ADMIN])
  @ApiOperation({ summary: 'Deactivate a ULB (ADMIN only). Soft-delete via isActive=false.' })
  remove(@Param('id', ParseObjectIdPipe) id: string) {
    return this.ulbService.remove(id);
  }
}
