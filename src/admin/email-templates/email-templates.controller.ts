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
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Roles } from 'src/module/auth/decorators/roles.decorator';
import { Role } from 'src/module/auth/enum/role.enum';
import { RolesGuard } from 'src/module/auth/guards/roles.guard';
import { ParseObjectIdPipe } from 'src/common/pipes/parse-object-id.pipe';
import { PaginationDto } from 'src/common/dto/pagination.dto';
import { Public } from 'src/module/auth/decorators/public.decorator';
import { EmailTemplatesService } from './email-templates.service';
import { WeeklyReportService } from './weekly-report.service';
import { CreateEmailTemplateDto } from './dto/create-email-template.dto';
import { UpdateEmailTemplateDto } from './dto/update-email-template.dto';
import { SendTemplateEmailDto } from './dto/send-template-email.dto';

@ApiTags('email-templates')
@ApiBearerAuth()
@Roles([Role.ADMIN])
@UseGuards(RolesGuard)
@Controller('email-templates')
export class EmailTemplatesController {
  constructor(
    private readonly service: EmailTemplatesService,
    private readonly weeklyReport: WeeklyReportService,
  ) {}

  // ─── Template CRUD ──────────────────────────────────────────────────────────

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new email template' })
  @ApiResponse({ status: 201, description: 'Template created' })
  @ApiResponse({ status: 409, description: 'Slug already exists' })
  create(@Body() dto: CreateEmailTemplateDto) {
    return this.service.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all email templates (paginated, newest first)' })
  findAll(@Query() pagination: PaginationDto) {
    return this.service.findAll(pagination.page, pagination.limit);
  }

  @Get('slug/:slug')
  @ApiOperation({ summary: 'Get an active template by slug (e.g. pending-review)' })
  findBySlug(@Param('slug') slug: string) {
    return this.service.findBySlug(slug);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a template by ID' })
  @ApiResponse({ status: 404, description: 'Not found' })
  findOne(@Param('id', ParseObjectIdPipe) id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a template' })
  update(@Param('id', ParseObjectIdPipe) id: string, @Body() dto: UpdateEmailTemplateDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete a template' })
  remove(@Param('id', ParseObjectIdPipe) id: string) {
    return this.service.remove(id);
  }

  // ─── Send ───────────────────────────────────────────────────────────────────

  @Post('send')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Queue email via stored template or raw subject/body',
    description: 'Use templateId or templateSlug to pick a stored template; pass variables to replace {{placeholders}}',
  })
  send(@Body() dto: SendTemplateEmailDto) {
    return this.service.send(dto);
  }

  // ─── Weekly report ──────────────────────────────────────────────────────────

  @Public()
  @Post('seed-weekly-template')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Seed the default weekly-report template into DB (safe to call multiple times)' })
  seedWeeklyTemplate() {
    return this.weeklyReport.seedWeeklyReportTemplate();
  }

  @Post('send-weekly-report')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Manually trigger the weekly report email to all users (same logic as Monday 10AM cron)',
  })
  @ApiResponse({ status: 200, description: 'Returns queued/total counts' })
  sendWeeklyReport() {
    return this.weeklyReport.sendWeeklyReport();
  }
}
