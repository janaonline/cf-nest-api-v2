import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../../../auth/auth-user.interface';
import { CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { PermissionGuard } from '../../../auth/permission.guard';
import { RequirePermissions } from '../../../auth/require-permissions.decorator';
import { Permission } from '../../../auth/enum/roles-xvi-fc.enum';
import { UnspentBalanceDisclosureService } from './unspent-balance-disclosure.service';
import { SubmitDisclosureDto } from './dto/submit-disclosure.dto';
import { UpdateDisclosureDto } from './dto/update-disclosure.dto';

@ApiTags('XVI-FC')
@ApiBearerAuth()
@Controller('xvi-fc/unspent-balance-disclosure')
export class UnspentBalanceDisclosureController {
  constructor(private readonly service: UnspentBalanceDisclosureService) {}

  /** Submit a disclosure. Returns 409 if already submitted. */
  @Post()
  // @UseGuards(PermissionGuard)
  // @RequirePermissions(Permission.UPLOAD_DOCUMENTS)
  submit(@Body() dto: SubmitDisclosureDto, @CurrentUser() user: AuthUser) {
    return this.service.submit(dto, user);
  }

  /** Fetch the disclosure for a given ULB and design year. */
  @Get()
  // @UseGuards(PermissionGuard)
  // @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  getByYear(@Query('yearId') yearId: string, @Query('ulbId') ulbId: string | undefined, @CurrentUser() user: AuthUser) {
    const resolvedUlbId = user.ulb ?? ulbId;
    if (!resolvedUlbId) throw new BadRequestException('ulbId is required.');
    return this.service.getByUlbAndYear(resolvedUlbId, yearId);
  }

  /** Partially update an existing disclosure. Returns 403 if already submitted. */
  @Patch(':id')
  // @UseGuards(PermissionGuard)
  // @RequirePermissions(Permission.UPLOAD_DOCUMENTS)
  update(@Param('id') id: string, @Body() dto: UpdateDisclosureDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user);
  }

  /** Generate a presigned S3 GET URL for a document attached to this disclosure. */
  @Get(':id/documents/signed-url')
  // @UseGuards(PermissionGuard)
  // @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  getDocumentSignedUrl(@Param('id') id: string, @Query('filepath') filepath: string, @CurrentUser() user: AuthUser) {
    return this.service.getDocumentSignedUrl(id, filepath, user);
  }
}
