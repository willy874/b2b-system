export const WORKSPACE_AUDIT_FIELDS = ['name', 'description'] as const;

/**
 * `name` → 網址用的 slug（小寫英數與連字號）。非 ASCII 字元會被移除，空字串時退回 `workspace`。
 * 與 `WORKSPACE_SLUG_PATTERN` 相容：不以連字號開頭或結尾、最長 50 字。
 */
export function slugifyWorkspace(name: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '')
    .slice(0, 40)
    .replaceAll(/-+$/g, '');
  return slug.length ? slug : 'workspace';
}
