import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { Role } from '../auth/enum/role.enum';
import { RolesGuard } from '../auth/guards/roles.guard';
import type { AuthUser } from '../auth/auth-user.interface';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import { PropertyTaxService } from './property-tax.service';

@ApiTags('Property Tax')
@UseGuards(RolesGuard)
@Roles([Role.ULB])
@ApiBearerAuth()
@Controller('property-tax')
export class PropertyTaxController {
  constructor(private readonly propertyTaxService: PropertyTaxService) {}

  @ApiOperation({
    summary:
      'Total Property Tax Collection per financial year (2018-19 to 2023-24), in raw rupees — data for the "Property Tax* (Cr.)" trend chart. FE converts to crores (÷1,00,00,000)',
  })
  @ApiParam({ name: 'ulbId', description: 'ULB ObjectId' })
  @Get(':ulbId/collection-trend')
  getCollectionTrend(@Param('ulbId', ParseObjectIdPipe) ulbId: string, @CurrentUser() user: AuthUser) {
    return this.propertyTaxService.getCollectionTrend(ulbId, user);
  }
}
