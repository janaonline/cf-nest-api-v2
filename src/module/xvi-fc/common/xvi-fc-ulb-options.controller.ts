import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { assertStateAccess } from './utils/xvi-fc-state-access.util';
import { xviFcSuccess } from './response/xvi-fc-response.util';
import { GetUlbOptionsQueryDto } from './dto/get-ulb-options-query.dto';
import { XviFcUlbOptionsService } from './services/xvi-fc-ulb-options.service';

@ApiTags('XVI-FC - Common - ULB Options')
@ApiBearerAuth()
@Controller('xvi-fc/ulb-options')
export class XviFcUlbOptionsController {
  constructor(private readonly ulbOptionsService: XviFcUlbOptionsService) {}

  @ApiOperation({
    summary: 'Searchable, eligibility-filtered ULB list for a state/year',
    description:
      'Generic ULB picker source for any 16th-FC feature with no feature-specific per-ULB business ' +
      'logic to attach - excludes ULB types ineligible for XVIFC (e.g. Cantonment Boards) and ULBs ' +
      'not yet expected to participate this design year.',
  })
  // stateId/yearId are query params, not route params: the generic AutocompleteComponent consumers
  // of this endpoint call one fixed URL plus query params (see GetUlbOptionsQueryDto's own comment).
  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  async getOptions(@Query() query: GetUlbOptionsQueryDto, @CurrentUser() user: AuthUser) {
    assertStateAccess(user, query.stateId);
    const options = await this.ulbOptionsService.getOptions(query.stateId, query.yearId, query.search, query.limit);
    return xviFcSuccess('ULB options fetched.', options);
  }
}
