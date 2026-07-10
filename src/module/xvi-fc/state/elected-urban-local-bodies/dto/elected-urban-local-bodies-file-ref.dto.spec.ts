import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidatorOptions } from 'class-validator';
import { FinalSubmitElectedUrbanLocalBodiesDto } from './final-submit-elected-urban-local-bodies.dto';
import { SaveElectedUrbanLocalBodiesDraftDto } from './save-elected-urban-local-bodies-draft.dto';
import { SubmitEulbPostSubmissionUpdateDto } from './submit-eulb-post-submission-update.dto';
import { ValidateElectedUrbanLocalBodiesExcelDto } from './validate-elected-urban-local-bodies-excel.dto';

// Mirrors the global ValidationPipe options in src/main.ts
const PIPE_OPTIONS: ValidatorOptions = { whitelist: true, forbidNonWhitelisted: true };

const STATE_ID = '65f000000000000000000001';
const YEAR_ID = '65f000000000000000000002';
const ROW_ID = '65f000000000000000000003';

function buildFileRef(pageCount?: unknown): Record<string, unknown> {
  const file: Record<string, unknown> = {
    fileName: 'elected-body.xlsx',
    fileUrl: 'state/elected-body/elected-body.xlsx',
    fileSize: 1024,
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    s3Key: 'state/elected-body/elected-body.xlsx',
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

describe('EULB file-ref DTOs — pageCount', () => {
  describe('ValidateElectedUrbanLocalBodiesExcelDto (electedBodyExcelFile)', () => {
    const build = (pageCount?: unknown) =>
      plainToInstance(ValidateElectedUrbanLocalBodiesExcelDto, {
        stateId: STATE_ID,
        yearId: YEAR_ID,
        electedBodyExcelFile: buildFileRef(pageCount),
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

  describe('SaveElectedUrbanLocalBodiesDraftDto (data.electedBodyExcelFile)', () => {
    const build = (pageCount?: unknown) =>
      plainToInstance(SaveElectedUrbanLocalBodiesDraftDto, {
        stateId: STATE_ID,
        yearId: YEAR_ID,
        data: { electedBodyExcelFile: buildFileRef(pageCount), checkboxConfirmation: true },
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

  describe('FinalSubmitElectedUrbanLocalBodiesDto (data.electedBodyExcelFile)', () => {
    const build = (pageCount?: unknown) =>
      plainToInstance(FinalSubmitElectedUrbanLocalBodiesDto, {
        stateId: STATE_ID,
        yearId: YEAR_ID,
        data: { electedBodyExcelFile: buildFileRef(pageCount), checkboxConfirmation: true },
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

  describe('SubmitEulbPostSubmissionUpdateDto (document)', () => {
    const build = (pageCount?: unknown) => {
      const document: Record<string, unknown> = {
        fileName: 'proof.pdf',
        fileUrl: 'state/elected-body/proof.pdf',
        fileSize: 2048,
        mimeType: 'application/pdf',
        s3Key: 'state/elected-body/proof.pdf',
      };
      if (pageCount !== undefined) document['pageCount'] = pageCount;
      return plainToInstance(SubmitEulbPostSubmissionUpdateDto, {
        rows: [{ rowId: ROW_ID, electedBodyStatus: 'Constituted' }],
        document,
      });
    };

    it('accepts a PDF pageCount: 5', async () => {
      expect(await validate(build(5), PIPE_OPTIONS)).toHaveLength(0);
    });

    it('accepts pageCount: null', async () => {
      expect(await validate(build(null), PIPE_OPTIONS)).toHaveLength(0);
    });

    it('accepts a missing pageCount (backward compatible)', async () => {
      expect(await validate(build(), PIPE_OPTIONS)).toHaveLength(0);
    });

    it('rejects pageCount as a string', async () => {
      expect(allMessages(await validate(build('5'), PIPE_OPTIONS)).join(' ')).toContain('pageCount');
    });

    it('rejects a negative pageCount', async () => {
      expect(allMessages(await validate(build(-1), PIPE_OPTIONS)).join(' ')).toContain('pageCount');
    });
  });
});
