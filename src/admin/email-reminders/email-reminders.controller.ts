import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from 'src/module/auth/decorators/roles.decorator';
import { Role } from 'src/module/auth/enum/role.enum';
import { RolesGuard } from 'src/module/auth/guards/roles.guard';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { RecipientCategory } from 'src/schemas/email-reminder.schema';
import { EmailRemindersService } from './email-reminders.service';
import { CreateEmailReminderDto } from './dto/create-email-reminder.dto';
import { UpdateEmailReminderDto } from './dto/update-email-reminder.dto';

@ApiTags('email-reminders')
@ApiBearerAuth()
@Roles([Role.ADMIN])
@UseGuards(RolesGuard)
@Controller('email-reminders')
export class EmailRemindersController {
  constructor(private readonly service: EmailRemindersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create a scheduled reminder email',
    description:
      'Set deadlineDate and reminderDaysBefore. The reminder fires automatically at 9AM IST on (deadlineDate − reminderDaysBefore).',
  })
  @ApiResponse({ status: 201, description: 'Reminder created' })
  @ApiResponse({ status: 400, description: 'Reminder date is in the past' })
  create(@Body() dto: CreateEmailReminderDto) {
    return this.service.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List reminders (sorted by reminderDate ascending, paginated)' })
  findAll(@Query() pagination: PaginationDto) {
    return this.service.findAll(pagination.page, pagination.limit);
  }

  @Get('preview-recipients')
  @ApiOperation({ summary: 'Preview recipient emails for a category — no emails sent' })
  @ApiQuery({ name: 'category', type: String, enum: RecipientCategory })
  previewRecipients(@Query('category') category: RecipientCategory) {
    return this.service.previewRecipients(category);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single reminder by ID' })
  @ApiResponse({ status: 404, description: 'Not found' })
  findOne(@Param('id', ParseObjectIdPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a reminder',
    description:
      'If deadlineDate or reminderDaysBefore changes, reminderDate is recalculated and status resets to PENDING.',
  })
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateEmailReminderDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel and soft-delete a reminder' })
  cancel(@Param('id', ParseObjectIdPipe) id: string) {
    return this.service.cancel(id);
  }

  @Post(':id/trigger')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Manually trigger a reminder now — queues emails regardless of scheduled date',
  })
  @ApiResponse({ status: 200, description: 'Returns queued count' })
  triggerNow(@Param('id', ParseObjectIdPipe) id: string) {
    return this.service.triggerNow(id);
  }
}
