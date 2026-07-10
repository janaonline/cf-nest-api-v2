import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidatorOptions } from 'class-validator';
import { FinalSubmitDevolutionFormulaDto } from './final-submit-devolution-formula.dto';
import { SaveDraftDevolutionFormulaDto } from './save-draft-devolution-formula.dto';
import { ValidateExcelDevolutionFormulaDto } from './validate-excel-devolution-formula.dto';

// Mirrors the global ValidationPipe options in src/main.ts
const PIPE_OPTIONS: ValidatorOptions = { whitelist: true, forbidNonWhitelisted: true };

const STATE_ID = '65f000000000000000000001';
const YEAR_ID = '65f000000000000000000002';

function buildFileRef(pageCount?: unknown): Record<string, unknown> {
  const file: Record<string, unknown> = {
    fileName: 'devolution.xlsx',
    fileUrl: 'state/devolution/devolution.xlsx',
    fileSize: 1024,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    s3Key: 'state/devolution/devolution.xlsx',
  };
  if (pageCount !== undefined) file['pageCount'] = pageCount;
  return file;
}

/** Flattens nested validation errors into their constraint messages. */
function allMessages(errors: Awaited<ReturnType<typeof validate>>): string[] {
  const messages: string[] = [];
  const walk = (errs: typeof errors): void => {
    for (const err of errs) {
      if (err.constraints) messages.push(...Object.values(err.constraints));
      if (err.children?.length) walk(err.children);
    }
  };
  walk(errors);
  return messages;
}

describe('Devolution Formula file-ref DTOs — pageCount', () => {
  describe('ValidateExcelDevolutionFormulaDto (excelFile)', () => {
    const build = (pageCount?: unknown) =>
      plainToInstance(ValidateExcelDevolutionFormulaDto, {
        stateId: STATE_ID,
        yearId: YEAR_ID,
        installment: 1,
        excelFile: buildFileRef(pageCount),
      });

    it('accepts pageCount: null', async () => {
      expect(await validate(build(null), PIPE_OPTIONS)).toHaveLength(0);
    });

    it('accepts pageCount: 3', async () => {
      expect(await validate(build(3), PIPE_OPTIONS)).toHaveLength(0);
    });

    it('accepts a missing pageCount (backward compatible)', async () => {
      expect(await validate(build(), PIPE_OPTIONS)).toHaveLength(0);
    });

    it('does not report "property pageCount should not exist"', async () => {
      const errors = await validate(build(null), PIPE_OPTIONS);
      expect(allMessages(errors).join(' ')).not.toContain('property pageCount should not exist');
    });

    it('rejects pageCount as a string', async () => {
      expect(allMessages(await validate(build('3'), PIPE_OPTIONS)).join(' ')).toContain('pageCount');
    });

    it('rejects a negative pageCount', async () => {
      expect(allMessages(await validate(build(-1), PIPE_OPTIONS)).join(' ')).toContain('pageCount');
    });

    it('rejects a non-integer pageCount', async () => {
      expect(allMessages(await validate(build(2.5), PIPE_OPTIONS)).join(' ')).toContain('pageCount');
    });
  });

  describe('SaveDraftDevolutionFormulaDto (data.excelFile)', () => {
    const build = (pageCount?: unknown) =>
      plainToInstance(SaveDraftDevolutionFormulaDto, {
        stateId: STATE_ID,
        yearId: YEAR_ID,
        installment: 1,
        data: { excelFile: buildFileRef(pageCount), checkboxConfirmation: true },
      });

    it('accepts pageCount: null', async () => {
      expect(await validate(build(null), PIPE_OPTIONS)).toHaveLength(0);
    });

    it('accepts pageCount: 3', async () => {
      expect(await validate(build(3), PIPE_OPTIONS)).toHaveLength(0);
    });

    it('accepts a missing pageCount (backward compatible)', async () => {
      expect(await validate(build(), PIPE_OPTIONS)).toHaveLength(0);
    });

    it('rejects pageCount as a string', async () => {
      expect(allMessages(await validate(build('3'), PIPE_OPTIONS)).join(' ')).toContain('pageCount');
    });
  });

  describe('FinalSubmitDevolutionFormulaDto (data.excelFile)', () => {
    const build = (pageCount?: unknown) =>
      plainToInstance(FinalSubmitDevolutionFormulaDto, {
        stateId: STATE_ID,
        yearId: YEAR_ID,
        installment: 1,
        data: { excelFile: buildFileRef(pageCount), checkboxConfirmation: true },
      });

    it('accepts pageCount: null', async () => {
      expect(await validate(build(null), PIPE_OPTIONS)).toHaveLength(0);
    });

    it('accepts pageCount: 3', async () => {
      expect(await validate(build(3), PIPE_OPTIONS)).toHaveLength(0);
    });

    it('accepts a missing pageCount (backward compatible)', async () => {
      expect(await validate(build(), PIPE_OPTIONS)).toHaveLength(0);
    });

    it('rejects a negative pageCount', async () => {
      expect(allMessages(await validate(build(-1), PIPE_OPTIONS)).join(' ')).toContain('pageCount');
    });
  });
});
