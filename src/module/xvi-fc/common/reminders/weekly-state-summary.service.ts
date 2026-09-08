import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { EmailTemplatesService } from 'src/admin/email-templates/email-templates.service';
import { EmailTemplate, EmailTemplateDocument } from 'src/schemas/email-template.schema';
import { EmailQueueService } from 'src/core/queue/email-queue/email-queue.service';
import { interpolate } from 'src/core/utils/interpolate.util';
import { Role } from 'src/module/auth/enum/role.enum';
import { User, UserDocument } from 'src/schemas/user/user.schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { State, StateDocument } from 'src/schemas/state.schema';
import { PORTAL_INVITE_LOGIN_TYPE, buildPortalAuthUrls } from 'src/core/utils/portal-urls.util';
import { AnnualAccountFormStatus, FORM_STATUS_ID, XviFcAnnualAccount, XviFcAnnualAccountDocument } from 'src/schemas/xvi-fc/annual-account.schema';
import { remindersCronsEnabled } from 'src/common/utils/reminder-cron-gate.util';

const TEMPLATE_SLUG = 'weekly-state-summary';
const DAY_MS = 24 * 60 * 60 * 1000;
const REVIEW_DELAYED_THRESHOLD_DAYS = 10;

const DEFAULT_SUBJECT = '{{stateName}} — Status Update for the week — {{date}}';

const DEFAULT_BODY = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Weekly Status Summary</title>
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
      <h2>Weekly Status Summary</h2>
      <p>Dear Sir/Madam,</p>

      <div class="info-box">
        <p><strong>State:</strong> {{stateName}}</p>
        <p><strong>Reporting Date:</strong> {{date}}</p>
        <p><strong>Total ULBs:</strong> {{totalUlbs}}</p>
        <p><strong>Not started:</strong> {{notStarted}} ({{notStartedPercent}}%)</p>
        <p><strong>Under state review:</strong> {{underStateReview}} ({{underStateReviewPercent}}%)</p>
        <p><strong>Review delayed (10+ days without action):</strong> {{reviewDelayed}} ({{reviewDelayedPercent}}%)</p>
        <p><strong>Ready for claim — all checks passed:</strong> {{readyForClaim}} ({{readyForClaimPercent}}%)</p>
        <p><strong>Forwarded to MoHUA (via Claim Letter):</strong> {{forwardedToMohua}} ({{forwardedToMohuaPercent}}%)</p>
      </div>

      <div class="cta">
        <a href="{{loginLink}}" target="_blank">View CityFinance Dashboard</a>
      </div>
      <p style="font-size:13px;color:#777777;text-align:center;margin-top:-16px;">
        Please log in to view the city-wise status and take the necessary action.
      </p>

      <hr class="divider" />

      <p style="margin-bottom:0;">Regards,<br><strong>Team CityFinance</strong></p>
    </div>

    <div class="footer">
      &copy; CityFinance &mdash; Ministry of Housing and Urban Affairs, Government of India<br />
      This is an automated message. Please do not reply to this email.
    </div>
  </div>
</body>
</html>
`.trim();

interface StatusCounts {
  total: number;
  notStarted: number;
  underStateReview: number;
  readyForClaim: number;
  forwardedToMohua: number;
}

/**
 * Every Monday 11AM IST, emails each state's own STATE/STATE-EDITOR/STATE-VIEWER users a summary
 * of that state's Annual Account (Audited) status. "Forwarded to MoHUA" is a direct count of
 * UNDER_REVIEW_BY_MOHUA (form_status_id 5) — a form actually sitting with MoHUA — not a
 * claim-letter-batch join, which would count ULBs merely eligible/ready rather than actually
 * forwarded.
 */
@Injectable()
export class WeeklyStateSummaryService {
  private readonly logger = new Logger(WeeklyStateSummaryService.name);

  constructor(
    @InjectModel(XviFcAnnualAccount.name) private readonly annualAccountModel: Model<XviFcAnnualAccountDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Ulb.name) private readonly ulbModel: Model<UlbDocument>,
    @InjectModel(State.name) private readonly stateModel: Model<StateDocument>,
    @InjectModel(EmailTemplate.name) private readonly templateModel: Model<EmailTemplateDocument>,
    private readonly emailTemplates: EmailTemplatesService,
    private readonly emailQueue: EmailQueueService,
    private readonly config: ConfigService,
  ) {}

  // ─── Seed default template (idempotent — mirrors the other reminder services' seedTemplate) ──

  async seedTemplate(): Promise<{ created: boolean; message: string }> {
    const existing = await this.templateModel.findOne({ slug: TEMPLATE_SLUG }).exec();
    if (existing) return { created: false, message: 'Weekly state summary template already exists' };

    await this.templateModel.create({
      name: 'Weekly State Summary',
      slug: TEMPLATE_SLUG,
      subject: DEFAULT_SUBJECT,
      body: DEFAULT_BODY,
      isActive: true,
    });
    this.logger.log('Weekly state summary template seeded');
    return { created: true, message: 'Weekly state summary template created successfully' };
  }

  // Master on/off switch — see UlbInProgressReminderService.handleScheduledRun for the full
  // rationale (one flag shared across the 3 reminder/summary crons). Manual trigger
  // (POST xvi-fc/reminders/send-weekly-state-summary-now → sendWeeklySummaries() directly)
  // bypasses this flag.
  @Cron('0 11 * * 1', { timeZone: 'Asia/Kolkata' })
  async handleScheduledRun(): Promise<void> {
    if (!remindersCronsEnabled(this.config, this.logger)) return;
    await this.sendWeeklySummaries();
  }

  async sendWeeklySummaries(): Promise<void> {
    let template: EmailTemplateDocument;
    try {
      template = await this.emailTemplates.findBySlug(TEMPLATE_SLUG);
    } catch {
      this.logger.warn(`Template "${TEMPLATE_SLUG}" not found or inactive — skipping this run`);
      return;
    }

    const states = await this.stateModel.find({}).select('name').lean().exec();
    const sentCounts = await Promise.all(
      states.map((state) => this.sendSummaryForState(state._id as Types.ObjectId, state.name, template)),
    );
    const sent = sentCounts.reduce((sum, n) => sum + n, 0);
    this.logger.log(`Weekly state summary — ${sent} email(s) queued across ${states.length} state(s)`);
  }

  private async sendSummaryForState(
    stateId: Types.ObjectId,
    stateName: string,
    template: EmailTemplateDocument,
  ): Promise<number> {
    const recipients = await this.userModel
      .find({
        state: stateId,
        role: Role.STATE,
        xviFcSubrole: { $in: ['admin', 'reviewer', 'viewer'] },
        isActive: true,
        isDeleted: false,
        isXVIFCProfileVerified: true,
        email: { $exists: true, $nin: ['', null] },
      })
      .select('email')
      .lean()
      .exec();

    if (!recipients.length) return 0;

    const [counts, reviewDelayed] = await Promise.all([
      this.countByStatus(stateId),
      this.countReviewDelayed(stateId),
    ]);

    const pct = (n: number) => (counts.total > 0 ? Math.round((n / counts.total) * 100) : 0);
    const now = new Date();
    const variables: Record<string, string> = {
      stateName,
      date: `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}`,
      totalUlbs: String(counts.total),
      notStarted: String(counts.notStarted),
      notStartedPercent: String(pct(counts.notStarted)),
      underStateReview: String(counts.underStateReview),
      underStateReviewPercent: String(pct(counts.underStateReview)),
      reviewDelayed: String(reviewDelayed),
      reviewDelayedPercent: String(pct(reviewDelayed)),
      readyForClaim: String(counts.readyForClaim),
      readyForClaimPercent: String(pct(counts.readyForClaim)),
      forwardedToMohua: String(counts.forwardedToMohua),
      forwardedToMohuaPercent: String(pct(counts.forwardedToMohua)),
      loginLink: buildPortalAuthUrls(this.config, PORTAL_INVITE_LOGIN_TYPE).loginUrl,
    };

    const subject = interpolate(template.subject, variables);
    const html = interpolate(template.body, variables);
    for (const recipient of recipients) {
      await this.emailQueue.addEmailJob({ to: recipient.email as string, subject, html });
    }
    return recipients.length;
  }

  /**
   * Per-state ULB counts, anchored on the 'audited' section (the canonical Annual Account record
   * — see the schema's own doc comment on why 'audited' is the anchor). Same ULB-primary /
   * left-join-to-annual-account shape as `AnnualAccountsService.listUlbSubmissions`'s counts
   * facet, minus pagination/search since this only ever needs the totals. Deliberately not scoped
   * to a specific design year — same convention as the other two reminder crons in this folder,
   * since a ULB only ever has one live/current-cycle record in a non-terminal status at a time.
   */
  private async countByStatus(stateId: Types.ObjectId): Promise<StatusCounts> {
    const pipeline = [
      { $match: { state: stateId, isActive: true } },
      {
        $lookup: {
          from: 'xvifc_annualaccounts',
          let: { ulbId: '$_id' },
          pipeline: [
            { $match: { $expr: { $and: [{ $eq: ['$ulb', '$$ulbId'] }, { $eq: ['$sectionType', 'audited'] }] } } },
            // A ULB can carry more than one 'audited' record across design years — sort so
            // $arrayElemAt below deterministically picks the most recent one, not whichever
            // happens to come back first.
            { $sort: { design_year: -1 } },
          ],
          as: 'account',
        },
      },
      { $addFields: { account: { $arrayElemAt: ['$account', 0] } } },
      {
        $addFields: {
          formStatusId: { $ifNull: ['$account.form_status_id', FORM_STATUS_ID[AnnualAccountFormStatus.NOT_STARTED]] },
        },
      },
      { $group: { _id: '$formStatusId', count: { $sum: 1 } } },
    ];

    const rows = await this.ulbModel.aggregate<{ _id: number; count: number }>(pipeline).exec();
    const byId = new Map(rows.map((r) => [r._id, r.count]));
    const total = rows.reduce((sum, r) => sum + r.count, 0);

    return {
      total,
      notStarted: byId.get(FORM_STATUS_ID[AnnualAccountFormStatus.NOT_STARTED]) ?? 0,
      underStateReview: byId.get(FORM_STATUS_ID[AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE]) ?? 0,
      readyForClaim: byId.get(FORM_STATUS_ID[AnnualAccountFormStatus.APPROVED_BY_STATE]) ?? 0,
      forwardedToMohua: byId.get(FORM_STATUS_ID[AnnualAccountFormStatus.UNDER_REVIEW_BY_MOHUA]) ?? 0,
    };
  }

  /** Same date-math pattern as StateReviewDigestService.findDueAnnualAccounts, threshold=10 days. */
  private countReviewDelayed(stateId: Types.ObjectId): Promise<number> {
    return this.annualAccountModel
      .countDocuments({
        state: stateId,
        sectionType: 'audited',
        form_status_id: FORM_STATUS_ID[AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE],
        declaredAt: { $ne: null },
        $expr: {
          $gte: [new Date(), { $add: ['$declaredAt', REVIEW_DELAYED_THRESHOLD_DAYS * DAY_MS] }],
        },
      })
      .exec();
  }
}
