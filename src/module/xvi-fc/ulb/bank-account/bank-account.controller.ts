import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { GetXviFcBankAccountQueryDto } from './dto/get-xvi-fc-bank-account-query.dto';
import { GetBankAccountProofSignedUrlDto } from './dto/get-bank-account-proof-signed-url.dto';
import { SubmitXviFcBankAccountDto } from './dto/submit-xvi-fc-bank-account.dto';
import { BankAccountService } from './bank-account.service';

@ApiTags('XVI-FC')
@ApiBearerAuth()
@Controller('xvi-fc/bank-account')
export class BankAccountController {
  constructor(private readonly bankAccountService: BankAccountService) {}

  @Get('ifsc/:ifscCode')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  lookupIfsc(@Param('ifscCode') ifscCode: string) {
    return this.bankAccountService.lookupIfsc(ifscCode);
  }

  @Get()
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.VIEW_STATUS_REPORTS)
  getBankAccount(@Query() query: GetXviFcBankAccountQueryDto, @CurrentUser() user: AuthUser) {
    return this.bankAccountService.getBankAccount(query, user);
  }

  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.UPLOAD_DOCUMENTS)
  submitBankAccount(@Body() dto: SubmitXviFcBankAccountDto, @CurrentUser() user: AuthUser) {
    return this.bankAccountService.submitBankAccount(dto, user);
  }

  @Post('proof/signed-url')
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.UPLOAD_DOCUMENTS)
  getProofSignedUrl(@Body() dto: GetBankAccountProofSignedUrlDto, @CurrentUser() user: AuthUser) {
    return this.bankAccountService.getProofSignedUrl(dto, user);
  }
}
