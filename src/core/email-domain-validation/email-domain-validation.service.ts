import { Injectable, Logger } from '@nestjs/common';
import { lookup, resolveMx } from 'dns/promises';

@Injectable()
export class EmailDomainValidationService {
  private readonly logger = new Logger(EmailDomainValidationService.name);

  /**
   * Resolves whether `email`'s domain can plausibly receive mail — catches typos like
   * "@gmial.com" or made-up domains that a regex alone would accept. Malformed input (no domain
   * part) resolves `false` without any lookup.
   *
   * Prefers an explicit MX record (`resolveMx`), but falls back to a plain `dns.lookup()`
   * (A/AAAA) whenever the MX query itself doesn't confirm one, for two reasons:
   *  1. Correctness — per RFC 5321, a domain with no MX record but a valid A/AAAA record still
   *     receives mail there (implicit MX at the A record); failing the MX query alone isn't proof
   *     the domain can't receive mail.
   *  2. Reliability — `resolveMx` sends a raw DNS-protocol query against Node's configured
   *     nameservers (`dns.getServers()`), which several environments (containers/VPNs behind a
   *     local stub resolver, restricted-egress networks that only let the OS resolver through)
   *     refuse outright (e.g. `ECONNREFUSED`) even though ordinary name resolution works fine.
   *     Without this fallback, a broken raw-DNS path would reject every email, valid or not.
   * Only resolves `false` when both the MX query and the fallback lookup fail to resolve anything.
   */
  async domainHasMxRecord(email: string): Promise<boolean> {
    const domain = email.split('@')[1]?.trim().toLowerCase();
    if (!domain) return false;

    try {
      const records = await resolveMx(domain);
      if (records.length > 0) return true;
    } catch (error) {
      this.logger.debug(`MX lookup failed for domain "${domain}": ${(error as Error).message}`);
    }

    try {
      await lookup(domain);
      return true;
    } catch (error) {
      this.logger.debug(`Fallback A/AAAA lookup failed for domain "${domain}": ${(error as Error).message}`);
      return false;
    }
  }
}
