import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface FileDownloadPayload {
  path: string;
  exp?: number;
  disposition?: string;
}

export type TokenError = { type: 'invalid' | 'expired' | 'tampered' };

@Injectable()
export class FileTokenService {
  private readonly key: Buffer;
  private readonly baseUrl: string;

  constructor(cfg: ConfigService) {
    const secret = cfg.get<string>('JWT_SECRET');
    if (!secret) throw new Error('SECRET env variable is not set for FileTokenService');
    this.key = crypto.createHash('sha256').update(secret).digest();
    this.baseUrl = cfg.get<string>('BASE_URL', '');
  }

  signFileUrl(url: string): string {
    if (!url) return url;
    const token = this.createToken({ path: url, disposition: 'attachment' });
    return `${this.baseUrl}file/download?signature=${token}`;
  }

  createToken(payload: FileDownloadPayload): string {
    payload.exp = payload.exp || Date.now() + 24 * 60 * 1000; // default 24 hours expiry
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, this.key, iv);
    const pt = JSON.stringify(payload);
    const encrypted = Buffer.concat([cipher.update(pt, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64url');
  }

  parseToken(token: string): FileDownloadPayload {
    if (!token || typeof token !== 'string') throw { type: 'invalid' } as TokenError;

    let buf: Buffer;
    try {
      buf = Buffer.from(token, 'base64url');
    } catch {
      throw { type: 'invalid' } as TokenError;
    }

    if (buf.length <= IV_BYTES + TAG_BYTES) throw { type: 'invalid' } as TokenError;

    const iv = buf.subarray(0, IV_BYTES);
    const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = buf.subarray(IV_BYTES + TAG_BYTES);

    let plaintext: string;
    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, this.key, iv);
      decipher.setAuthTag(tag);
      plaintext = decipher.update(ciphertext, undefined, 'utf8') + decipher.final('utf8');
    } catch {
      throw { type: 'tampered' } as TokenError;
    }

    let payload: FileDownloadPayload;
    try {
      payload = JSON.parse(plaintext);
    } catch {
      throw { type: 'invalid' } as TokenError;
    }

    if (!payload.path || typeof payload.exp !== 'number') throw { type: 'invalid' } as TokenError;
    if (Date.now() > payload.exp) throw { type: 'expired' } as TokenError;

    return payload;
  }
}
