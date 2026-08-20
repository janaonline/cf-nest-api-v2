export function buildXviFcDownloadFileName(params: {
  entityName: string;
  formName: string;
  yearLabel: string;
  /** No leading dot, e.g. 'xlsx', 'docx', 'pdf'. */
  extension: string;
}): string {
  const parts = ['CF', segment(params.entityName), segment(params.formName), segment(params.yearLabel)].filter(Boolean);
  return `${parts.join('_')}.${params.extension}`;
}

/** Collapses any run of non-alphanumeric characters into a single hyphen, trims leading/trailing
 *  hyphens, and capitalizes the first character — e.g. `devolution-formula-template` becomes
 *  `Devolution-formula-template`. A no-op for values already starting with a capital (state names
 *  from the DB) or a digit (year labels like `2024-25`), so this is safe to apply uniformly to
 *  every segment rather than special-casing `formName` alone. */
function segment(value: string): string {
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned.length > 0 ? cleaned.charAt(0).toUpperCase() + cleaned.slice(1) : cleaned;
}
