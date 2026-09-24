import type { PermissionKey } from '@/common/types';
import { ALL_PERMISSION_KEYS } from '@/db/seeds/permissions';

/** Room 名稱只在這裡組，不以模板字串散落各處（docs/architecture/backend/08-realtime.md §6）。 */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

export function permRoom(key: PermissionKey): string {
  return `perm:${key}`;
}

export const ALL_PERM_ROOMS: readonly string[] = ALL_PERMISSION_KEYS.map(permRoom);

/** 使用者的權限集合 → 應在的 perm room；super-admin 加入全部。 */
export function permRoomsFor(
  permissions: Iterable<PermissionKey>,
  isSuperAdmin: boolean,
): string[] {
  return isSuperAdmin ? [...ALL_PERM_ROOMS] : [...permissions].map(permRoom);
}
