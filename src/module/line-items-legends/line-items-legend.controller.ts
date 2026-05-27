import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelope } from 'src/common/decorators/api-envelope.decorator';
import { Roles } from 'src/module/auth/decorators/roles.decorator';
import * as roleEnum from 'src/module/auth/enum/role.enum';
import { RolesGuard } from 'src/module/auth/guards/roles.guard';
import { CreateLineItemsLegendDto } from './dto/create-line-items-legend.dto';
import { ImportLineItemsTemplateDto } from './dto/import-line-items-template.dto';
import { ListLineItemsLegendQueryDto } from './dto/list-line-items-legend-query.dto';
import { UpdateLineItemsLegendDto } from './dto/update-line-items-legend.dto';
import { LineItemsLegendService } from './line-items-legend.service';

@ApiEnvelope()
@ApiTags('line-items-legends')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles([roleEnum.Role.ADMIN])
@Controller('line-items-legends')
export class LineItemsLegendController {
  constructor(private readonly legendService: LineItemsLegendService) {}

  @Get()
  @ApiOperation({ summary: 'List line item legends', description: 'Returns paginated line item legends.' })
  listLegends(@Query() query: ListLineItemsLegendQueryDto) {
    return this.legendService.listLegends(query);
  }

  @Get(':nmamCode')
  @ApiOperation({ summary: 'Get a line item legend', description: 'Returns a single legend by nmamCode.' })
  getLegend(@Param('nmamCode') nmamCode: string, @Query('templateVersion') templateVersion?: string) {
    return this.legendService.getLegend(nmamCode, templateVersion);
  }

  @Post('import')
  @ApiOperation({
    summary: 'Import line items template',
    description: 'Accepts a JSON body of line items and bulk-upserts them into lineitemslegends.',
  })
  importTemplate(@Body() dto: ImportLineItemsTemplateDto) {
    return this.legendService.importFromJson(dto);
  }

  @Post()
  @ApiOperation({ summary: 'Create a line item legend', description: 'Creates a new legend entry.' })
  createLegend(@Body() dto: CreateLineItemsLegendDto) {
    return this.legendService.createLegend(dto);
  }

  @Patch(':nmamCode')
  @ApiOperation({ summary: 'Update a line item legend', description: 'Updates safe fields of an existing legend.' })
  updateLegend(
    @Param('nmamCode') nmamCode: string,
    @Query('templateVersion') templateVersion: string,
    @Body() dto: UpdateLineItemsLegendDto,
  ) {
    return this.legendService.updateLegend(nmamCode, templateVersion, dto);
  }

  @Delete(':nmamCode/subtree')
  @ApiOperation({
    summary: 'Delete line item legend subtree',
    description: 'Hard deletes one line item legend and all descendants. Descendants are matched via codePath.',
  })
  deleteLegendSubtree(@Param('nmamCode') nmamCode: string, @Query('templateVersion') templateVersion?: string) {
    return this.legendService.deleteLegendSubtree(nmamCode, templateVersion);
  }

  @Delete(':nmamCode')
  @ApiOperation({
    summary: 'Delete a line item legend',
    description: 'Hard deletes one line item legend and returns the deleted data.',
  })
  deleteLegend(@Param('nmamCode') nmamCode: string, @Query('templateVersion') templateVersion?: string) {
    return this.legendService.deleteLegend(nmamCode, templateVersion);
  }
}
