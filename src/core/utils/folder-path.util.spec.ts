import { buildModuleFolderPath, resolveFormJsonFolderPaths } from './folder-path.util';

const ENTITY_ID = '5dcf9d7416a06aed41c748f0';
const DESIGN_YEAR = '2026-27';

// ─── buildModuleFolderPath ────────────────────────────────────────────────────

describe('buildModuleFolderPath', () => {
  it('builds path from subPath, basePrefix, entityId, and designYear', () => {
    expect(buildModuleFolderPath('sfc-status/sfc-report', 'xvi-fc/state', ENTITY_ID, DESIGN_YEAR)).toBe(
      `xvi-fc/state/${ENTITY_ID}/${DESIGN_YEAR}/sfc-status/sfc-report`,
    );
  });

  it('works with a different basePrefix (e.g. xvi-fc/ulb)', () => {
    expect(buildModuleFolderPath('annual-accounts', 'xvi-fc/ulb', 'ulb-abc-123', DESIGN_YEAR)).toBe(
      `xvi-fc/ulb/ulb-abc-123/${DESIGN_YEAR}/annual-accounts`,
    );
  });

  it('throws for empty entityId', () => {
    expect(() => buildModuleFolderPath('sfc-status/sfc-report', 'xvi-fc/state', '', DESIGN_YEAR)).toThrow(
      'entityId is required',
    );
  });

  it('throws for empty designYear', () => {
    expect(() => buildModuleFolderPath('sfc-status/sfc-report', 'xvi-fc/state', ENTITY_ID, '')).toThrow(
      'designYear is required',
    );
  });

  it('throws for empty subPath', () => {
    expect(() => buildModuleFolderPath('', 'xvi-fc/state', ENTITY_ID, DESIGN_YEAR)).toThrow(
      'subPath is required',
    );
  });
});

// ─── resolveFormJsonFolderPaths ───────────────────────────────────────────────

describe('resolveFormJsonFolderPaths', () => {
  const buildFn = (subPath: string) => `xvi-fc/state/${ENTITY_ID}/${DESIGN_YEAR}/${subPath}`;

  it('resolves file field with folderPathKey', () => {
    const field = { formFieldType: 'file', key: 'sfcReport', label: 'SFC Report', folderPathKey: 'sfc-status/sfc-report' };
    const result = resolveFormJsonFolderPaths([field], buildFn);
    expect(result[0].folderPath).toBe(`xvi-fc/state/${ENTITY_ID}/${DESIGN_YEAR}/sfc-status/sfc-report`);
  });

  it('skips non-file fields', () => {
    const field = { formFieldType: 'text', key: 'name', label: 'Name', folderPathKey: 'some/path' };
    const result = resolveFormJsonFolderPaths([field], buildFn);
    expect(result[0].folderPath).toBeUndefined();
  });

  it('preserves existing folderPath when folderPathKey is absent', () => {
    const field = { formFieldType: 'file', key: 'doc', label: 'Doc', folderPath: 'static/path' };
    const result = resolveFormJsonFolderPaths([field], buildFn);
    expect(result[0].folderPath).toBe('static/path');
  });

  it('does not mutate the input array', () => {
    const field = { formFieldType: 'file', key: 'sfcReport', label: 'SFC Report', folderPathKey: 'sfc-status/sfc-report', folderPath: 'original' };
    resolveFormJsonFolderPaths([field], buildFn);
    expect(field.folderPath).toBe('original');
  });
});
