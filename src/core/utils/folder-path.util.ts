interface FormFieldWithPath {
  formFieldType: string;
  folderPathKey?: string;
  folderPath?: string;
}

/**
 * Assembles a module S3 folder path from a DB-stored subpath.
 * Format: {basePrefix}/{entityId}/{designYear}/{subPath}
 *
 * subPath comes directly from the DB folderPathKey field (e.g. "sfc-status/sfc-report"),
 * making path changes a DB-only update without a code deploy.
 */
export function buildModuleFolderPath(
  subPath: string,
  basePrefix: string,
  entityId: string,
  designYear: string,
): string {
  if (!entityId) throw new Error('entityId is required to build folder path');
  if (!designYear) throw new Error('designYear is required to build folder path');
  if (!subPath) throw new Error('subPath is required to build folder path');
  return `${basePrefix}/${entityId}/${designYear}/${subPath}`;
}

/**
 * Resolves folderPath for every file field that carries a folderPathKey.
 * Caller provides a buildFn closure that binds module prefix + context.
 *
 * - File fields with folderPathKey  → folderPath set/overridden via buildFn
 * - File fields without folderPathKey → existing folderPath preserved (backward compat)
 * - Non-file fields → returned unchanged
 *
 * Returns a new array; does not mutate input.
 */
export function resolveFormJsonFolderPaths<T extends FormFieldWithPath>(
  fields: T[],
  buildFn: (subPath: string) => string,
): T[] {
  return fields.map((field) => {
    if (field.formFieldType !== 'file' || !field.folderPathKey) return { ...field };
    return { ...field, folderPath: buildFn(field.folderPathKey) };
  });
}
