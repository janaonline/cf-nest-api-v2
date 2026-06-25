import type { FieldConfig } from 'src/module/xvi-fc/common/types/field-config.type';
import {
  XVI_FC_FOLDER_PATH_KEYS,
  XVI_FC_FOLDER_PATH_MAP,
  type XviFcFolderPathKey,
} from './xvi-fc-folder-path.constants';

export interface XviFcFolderPathContext {
  _id: string; // state_id, ulb_id...
  role: 'ulb' | 'state' | 'mohua' | 'admin';
  designYear: string;
  batchId?: string;
}

/**
 * Builds a resolved S3 folder path for a given XVI-FC folder path key and runtime context.
 *
 * Format: `xvi-fc/{role}/{_id}/{designYear}/{mappedPath}`
 * For EULB_POST_SUBMISSION_PROOF with batchId:
 *   `xvi-fc/{role}/{_id}/{designYear}/elected-body/post-submission-update/{batchId}/document`
 */
export function buildXviFcFolderPath(folderPathKey: XviFcFolderPathKey, context: XviFcFolderPathContext): string {
  if (!context._id) throw new Error('id is required to build XVI-FC folder path');
  if (!context.designYear) throw new Error('designYear is required to build XVI-FC folder path');

  const mappedPath = XVI_FC_FOLDER_PATH_MAP[folderPathKey];
  if (mappedPath === undefined) {
    throw new Error(`Unsupported XVI-FC folder path key: "${folderPathKey}"`);
  }

  const base = `xvi-fc/${context.role}/${context._id}/${context.designYear}/${mappedPath}`;

  if (folderPathKey === XVI_FC_FOLDER_PATH_KEYS.EULB_POST_SUBMISSION_PROOF && context.batchId) {
    return `${base}/${context.batchId}/document`;
  }

  return base;
}

/**
 * Traverses a formJson field array and resolves `folderPath` for every file field that
 * carries a `folderPathKey`.
 *
 * - File fields with `folderPathKey` → `folderPath` is set/overridden via `buildXviFcFolderPath`.
 * - File fields without `folderPathKey` → existing `folderPath` is preserved (backward compat).
 * - Non-file fields → returned unchanged.
 *
 * Returns a new array; does not mutate Mongoose lean documents or the input array.
 */
export function resolveXviFcFolderPathsInFormJson<T extends FieldConfig>(
  fields: T[],
  context: XviFcFolderPathContext,
): T[] {
  return fields.map((field) => {
    if (field.formFieldType !== 'file') return { ...field };

    const key = field.folderPathKey;
    if (!key) return { ...field };

    const resolvedPath = buildXviFcFolderPath(key as XviFcFolderPathKey, context);
    return { ...field, folderPath: resolvedPath };
  });
}
