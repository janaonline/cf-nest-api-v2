import type { FieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';
import { buildModuleFolderPath, resolveFormJsonFolderPaths } from 'src/core/utils/folder-path.util';

export interface XviFcFolderPathContext {
  _id: string;
  role: 'ulb' | 'state' | 'mohua' | 'admin';
  designYear: string;
  batchId?: string;
}

/**
 * Builds a resolved S3 folder path for XVI-FC.
 *
 * subPath is the DB-stored value in folderPathKey (e.g. "sfc-status/sfc-report").
 * Format: xvi-fc/{role}/{_id}/{designYear}/{subPath}
 * With batchId: xvi-fc/{role}/{_id}/{designYear}/{subPath}/{batchId}/document
 */
export function buildXviFcFolderPath(subPath: string, context: XviFcFolderPathContext): string {
  const base = buildModuleFolderPath(subPath, `xvi-fc/${context.role}`, context._id, context.designYear);
  if (context.batchId) {
    return `${base}/${context.batchId}/document`;
  }
  return base;
}

/**
 * Traverses a formJson field array and resolves folderPath for every file field
 * that carries a folderPathKey (the DB-stored subpath string).
 *
 * - File fields with folderPathKey → folderPath set/overridden
 * - File fields without folderPathKey → existing folderPath preserved (backward compat)
 * - Non-file fields → returned unchanged
 *
 * Returns a new array; does not mutate Mongoose lean documents or the input array.
 */
export function resolveXviFcFolderPathsInFormJson<T extends FieldConfig>(
  fields: T[],
  context: XviFcFolderPathContext,
): T[] {
  return resolveFormJsonFolderPaths(fields, (subPath) => buildXviFcFolderPath(subPath, context));
}
