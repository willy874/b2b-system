import { PERMISSION } from '@/common/types';

export const ROLE_PERMISSIONS = {
  CREATE: PERMISSION.ROLE_CREATE,
  READ: PERMISSION.ROLE_READ,
  UPDATE: PERMISSION.ROLE_UPDATE,
  DELETE: PERMISSION.ROLE_DELETE,
  GRANT_PERMISSION: PERMISSION.ROLE_GRANT_PERMISSION,
} as const;

export const ROLE_AUDIT_FIELDS = ['name', 'description'] as const;

/** `name` → kebab-case slug。非 ASCII 字元會被移除，空字串時退回 `role`。 */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-')
    .replaceAll(/^-+|-+$/g, '');
  return slug.length ? slug.slice(0, 50) : 'role';
}
