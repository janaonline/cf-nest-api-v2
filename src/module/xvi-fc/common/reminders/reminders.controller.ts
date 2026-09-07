import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from 'src/module/auth/decorators/roles.decorator';
import { Role } from 'src/module/auth/enum/role.enum';
import { RolesGuard } from 'src/module/auth/guards/roles.guard';
import { Public } from 'src/module/auth/decorators/public.decorator';
import { UlbInProgressReminderService } from './ulb-in-progress-reminder.service';
import { StateReviewDigestService } from './state-review-digest.service';
import { WeeklyStateSummaryService } from './weekly-state-summary.service';

@ApiTags('xvi-fc-reminders')
@ApiBearerAuth()
@Roles([Role.ADMIN])
@UseGuards(RolesGuard)
@Controller('xvi-fc/reminders')
export class RemindersController {
  constructor(
    private readonly ulbReminder: UlbInProgressReminderService,
    private readonly stateDigest: StateReviewDigestService,
    private readonly weeklyStateSummary: WeeklyStateSummaryService,
  ) {}

  @Public()
  @Post('seed-ulb-in-progress-template')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Seed the default ULB in-progress reminder template into DB (safe to call multiple times)' })
  seedUlbInProgressTemplate() {
    return this.ulbReminder.seedTemplate();
  }

  @Public()
  @Post('seed-state-review-template')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Seed the default state review reminder template into DB (safe to call multiple times)' })
  seedStateReviewTemplate() {
    return this.stateDigest.seedTemplate();
  }

  @Post('send-ulb-in-progress-now')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually trigger the ULB in-progress reminder cron immediately (same logic as the daily 9AM IST run)' })
  sendUlbInProgressNow() {
    return this.ulbReminder.sendDueReminders();
  }

  @Post('send-state-review-now')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually trigger the state review digest cron immediately (same logic as the daily 9AM IST run)' })
  sendStateReviewNow() {
    return this.stateDigest.sendDueDigests();
  }

  @Public()
  @Post('seed-weekly-state-summary-template')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Seed the default weekly state summary template into DB (safe to call multiple times)' })
  seedWeeklyStateSummaryTemplate() {
    return this.weeklyStateSummary.seedTemplate();
  }

  @Post('send-weekly-state-summary-now')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Manually trigger the weekly state summary cron immediately (same logic as the Monday 11AM IST run)' })
  sendWeeklyStateSummaryNow() {
    return this.weeklyStateSummary.sendWeeklySummaries();
  }
}
