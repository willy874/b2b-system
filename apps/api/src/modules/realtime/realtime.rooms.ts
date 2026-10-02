import type { PermissionKey } from '@/common/types';
import { requireTenant } from '@/core/tenant';
import { ALL_PERMISSION_KEYS } from '@/db/seeds/permissions';

/**
 * Room 名稱只在這裡組，不以模板字串散落各處（docs/architecture/backend/08-realtime.md §6）。
 * 使用者的 id 只在自己的租戶 DB 裡唯一（從備份還原或複製出來的租戶會有相同的 id），所以也帶上目前的租戶。
 */
export function userRoom(userId: string): string {
  return `t:${requireTenant().id}:user:${userId}`;
}

/** 某個租戶的所有連線：停用或刪除租戶時一次斷掉（docs/architecture/05-tenancy.md §10.2 D13）。 */
export function tenantRoom(tenantId: string): string {
  return `t:${tenantId}`;
}

/** 同一個 IdP session 的連線（單一登出，docs/architecture/04-sso.md §12.2 D5）。 */
export function idpSessionRoom(idpSessionUid: string): string {
  return `sid:${idpSessionUid}`;
}

/**
 * 目前租戶裡持有這個權限鍵的連線。一個程序服務所有租戶，權限鍵的名稱各租戶都一樣，
 * 所以 room 帶上租戶，A 租戶的變更才不會推給 B 租戶的人（docs/architecture/05-tenancy.md §10.2 D17）。
 * IdP session 的 room 用的是 IdP 全域唯一的 uid，不必再帶租戶。
 */
export function permRoom(key: PermissionKey): string {
  return `t:${requireTenant().id}:perm:${key}`;
}

/** 目前租戶的所有 perm room。 */
export function allPermRooms(): string[] {
  return ALL_PERMISSION_KEYS.map(permRoom);
}

/** 使用者的權限集合 → 應在的 perm room；super-admin 加入全部。 */
export function permRoomsFor(
  permissions: Iterable<PermissionKey>,
  isSuperAdmin: boolean,
): string[] {
  return isSuperAdmin ? allPermRooms() : [...permissions].map(permRoom);
}
