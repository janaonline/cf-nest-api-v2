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
import { PORTAL_INVITE_LOGIN_TYPE, buildPortalAuthUrls } from 'src/core/utils/portal-urls.util';

const TEMPLATE_SLUG = 'form-returned-notification';

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
  ) {}

  // ─── Seed default template (idempotent — mirrors the other reminder services) ──────────────

  async seedTemplate(): Promise<{ created: boolean; message: string }> {
    const existing = await this.templateModel.findOne({ slug: TEMPLATE_SLUG }).exec();
    if (existing) return { created: false, message: 'Form returned notification template already exists' };

    await this.templateModel.create({
      name: 'Form Returned Notification',
      slug: TEMPLATE_SLUG,
      subject: DEFAULT_SUBJECT,
      body: DEFAULT_BODY,
      isActive: true,
    });
    this.logger.log('Form returned notification template seeded');
    return { created: true, message: 'Form returned notification template created successfully' };
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

      let recipientEmail = nodalOfficer?.email as string | undefined;

      // No verified Nodal Officer on file — fall back to the ULB's plain-text accountant contact
      // (accountantEmail, embedded on the ULB's primary User doc) rather than sending nothing.
      if (!recipientEmail) {
        const primaryUser = await this.userModel
          .findOne({ ulb: ulbId, role: Role.ULB, isDeleted: false })
          .select('accountantEmail')
          .lean()
          .exec();
        recipientEmail = primaryUser?.accountantEmail || undefined;

        if (recipientEmail) {
          this.logger.warn(
            `No active Nodal Officer found for ULB ${ulbId.toString()} — falling back to accountant email ${recipientEmail}`,
          );
        }
      }

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
}
