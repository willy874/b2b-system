/** 稽核裡絕不出現的欄位。 */
export const AUDIT_EXCLUDED_FIELDS = new Set(['passwordHash', 'tokenHash', 'tokenVersion']);

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/** 只記實際改變的欄位（docs/backend/06-audit-log.md §5）。 */
export function diff<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  fields: readonly (keyof T)[],
): { before: Partial<T>; after: Partial<T> } | null {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const field of fields) {
    if (AUDIT_EXCLUDED_FIELDS.has(String(field))) continue;
    if (field in after && !isEqual(before[field], after[field])) {
      b[field] = before[field];
      a[field] = after[field];
    }
  }
  return Object.keys(a).length ? { before: b, after: a } : null;
}
