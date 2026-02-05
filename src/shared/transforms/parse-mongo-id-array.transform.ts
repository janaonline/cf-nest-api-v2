export function parseMongoIdToArray(value: any) {
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0)) {
    return undefined;
  }

  if (Array.isArray(value)) {
    return value.map((v) => String(v));
  }

  return String(value)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}
