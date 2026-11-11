import { Body, Controller, Headers, Ip, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { PermissionGuard } from 'src/module/auth/permission.guard';
import { RequirePermissions } from 'src/module/auth/require-permissions.decorator';
import { PmuUndoDto } from './pmu-undo.dto';
import { PmuUndoService } from './pmu-undo.service';

@ApiTags('XVI-FC - PMU Review - Undo')
@ApiBearerAuth()
@Controller('xvi-fc/pmu/undo')
export class PmuUndoController {
  constructor(private readonly undoService: PmuUndoService) {}

  @ApiOperation({
    summary: "Undo PMU's own approve/return of a State form (back to Under Review by PMU)",
    description:
      'One endpoint for all five PMU-reviewed forms; `type` picks the form. Allowed only while the form is in ' +
      'Under Review by MoHUA (5) or Returned by PMU (14) and no claim letter has been started for the state/year.',
  })
  @ApiBody({ type: PmuUndoDto })
  @Post()
  @UseGuards(PermissionGuard)
  @RequirePermissions(Permission.APPROVE_STATE_SUBMISSIONS_PMU)
  undo(@Body() dto: PmuUndoDto, @CurrentUser() user: AuthUser, @Ip() ip: string, @Headers('user-agent') userAgent: string) {
    return this.undoService.undo(dto, user, ip, userAgent);
  }
}
