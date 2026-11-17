import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { escapeHtml } from 'src/common/utils/html-escape.util';
import { EmailTemplatesService } from 'src/admin/email-templates/email-templates.service';
import { EmailTemplate, EmailTemplateDocument } from 'src/schemas/email-template.schema';
import { EmailQueueService } from 'src/core/queue/email-queue/email-queue.service';
import { interpolate } from 'src/core/utils/interpolate.util';
import { Role } from 'src/module/auth/enum/role.enum';
import { User, UserDocument } from 'src/schemas/user/user.schema';
import { Ulb, UlbDocument } from 'src/schemas/ulb.schema';
import { State, StateDocument } from 'src/schemas/state.schema';
import { PORTAL_INVITE_LOGIN_TYPE, buildPortalAuthUrls } from 'src/core/utils/portal-urls.util';

const TEMPLATE_SLUG = 'form-returned-notification';
const STATE_TEMPLATE_SLUG = 'state-form-returned-notification';
const CLAIM_LETTER_STATE_TEMPLATE_SLUG = 'claim-letter-returned-state';
const CLAIM_LETTER_ULB_TEMPLATE_SLUG = 'claim-letter-returned-ulb';

/** Shared look of the two claim-letter return emails (the same palette as the form-returned ones). */
const RETURN_EMAIL_STYLE = `
    body { margin: 0; padding: 0; background-color: #f4f6f9; font-family: Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header { background-color: #b3261e; padding: 28px 32px; text-align: center; }
    .header-title { color: #ffffff; font-size: 18px; font-weight: bold; }
    .body { padding: 32px; color: #333333; font-size: 15px; line-height: 1.6; }
    .body h2 { font-size: 20px; color: #b3261e; margin-bottom: 8px; }
    .info-box { background: #fdecea; border-left: 4px solid #b3261e; border-radius: 4px; padding: 14px 18px; margin: 20px 0; font-size: 14px; }
    .info-box p { margin: 4px 0; }
    .info-box strong { color: #b3261e; }
    .reason-box { background: #fff8e1; border-left: 4px solid #e0a800; border-radius: 4px; padding: 14px 18px; margin: 20px 0; font-size: 14px; }
    .items { margin: 8px 0 20px; padding-left: 20px; font-size: 14px; }
    .items li { margin: 6px 0; }
    .cta { text-align: center; margin: 28px 0; }
    .cta a { background-color: #0f4c81; color: #ffffff; text-decoration: none; padding: 13px 32px; border-radius: 6px; font-size: 15px; font-weight: bold; display: inline-block; }
    .note { font-size: 13px; color: #777777; margin-top: 24px; background: #f4f6f9; border-radius: 4px; padding: 12px 16px; }
    .footer { background: #f4f6f9; text-align: center; padding: 18px 32px; font-size: 12px; color: #999999; }
`;

const CLAIM_LETTER_STATE_SUBJECT = 'Action Required: XVI-FC Claim Letter {{refNo}} Was Returned for Correction';

// Like the other State emails, never names the reviewer: the State sees "Returned for Correction".
const CLAIM_LETTER_STATE_BODY = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your XVI-FC Claim Letter Was Returned</title>
  <style>${RETURN_EMAIL_STYLE}</style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="header-title">XVI Finance Commission — CityFinance Portal</div>
    </div>
    <div class="body">
      <h2>Your Claim Letter Was Returned for Correction</h2>
      <p>Dear Sir / Madam,</p>
      <p>
        The XVI-FC claim letter <strong>{{refNo}}</strong> for <strong>{{stateName}}</strong> has been
        <strong>returned for correction</strong>.
      </p>
      <div class="info-box">
        <p><strong>State:</strong> {{stateName}}</p>
        <p><strong>Claim letter:</strong> {{refNo}}</p>
        <p><strong>Status:</strong> Returned for correction</p>
      </div>
      {{returnReasonBlock}}
      <p><strong>Returned for correction:</strong></p>
      {{returnedItemsBlock}}
      <p>
        Please log in to City Finance and correct these items. The returned ULBs' forms go back through review; once
        they are approved again, prepare and submit a new claim letter for them.
      </p>
      <div class="cta">
        <a href="{{loginLink}}" target="_blank">Login to City Finance</a>
      </div>
      <div class="note">
        <strong>Note:</strong> This email is sent automatically when a claim letter is returned.
      </div>
    </div>
    <div class="footer">
      &copy; CityFinance &mdash; Ministry of Housing and Urban Affairs, Government of India
    </div>
  </div>
</body>
</html>
`.trim();

const CLAIM_LETTER_ULB_SUBJECT = 'Action Required: Your XVI-FC {{formName}} Was Returned for Correction';

const CLAIM_LETTER_ULB_BODY = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your XVI-FC Submission Was Returned</title>
  <style>${RETURN_EMAIL_STYLE}</style>
</head>
<body>
  <div class="wrapper">
    <div class="header">
      <div class="header-title">XVI Finance Commission — CityFinance Portal</div>
    </div>
    <div class="body">
      <h2>Your Submission Was Returned for Correction</h2>
      <p>Dear Sir / Madam,</p>
      <p>
        Your XVI-FC <strong>{{formName}}</strong> for <strong>{{ulbName}}</strong> was reviewed with your State's
        grant claim and has been <strong>returned for correction</strong>.
      </p>
      <div class="info-box">
        <p><strong>ULB:</strong> {{ulbName}}</p>
        <p><strong>Form:</strong> {{formName}}</p>
        <p><strong>Status:</strong> Returned for correction</p>
      </div>
      {{returnReasonBlock}}
      <p>
        Please log in to City Finance, make the required changes and re-submit, so your State can include
        your ULB in its next claim.
      </p>
      <div class="cta">
        <a href="{{loginLink}}" target="_blank">Login &amp; Resubmit</a>
      </div>
      <div class="note">
        <strong>Note:</strong> If you have already corrected and resubmitted this form, please disregard this email.
      </div>
    </div>
    <div class="footer">
      &copy; CityFinance &mdash; Ministry of Housing and Urban Affairs, Government of India
    </div>
  </div>
</body>
</html>
`.trim();

/** One ULB the claim letter return sent back: everything returned for it, and which of that is its own forms. */
export interface ClaimLetterReturnedUlbNotice {
  ulbId: Types.ObjectId;
  /** Every item returned for this ULB (its rows in State forms, its own forms, its exemptions), for the State email. */
  items: string[];
  /** The ULB's own forms among them: only these get the ULB an email. */
  ownForms: string[];
  remark: string | null;
}

const STATE_DEFAULT_SUBJECT = 'Action Required: Your XVI-FC {{formName}} Was Returned for Correction';

// Deliberately never names the reviewer (PMU or MoHUA) — State users only ever see "returned for
// correction" in the app, so the email matches.
const STATE_DEFAULT_BODY = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your XVI-FC Form Was Returned</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f4f6f9; font-family: Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header { background-color: #b3261e; padding: 28px 32px; text-align: center; }
    .header-title { color: #ffffff; font-size: 18px; font-weight: bold; }
    .body { padding: 32px; color: #333333; font-size: 15px; line-height: 1.6; }
    .body h2 { font-size: 20px; color: #b3261e; margin-bottom: 8px; }
    .info-box { background: #fdecea; border-left: 4px solid #b3261e; border-radius: 4px; padding: 14px 18px; margin: 20px 0; font-size: 14px; }
    .info-box p { margin: 4px 0; }
    .info-box strong { color: #b3261e; }
    .reason-box { background: #fff8e1; border-left: 4px solid #e0a800; border-radius: 4px; padding: 14px 18px; margin: 20px 0; font-size: 14px; }
    .cta { text-align: center; margin: 28px 0; }
    .cta a { background-color: #0f4c81; color: #ffffff; text-decoration: none; padding: 13px 32px; border-radius: 6px; font-size: 15px; font-weight: bold; display: inline-block; }
    .note { font-size: 13px; color: #777777; margin-top: 24px; background: #f4f6f9; border-radius: 4px; padding: 12px 16px; }
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
      <h2>Your Form Was Returned for Correction</h2>
      <p>Dear Sir / Madam,</p>
      <p>
        The XVI-FC <strong>{{formName}}</strong> form for <strong>{{stateName}}</strong> has been
        <strong>returned for correction</strong> and needs your attention.
      </p>

      <div class="info-box">
        <p><strong>State:</strong> {{stateName}}</p>
        <p><strong>Form:</strong> {{formName}}</p>
        <p><strong>Status:</strong> Returned for correction</p>
      </div>

      {{returnReasonBlock}}

      <p>
        Please log in to City Finance, review the comments, make the required changes and re-submit the
        form so the review can continue.
      </p>

      <div class="cta">
        <a href="{{loginLink}}" target="_blank">Login &amp; Resubmit</a>
      </div>

      <hr class="divider" />

      <div class="note">
        <strong>Note:</strong> If this form has already been corrected and resubmitted, please disregard
        this email — it is sent automatically when the form is returned.
      </div>
    </div>

    <div class="footer">
      &copy; CityFinance &mdash; Ministry of Housing and Urban Affairs, Government of India
    </div>
  </div>
</body>
</html>
`.trim();

const DEFAULT_SUBJECT = 'Action Required: Your XVI-FC {{formName}} Submission Was Returned by the State';

const DEFAULT_BODY = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Your XVI-FC Submission Was Returned</title>
  <style>
    body { margin: 0; padding: 0; background-color: #f4f6f9; font-family: Arial, sans-serif; }
    .wrapper { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08); }
    .header { background-color: #b3261e; padding: 28px 32px; text-align: center; }
    .header-title { color: #ffffff; font-size: 18px; font-weight: bold; margin-top: 12px; }
    .body { padding: 32px; color: #333333; font-size: 15px; line-height: 1.6; }
    .body h2 { font-size: 20px; color: #b3261e; margin-bottom: 8px; }
    .info-box { background: #fdecea; border-left: 4px solid #b3261e; border-radius: 4px; padding: 14px 18px; margin: 20px 0; font-size: 14px; }
    .info-box p { margin: 4px 0; }
    .info-box strong { color: #b3261e; }
    .reason-box { background: #fff8e1; border-left: 4px solid #e0a800; border-radius: 4px; padding: 14px 18px; margin: 20px 0; font-size: 14px; }
    .cta { text-align: center; margin: 28px 0; }
    .cta a { background-color: #0f4c81; color: #ffffff; text-decoration: none; padding: 13px 32px; border-radius: 6px; font-size: 15px; font-weight: bold; display: inline-block; }
    .note { font-size: 13px; color: #777777; margin-top: 24px; background: #f4f6f9; border-radius: 4px; padding: 12px 16px; }
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
      <h2>Your Submission Was Returned by the State</h2>
      <p>Dear Sir / Madam,</p>
      <p>
        Your XVI-FC <strong>{{formName}}</strong> submission for <strong>{{ulbName}}</strong> has been
        <strong>returned by the State</strong> and requires your attention.
      </p>

      <div class="info-box">
        <p><strong>ULB:</strong> {{ulbName}}</p>
        <p><strong>Form:</strong> {{formName}}</p>
        <p><strong>Status:</strong> Returned by State</p>
      </div>

      {{returnReasonBlock}}

      <p>
        Please log in to City Finance to review the comments, make the required changes, and
        re-submit your application for State review.
      </p>

      <p>Review and update your submission here:</p>

      <div class="cta">
        <a href="{{loginLink}}" target="_blank">Login &amp; Resubmit</a>
      </div>

      <p>If you need any help understanding or resolving the comments, you can:</p>
      <ul style="padding-left:20px;margin:8px 0;">
        <li>Join the City Finance Support Hour for live assistance</li>
        <li>Reply to this email with your question</li>
      </ul>
      <p>
        Please re-submit at the earliest so your State can continue the review for fund release.
      </p>

      <hr class="divider" />

      <div class="note">
        <strong>Note:</strong> If you have already corrected and resubmitted this form, please disregard
        this email — notifications are sent automatically based on the form's status at the time this
        email was queued.
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
 * One-off notification (not a dwell-time cron) fired synchronously the moment STATE returns a
 * ULB's Annual Account section or Bank Account form — "your form was returned, please log in and
 * resubmit". Shared across both `annual_accounts.service.ts` and `bank-account.service.ts` since
 * both forms use the same RETURNED_BY_STATE status and the same Nodal Officer recipient.
 *
 * Also hosts `notifyStateFormReturned`: the State-facing counterpart, fired when PMU (or MoHUA, for
 * FC Unspent) returns one of the five State forms — every verified State user gets one email.
 *
 * And `notifyClaimLetterReturned`: when the MoHUA Section Officer returns a claim letter, one email to the State
 * users and one to each ULB whose own forms were reopened.
 *
 * Deliberately never throws — a notification failure (missing template, no Nodal Officer, queue
 * error) must never fail the underlying approve/return decision it's reporting on.
 */
@Injectable()
export class FormReturnedNotificationService {
  private readonly logger = new Logger(FormReturnedNotificationService.name);

  constructor(
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
    @InjectModel(Ulb.name) private readonly ulbModel: Model<UlbDocument>,
    @InjectModel(EmailTemplate.name) private readonly templateModel: Model<EmailTemplateDocument>,
    private readonly emailTemplates: EmailTemplatesService,
    private readonly emailQueue: EmailQueueService,
    private readonly config: ConfigService,
    @InjectModel(State.name) private readonly stateModel: Model<StateDocument>,
  ) {}

  // ─── Seed default templates (idempotent — mirrors the other reminder services) ─────────────

  async seedTemplate(): Promise<{ created: boolean; message: string }> {
    const createdEach = await Promise.all([
      this.seedOne(TEMPLATE_SLUG, 'Form Returned Notification', DEFAULT_SUBJECT, DEFAULT_BODY),
      this.seedOne(STATE_TEMPLATE_SLUG, 'State Form Returned Notification', STATE_DEFAULT_SUBJECT, STATE_DEFAULT_BODY),
      this.seedOne(
        CLAIM_LETTER_STATE_TEMPLATE_SLUG,
        'Claim Letter Returned (State)',
        CLAIM_LETTER_STATE_SUBJECT,
        CLAIM_LETTER_STATE_BODY,
      ),
      this.seedOne(
        CLAIM_LETTER_ULB_TEMPLATE_SLUG,
        'Claim Letter Returned (ULB)',
        CLAIM_LETTER_ULB_SUBJECT,
        CLAIM_LETTER_ULB_BODY,
      ),
    ]);
    const created = createdEach.some(Boolean);
    return {
      created,
      message: created
        ? 'Form returned notification template(s) created successfully'
        : 'Form returned notification templates already exist',
    };
  }

  private async seedOne(slug: string, name: string, subject: string, body: string): Promise<boolean> {
    const existing = await this.templateModel.findOne({ slug }).exec();
    if (existing) return false;
    await this.templateModel.create({ name, slug, subject, body, isActive: true });
    this.logger.log(`Email template seeded: ${slug}`);
    return true;
  }

  /**
   * Notifies every verified State user of `stateId` that `formName` was returned for correction
   * (by PMU or MoHUA — the email never says which). `remarks` is the reviewer's single form-level
   * remark when there is one; omit it (null) for a row-level return, whose remarks live per row.
   * Best-effort and never throws, like `notifyReturned` — the caller's decision has already been
   * committed by the time this runs.
   */
  async notifyStateFormReturned(params: {
    stateId: Types.ObjectId;
    formName: string;
    remarks: string | null;
  }): Promise<void> {
    const { stateId, formName, remarks } = params;
    try {
      const template = await this.emailTemplates.findBySlug(STATE_TEMPLATE_SLUG);
      const recipients = await this.findStateRecipients(stateId);

      if (!recipients.length) {
        this.logger.warn(
          `No verified State users found for state ${stateId.toString()} — skipping ${formName} return notification`,
        );
        return;
      }

      const state = await this.stateModel.findById(stateId).select('name').lean().exec();
      const { loginUrl } = buildPortalAuthUrls(this.config, PORTAL_INVITE_LOGIN_TYPE);

      const variables: Record<string, string> = {
        stateName: escapeHtml(state?.name ?? 'your State'),
        formName,
        returnReasonBlock: remarks
          ? `<div class="reason-box"><p><strong>Reviewer's remarks:</strong> ${escapeHtml(remarks)}</p></div>`
          : '',
        loginLink: loginUrl,
      };

      const queued = await this.queueToEach(
        recipients,
        interpolate(template.subject, variables),
        interpolate(template.body, variables),
        `state ${stateId.toString()}, ${formName}`,
      );
      this.logger.log(
        `State return notification queued for state ${stateId.toString()} (${formName}) → ${queued}/${recipients.length} recipient(s)`,
      );
    } catch (err) {
      this.logger.warn(
        `Failed to send State return notification for state ${stateId.toString()} (${formName}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Notifies the ULB's Nodal Officer that `formName` was returned by the State. Falls back to the
   * ULB's plain-text `accountantEmail` contact (embedded on its primary User doc) when no verified
   * Nodal Officer is on file. Best-effort: logs and returns (never throws) on any missing
   * precondition — template inactive/missing, no Nodal Officer and no accountant email either — so
   * the caller's own transaction is never put at risk by this.
   */
  async notifyReturned(params: { ulbId: Types.ObjectId; formName: string; note: string | null }): Promise<void> {
    const { ulbId, formName, note } = params;
    try {
      const template = await this.emailTemplates.findBySlug(TEMPLATE_SLUG);
      const recipientEmail = await this.findUlbRecipient(ulbId);

      if (!recipientEmail) {
        this.logger.warn(
          `No active Nodal Officer or accountant email found for ULB ${ulbId.toString()} — skipping return notification`,
        );
        return;
      }

      const ulb = await this.ulbModel.findById(ulbId).select('name').lean().exec();
      const { loginUrl } = buildPortalAuthUrls(this.config, PORTAL_INVITE_LOGIN_TYPE);

      const variables: Record<string, string> = {
        ulbName: escapeHtml(ulb?.name ?? 'your ULB'),
        formName,
        returnReasonBlock: note
          ? `<div class="reason-box"><p><strong>State's remarks:</strong> ${escapeHtml(note)}</p></div>`
          : '',
        loginLink: loginUrl,
      };

      const subject = interpolate(template.subject, variables);
      const html = interpolate(template.body, variables);
      await this.emailQueue.addEmailJob({ to: recipientEmail, subject, html });

      this.logger.log(`Return notification sent for ULB ${ulbId.toString()} (${formName}) → ${recipientEmail}`);
    } catch (err) {
      this.logger.warn(
        `Failed to send return notification for ULB ${ulbId.toString()} (${formName}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  /**
   * The Section Officer returned claim letter `refNo`: every verified State user gets one email listing what was
   * returned (the State-wide items, each returned ULB with its items and remark), and each ULB whose own forms were
   * reopened gets one email (Nodal Officer, else the accountant contact). A ULB returned only through State-form rows
   * or exemptions gets none: the State fixes those. Called after the return committed; never throws.
   */
  async notifyClaimLetterReturned(params: {
    stateId: Types.ObjectId;
    refNo: string;
    stateRemark: string | null;
    stateItems: string[];
    ulbs: ClaimLetterReturnedUlbNotice[];
  }): Promise<void> {
    const { stateId, refNo, stateRemark, stateItems, ulbs } = params;
    let ulbNames = new Map<string, string>();
    try {
      const docs = ulbs.length
        ? await this.ulbModel
            .find({ _id: { $in: ulbs.map((u) => u.ulbId) } })
            .select('name')
            .lean()
            .exec()
        : [];
      ulbNames = new Map(docs.map((d) => [String(d._id), d.name]));
    } catch (err) {
      this.logger.warn(`Failed to load ULB names for claim letter ${refNo}: ${err instanceof Error ? err.message : String(err)}`);
    }
    const nameOf = (ulbId: Types.ObjectId) => ulbNames.get(String(ulbId)) ?? 'your ULB';
    const { loginUrl } = buildPortalAuthUrls(this.config, PORTAL_INVITE_LOGIN_TYPE);

    try {
      const template = await this.emailTemplates.findBySlug(CLAIM_LETTER_STATE_TEMPLATE_SLUG);
      const recipients = await this.findStateRecipients(stateId);
      if (!recipients.length) {
        this.logger.warn(`No verified State users for state ${stateId.toString()} — skipping claim letter ${refNo} return notification`);
      } else {
        const state = await this.stateModel.findById(stateId).select('name').lean().exec();
        const lines = [
          ...stateItems.map((item) => `<li>${escapeHtml(item)}</li>`),
          ...ulbs.map(
            (u) =>
              `<li><strong>${escapeHtml(nameOf(u.ulbId))}</strong>: ${escapeHtml(u.items.join(', '))}` +
              (u.remark ? ` &mdash; ${escapeHtml(u.remark)}` : '') +
              '</li>',
          ),
        ];
        const variables: Record<string, string> = {
          stateName: escapeHtml(state?.name ?? 'your State'),
          refNo: escapeHtml(refNo),
          returnReasonBlock: stateRemark
            ? `<div class="reason-box"><p><strong>Reviewer's remarks:</strong> ${escapeHtml(stateRemark)}</p></div>`
            : '',
          returnedItemsBlock: `<ul class="items">${lines.join('')}</ul>`,
          loginLink: loginUrl,
        };
        const queued = await this.queueToEach(
          recipients,
          interpolate(template.subject, variables),
          interpolate(template.body, variables),
          `state ${stateId.toString()}, claim letter ${refNo}`,
        );
        this.logger.log(`Claim letter ${refNo} return notification queued → ${queued}/${recipients.length} State user(s)`);
      }
    } catch (err) {
      this.logger.warn(
        `Failed to send claim letter ${refNo} return notification to state ${stateId.toString()}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    for (const ulb of ulbs.filter((u) => u.ownForms.length)) {
      try {
        const template = await this.emailTemplates.findBySlug(CLAIM_LETTER_ULB_TEMPLATE_SLUG);
        const to = await this.findUlbRecipient(ulb.ulbId);
        if (!to) {
          this.logger.warn(`No Nodal Officer or accountant email for ULB ${ulb.ulbId.toString()} — skipping claim letter ${refNo} return notification`);
          continue;
        }
        const variables: Record<string, string> = {
          ulbName: escapeHtml(nameOf(ulb.ulbId)),
          formName: escapeHtml(ulb.ownForms.join(', ')),
          returnReasonBlock: ulb.remark
            ? `<div class="reason-box"><p><strong>Reviewer's remarks:</strong> ${escapeHtml(ulb.remark)}</p></div>`
            : '',
          loginLink: loginUrl,
        };
        await this.emailQueue.addEmailJob({
          to,
          subject: interpolate(template.subject, variables),
          html: interpolate(template.body, variables),
        });
      } catch (err) {
        this.logger.warn(
          `Failed to send claim letter ${refNo} return notification to ULB ${ulb.ulbId.toString()}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /** Every verified State user of the state, any subrole (the weekly state summary's rule). */
  private async findStateRecipients(stateId: Types.ObjectId): Promise<{ email?: string | null }[]> {
    return this.userModel
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
  }

  /**
   * The ULB's verified Nodal Officer; without one, the plain-text `accountantEmail` on its primary User doc rather
   * than sending nothing. Undefined when neither exists.
   */
  private async findUlbRecipient(ulbId: Types.ObjectId): Promise<string | undefined> {
    const nodalOfficer = await this.userModel
      .findOne({
        ulb: ulbId,
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
    if (nodalOfficer?.email) return nodalOfficer.email as string;

    const primaryUser = await this.userModel
      .findOne({ ulb: ulbId, role: Role.ULB, isDeleted: false })
      .select('accountantEmail')
      .lean()
      .exec();
    const fallback = primaryUser?.accountantEmail || undefined;
    if (fallback) {
      this.logger.warn(
        `No active Nodal Officer found for ULB ${ulbId.toString()} — falling back to accountant email ${fallback}`,
      );
    }
    return fallback;
  }

  /** Queues one email per recipient; one enqueue failing must not cost the rest theirs. Returns how many queued. */
  private async queueToEach(
    recipients: { email?: string | null }[],
    subject: string,
    html: string,
    context: string,
  ): Promise<number> {
    let queued = 0;
    for (const recipient of recipients) {
      try {
        await this.emailQueue.addEmailJob({ to: recipient.email as string, subject, html });
        queued += 1;
      } catch (err) {
        this.logger.warn(
          `Failed to queue return notification for ${String(recipient.email)} (${context}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return queued;
  }
}
