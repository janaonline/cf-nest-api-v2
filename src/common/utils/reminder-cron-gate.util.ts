import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

/**
 * Master on/off switch shared by all 4 reminder/summary crons — the 3 in
 * `module/xvi-fc/common/reminders/` plus the pre-existing, otherwise-unrelated
 * `admin/email-templates/weekly-report.service.ts` (kept under the same flag deliberately, so one
 * switch controls all 4 rather than needing separate flags per cron).
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
