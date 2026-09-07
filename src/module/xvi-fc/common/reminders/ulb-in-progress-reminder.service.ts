import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { EmailTemplatesService } from 'src/admin/email-templates/email-templates.service';
import { EmailTemplate, EmailTemplateDocument } from 'src/schemas/email-template.schema';
import { EmailQueueService } from 'src/core/queue/email-queue/email-queue.service';
import { interpolate } from 'src/core/utils/interpolate.util';
import { Role } from 'src/module/auth/enum/role.enum';
import { User, UserDocument } from 'src/schemas/user/user.schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { PORTAL_INVITE_LOGIN_TYPE, buildPortalAuthUrls } from 'src/core/utils/portal-urls.util';
import { remindersCronsEnabled } from 'src/common/utils/reminder-cron-gate.util';
import {
  AnnualAccountFormStatus,
  FORM_STATUS_ID,
  XviFcAnnualAccount,
  XviFcAnnualAccountDocument,
} from 'src/schemas/xvi-fc/annual-account.schema';

const INTERVAL_DAYS = 3;
const TEMPLATE_SLUG = 'ulb-in-progress-reminder';
const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_SUBJECT = 'Assistance Required to Complete Your XVI-FC Submission';

const DEFAULT_BODY = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Assistance Required to Complete Your XVI-FC Submission</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f4f6f9; font-family: Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header { background-color: #0f4c81; padding: 28px 32px; text-align: center; }
    .header-title { color: #ffffff; font-size: 18px; font-weight: bold; margin-top: 12px; }
    .body { padding: 32px; color: #333333; font-size: 15px; line-height: 1.6; }
    .body h2 { font-size: 20px; color: #0f4c81; margin-bottom: 8px; }
    .info-box { background: #f0f5ff; border-left: 4px solid #0f4c81; border-radius: 4px; padding: 14px 18px; margin: 20px 0; font-size: 14px; }
    .info-box p { margin: 4px 0; }
    .info-box strong { color: #0f4c81; }
    .cta { text-align: center; margin: 28px 0; }
    .cta a { background-color: #0f4c81; color: #ffffff; text-decoration: none; padding: 13px 32px; border-radius: 6px; font-size: 15px; font-weight: bold; display: inline-block; }
    .note { font-size: 13px; color: #777777; margin-top: 24px; background: #fff8e1; border-radius: 4px; padding: 12px 16px; }
    .footer { background: #f4f6f9; text-align: center; padding: 18px 32px; font-size: 12px; color: #999999; }
    .divider { border: none; border-top: 1px solid #eeeeee; margin: 24px 0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="header-title">XVI Finance Commission — CityFinance Portal</div>
    </div>

    <div class="body">
      <h2>Your XVI-FC Submission Needs Attention</h2>
      <p>Dear Sir / Madam,</p>
      <p>
        This is a reminder that the XVI-FC submission for <strong>{{ulbName}}</strong> was initiated
        <strong>{{daysPending}} days</strong> ago and is still pending completion.
      </p>

      <div class="info-box">
        <p><strong>ULB:</strong> {{ulbName}}</p>
        <p><strong>Status:</strong> In Progress</p>
        <p><strong>Days Pending:</strong> {{daysPending}}</p>
      </div>

      <p>If you require any assistance in completing the submission, you may:</p>
      <ul style="padding-left:20px;margin:8px 0;">
        <li>Join the CityFinance Support Hour for live guidance and support.</li>
        <li>Reply to this email with your query, and our team will assist you.</li>
      </ul>
      <p>
        We request you to complete the pending submission at the earliest to enable your State to review it
        and proceed with the fund release process.
      </p>

      <div class="cta">
        <a href="{{loginLink}}" target="_blank">Continue Submission</a>
      </div>

      <hr class="divider" />

      <div class="note">
        <strong>Note:</strong> If you have already completed and submitted this form, please disregard this
        email — reminders are sent automatically based on the form's status at the time this email was queued.
      </div>
    </div>

    <div class="footer">
      &copy; CityFinance &mdash; Ministry of Housing and Urban Affairs, Government of India
    </div>
  </div>
</body>
</html>
`.trim();

/**
 * Nudges a ULB's Nodal Officer every `INTERVAL_DAYS` while their Annual Account section stays
 * IN_PROGRESS — "please submit to state with all the records ASAP". v1 scope is Annual Account
 * only (Bank Account's IN_PROGRESS-equivalent dwell time hasn't been verified to have the same
 * clean anchor as `inProgressSince`).
 */
@Injectable()
export class UlbInProgressReminderService {
  private readonly logger = new Logger(UlbInProgressReminderService.name);

  constructor(
    @InjectModel(XviFcAnnualAccount.name) private readonly annualAccountModel: Model<XviFcAnnualAccountDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Ulb.name) private readonly ulbModel: Model<UlbDocument>,
    @InjectModel(EmailTemplate.name) private readonly templateModel: Model<EmailTemplateDocument>,
    private readonly emailTemplates: EmailTemplatesService,
    private readonly emailQueue: EmailQueueService,
    private readonly config: ConfigService,
  ) {}

  // ─── Seed default template (idempotent — mirrors WeeklyReportService.seedWeeklyReportTemplate) ──

  async seedTemplate(): Promise<{ created: boolean; message: string }> {
    const existing = await this.templateModel.findOne({ slug: TEMPLATE_SLUG }).exec();
    if (existing) return { created: false, message: 'ULB in-progress reminder template already exists' };

    await this.templateModel.create({
      name: 'ULB In-Progress Reminder',
      slug: TEMPLATE_SLUG,
      subject: DEFAULT_SUBJECT,
      body: DEFAULT_BODY,
      isActive: true,
    });
    this.logger.log('ULB in-progress reminder template seeded');
    return { created: true, message: 'ULB in-progress reminder template created successfully' };
  }

  // Master on/off switch for every XVI-FC reminder/summary cron (this one + StateReviewDigest +
  // WeeklyStateSummary + WeeklyReport) — set XVIFC_REMINDER_CRONS_ENABLED=true in env to let the
  // scheduled run actually fire. The manual trigger (POST xvi-fc/reminders/send-ulb-in-progress-now
  // → sendDueReminders() directly) deliberately bypasses this flag, same as WeeklyReportService's
  // existing handleWeeklyCron()/sendWeeklyReport() split.
  @Cron('0 9 * * *', { timeZone: 'Asia/Kolkata' })
  async handleScheduledRun(): Promise<void> {
    if (!remindersCronsEnabled(this.config, this.logger)) return;
    await this.sendDueReminders();
  }

  async sendDueReminders(): Promise<void> {
    const due = await this.findDueForms();
    if (!due.length) return;
    this.logger.log(`Found ${due.length} IN_PROGRESS form(s) due for a reminder`);

    let template: EmailTemplateDocument;
    try {
      template = await this.emailTemplates.findBySlug(TEMPLATE_SLUG);
    } catch {
      this.logger.warn(`Template "${TEMPLATE_SLUG}" not found or inactive — skipping this run`);
      return;
    }

    for (const doc of due) {
      await this.sendReminderForForm(doc, template);
    }
  }

  // now >= (lastReminderSentAt ?? inProgressSince) + INTERVAL_DAYS
  private findDueForms(): Promise<XviFcAnnualAccountDocument[]> {
    return this.annualAccountModel
      .find({
        form_status_id: FORM_STATUS_ID[AnnualAccountFormStatus.IN_PROGRESS],
        inProgressSince: { $ne: null },
        $expr: {
          $gte: [
            new Date(),
            { $add: [{ $ifNull: ['$lastReminderSentAt', '$inProgressSince'] }, INTERVAL_DAYS * DAY_MS] },
          ],
        },
      })
      .exec();
  }

  private async sendReminderForForm(doc: XviFcAnnualAccountDocument, template: EmailTemplateDocument): Promise<void> {
    const nodalOfficer = await this.userModel
      .findOne({
        ulb: doc.ulb,
        role: { $in: [Role.ULB, Role.ULB_EDITOR, Role.ULB_VIEWER] },
        isNodalOfficer: true,
        isActive: true,
        isDeleted: false,
        isXVIFCProfileVerified: true,
        email: { $exists: true, $nin: ['', null] },
      })
      .select('email')
      .lean()
      .exec();

    if (!nodalOfficer) {
      this.logger.warn(`No active Nodal Officer found for ULB ${doc.ulb.toString()} — skipping reminder`);
      return;
    }

    const ulb = await this.ulbModel.findById(doc.ulb).select('name').lean().exec();
    const { loginUrl } = buildPortalAuthUrls(this.config, PORTAL_INVITE_LOGIN_TYPE);

    const variables: Record<string, string> = {
      ulbName: ulb?.name ?? 'your ULB',
      daysPending: String(this.daysSince(doc.inProgressSince!)),
      loginLink: loginUrl,
    };
    const subject = interpolate(template.subject, variables);
    const html = interpolate(template.body, variables);
    await this.emailQueue.addEmailJob({ to: nodalOfficer.email as string, subject, html });

    await this.annualAccountModel.updateOne({ _id: doc._id }, { $set: { lastReminderSentAt: new Date() } });
    this.logger.log(`Reminder sent for annualAccountId=${doc._id.toString()} → ${nodalOfficer.email as string}`);
  }

  private daysSince(date: Date): number {
    return Math.floor((Date.now() - date.getTime()) / DAY_MS);
  }
}
