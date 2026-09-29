import type { PermissionKey } from '@/common/types';
import {
  PERMISSION_SCOPE_OF,
  PLATFORM_PERMISSION_KEYS,
  WORKSPACE_PERMISSION_KEYS,
} from '@/db/seeds/permissions';

/** Room 名稱只在這裡組，不以模板字串散落各處（docs/architecture/backend/08-realtime.md §6）。 */
export function userRoom(userId: string): string {
  return `user:${userId}`;
}

/** 同一個 IdP session 的連線（單一登出，docs/adr/0019-sso-identity-platform.md D5）。 */
export function idpSessionRoom(idpSessionUid: string): string {
  return `sid:${idpSessionUid}`;
}

/** 平台範圍的權限鍵。 */
export function permRoom(key: PermissionKey): string {
  return `perm:${key}`;
}

/**
 * 工作區範圍的權限鍵：這個工作區的成員之中持有該鍵的連線（docs/adr/0018-workspace-tenancy.md D16）。
 * 連線一律加入所屬每個工作區的 room——前端只有 leader 分頁持有連線，代表所有分頁
 * （各分頁可能開著不同的工作區），所以不能只訂閱「目前的」工作區。
 */
export function workspacePermRoom(workspaceId: string, key: PermissionKey): string {
  return `ws:${workspaceId}:perm:${key}`;
}

export const ALL_PERM_ROOMS: readonly string[] = PLATFORM_PERMISSION_KEYS.map(permRoom);

/** 權限決定的 room（平台與工作區）；使用者的 room 不算。 */
export function isPermRoom(room: string): boolean {
  return room.startsWith('perm:') || room.startsWith('ws:');
}

export function allWorkspacePermRooms(workspaceId: string): string[] {
  return WORKSPACE_PERMISSION_KEYS.map((key) => workspacePermRoom(workspaceId, key));
}

/** 使用者的平台權限集合 → 應在的 perm room；super-admin 加入全部。 */
export function permRoomsFor(
  permissions: Iterable<PermissionKey>,
  isSuperAdmin: boolean,
): string[] {
  if (isSuperAdmin) return [...ALL_PERM_ROOMS];
  return [...permissions].filter((key) => PERMISSION_SCOPE_OF[key] === 'platform').map(permRoom);
}

/** 使用者在這個工作區的權限集合 → 應在的工作區 perm room；super-admin 加入全部。 */
export function workspacePermRoomsFor(
  workspaceId: string,
  permissions: Iterable<PermissionKey>,
  isSuperAdmin: boolean,
): string[] {
  if (isSuperAdmin) return allWorkspacePermRooms(workspaceId);
  return [...permissions]
    .filter((key) => PERMISSION_SCOPE_OF[key] === 'workspace')
    .map((key) => workspacePermRoom(workspaceId, key));
}
