import type { FieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';
import { XVI_FC_FOLDER_PATH_KEYS } from './xvi-fc-folder-path.constants';
import {
  buildXviFcFolderPath,
  resolveXviFcFolderPathsInFormJson,
  type XviFcFolderPathContext,
} from './xvi-fc-folder-path.resolver';

const BASE_CONTEXT: XviFcFolderPathContext = {
  _id: '5dcf9d7416a06aed41c748f0',
  role: 'state',
  designYear: '2026-27',
};

// ─── buildXviFcFolderPath ─────────────────────────────────────────────────────

describe('buildXviFcFolderPath', () => {
  it('builds SFC extension order path', () => {
    expect(buildXviFcFolderPath(XVI_FC_FOLDER_PATH_KEYS.SFC_EXTENSION_ORDER, BASE_CONTEXT)).toBe(
      'xvi-fc/state/5dcf9d7416a06aed41c748f0/2026-27/sfc-status/extension-order',
    );
  });

  it('builds SFC report path', () => {
    expect(buildXviFcFolderPath(XVI_FC_FOLDER_PATH_KEYS.SFC_REPORT, BASE_CONTEXT)).toBe(
      'xvi-fc/state/5dcf9d7416a06aed41c748f0/2026-27/sfc-status/sfc-report',
    );
  });

  it('builds SFC ATR report path', () => {
    expect(buildXviFcFolderPath(XVI_FC_FOLDER_PATH_KEYS.SFC_ATR_REPORT, BASE_CONTEXT)).toBe(
      'xvi-fc/state/5dcf9d7416a06aed41c748f0/2026-27/sfc-status/atr-report',
    );
  });

  it('builds SFC gazette notification path', () => {
    expect(buildXviFcFolderPath(XVI_FC_FOLDER_PATH_KEYS.SFC_GAZETTE_NOTIFICATION, BASE_CONTEXT)).toBe(
      'xvi-fc/state/5dcf9d7416a06aed41c748f0/2026-27/sfc-status/gazette-notification',
    );
  });

  it('builds EULB Excel path as elected-body/elected-bodies-list (not elected-body-excels)', () => {
    const result = buildXviFcFolderPath(XVI_FC_FOLDER_PATH_KEYS.EULB_EXCEL, BASE_CONTEXT);
    expect(result).toBe('xvi-fc/state/5dcf9d7416a06aed41c748f0/2026-27/elected-body/elected-bodies-list');
    expect(result).not.toContain('elected-body-excels');
  });

  it('builds EULB post-submission proof path without batchId', () => {
    expect(buildXviFcFolderPath(XVI_FC_FOLDER_PATH_KEYS.EULB_POST_SUBMISSION_PROOF, BASE_CONTEXT)).toBe(
      'xvi-fc/state/5dcf9d7416a06aed41c748f0/2026-27/elected-body/post-submission-update',
    );
  });

  it('builds EULB post-submission proof path with batchId', () => {
    const ctx: XviFcFolderPathContext = { ...BASE_CONTEXT, batchId: 'batch-abc-123' };
    expect(buildXviFcFolderPath(XVI_FC_FOLDER_PATH_KEYS.EULB_POST_SUBMISSION_PROOF, ctx)).toBe(
      'xvi-fc/state/5dcf9d7416a06aed41c748f0/2026-27/elected-body/post-submission-update/batch-abc-123/document',
    );
  });

  it('builds path with dynamic role and id', () => {
    const ctx: XviFcFolderPathContext = { ...BASE_CONTEXT, _id: 'ulb-123', role: 'ulb' };
    expect(buildXviFcFolderPath(XVI_FC_FOLDER_PATH_KEYS.SFC_REPORT, ctx)).toBe(
      'xvi-fc/ulb/ulb-123/2026-27/sfc-status/sfc-report',
    );
  });

  it('throws for empty _id', () => {
    expect(() => buildXviFcFolderPath(XVI_FC_FOLDER_PATH_KEYS.SFC_REPORT, { ...BASE_CONTEXT, _id: '' })).toThrow(
      'id is required',
    );
  });

  it('throws for empty designYear', () => {
    expect(() => buildXviFcFolderPath(XVI_FC_FOLDER_PATH_KEYS.SFC_REPORT, { ...BASE_CONTEXT, designYear: '' })).toThrow(
      'designYear is required',
    );
  });

  it('throws for an unsupported folderPathKey', () => {
    expect(() => buildXviFcFolderPath('UNKNOWN_KEY' as never, BASE_CONTEXT)).toThrow(
      'Unsupported XVI-FC folder path key',
    );
  });
});

// ─── resolveXviFcFolderPathsInFormJson ───────────────────────────────────────

describe('resolveXviFcFolderPathsInFormJson', () => {
  const fileFieldWithKey: FieldConfig = {
    formFieldType: 'file',
    key: 'sfcReport',
    label: 'SFC Report',
    folderPathKey: XVI_FC_FOLDER_PATH_KEYS.SFC_REPORT,
    folderPath: 'xvi-fc/state/2026-27/sfc-status/sfc-report',
  };

  const fileFieldWithoutKey: FieldConfig = {
    formFieldType: 'file',
    key: 'legacyFile',
    label: 'Legacy File',
    folderPath: 'xvi-fc/state/2026-27/sfc-status/legacy',
  };

  const textField: FieldConfig = {
    formFieldType: 'text',
    key: 'stateName',
    label: 'State Name',
    value: 'Karnataka',
    validations: [{ name: 'required', validator: null, message: 'Required' }],
    visibleWhen: { mode: 'all', conditions: [] },
  };

  it('resolves file fields that have folderPathKey, overriding the static folderPath', () => {
    const result = resolveXviFcFolderPathsInFormJson([fileFieldWithKey], BASE_CONTEXT);
    expect(result[0].folderPath).toBe('xvi-fc/state/5dcf9d7416a06aed41c748f0/2026-27/sfc-status/sfc-report');
  });

  it('preserves existing static folderPath when folderPathKey is absent', () => {
    const result = resolveXviFcFolderPathsInFormJson([fileFieldWithoutKey], BASE_CONTEXT);
    expect(result[0].folderPath).toBe('xvi-fc/state/2026-27/sfc-status/legacy');
  });

  it('does not alter non-file fields', () => {
    const result = resolveXviFcFolderPathsInFormJson([textField], BASE_CONTEXT);
    expect(result[0]).toEqual({ ...textField });
    expect(result[0].formFieldType).toBe('text');
  });

  it('does not remove value, validations, visibleWhen, or other properties from any field', () => {
    const fields: FieldConfig[] = [textField, fileFieldWithKey];
    const result = resolveXviFcFolderPathsInFormJson(fields, BASE_CONTEXT);

    const resolvedText = result[0];
    expect(resolvedText.value).toBe('Karnataka');
    expect(resolvedText.validations).toEqual(textField.validations);
    expect(resolvedText.visibleWhen).toEqual(textField.visibleWhen);

    const resolvedFile = result[1];
    expect(resolvedFile.key).toBe('sfcReport');
    expect(resolvedFile.label).toBe('SFC Report');
    expect(resolvedFile.folderPathKey).toBe(XVI_FC_FOLDER_PATH_KEYS.SFC_REPORT);
  });

  it('does not mutate the input fields array', () => {
    const fields: FieldConfig[] = [{ ...fileFieldWithKey }];
    const originalFolderPath = fields[0].folderPath;
    resolveXviFcFolderPathsInFormJson(fields, BASE_CONTEXT);
    expect(fields[0].folderPath).toBe(originalFolderPath);
  });

  it('returns correct resolved paths for all configured keys in a mixed array', () => {
    const allFileFields: FieldConfig[] = Object.values(XVI_FC_FOLDER_PATH_KEYS).map((k) => ({
      formFieldType: 'file' as const,
      key: k,
      label: k,
      folderPathKey: k,
    }));

    const result = resolveXviFcFolderPathsInFormJson(allFileFields, BASE_CONTEXT);

    expect(result.find((f) => f.key === 'SFC_EXTENSION_ORDER')?.folderPath).toBe(
      'xvi-fc/state/5dcf9d7416a06aed41c748f0/2026-27/sfc-status/extension-order',
    );
    expect(result.find((f) => f.key === 'EULB_EXCEL')?.folderPath).toBe(
      'xvi-fc/state/5dcf9d7416a06aed41c748f0/2026-27/elected-body/elected-bodies-list',
    );
    expect(result.find((f) => f.key === 'EULB_POST_SUBMISSION_PROOF')?.folderPath).toBe(
      'xvi-fc/state/5dcf9d7416a06aed41c748f0/2026-27/elected-body/post-submission-update',
    );
  });
});
