import type { ConfigService } from '@nestjs/config';
import { FileTokenService } from './file-token.service';

function buildService(env: Record<string, string> = {}): FileTokenService {
  const config = {
    get: (key: string, defaultValue?: string) => env[key] ?? defaultValue,
  } as ConfigService;
  return new FileTokenService(config);
}

describe('FileTokenService', () => {
  const service = buildService({ JWT_SECRET: 'test-secret', BASE_URL: 'https://app.example.com/' });

  describe('signFileUrl', () => {
    it('defaults to attachment disposition when none is passed', () => {
      const url = service.signFileUrl('state/foo/bar.pdf');
      const signature = new URL(url).searchParams.get('signature')!;
      expect(service.parseToken(signature).disposition).toBe('attachment');
    });

    it('honors an explicit inline override', () => {
      const url = service.signFileUrl('state/foo/bar.pdf', 'inline');
      const signature = new URL(url).searchParams.get('signature')!;
      expect(service.parseToken(signature).disposition).toBe('inline');
    });

    it('returns an empty/falsy url unchanged without signing', () => {
      expect(service.signFileUrl('')).toBe('');
    });
  });

  describe('createToken / parseToken', () => {
    it('round-trips the path, disposition, and expiry unchanged', () => {
      const exp = Date.now() + 60_000;
      const token = service.createToken({ path: 'a/b/c.pdf', disposition: 'inline', exp });
      const payload = service.parseToken(token);
      expect(payload).toEqual({ path: 'a/b/c.pdf', disposition: 'inline', exp });
    });

    it('rejects an expired token', () => {
      const token = service.createToken({ path: 'a/b/c.pdf', exp: Date.now() - 1000 });
      expect(() => service.parseToken(token)).toThrow(expect.objectContaining({ type: 'expired' }) as unknown as Error);
    });

    it('rejects a tampered token', () => {
      const token = service.createToken({ path: 'a/b/c.pdf' });
      const tampered = token.slice(0, -2) + (token.slice(-2) === 'AA' ? 'BB' : 'AA');
      expect(() => service.parseToken(tampered)).toThrow();
    });
  });
});
