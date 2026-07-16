import { Body, Controller, Get, Headers, Ip, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { FcUnspentDeclarationService } from './services/main/fc-unspent-declaration.service';
import { FcUnspentUlbOptionsService } from './services/ulb-options/fc-unspent-ulb-options.service';
import { SaveFcUnspentDeclarationDto } from './dto/save-fc-unspent-declaration.dto';
import { GetFcUnspentUlbOptionsQueryDto } from './dto/get-fc-unspent-ulb-options-query.dto';

@ApiTags('XVI-FC - State Forms - FC Unspent Declaration')
@ApiBearerAuth()
@Controller('xvi-fc/state/fc-unspent-declaration')
export class FcUnspentDeclarationController {
  constructor(
    private readonly fcUnspentDeclarationService: FcUnspentDeclarationService,
    private readonly fcUnspentUlbOptionsService: FcUnspentUlbOptionsService,
  ) {}

  @ApiOperation({ summary: 'Save FC Unspent Declaration draft' })
  @ApiBody({ type: SaveFcUnspentDeclarationDto })
  @Post('save-draft')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.EDIT_STATE_FORMS)
  saveDraft(@Body() dto: SaveFcUnspentDeclarationDto, @CurrentUser() user: AuthUser) {
    return this.fcUnspentDeclarationService.saveDraft(dto, user);
  }

  @ApiOperation({ summary: 'Final submit FC Unspent Declaration form' })
  @ApiBody({ type: SaveFcUnspentDeclarationDto })
  @Post('final-submit')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.FINAL_SUBMIT_STATE_FORMS)
  finalSubmit(
    @Body() dto: SaveFcUnspentDeclarationDto,
    @CurrentUser() user: AuthUser,
    @Ip() ip: string,
    @Headers('user-agent') userAgent: string,
  ) {
    return this.fcUnspentDeclarationService.finalSubmit(dto, user, ip, userAgent);
  }

  @ApiOperation({ summary: 'Get FC Unspent Declaration form (hydrated)' })
  @Get(':stateId/:yearId')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  getForm(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.fcUnspentDeclarationService.getForm(stateId, yearId, user);
  }

  @ApiOperation({ summary: 'Get lazy, paginated ULB options for the Yes-branch row picker' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @Get(':stateId/:yearId/ulb-options')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATE_FORMS)
  getUlbOptions(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Query() query: GetFcUnspentUlbOptionsQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.fcUnspentUlbOptionsService.getOptions(stateId, yearId, query, user);
  }

  @ApiOperation({
    summary: 'Get a private, signed download URL for the design-year-specific declaration template (No branch)',
  })
  @Get(':stateId/:yearId/declaration-template')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.EDIT_STATE_FORMS)
  getDeclarationTemplate(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.fcUnspentDeclarationService.getDeclarationTemplate(stateId, yearId, user);
  }
}
