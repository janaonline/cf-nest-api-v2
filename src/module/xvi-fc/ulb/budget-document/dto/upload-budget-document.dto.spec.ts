import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Types } from 'mongoose';
import { MAX_BUDGET_DOCUMENT_FILE_SIZE_KB, UploadBudgetDocumentDto } from './upload-budget-document.dto';

type TestPayload = Record<string, any>;

const validPayload = (): TestPayload => ({
  designYearId: new Types.ObjectId().toString(),
  originalName: 'Budget-2026-27.pdf',
  sizeKb: 512,
  s3Key: 'budgets/2026-27/Budget-2026-27_abc123.pdf',
});

const validatePayload = (payload: Record<string, unknown>) => {
  const dto = plainToInstance(UploadBudgetDocumentDto, payload);
  return validateSync(dto, { whitelist: true, forbidNonWhitelisted: true });
};

const errorProperties = (payload: Record<string, unknown>) => validatePayload(payload).map((error) => error.property);

describe('UploadBudgetDocumentDto', () => {
  it('passes for a valid payload', () => {
    expect(validatePayload(validPayload())).toHaveLength(0);
  });

  it('fails for an invalid designYearId', () => {
    expect(errorProperties({ ...validPayload(), designYearId: 'not-object-id' })).toContain('designYearId');
  });

  it('fails for a missing originalName', () => {
    expect(errorProperties({ ...validPayload(), originalName: '' })).toContain('originalName');
  });

  it('fails for sizeKb over the max', () => {
    expect(
      errorProperties({ ...validPayload(), sizeKb: MAX_BUDGET_DOCUMENT_FILE_SIZE_KB + 1 }),
    ).toContain('sizeKb');
  });

  it('fails for a s3Key with a querystring', () => {
    expect(errorProperties({ ...validPayload(), s3Key: `${validPayload().s3Key}?X-Amz-Signature=x` })).toContain(
      's3Key',
    );
  });

  it('fails for a s3Key that is a full URL', () => {
    expect(errorProperties({ ...validPayload(), s3Key: 'https://bucket.s3.amazonaws.com/budgets/2026-27/x.pdf' })).toContain(
      's3Key',
    );
  });

  it('fails for a s3Key not under budgets/<year>/', () => {
    expect(
      errorProperties({ ...validPayload(), s3Key: 'xvi-fc/bank-account/some/other/path.pdf' }),
    ).toContain('s3Key');
  });

  it('fails for a s3Key not ending in .pdf', () => {
    expect(errorProperties({ ...validPayload(), s3Key: 'budgets/2026-27/Budget-2026-27_abc123.jpg' })).toContain(
      's3Key',
    );
  });
});
