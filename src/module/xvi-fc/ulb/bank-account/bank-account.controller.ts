import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { GetXviFcBankAccountQueryDto } from './dto/get-xvi-fc-bank-account-query.dto';
import { SubmitXviFcBankAccountDto } from './dto/submit-xvi-fc-bank-account.dto';
import { BankAccountDecisionDto } from './dto/bank-account-decision.dto';
import { BulkBankAccountDecisionDto } from './dto/bulk-bank-account-decision.dto';
import { BankAccountUlbSubmissionsQueryDto } from './dto/bank-account-ulb-submissions-query.dto';
import { BankAccountService } from './bank-account.service';
import { extractIpAndUserAgent } from 'src/module/xvi-fc/common/utils/xvi-fc-request-meta.util';

@ApiTags('XVI-FC')
@ApiBearerAuth()
@Controller('xvi-fc/bank-account')
export class BankAccountController {
  constructor(private readonly bankAccountService: BankAccountService) {}

  @Get('ifsc/:ifscCode')
  @UseGuards(PermissionGuard)
  lookupIfsc(@Param('ifscCode') ifscCode: string) {
    return this.bankAccountService.lookupIfsc(ifscCode);
  }

  @Get('state/ulb-submissions')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.REVIEW_ULB_SUBMISSIONS)
  listUlbSubmissions(@Query() dto: BankAccountUlbSubmissionsQueryDto, @CurrentUser() user: AuthUser) {
    return this.bankAccountService.listUlbBankAccounts(dto, user);
  }

  @Get()
  @UseGuards(PermissionGuard)
  getBankAccount(@Query() query: GetXviFcBankAccountQueryDto, @CurrentUser() user: AuthUser) {
    return this.bankAccountService.getBankAccount(query, user);
  }

  @Post()
  @UseGuards(PermissionGuard)
  submitBankAccount(@Body() dto: SubmitXviFcBankAccountDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const { ipAddress, userAgent } = extractIpAndUserAgent(req);
    return this.bankAccountService.submitBankAccount(dto, user, ipAddress, userAgent);
  }

  @Post('bulk-decision')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.APPROVE_ULB_SUBMISSIONS)
  bulkDecide(@Body() dto: BulkBankAccountDecisionDto, @CurrentUser() user: AuthUser, @Req() req: Request) {
    const { ipAddress, userAgent } = extractIpAndUserAgent(req);
    return this.bankAccountService.bulkDecideBankAccount(dto, user, ipAddress, userAgent);
  }

  @Get(':id/logs')
  @UseGuards(PermissionGuard)
  getFormLogs(@Param('id', ParseObjectIdPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.bankAccountService.getBankAccountFormLogs(id, user);
  }

  @Post(':id/decision')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.APPROVE_ULB_SUBMISSIONS)
  decide(
    @Param('id', ParseObjectIdPipe) id: string,
    @Body() dto: BankAccountDecisionDto,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const { ipAddress, userAgent } = extractIpAndUserAgent(req);
    return this.bankAccountService.decideBankAccount(id, dto, user, ipAddress, userAgent);
  }

  // @Post(':id/mohua-decision')
  // @UseGuards(PermissionGuard)
  // @RequirePermissions(Permission.APPROVE_STATE_SUBMISSIONS)
  // decideMohua(
  //   @Param('id', ParseObjectIdPipe) id: string,
  //   @Body() dto: BankAccountDecisionDto,
  //   @CurrentUser() user: AuthUser,
  //   @Req() req: Request,
  // ) {
  //   const { ipAddress, userAgent } = extractIpAndUserAgent(req);
  //   return this.bankAccountService.decideMohuaBankAccount(id, dto, user, ipAddress, userAgent);
  // }
}
