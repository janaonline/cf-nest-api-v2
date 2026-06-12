import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger/dist/decorators';
import { AnnualAccountsService } from './annual_accounts.service';
import { SaveAnnualAccountDto } from './dto/create-annual_account.dto';
import { ParseObjectIdPipe } from '../../../../common/pipes/parse-object-id.pipe';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';

@Controller('xvi-fc/annual-account')
export class AnnualAccountsController {
  constructor(private readonly annualAccountsService: AnnualAccountsService) {}

  @ApiBearerAuth()
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.UPLOAD_DOCUMENTS)
  saveAnnualAccount(
    @Body() dto: SaveAnnualAccountDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.annualAccountsService.upsert(dto, user);
  }

  @ApiBearerAuth()
  @Get(':ulbId/:yearId')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.UPLOAD_DOCUMENTS)
  getAnnualAccount(
    @Param('ulbId', ParseObjectIdPipe) ulbId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
  ) {
    return this.annualAccountsService.findOne(ulbId, yearId);
  }
}
