import { lookup, resolveMx } from 'dns/promises';
import { EmailDomainValidationService } from './email-domain-validation.service';

jest.mock('dns/promises', () => ({ resolveMx: jest.fn(), lookup: jest.fn() }));

describe('EmailDomainValidationService', () => {
  let service: EmailDomainValidationService;
  const mockResolveMx = resolveMx as jest.Mock;
  const mockLookup = lookup as jest.Mock;

  beforeEach(() => {
    service = new EmailDomainValidationService();
    mockResolveMx.mockReset();
    mockLookup.mockReset();
  });

  it('returns true when the domain resolves at least one MX record', async () => {
    mockResolveMx.mockResolvedValue([{ exchange: 'mx.ulb.gov.in', priority: 10 }]);

    await expect(service.domainHasMxRecord('commissioner@ulb.gov.in')).resolves.toBe(true);
    expect(mockResolveMx).toHaveBeenCalledWith('ulb.gov.in');
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('falls back to a plain A/AAAA lookup when the domain has no MX records', async () => {
    mockResolveMx.mockResolvedValue([]);
    mockLookup.mockResolvedValue({ address: '1.2.3.4', family: 4 });

    await expect(service.domainHasMxRecord('commissioner@ulb.gov.in')).resolves.toBe(true);
    expect(mockLookup).toHaveBeenCalledWith('ulb.gov.in');
  });

  it('falls back to a plain lookup when the MX query itself fails (e.g. a blocked raw-DNS path)', async () => {
    mockResolveMx.mockRejectedValue(Object.assign(new Error('queryMx ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    mockLookup.mockResolvedValue({ address: '1.2.3.4', family: 4 });

    // This is the exact scenario that caused valid emails (e.g. real gmail.com addresses) to be
    // rejected: resolveMx() can't even reach a resolver in some environments, but the OS-level
    // resolver used by dns.lookup() still works fine.
    await expect(service.domainHasMxRecord('commissioner@gmail.com')).resolves.toBe(true);
    expect(mockLookup).toHaveBeenCalledWith('gmail.com');
  });

  it('returns false when both the MX query and the fallback lookup fail (a real nonexistent domain)', async () => {
    mockResolveMx.mockRejectedValue(new Error('queryMx ENOTFOUND ulb.gvo.in'));
    mockLookup.mockRejectedValue(new Error('getaddrinfo ENOTFOUND ulb.gvo.in'));

    await expect(service.domainHasMxRecord('commissioner@ulb.gvo.in')).resolves.toBe(false);
  });

  it('returns false without querying DNS when the email has no domain part', async () => {
    await expect(service.domainHasMxRecord('not-an-email')).resolves.toBe(false);
    expect(mockResolveMx).not.toHaveBeenCalled();
    expect(mockLookup).not.toHaveBeenCalled();
  });

  it('lowercases and trims the domain before resolving', async () => {
    mockResolveMx.mockResolvedValue([{ exchange: 'mx.ulb.gov.in', priority: 10 }]);

    await service.domainHasMxRecord('commissioner@ULB.GOV.IN ');
    expect(mockResolveMx).toHaveBeenCalledWith('ulb.gov.in');
  });
});
