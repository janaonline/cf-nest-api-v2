import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

/**
 * Master on/off switch shared by the 3 dwell-time/summary crons in
 * `module/xvi-fc/common/reminders/` (ulb-in-progress-reminder, state-review-digest,
 * weekly-state-summary) — one flag instead of a separate one per cron. Does not gate
 * `form-returned-notification.service.ts`, which is event-triggered (fires once at the moment
 * STATE returns a form), not a scheduled cron.
 *
 * Returns true (safe to proceed) only when `XVIFC_REMINDER_CRONS_ENABLED` is exactly `'true'`.
 * Manual trigger endpoints call each cron's underlying method directly and never go through this
 * check, so they're unaffected by the flag either way.
 */
export function remindersCronsEnabled(config: ConfigService, logger: Logger): boolean {
  const enabled = config.get<string>('XVIFC_REMINDER_CRONS_ENABLED') === 'true';
  if (!enabled) logger.debug('XVIFC_REMINDER_CRONS_ENABLED is not "true" — skipping scheduled run');
  return enabled;
}
