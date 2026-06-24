import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

/**
 * Thin wrapper around MSG91 for non-OTP transactional SMS.
 * OTP sending stays in OtpService so it can maintain its own rate-limit
 * and lock logic. This service handles notifications and reminders only.
 *
 * Design rule: SMS failure is always logged but never propagated to the caller.
 * A notification going missing is recoverable; a failed HTTP 500 is not.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  private readonly authKey: string | undefined;
  private readonly inviteTemplateId: string | undefined;
  private readonly isProduction: boolean;

  constructor(private readonly configService: ConfigService) {
    this.authKey = configService.get<string>('MSG91_AUTH_KEY');
    this.inviteTemplateId = configService.get<string>('MSG91_INVITE_TEMPLATE_ID');
    this.isProduction = configService.get<string>('NODE_ENV') === 'production';
  }

  /**
   * Sends an invite reminder to a pending user.
   * Safe to call from within a transaction — any SMS failure is caught and
   * logged without rolling back the DB operation.
   */
  async sendInviteReminder(mobile: string, recipientName: string): Promise<void> {
    if (!this.isProduction) {
      this.logger.debug(`[DEV] Invite reminder SMS to ${mobile} for ${recipientName} — skipped in non-production`);
      return;
    }

    if (!this.authKey || !this.inviteTemplateId) {
      this.logger.warn('MSG91_AUTH_KEY or MSG91_INVITE_TEMPLATE_ID not configured — invite SMS skipped');
      return;
    }

    try {
      await axios.post(
        'https://api.msg91.com/api/v5/flow/',
        {
          template_id: this.inviteTemplateId,
          short_url: '0',
          recipients: [{ mobiles: `91${mobile}`, name: recipientName }],
        },
        {
          headers: {
            authkey: this.authKey,
            'Content-Type': 'application/json',
          },
          timeout: 5000,
        },
      );
      this.logger.log(`Invite reminder SMS sent to ${mobile}`);
    } catch (err) {
      this.logger.error(`Failed to send invite reminder SMS to ${mobile}`, err);
    }
  }
}
