import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';

import { XviFcService } from './xvi-fc.service';
import { FormJsonService } from '../../form-json/form-json.service';
import { StateWiseResponseDto } from './dto/state-wise-response.dto';
import { SideMenuResponseDto } from './dto/side-menu.dto';
import { ParseObjectIdPipe } from '../../common/pipes/parse-object-id.pipe';
import type { MenuRole } from '../../schemas/xvi-fc/xvi-fc-side-menu.schema';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger/dist/decorators';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { Permission, Scope } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
// XVIFC_DEV_STATUS_API_REMOVE_AFTER_TESTING_START
import { createHash, timingSafeEqual } from 'crypto';
import { InjectConnection } from '@nestjs/mongoose';
import { Connection, Types } from 'mongoose';
import { Public } from '../auth/decorators/public.decorator';
import { FORM_STATUS, FORM_STATUS_LABELS, FormStatusType } from '../../common/constants/form-status.constants';
// XVIFC_DEV_STATUS_API_REMOVE_AFTER_TESTING_END
import { XviFcCacheInterceptor, XviFcCacheTTL } from './cache/xvi-fc-cache.interceptor';

@ApiTags('XVI-FC')
@Controller('xvi-fc')
export class XviFcController {
  constructor(
    private readonly xviFcService: XviFcService,
    // XVIFC_DEV_STATUS_API_REMOVE_AFTER_TESTING_START
    @InjectConnection() private readonly _devConnection: Connection,
    // XVIFC_DEV_STATUS_API_REMOVE_AFTER_TESTING_END
    private readonly formJsonService: FormJsonService,
  ) {}

  @ApiBearerAuth()
  @Get('state/:stateId')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  async getStateWiseData(
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @CurrentUser() user: AuthUser,
  ): Promise<StateWiseResponseDto> {
    return this.xviFcService.getStateWiseData(stateId, user);
  }

  @ApiBearerAuth()
  @Get('sidebar/:role')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  @UseInterceptors(XviFcCacheInterceptor)
  @XviFcCacheTTL(600)
  async getSideMenu(@Param('role') role: MenuRole, @Query('yearId') yearId: string): Promise<SideMenuResponseDto> {
    return this.xviFcService.getSideMenu(role, yearId);
  }

  @ApiBearerAuth()
  @Get('years')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  async getYears(): Promise<{ _id: string; year: string }[]> {
    return this.xviFcService.getYears();
  }

  @ApiBearerAuth()
  @Get('ulb/:ulbId')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  async getUlbById(@Param('ulbId', ParseObjectIdPipe) ulbId: string) {
    return this.xviFcService.getUlbById(ulbId);
  }

  @ApiBearerAuth()
  @Get('state-info/:stateId')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  async getStateById(@Param('stateId', ParseObjectIdPipe) stateId: string) {
    return this.xviFcService.getStateById(stateId);
  }

  @ApiBearerAuth()
  @Get('support-hours')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  getSupportHours(): ReturnType<XviFcService['getSupportHours']> {
    return this.xviFcService.getSupportHours();
  }

  // XVIFC_DEV_STATUS_API_REMOVE_AFTER_TESTING_START

  private static readonly DEV_PASSWORD_SHA256_HASH = '8854537b8130cb5ca06a91b8e6929123603077b1f9aec479e09f344ba030164a';

  @ApiOperation({
    summary: '[DEV ONLY — REMOVE AFTER TESTING] Update XVI-FC form status',
    description:
      'Temporary dev-only endpoint for directly setting currentFormStatus on a target form document. ' +
      'Requires x-xvifc-dev-password header. Blocked in production and after May 1 of the current year.',
  })
  @Patch('dev/forms/:formKey/status')
  @Public()
  async devUpdateFormStatus(
    @Param('formKey') formKey: string,
    @Query('stateId', ParseObjectIdPipe) stateId: string,
    @Query('yearId', ParseObjectIdPipe) yearId: string,
    @Query('status') statusRaw: string | undefined,
    @Query('password') password: string | undefined,
  ): Promise<{ success: true; message: string; data: Record<string, unknown> }> {
    if (process.env.NODE_ENV === 'production') {
      throw new ForbiddenException('XVI-FC dev status API is blocked in production.');
    }
    this.assertDevStatusApiNotExpired();
    this.assertValidDevPassword(password);

    const config = this.resolveDevFormStatusConfig(formKey);
    const status = this.parseDevStatusOrDefault(statusRaw);

    const collection = this._devConnection.collection(config.collectionName);
    const filter = {
      state: new Types.ObjectId(stateId),
      year: new Types.ObjectId(yearId),
      formType: config.formType,
      isActive: true,
      isDeleted: { $ne: true },
    };

    const existing = await collection.findOne<{ currentFormStatus?: number }>(filter, {
      projection: { currentFormStatus: 1 },
    });
    if (!existing) {
      throw new NotFoundException(`No ${formKey} form found for stateId "${stateId}" and yearId "${yearId}".`);
    }

    const previousStatus = existing.currentFormStatus ?? 0;
    await collection.updateOne(filter, { $set: { currentFormStatus: status, updatedAt: new Date() } });

    return {
      success: true,
      message: 'Form status updated for dev testing.',
      data: {
        formKey,
        stateId,
        yearId,
        previousStatus,
        currentStatus: status,
        currentStatusLabel: FORM_STATUS_LABELS[status],
      },
    };
  }

  private assertDevStatusApiNotExpired(): void {
    const now = new Date();
    const cutoff = new Date(now.getFullYear(), 6, 2); // July 2 of current year (month index 6 = July)
    if (now >= cutoff) {
      throw new ForbiddenException('XVI-FC dev status API expired after July 1 and cannot be used.');
    }
  }

  /**
   * Validates the temporary XVI-FC dev API password using a constant-time hash comparison.
   *
   * @param password Plain password received from `x-xvifc-dev-password` request header.
   * @throws ForbiddenException when the password is missing or invalid.
   */
  private assertValidDevPassword(password: string | undefined): void {
    if (!password) {
      throw new ForbiddenException('XVI-FC dev status API password is required.');
    }
    const incomingHash = createHash('sha256').update(password, 'utf8').digest('hex');
    const expected = Buffer.from(XviFcController.DEV_PASSWORD_SHA256_HASH, 'hex');
    const actual = Buffer.from(incomingHash, 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      throw new ForbiddenException('Invalid XVI-FC dev status API password.');
    }
  }

  private parseDevStatusOrDefault(statusRaw: string | undefined): FormStatusType {
    if (statusRaw === undefined || statusRaw === '') return FORM_STATUS.RETURNED_BY_MOHUA;
    const parsed = Number(statusRaw);
    const validStatuses = Object.values(FORM_STATUS) as number[];
    if (!Number.isInteger(parsed) || !validStatuses.includes(parsed)) {
      throw new BadRequestException(`Invalid status value "${statusRaw}". Valid values: ${validStatuses.join(', ')}.`);
    }
    return parsed as FormStatusType;
  }

  private resolveDevFormStatusConfig(formKey: string): { collectionName: string; formType: string } {
    type DevFormKey = 'sfc' | 'electedBody';
    const validKeys: ReadonlyArray<DevFormKey> = ['sfc', 'electedBody'];
    const configs: Readonly<Record<DevFormKey, { collectionName: string; formType: string }>> = {
      sfc: { collectionName: 'xvifc_sfc_forms', formType: 'SFC_STATUS' },
      electedBody: {
        collectionName: 'xvi_fc_elected_urban_local_bodies_forms',
        formType: 'ELECTED_URBAN_LOCAL_BODIES',
      },
    };
    if (!validKeys.includes(formKey as DevFormKey)) {
      throw new BadRequestException(`Unsupported formKey "${formKey}". Valid keys: ${validKeys.join(', ')}.`);
    }
    return configs[formKey as DevFormKey];
  }

  // XVIFC_DEV_STATUS_API_REMOVE_AFTER_TESTING_END

  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Clear XVI-FC cache (Admin only)',
    description:
      'Clears cached data from Redis.\n\n' +
      '**XVI-FC page cache**: Pass `pattern` (URL pattern, e.g. `/xvi-fc/sidebar/*`) or omit to clear all XVI-FC cache.\n\n' +
      '**FormJson config cache**: Pass `scope=formJson&designYearId=<id>&formId=<30|31>` to clear a specific formJson cache entry.',
  })
  @ApiQuery({
    name: 'pattern',
    required: false,
    description: 'URL pattern to clear, e.g. /xvi-fc/sidebar/*. Omit to clear all XVI-FC cache.',
  })
  @ApiQuery({
    name: 'scope',
    required: false,
    enum: ['formJson'],
    description: 'Set to "formJson" to clear a FormJson config cache entry.',
  })
  @ApiQuery({
    name: 'designYearId',
    required: false,
    description: 'MongoDB ObjectId of the design year (required when scope=formJson).',
  })
  @ApiQuery({
    name: 'formId',
    required: false,
    description: 'Form ID (30 = audited, 31 = provisional; required when scope=formJson).',
  })
  @ApiResponse({ status: 200, description: 'Cache cleared successfully' })
  @ApiResponse({ status: 403, description: 'Forbidden — admin scope required' })
  @Delete('admin/cache')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.MANAGE_USERS)
  async clearCache(
    @CurrentUser() user: AuthUser,
    @Query('pattern') pattern?: string,
    @Query('scope') scope?: string,
    @Query('designYearId') designYearId?: string,
    @Query('formId') formId?: string,
  ): Promise<{ message: string }> {
    if (user.scope !== Scope.ADMIN) {
      throw new ForbiddenException('Only admins can clear the cache');
    }

    if (scope === 'formJson') {
      if (!designYearId || !formId) {
        throw new ForbiddenException('designYearId and formId are required when scope=formJson');
      }
      await this.formJsonService.clearCache(designYearId, Number(formId));
      return { message: `FormJson cache cleared for designYearId: ${designYearId}, formId: ${formId}` };
    }

    await this.xviFcService.clearCache(pattern);
    const cleared = pattern ? `pattern: ${pattern}` : 'all XVI-FC cache';
    return { message: `Cache cleared for ${cleared}` };
  }
}
