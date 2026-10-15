import { Controller, Get, Param, ParseEnumPipe, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { AnyPermissionGuard } from 'src/module/auth/any-permission.guard';
import { RequireAnyPermission } from 'src/module/auth/require-permissions.decorator';
import { Permission } from 'src/module/auth/enum/roles-xvi-fc.enum';
import { CurrentUser } from 'src/module/auth/decorators/current-user.decorator';
import type { AuthUser } from 'src/module/auth/auth-user.interface';
import { GetStateFormHistoryQueryDto } from './dto/get-state-form-history-query.dto';
import { StateFormHistoryForm } from './state-form-history.constants';
import { StateFormHistoryService } from './state-form-history.service';

/** Shared by every reviewer role's table — add a role's review permission here when its table adopts the history popover. */
@ApiTags('XVI-FC - State Form History')
@ApiBearerAuth()
@Controller('xvi-fc/form-history')
export class StateFormHistoryController {
  constructor(private readonly historyService: StateFormHistoryService) {}

  @ApiOperation({ summary: 'Status history (newest first) of a state-level form' })
  // `form` is typed `string` (validated by ParseEnumPipe) — a TS enum as the param type makes @nestjs/swagger
  // treat the enum object as a class and throw "circular dependency detected" at startup.
  @ApiParam({ name: 'form', enum: StateFormHistoryForm })
  @ApiQuery({ name: 'installment', required: false })
  @ApiQuery({ name: 'limit', required: false, description: 'Page size, default 20, max 50.' })
  @ApiQuery({ name: 'cursor', required: false, description: '`nextCursor` from the previous page.' })
  @Get(':form/:stateId/:yearId')
  @UseGuards(AnyPermissionGuard)
  @RequireAnyPermission(Permission.REVIEW_STATE_SUBMISSIONS_PMU, Permission.REVIEW_STATE_SUBMISSIONS)
  getHistory(
    @Param('form', new ParseEnumPipe(StateFormHistoryForm)) form: string,
    @Param('stateId', ParseObjectIdPipe) stateId: string,
    @Param('yearId', ParseObjectIdPipe) yearId: string,
    @Query() query: GetStateFormHistoryQueryDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.historyService.getHistory(form as StateFormHistoryForm, stateId, yearId, query.installment, user, {
      limit: query.limit,
      cursor: query.cursor,
    });
  }
}
