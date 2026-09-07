import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { EmailQueueModule } from 'src/core/queue/email-queue/email-queue.module';
import { EmailTemplatesModule } from 'src/admin/email-templates/email-templates.module';
import { EmailTemplate, EmailTemplateSchema } from 'src/schemas/email-template.schema';
import { User, UserSchema } from 'src/schemas/user/user.schema';
import { Ulb, UlbSchema } from 'src/schemas/ulb.schema';
import { State, StateSchema } from 'src/schemas/state.schema';
import { XviFcAnnualAccount, XviFcAnnualAccountSchema } from 'src/schemas/xvi-fc/annual-account.schema';
import { XviFcBankAccount, XviFcBankAccountSchema } from 'src/schemas/xvi-fc/ulb/xvi-fc-bank-account.schema';
import { UlbInProgressReminderService } from './ulb-in-progress-reminder.service';
import { StateReviewDigestService } from './state-review-digest.service';
import { StateReviewPdfService } from './state-review-pdf.service';
import { WeeklyStateSummaryService } from './weekly-state-summary.service';
import { RemindersController } from './reminders.controller';

/**
 * Dwell-time reminder crons — cross-cutting (reads both ulb/annual_accounts and ulb/bank-account
 * data, serves both ULB and STATE recipients), so it lives alongside the other shared xvi-fc
 * building blocks in `common/` rather than under either the `ulb/` or `state/` subfolder.
 */
@Module({
  imports: [
    MongooseModule.forFeature([
      { name: XviFcAnnualAccount.name, schema: XviFcAnnualAccountSchema },
      { name: XviFcBankAccount.name, schema: XviFcBankAccountSchema },
      { name: User.name, schema: UserSchema },
      { name: Ulb.name, schema: UlbSchema },
      { name: State.name, schema: StateSchema },
      { name: EmailTemplate.name, schema: EmailTemplateSchema },
    ]),
    EmailQueueModule,
    EmailTemplatesModule,
  ],
  controllers: [RemindersController],
  providers: [UlbInProgressReminderService, StateReviewDigestService, StateReviewPdfService, WeeklyStateSummaryService],
})
export class RemindersModule implements OnModuleInit {
  private readonly logger = new Logger(RemindersModule.name);

  constructor(
    private readonly ulbReminder: UlbInProgressReminderService,
    private readonly stateDigest: StateReviewDigestService,
    private readonly weeklyStateSummary: WeeklyStateSummaryService,
  ) {}

  // Idempotent (each seedTemplate() is a check-then-create) — safe to run on every boot in every
  // environment, so this removes the need to manually call the three seed-*-template endpoints.
  async onModuleInit(): Promise<void> {
    const results = await Promise.all([
      this.ulbReminder.seedTemplate(),
      this.stateDigest.seedTemplate(),
      this.weeklyStateSummary.seedTemplate(),
    ]);
    const created = results.filter((r) => r.created).length;
    if (created > 0) this.logger.log(`Seeded ${created} reminder email template(s) on startup`);
  }
}
