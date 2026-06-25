export interface ModuleFolderPathContext {
  stateId: string;
  designYear: string;
}

interface FormFieldWithPath {
  formFieldType: string;
  folderPathKey?: string;
  folderPath?: string;
}

/**
 * Builds an S3 folder path for any module using the pattern:
 *   {basePrefix}/{stateId}/{designYear}/{subPath}
 *
 * Each module owns its key map and base prefix; this utility handles
 * validated path assembly so the pattern is not re-implemented per module.
 */
export function buildModuleFolderPath<K extends string>(
  key: K,
  pathMap: Record<K, string>,
  basePrefix: string,
  context: ModuleFolderPathContext,
): string {
  if (!context.stateId) throw new Error('stateId is required to build folder path');
  if (!context.designYear) throw new Error('designYear is required to build folder path');
  const subPath = pathMap[key];
  if (subPath === undefined) throw new Error(`Unknown folder path key: "${key}"`);
  return `${basePrefix}/${context.stateId}/${context.designYear}/${subPath}`;
}

/**
 * Resolves folderPath for every file field that carries a folderPathKey.
 * The caller provides a buildFn closure that binds module-specific context.
 *
 * - File fields with folderPathKey  → folderPath set/overridden via buildFn
 * - File fields without folderPathKey → existing folderPath preserved (backward compat)
 * - Non-file fields → returned unchanged
 *
 * Returns a new array; does not mutate input.
 */
export function resolveFormJsonFolderPaths<T extends FormFieldWithPath>(
  fields: T[],
  buildFn: (key: string) => string,
): T[] {
  return fields.map((field) => {
    if (field.formFieldType !== 'file' || !field.folderPathKey) return { ...field };
    return { ...field, folderPath: buildFn(field.folderPathKey) };
  });
}
