import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Types } from 'mongoose';
import {
  MAX_BANK_ACCOUNT_PROOF_FILE_SIZE_BYTES,
  SubmitXviFcBankAccountDto,
} from './submit-xvi-fc-bank-account.dto';

const validPayload = () => ({
  ulbId: new Types.ObjectId().toString(),
  designYearId: new Types.ObjectId().toString(),
  ifscCode: 'SBIN0123456',
  accountNumber: '123456789012',
  confirmAccountNumber: '123456789012',
  bankDetails: {
    name: 'State Bank of India',
    branch: 'Main Branch',
    address: 'MG Road',
    city: 'Bhopal',
    state: 'Madhya Pradesh',
    micr: null,
  },
  proof: {
    fileName: 'cancelled-cheque.pdf',
    fileUrl: 'https://bucket.s3.amazonaws.com/proof/cancelled-cheque.pdf',
    fileSize: 1024,
    mimeType: 'application/pdf',
  },
});

const validatePayload = (payload: Record<string, unknown>) => {
  const dto = plainToInstance(SubmitXviFcBankAccountDto, payload);
  return validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
};

const errorProperties = (payload: Record<string, unknown>) => validatePayload(payload).map((error) => error.property);

describe('SubmitXviFcBankAccountDto', () => {
  it('passes for a valid payload with SFC-style proof object', () => {
    const errors = validatePayload(validPayload());

    expect(errors).toHaveLength(0);
  });

  it('fails for an invalid ulbId', () => {
    expect(errorProperties({ ...validPayload(), ulbId: 'not-object-id' })).toContain('ulbId');
  });

  it('fails for an invalid designYearId', () => {
    expect(errorProperties({ ...validPayload(), designYearId: 'not-object-id' })).toContain('designYearId');
  });

  it('transforms lowercase IFSC to uppercase', () => {
    const dto = plainToInstance(SubmitXviFcBankAccountDto, {
      ...validPayload(),
      ifscCode: ' sbin0123456 ',
    });

    const errors = validateSync(dto);

    expect(errors).toHaveLength(0);
    expect(dto.ifscCode).toBe('SBIN0123456');
  });

  it('fails for an invalid IFSC', () => {
    expect(errorProperties({ ...validPayload(), ifscCode: 'SBIN1234567' })).toContain('ifscCode');
  });

  it('fails when account number contains alphabets', () => {
    expect(errorProperties({ ...validPayload(), accountNumber: '12345ABC9012' })).toContain('accountNumber');
  });

  it('fails when account number contains spaces', () => {
    expect(errorProperties({ ...validPayload(), accountNumber: '12345 789012' })).toContain('accountNumber');
  });

  it('fails when account number is below 9 digits', () => {
    expect(errorProperties({ ...validPayload(), accountNumber: '12345678' })).toContain('accountNumber');
  });

  it('fails when account number is above 18 digits', () => {
    expect(errorProperties({ ...validPayload(), accountNumber: '1234567890123456789' })).toContain('accountNumber');
  });

  it('fails when confirmAccountNumber does not match accountNumber', () => {
    expect(errorProperties({ ...validPayload(), confirmAccountNumber: '987654321098' })).toContain(
      'confirmAccountNumber',
    );
  });

  it('fails when bankDetails is missing', () => {
    const payload = validPayload();
    delete (payload as Partial<ReturnType<typeof validPayload>>).bankDetails;

    expect(errorProperties(payload)).toContain('bankDetails');
  });

  it('fails when proof is missing', () => {
    const payload = validPayload();
    delete (payload as Partial<ReturnType<typeof validPayload>>).proof;

    expect(errorProperties(payload)).toContain('proof');
  });

  it('fails for unsupported proof MIME type', () => {
    const payload = validPayload();
    payload.proof.mimeType = 'image/gif';

    expect(errorProperties(payload)).toContain('proof');
  });

  it('fails when proof is over 5 MB', () => {
    const payload = validPayload();
    payload.proof.fileSize = MAX_BANK_ACCOUNT_PROOF_FILE_SIZE_BYTES + 1;

    expect(errorProperties(payload)).toContain('proof');
  });

  it('rejects legacy proof fields', () => {
    const payload = {
      ...validPayload(),
      proof: {
        filepath: 'xvi-fc/legacy.pdf',
        originalName: 'legacy.pdf',
        sizeKb: 12,
        mimeType: 'application/pdf',
      },
    };

    expect(errorProperties(payload)).toContain('proof');
  });
});
