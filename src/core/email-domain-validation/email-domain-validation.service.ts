import { Injectable, Logger } from '@nestjs/common';
import { resolveMx } from 'dns/promises';

@Injectable()
export class EmailDomainValidationService {
  private readonly logger = new Logger(EmailDomainValidationService.name);

  /**
   * Resolves whether `email`'s domain has at least one MX record — i.e. the domain can actually
   * receive mail, not just look syntactically valid (catches typos like "@gmial.com" or
   * made-up domains that a regex alone would accept). Malformed input (no domain part) and DNS
   * failures (NXDOMAIN, no MX records, resolver timeout) both resolve `false` rather than
   * throwing, so callers get a single yes/no check without needing to handle DNS errors
   * themselves — a resolver hiccup is treated the same as "can't verify this domain".
   */
  async domainHasMxRecord(email: string): Promise<boolean> {
    const domain = email.split('@')[1]?.trim().toLowerCase();
    if (!domain) return false;

    try {
      const records = await resolveMx(domain);
      return records.length > 0;
    } catch (error) {
      this.logger.debug(`MX lookup failed for domain "${domain}": ${(error as Error).message}`);
      return false;
    }
  }
}
