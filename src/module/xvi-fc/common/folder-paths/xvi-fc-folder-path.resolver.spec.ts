import type { FieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';
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
    expect(buildXviFcFolderPath('sfc-status/extension-order', BASE_CONTEXT)).toBe(
      'xvi-fc/state/5dcf9d7416a06aed41c748f0/2026-27/sfc-status/extension-order',
    );
  });

  it('builds SFC report path', () => {
    expect(buildXviFcFolderPath('sfc-status/sfc-report', BASE_CONTEXT)).toBe(
      'xvi-fc/state/5dcf9d7416a06aed41c748f0/2026-27/sfc-status/sfc-report',
    );
  });

  it('builds SFC ATR report path', () => {
    expect(buildXviFcFolderPath('sfc-status/atr-report', BASE_CONTEXT)).toBe(
      'xvi-fc/state/5dcf9d7416a06aed41c748f0/2026-27/sfc-status/atr-report',
    );
  });

  it('builds SFC gazette notification path', () => {
    expect(buildXviFcFolderPath('sfc-status/gazette-notification', BASE_CONTEXT)).toBe(
      'xvi-fc/state/5dcf9d7416a06aed41c748f0/2026-27/sfc-status/gazette-notification',
    );
  });

  it('builds EULB Excel path', () => {
    expect(buildXviFcFolderPath('elected-body/excels', BASE_CONTEXT)).toBe(
      'xvi-fc/state/5dcf9d7416a06aed41c748f0/2026-27/elected-body/excels',
    );
  });

  it('builds EULB post-submission proof path without batchId', () => {
    expect(buildXviFcFolderPath('elected-body/post-submission-update', BASE_CONTEXT)).toBe(
      'xvi-fc/state/5dcf9d7416a06aed41c748f0/2026-27/elected-body/post-submission-update',
    );
  });

  it('appends batchId/document suffix when batchId is in context', () => {
    const ctx: XviFcFolderPathContext = { ...BASE_CONTEXT, batchId: 'batch-abc-123' };
    expect(buildXviFcFolderPath('elected-body/post-submission-update', ctx)).toBe(
      'xvi-fc/state/5dcf9d7416a06aed41c748f0/2026-27/elected-body/post-submission-update/batch-abc-123/document',
    );
  });

  it('builds path with dynamic role in basePrefix', () => {
    const ctx: XviFcFolderPathContext = { ...BASE_CONTEXT, _id: 'ulb-123', role: 'ulb' };
    expect(buildXviFcFolderPath('sfc-status/sfc-report', ctx)).toBe('xvi-fc/ulb/ulb-123/2026-27/sfc-status/sfc-report');
  });

  it('throws for empty _id', () => {
    expect(() => buildXviFcFolderPath('sfc-status/sfc-report', { ...BASE_CONTEXT, _id: '' })).toThrow(
      'entityId is required',
    );
  });

  it('throws for empty designYear', () => {
    expect(() => buildXviFcFolderPath('sfc-status/sfc-report', { ...BASE_CONTEXT, designYear: '' })).toThrow(
      'designYear is required',
    );
  });

  it('throws for empty subPath', () => {
    expect(() => buildXviFcFolderPath('', BASE_CONTEXT)).toThrow('subPath is required');
  });
});

// ─── resolveXviFcFolderPathsInFormJson ───────────────────────────────────────

describe('resolveXviFcFolderPathsInFormJson', () => {
  const fileFieldWithKey: FieldConfig = {
    formFieldType: 'file',
    key: 'sfcReport',
    label: 'SFC Report',
    folderPathKey: 'sfc-status/sfc-report',
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
    expect(resolvedFile.folderPathKey).toBe('sfc-status/sfc-report');
  });

  it('does not mutate the input fields array', () => {
    const fields: FieldConfig[] = [{ ...fileFieldWithKey }];
    const originalFolderPath = fields[0].folderPath;
    resolveXviFcFolderPathsInFormJson(fields, BASE_CONTEXT);
    expect(fields[0].folderPath).toBe(originalFolderPath);
  });

  it('returns correct resolved paths for all six subpaths in a mixed array', () => {
    const subPaths = [
      'sfc-status/extension-order',
      'sfc-status/sfc-report',
      'sfc-status/atr-report',
      'sfc-status/gazette-notification',
      'elected-body/excels',
      'elected-body/post-submission-update',
    ];

    const allFileFields: FieldConfig[] = subPaths.map((subPath) => ({
      formFieldType: 'file' as const,
      key: subPath,
      label: subPath,
      folderPathKey: subPath,
    }));

    const result = resolveXviFcFolderPathsInFormJson(allFileFields, BASE_CONTEXT);

    expect(result.find((f) => f.key === 'sfc-status/extension-order')?.folderPath).toBe(
      'xvi-fc/state/5dcf9d7416a06aed41c748f0/2026-27/sfc-status/extension-order',
    );
    expect(result.find((f) => f.key === 'elected-body/excels')?.folderPath).toBe(
      'xvi-fc/state/5dcf9d7416a06aed41c748f0/2026-27/elected-body/excels',
    );
    expect(result.find((f) => f.key === 'elected-body/post-submission-update')?.folderPath).toBe(
      'xvi-fc/state/5dcf9d7416a06aed41c748f0/2026-27/elected-body/post-submission-update',
    );
  });
});
