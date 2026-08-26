import { Body, Controller, Delete, Get, Param, ParseArrayPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SideMenuService } from './side-menu.service';
import { CreateSideMenuDto } from './dto/create-side-menu.dto';
import { UpdateSideMenuDto } from './dto/update-side-menu.dto';
import { QuerySideMenuDto } from './dto/query-side-menu.dto';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';

@ApiTags('XVI-FC Side Menu (Admin)')
@ApiBearerAuth()
@UseGuards(PermissionGuard)
@RequirePermissions(Permission.MANAGE_USERS)
@Controller('xvi-fc/side-menu')
export class SideMenuController {
  constructor(private readonly sideMenuService: SideMenuService) {}

  @Get()
  @ApiOperation({
    summary: 'List all side menu items',
    description:
      'Filter by role, yearId, includeInactive. Returns flat list — groups and children all at the same level.',
  })
  @ApiResponse({ status: 200, description: 'List of side menu documents' })
  findAll(@Query() query: QuerySideMenuDto) {
    return this.sideMenuService.findAll(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one side menu item by id' })
  findOne(@Param('id', ParseObjectIdPipe) id: string) {
    return this.sideMenuService.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a new side menu item' })
  @ApiResponse({ status: 201, description: 'Item created' })
  create(@Body() dto: CreateSideMenuDto) {
    return this.sideMenuService.create(dto);
  }

  @Post('bulk')
  @ApiOperation({
    summary: 'Bulk create side menu items',
    description:
      'Pass an array of one or more items. Each item is validated individually. Cache is invalidated per unique role+year pair.',
  })
  @ApiResponse({ status: 201, description: 'Items created' })
  bulkCreate(@Body(new ParseArrayPipe({ items: CreateSideMenuDto })) items: CreateSideMenuDto[]) {
    return this.sideMenuService.bulkCreate(items);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a side menu item' })
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateSideMenuDto) {
    return this.sideMenuService.update(id, dto);
  }

  @Patch(':id/toggle')
  @ApiOperation({
    summary: 'Toggle isActive on a side menu item',
    description: 'Flips isActive true→false or false→true and clears the cache for that role+year.',
  })
  toggleActive(@Param('id', ParseObjectIdPipe) id: string) {
    return this.sideMenuService.toggleActive(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a side menu item' })
  remove(@Param('id', ParseObjectIdPipe) id: string) {
    return this.sideMenuService.remove(id);
  }
}
