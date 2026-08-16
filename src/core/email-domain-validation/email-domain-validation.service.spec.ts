import { resolveMx } from 'dns/promises';
import { EmailDomainValidationService } from './email-domain-validation.service';

jest.mock('dns/promises', () => ({ resolveMx: jest.fn() }));

describe('EmailDomainValidationService', () => {
  let service: EmailDomainValidationService;
  const mockResolveMx = resolveMx as jest.Mock;

  beforeEach(() => {
    service = new EmailDomainValidationService();
    mockResolveMx.mockReset();
  });

  it('returns true when the domain resolves at least one MX record', async () => {
    mockResolveMx.mockResolvedValue([{ exchange: 'mx.ulb.gov.in', priority: 10 }]);

    await expect(service.domainHasMxRecord('commissioner@ulb.gov.in')).resolves.toBe(true);
    expect(mockResolveMx).toHaveBeenCalledWith('ulb.gov.in');
  });

  it('returns false when the domain resolves no MX records', async () => {
    mockResolveMx.mockResolvedValue([]);

    await expect(service.domainHasMxRecord('commissioner@ulb.gov.in')).resolves.toBe(false);
  });

  it('returns false when the DNS lookup rejects (e.g. NXDOMAIN)', async () => {
    mockResolveMx.mockRejectedValue(new Error('queryMx ENOTFOUND ulb.gvo.in'));

    await expect(service.domainHasMxRecord('commissioner@ulb.gvo.in')).resolves.toBe(false);
  });

  it('returns false without querying DNS when the email has no domain part', async () => {
    await expect(service.domainHasMxRecord('not-an-email')).resolves.toBe(false);
    expect(mockResolveMx).not.toHaveBeenCalled();
  });

  it('lowercases and trims the domain before resolving', async () => {
    mockResolveMx.mockResolvedValue([{ exchange: 'mx.ulb.gov.in', priority: 10 }]);

    await service.domainHasMxRecord('commissioner@ULB.GOV.IN ');
    expect(mockResolveMx).toHaveBeenCalledWith('ulb.gov.in');
  });
});
