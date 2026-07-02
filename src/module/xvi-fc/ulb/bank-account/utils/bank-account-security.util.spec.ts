import { FORM_STATUS } from 'src/common/constants/form-status.constants';
import {
  buildSafeBankAccountResponse,
  decryptAccountNumber,
  encryptAccountNumber,
  getAccountNumberLast4,
  hashAccountNumber,
  maskAccountNumber,
} from './bank-account-security.util';

describe('bank-account-security.util', () => {
  const originalEncryptionKey = process.env.BANK_ACCOUNT_ENCRYPTION_KEY;
  const originalHashSecret = process.env.BANK_ACCOUNT_HASH_SECRET;

  beforeEach(() => {
    process.env.BANK_ACCOUNT_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
    process.env.BANK_ACCOUNT_HASH_SECRET = 'test-bank-account-hash-secret';
  });

  afterAll(() => {
    if (originalEncryptionKey === undefined) {
      delete process.env.BANK_ACCOUNT_ENCRYPTION_KEY;
    } else {
      process.env.BANK_ACCOUNT_ENCRYPTION_KEY = originalEncryptionKey;
    }

    if (originalHashSecret === undefined) {
      delete process.env.BANK_ACCOUNT_HASH_SECRET;
    } else {
      process.env.BANK_ACCOUNT_HASH_SECRET = originalHashSecret;
    }
  });

  it('masks all but the last four account-number digits', () => {
    expect(maskAccountNumber('123456789012')).toBe('********9012');
  });

  it('returns the last four account-number digits', () => {
    expect(getAccountNumberLast4('123456789012')).toBe('9012');
  });

  it('hashes account numbers deterministically', () => {
    const firstHash = hashAccountNumber('123456789012');
    const secondHash = hashAccountNumber('123456789012');

    expect(firstHash).toBe(secondHash);
    expect(firstHash).not.toBe('123456789012');
  });

  it('encrypts and decrypts account numbers', () => {
    const accountNumber = '123456789012';
    const encryptedValue = encryptAccountNumber(accountNumber);

    expect(encryptedValue).not.toBe(accountNumber);
    expect(decryptAccountNumber(encryptedValue)).toBe(accountNumber);
  });

  it('maps records to safe responses without encrypted, hash, or full account-number fields', () => {
    const response = buildSafeBankAccountResponse({
      _id: 'record-id',
      ulb: 'ulb-id',
      designYear: 'year-id',
      ifscCode: 'SBIN0123456',
      bankDetails: { name: 'State Bank of India' },
      accountNumber: '123456789012',
      accountNumberEncrypted: 'encrypted-value',
      accountNumberHash: 'hash-value',
      accountNumberMasked: '********9012',
      accountNumberLast4: '9012',
      proof: {
        fileName: 'proof.pdf',
        fileUrl: 's3://bucket/proof.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
      },
      currentFormStatus: FORM_STATUS.IN_PROGRESS,
      submittedBy: 'user-id',
      submittedAt: new Date('2026-01-01T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(response).toMatchObject({
      accountNumberMasked: '********9012',
      accountNumberLast4: '9012',
      currentFormStatus: FORM_STATUS.IN_PROGRESS,
      currentFormStatusLabel: 'In Progress',
    });
    expect(response).not.toHaveProperty('accountNumber');
    expect(response).not.toHaveProperty('accountNumberEncrypted');
    expect(response).not.toHaveProperty('accountNumberHash');
  });
});
