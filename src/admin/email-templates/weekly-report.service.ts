import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EmailQueueService } from 'src/core/queue/email-queue/email-queue.service';
import { User, UserDocument } from 'src/schemas/user/user.schema';
import { EmailTemplate, EmailTemplateDocument } from 'src/schemas/email-template.schema';
import { interpolate } from 'src/core/utils/interpolate.util';

const WEEKLY_REPORT_SLUG = 'weekly-report';

const DEFAULT_WEEKLY_REPORT_BODY = `
<!DOCTYPE html>
<html>
<body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#333;background:#f9f9f9;">
  <div style="background:#fff;border-radius:8px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <h2 style="color:#222;margin-top:0;">{{stateName}} — Status Update for the week — {{date}}</h2>
    <h1 style="text-align:center;letter-spacing:-1px;margin:24px 0;">
      <span style="color:#222;font-weight:300;">city</span><span style="color:#009688;font-weight:700;">finance</span>
    </h1>
    <p style="margin-top:24px;">Hello {{name}},</p>
    <p>Here is the current status of 16th Finance Commission submissions for <strong>{{stateName}}</strong> for <strong>{{date}}</strong>:</p>
    <ul style="line-height:2;">
      <li>Total ULBs: <strong>{{totalUlbs}}</strong></li>
      <li>Not started: <strong>{{notStarted}}</strong></li>
      <li>Under state review: <strong>{{underStateReview}}</strong></li>
      <li>Submissions overdue (10+ days): <strong>{{submissionsOverdue}}</strong></li>
      <li>Ready to forward — all checks passed: <strong>{{readyToForward}}</strong></li>
      <li>OSR Growth ≥7.5%: <strong>{{osrGrowth}}</strong></li>
      <li>Discrepancies raised by ULBs: <strong>{{discrepancies}}</strong></li>
      <li>Forwarded to MoHUA: <strong>{{forwardedToMohua}}</strong></li>
    </ul>
    <p>You can view the detailed city-wise status on the
      <a href="{{dashboardUrl}}" style="color:#009688;font-weight:600;">dashboard</a>.
    </p>
    <p style="margin-bottom:0;">Regards,<br><strong>Team CityFinance</strong></p>
  </div>
</body>
</html>
`.trim();

@Injectable()
export class WeeklyReportService {
  private readonly logger = new Logger(WeeklyReportService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(EmailTemplate.name) private readonly templateModel: Model<EmailTemplateDocument>,
    private readonly emailQueue: EmailQueueService,
  ) {}

  // ─── Cron: every Monday 10:00 AM IST ──────────────────────────────────────

  @Cron('0 10 * * 1', { timeZone: 'Asia/Kolkata' })
  async handleWeeklyCron(): Promise<void> {
    this.logger.log('Weekly report cron triggered');
    const result = await this.sendWeeklyReport();
    this.logger.log(`Weekly report queued — queued: ${result.queued}, total: ${result.total}`);
  }

  // ─── Manual trigger ────────────────────────────────────────────────────────

  async sendWeeklyReport(): Promise<{ queued: number; total: number }> {
    const template = await this.templateModel
      .findOne({ slug: WEEKLY_REPORT_SLUG, isDeleted: false, isActive: true })
      .exec();

    if (!template) {
      throw new NotFoundException(
        `Weekly report template not found. Seed it first via POST /email-templates/seed-weekly-template.`,
      );
    }

    const users = await this.fetchUniqueUsersWithEmail();
    if (!users.length) {
      this.logger.warn('No users with valid email found');
      return { queued: 0, total: 0 };
    }

    const stats = this.buildStats();

    // TODO: replace buildStats() with real DB aggregation queries before going live
    this.logger.warn('⚠️  Weekly report is sending PLACEHOLDER stats (all zeros). Wire up real DB queries in buildStats().');

    let queued = 0;
    for (const user of users) {
      const variables: Record<string, string> = { ...stats, name: user.name?.trim() || 'User' };
      const subject = interpolate(template.subject, variables);
      const body = interpolate(template.body, variables);
      await this.emailQueue.addEmailJob({ to: user.email, subject, html: body });
      queued++;
    }

    this.logger.log(`Weekly report: ${queued} email(s) queued`);
    return { queued, total: users.length };
  }

  // ─── Seed default template ─────────────────────────────────────────────────

  async seedWeeklyReportTemplate(): Promise<{ created: boolean; message: string }> {
    const existing = await this.templateModel.findOne({ slug: WEEKLY_REPORT_SLUG }).exec();
    if (existing) {
      return { created: false, message: 'Weekly report template already exists' };
    }

    await this.templateModel.create({
      name: 'Weekly Report',
      slug: WEEKLY_REPORT_SLUG,
      subject: '{{stateName}} — Status Update for the week — {{date}}',
      body: DEFAULT_WEEKLY_REPORT_BODY,
      isActive: true,
    });

    this.logger.log('Weekly report template seeded');
    return { created: true, message: 'Weekly report template created successfully' };
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private async fetchUniqueUsersWithEmail(): Promise<{ name: string; email: string }[]> {
    const users = await this.userModel
      .find({ isDeleted: false, email: { $exists: true, $nin: ['', null] } })
      .select('name email')
      .lean()
      .exec();

    const seen = new Set<string>();
    return users.reduce<{ name: string; email: string }[]>((acc, u) => {
      const email = (u.email as string)?.trim().toLowerCase();
      if (!email || seen.has(email)) return acc;
      seen.add(email);
      acc.push({ name: (u.name as string) ?? '', email });
      return acc;
    }, []);
  }

  /** TODO: Replace with real Mongoose aggregation queries before going live. */
  private buildStats(): Record<string, string> {
    const now = new Date();
    const date = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}`;

    return {
      date,
      fy: '2026-27',
      stateName: 'All States',
      totalUlbs: '0',
      notStarted: '0',
      underStateReview: '0',
      submissionsOverdue: '0',
      readyToForward: '0',
      osrGrowth: '0',
      discrepancies: '0',
      forwardedToMohua: '0',
      dashboardUrl: 'https://cityfinance.in/dashboard',
    };
  }
}
