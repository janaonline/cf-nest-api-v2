import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { BudgetDocumentService } from './budget-document.service';
import { UploadBudgetDocumentDto } from './dto/upload-budget-document.dto';

@ApiTags('XVI-FC')
@ApiBearerAuth()
@Controller('xvi-fc/budget-document')
export class BudgetDocumentController {
  constructor(private readonly service: BudgetDocumentService) {}

  @Get()
  @UseGuards(PermissionGuard)
  getBudgetDocument(@Query('yearId') yearId: string, @CurrentUser() user: AuthUser) {
    return this.service.getByUlbAndYear(user, yearId);
  }

  @Post()
  @UseGuards(PermissionGuard)
  uploadBudgetDocument(@Body() dto: UploadBudgetDocumentDto, @CurrentUser() user: AuthUser) {
    return this.service.upload(dto, user);
  }
}
