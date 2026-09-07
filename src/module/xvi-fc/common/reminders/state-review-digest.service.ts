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
import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import { PORTAL_INVITE_LOGIN_TYPE, buildPortalAuthUrls } from 'src/core/utils/portal-urls.util';
import {
  AnnualAccountFormStatus,
  FORM_STATUS_ID,
  XviFcAnnualAccount,
  XviFcAnnualAccountDocument,
} from 'src/schemas/xvi-fc/annual-account.schema';
import { XviFcBankAccount, XviFcBankAccountDocument } from 'src/schemas/xvi-fc/ulb/xvi-fc-bank-account.schema';
import { StateReviewPdfRow, StateReviewPdfService } from './state-review-pdf.service';
import { remindersCronsEnabled } from 'src/common/utils/reminder-cron-gate.util';
import { escapeHtml } from 'src/common/utils/html-escape.util';

const INTERVAL_DAYS = 7;
const TEMPLATE_SLUG = 'state-review-reminder';
const DAY_MS = 24 * 60 * 60 * 1000;

const DEFAULT_SUBJECT = 'Action Required: {{totalCount}} ULB Submission(s) Pending State Review for 7+ Days — {{stateName}}';

const DEFAULT_BODY = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Action Required: ULB Submissions Pending State Review</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f4f6f9; font-family: Arial, sans-serif; }
    .wrapper { max-width: 680px; margin: 40px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
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
    table { border-collapse: collapse; width: 100%; font-size: 13px; margin: 16px 0; }
    th, td { border: 1px solid #ddd; padding: 6px 8px; }
    th { background: #f2f2f2; text-align: left; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="header-title">XVI Finance Commission — CityFinance Portal</div>
    </div>

    <div class="body">
      <h2>ULB Submissions Pending State Review</h2>
      <p>Dear Sir/Madam,</p>
      <p>
        The following <strong>{{totalCount}}</strong> ULB submission(s) under the XVI Finance Commission in
        <strong>{{stateName}}</strong> have been pending State review for more than 7 days.
      </p>

      {{table}}

      <p>We request you to review the pending submissions at the earliest. For each submission:</p>
      <ul style="padding-left:20px;margin:8px 0;">
        <li>If the submission is complete and meets the required criteria, please approve it to enable claim
          letter generation.</li>
        <li>If any clarification or correction is required, please return the submission to the concerned ULB
          with your comments through your CityFinance account.</li>
      </ul>

      <div class="cta">
        <a href="{{loginLink}}" target="_blank">Review Pending Submissions</a>
      </div>

      <p style="font-size:13px;color:#777777;text-align:center;margin-top:-16px;">
        A PDF copy of the pending submission list is attached for your reference.
      </p>

      <hr class="divider" />

      <div class="note">
        <strong>Note:</strong> We appreciate your timely action to facilitate further processing of these
        submissions. If you have already reviewed some of the submissions listed above, please disregard
        those — this reminder reflects each form's status at the time it was queued.
      </div>
    </div>

    <div class="footer">
      &copy; CityFinance &mdash; Ministry of Housing and Urban Affairs, Government of India<br />
      This is an automated message. Please do not reply to this email.
    </div>
  </div>
</body>
</html>
`.trim();

interface QualifyingRow {
  docId: Types.ObjectId;
  docType: 'annual_account' | 'bank_account';
  stateId: string;
  ulbId: string;
  formType: string;
  submittedOn: Date;
}

const IST_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  timeZone: 'Asia/Kolkata',
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
};

/**
 * Digests, per state, every ULB form sitting UNDER_REVIEW_BY_STATE for ≥INTERVAL_DAYS since it was
 * either submitted or last reminded about — "please review ASAP" — to every STATE/STATE-EDITOR/
 * STATE-VIEWER user in that state, with an HTML table plus a matching PDF attachment. Covers both
 * Annual Account (`declaredAt`) and Bank Account (`submittedAt`) — both already stamp an exact
 * "entered review" timestamp at the same update that flips their status.
 */
@Injectable()
export class StateReviewDigestService {
  private readonly logger = new Logger(StateReviewDigestService.name);

  constructor(
    @InjectModel(XviFcAnnualAccount.name) private readonly annualAccountModel: Model<XviFcAnnualAccountDocument>,
    @InjectModel(XviFcBankAccount.name) private readonly bankAccountModel: Model<XviFcBankAccountDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Ulb.name) private readonly ulbModel: Model<UlbDocument>,
    @InjectModel(State.name) private readonly stateModel: Model<StateDocument>,
    @InjectModel(EmailTemplate.name) private readonly templateModel: Model<EmailTemplateDocument>,
    private readonly emailTemplates: EmailTemplatesService,
    private readonly emailQueue: EmailQueueService,
    private readonly pdfService: StateReviewPdfService,
    private readonly config: ConfigService,
  ) {}

  // ─── Seed default template (idempotent — mirrors WeeklyReportService.seedWeeklyReportTemplate) ──

  async seedTemplate(): Promise<{ created: boolean; message: string }> {
    const existing = await this.templateModel.findOne({ slug: TEMPLATE_SLUG }).exec();
    if (existing) return { created: false, message: 'State review reminder template already exists' };

    await this.templateModel.create({
      name: 'State Review Reminder',
      slug: TEMPLATE_SLUG,
      subject: DEFAULT_SUBJECT,
      body: DEFAULT_BODY,
      isActive: true,
    });
    this.logger.log('State review reminder template seeded');
    return { created: true, message: 'State review reminder template created successfully' };
  }

  // Master on/off switch — see UlbInProgressReminderService.handleScheduledRun for the full
  // rationale (one flag shared across all four reminder/summary crons). Manual trigger
  // (POST xvi-fc/reminders/send-state-review-now → sendDueDigests() directly) bypasses this flag.
  @Cron('0 9 * * *', { timeZone: 'Asia/Kolkata' })
  async handleScheduledRun(): Promise<void> {
    if (!remindersCronsEnabled(this.config, this.logger)) return;
    await this.sendDueDigests();
  }

  async sendDueDigests(): Promise<void> {
    const [annualAccountDocs, bankAccountDocs] = await Promise.all([
      this.findDueAnnualAccounts(),
      this.findDueBankAccounts(),
    ]);
    const allRows = this.toQualifyingRows([...annualAccountDocs, ...bankAccountDocs]);
    if (!allRows.length) return;

    let template: EmailTemplateDocument;
    try {
      template = await this.emailTemplates.findBySlug(TEMPLATE_SLUG);
    } catch {
      this.logger.warn(`Template "${TEMPLATE_SLUG}" not found or inactive — skipping this run`);
      return;
    }

    const [ulbById, stateById] = await this.loadLookups(allRows);

    const byState = new Map<string, QualifyingRow[]>();
    for (const row of allRows) {
      if (!byState.has(row.stateId)) byState.set(row.stateId, []);
      byState.get(row.stateId)!.push(row);
    }

    await Promise.all(
      [...byState.entries()].map(([stateId, rows]) =>
        this.sendDigestForState(stateId, rows, template, ulbById, stateById),
      ),
    );
  }

  // now >= (lastReminderSentAt ?? declaredAt) + INTERVAL_DAYS
  private findDueAnnualAccounts(): Promise<XviFcAnnualAccountDocument[]> {
    return this.annualAccountModel
      .find({
        form_status_id: FORM_STATUS_ID[AnnualAccountFormStatus.UNDER_REVIEW_BY_STATE],
        declaredAt: { $ne: null },
        $expr: {
          $gte: [new Date(), { $add: [{ $ifNull: ['$lastReminderSentAt', '$declaredAt'] }, INTERVAL_DAYS * DAY_MS] }],
        },
      })
      .exec();
  }

  // now >= (lastReminderSentAt ?? submittedAt) + INTERVAL_DAYS
  private findDueBankAccounts(): Promise<XviFcBankAccountDocument[]> {
    return this.bankAccountModel
      .find({
        currentFormStatus: FORM_STATUS.UNDER_REVIEW_BY_STATE,
        submittedAt: { $ne: null },
        $expr: {
          $gte: [new Date(), { $add: [{ $ifNull: ['$lastReminderSentAt', '$submittedAt'] }, INTERVAL_DAYS * DAY_MS] }],
        },
      })
      .exec();
  }

  private toQualifyingRows(
    docs: (XviFcAnnualAccountDocument | XviFcBankAccountDocument)[],
  ): QualifyingRow[] {
    return docs.map((doc) => {
      const isAnnualAccount = 'sectionType' in doc;
      return {
        docId: doc._id as Types.ObjectId,
        docType: isAnnualAccount ? 'annual_account' : 'bank_account',
        stateId: (doc.state as Types.ObjectId).toString(),
        ulbId: (doc.ulb as Types.ObjectId).toString(),
        formType: isAnnualAccount
          ? (doc as XviFcAnnualAccountDocument).sectionType === 'audited'
            ? 'Annual Account – Audited'
            : 'Annual Account – Provisional'
          : 'Bank Account',
        submittedOn: isAnnualAccount
          ? (doc as XviFcAnnualAccountDocument).declaredAt!
          : (doc as XviFcBankAccountDocument).submittedAt!,
      };
    });
  }

  private async loadLookups(
    rows: QualifyingRow[],
  ): Promise<[Map<string, { name: string; code: string }>, Map<string, string>]> {
    const ulbIds = [...new Set(rows.map((r) => r.ulbId))].map((id) => new Types.ObjectId(id));
    const stateIds = [...new Set(rows.map((r) => r.stateId))].map((id) => new Types.ObjectId(id));

    const [ulbs, states] = await Promise.all([
      this.ulbModel.find({ _id: { $in: ulbIds } }).select('name code').lean().exec(),
      this.stateModel.find({ _id: { $in: stateIds } }).select('name').lean().exec(),
    ]);

    const ulbById = new Map(ulbs.map((u) => [(u._id as Types.ObjectId).toString(), { name: u.name, code: u.code }]));
    const stateById = new Map(states.map((s) => [(s._id as Types.ObjectId).toString(), s.name]));
    return [ulbById, stateById];
  }

  private async sendDigestForState(
    stateId: string,
    rows: QualifyingRow[],
    template: EmailTemplateDocument,
    ulbById: Map<string, { name: string; code: string }>,
    stateById: Map<string, string>,
  ): Promise<void> {
    const recipients = await this.userModel
      .find({
        state: new Types.ObjectId(stateId),
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

    if (!recipients.length) {
      this.logger.warn(`No active STATE-family users found for state ${stateId} — skipping digest`);
      return;
    }

    const stateName = stateById.get(stateId) ?? 'Unknown State';
    const now = new Date();
    const pdfRows: StateReviewPdfRow[] = rows
      .map((row) => ({
        ulbName: ulbById.get(row.ulbId)?.name ?? 'Unknown ULB',
        ulbCode: ulbById.get(row.ulbId)?.code ?? '-',
        formType: row.formType,
        submittedOnLabel: row.submittedOn.toLocaleString('en-IN', IST_DATE_FORMAT),
        daysPending: Math.floor((now.getTime() - row.submittedOn.getTime()) / DAY_MS),
      }))
      .sort((a, b) => b.daysPending - a.daysPending)
      .map((row, i) => ({ ...row, slNo: i + 1 }));

    const generatedAtLabel = now.toLocaleString('en-IN', IST_DATE_FORMAT);
    const pdfBuffer = await this.pdfService.generatePdf({ stateName, generatedAtLabel, rows: pdfRows });

    const { loginUrl } = buildPortalAuthUrls(this.config, PORTAL_INVITE_LOGIN_TYPE);
    const variables: Record<string, string> = {
      stateName,
      totalCount: String(pdfRows.length),
      table: this.buildHtmlTable(pdfRows),
      loginLink: loginUrl,
    };
    const subject = interpolate(template.subject, variables);
    const html = interpolate(template.body, variables);

    await this.emailQueue.addEmailJob({
      to: recipients.map((r) => r.email as string),
      subject,
      html,
      attachments: [
        {
          filename: `pending-review-${stateName.replace(/\s+/g, '-').toLowerCase()}-${now.toISOString().slice(0, 10)}.pdf`,
          content: pdfBuffer.toString('base64'),
          contentType: 'application/pdf',
        },
      ],
    });

    const annualAccountIds = rows.filter((r) => r.docType === 'annual_account').map((r) => r.docId);
    const bankAccountIds = rows.filter((r) => r.docType === 'bank_account').map((r) => r.docId);
    await Promise.all([
      annualAccountIds.length
        ? this.annualAccountModel.updateMany({ _id: { $in: annualAccountIds } }, { $set: { lastReminderSentAt: now } })
        : Promise.resolve(),
      bankAccountIds.length
        ? this.bankAccountModel.updateMany({ _id: { $in: bankAccountIds } }, { $set: { lastReminderSentAt: now } })
        : Promise.resolve(),
    ]);
    this.logger.log(
      `State digest sent for ${stateName} (${stateId}) — ${rows.length} form(s), ${recipients.length} recipient(s)`,
    );
  }

  private buildHtmlTable(rows: StateReviewPdfRow[]): string {
    const th = (label: string) =>
      `<th style="border:1px solid #ddd;padding:6px 8px;background:#f2f2f2;text-align:left;">${label}</th>`;
    const td = (value: string | number) => `<td style="border:1px solid #ddd;padding:6px 8px;">${escapeHtml(value)}</td>`;
    const headerRow = `<tr>${['S.No.', 'ULB Name', 'ULB Code', 'Form Type', 'Submitted On', 'Days Pending']
      .map(th)
      .join('')}</tr>`;
    const bodyRows = rows
      .map(
        (r) =>
          `<tr>${[r.slNo, r.ulbName, r.ulbCode, r.formType, r.submittedOnLabel, r.daysPending].map(td).join('')}</tr>`,
      )
      .join('');
    return `<table style="border-collapse:collapse;width:100%;font-size:13px;">${headerRow}${bodyRows}</table>`;
  }
}
