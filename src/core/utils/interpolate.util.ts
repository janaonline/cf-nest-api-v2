export function interpolate(text: string, variables?: Record<string, string>): string {
  if (!variables) return text;
  return text.replace(/\{\{(\w+)\}\}/g, (_, key: string) => variables[key] ?? `{{${key}}}`);
}
