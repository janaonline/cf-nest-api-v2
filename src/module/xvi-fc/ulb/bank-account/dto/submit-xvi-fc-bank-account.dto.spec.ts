import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Types } from 'mongoose';
import {
  MAX_BANK_ACCOUNT_PROOF_FILE_SIZE_KB,
  SubmitXviFcBankAccountDto,
} from './submit-xvi-fc-bank-account.dto';

const validSha256 = 'a'.repeat(64);

type TestPayload = Record<string, any>;

const validPayload = (): TestPayload => ({
  ulbId: new Types.ObjectId().toString(),
  stateId: new Types.ObjectId().toString(),
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
  proofFile: {
    originalName: 'cancelled-cheque.pdf',
    mimeType: 'application/pdf',
    pages: 2,
    sizeKb: 12.25,
    s3Key: 'xvi-fc/bank-account/66/67/proof/cancelled-cheque.pdf',
    sha256: validSha256,
  },
});

const validatePayload = (payload: Record<string, unknown>) => {
  const dto = plainToInstance(SubmitXviFcBankAccountDto, payload);
  return validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
};

const errorProperties = (payload: Record<string, unknown>) => validatePayload(payload).map((error) => error.property);

describe('SubmitXviFcBankAccountDto', () => {
  it('passes for a valid PDF proofFile with pages', () => {
    expect(validatePayload(validPayload())).toHaveLength(0);
  });

  it('passes for a valid image proofFile with null pages', () => {
    const payload = validPayload();
    payload.proofFile = {
      ...payload.proofFile,
      originalName: 'cancelled-cheque.jpeg',
      mimeType: 'image/jpeg',
      pages: null,
      s3Key: 'xvi-fc/bank-account/66/67/proof/cancelled-cheque.jpeg',
    };

    expect(validatePayload(payload)).toHaveLength(0);
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

  it('fails when proofFile is missing', () => {
    const payload = validPayload();
    delete (payload as Partial<ReturnType<typeof validPayload>>).proofFile;

    expect(errorProperties(payload)).toContain('proofFile');
  });

  it('rejects legacy proof object', () => {
    const payload = {
      ...validPayload(),
      proof: {
        fileName: 'proof.pdf',
        fileUrl: 'xvi-fc/bank-account/66/67/proof/proof.pdf',
        fileSize: 1024,
        mimeType: 'application/pdf',
      },
    };

    expect(errorProperties(payload)).toContain('proof');
  });

  it('fails when originalName is missing', () => {
    const payload = validPayload();
    delete (payload.proofFile as Partial<typeof payload.proofFile>).originalName;

    expect(errorProperties(payload)).toContain('proofFile');
  });

  it('fails for unsupported proofFile MIME type', () => {
    const payload = validPayload();
    payload.proofFile.mimeType = 'image/gif';

    expect(errorProperties(payload)).toContain('proofFile');
  });

  it('fails when PDF pages is null', () => {
    const payload = validPayload();
    payload.proofFile.pages = null;

    expect(errorProperties(payload)).toContain('proofFile');
  });

  it('fails when image pages is not null', () => {
    const payload = validPayload();
    payload.proofFile.mimeType = 'image/png';
    payload.proofFile.pages = 1;

    expect(errorProperties(payload)).toContain('proofFile');
  });

  it('fails when proofFile is over 5120 KB', () => {
    const payload = validPayload();
    payload.proofFile.sizeKb = MAX_BANK_ACCOUNT_PROOF_FILE_SIZE_KB + 0.01;

    expect(errorProperties(payload)).toContain('proofFile');
  });

  it('fails for invalid sha256', () => {
    const payload = validPayload();
    payload.proofFile.sha256 = 'not-a-sha';

    expect(errorProperties(payload)).toContain('proofFile');
  });

  it('fails for a full URL in s3Key', () => {
    const payload = validPayload();
    payload.proofFile.s3Key = 'https://bucket.s3.amazonaws.com/xvi-fc/bank-account/66/67/proof/proof.pdf';

    expect(errorProperties(payload)).toContain('proofFile');
  });

  it('fails for a signed URL query string in s3Key', () => {
    const payload = validPayload();
    payload.proofFile.s3Key = 'xvi-fc/bank-account/66/67/proof/proof.pdf?X-Amz-Signature=secret';

    expect(errorProperties(payload)).toContain('proofFile');
  });
});
