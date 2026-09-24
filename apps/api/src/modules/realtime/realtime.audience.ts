import { ChangeKind, ChangeSource } from '@game-editor/realtime';
import type { ResourceChangeWire } from '@game-editor/realtime';
import { Injectable } from '@nestjs/common';

import { PERMISSION } from '@/common/types';
import type { PermissionKey } from '@/common/types';
import { PermissionService } from '@/modules/permission/permission.service';

import { ALL_PERM_ROOMS, permRoom, permRoomsFor, userRoom } from './realtime.rooms';
import type { RealtimeServer, RealtimeSocket } from './realtime.types';

interface AudienceRule {
  /** 哪些 perm room 的人會因這筆變更需要重抓。 */
  perms: (change: ResourceChangeWire) => PermissionKey[];
  /** `change.id` 本人是否在受眾內（例：被改的那個人的 profile）。 */
  includesSubject: boolean;
}

const READERS_OF_USER_AND_ROLE: PermissionKey[] = [PERMISSION.USER_READ, PERMISSION.ROLE_READ];

/**
 * 來源 → 受眾（docs/architecture/backend/08-realtime.md §6.1），與前端 `apis/resources.ts` 的依賴圖對應。
 * 「持有該角色的所有人」不在這張表：由呼叫端以 `affectedUserIds` 帶入（它已經為了權限快取查過一次）。
 */
const AUDIENCE: Record<ChangeSource, AudienceRule> = {
  // 角色的持有者清單嵌入使用者名稱與狀態；本人的 profile
  [ChangeSource.USER]: { perms: () => READERS_OF_USER_AND_ROLE, includesSubject: true },
  // 使用者嵌入角色摘要、角色的 userCount；本人的權限
  [ChangeSource.USER_ROLE]: { perms: () => READERS_OF_USER_AND_ROLE, includesSubject: true },
  // 使用者嵌入角色名稱：只有改名／刪除才影響使用者畫面
  [ChangeSource.ROLE]: {
    perms: (change) =>
      change.kind === ChangeKind.CREATE ? [PERMISSION.ROLE_READ] : READERS_OF_USER_AND_ROLE,
    includesSubject: false,
  },
  // 權限數與清單
  [ChangeSource.ROLE_PERMISSION]: { perms: () => [PERMISSION.ROLE_READ], includesSubject: false },
  // 沒有任何畫面顯示憑證
  [ChangeSource.USER_CREDENTIAL]: { perms: () => [], includesSubject: false },
};

/** 每次寫入都會新增一筆稽核（前端 `derivesFromAnyChange`）。 */
const ANY_CHANGE_PERMS: PermissionKey[] = [PERMISSION.AUDIT_LOG_READ];

/** 一批變更要推給哪些 room。`io.to([...rooms])` 會對聯集去重，同一條連線只收到一次。 */
export function resolveAudienceRooms(
  changes: readonly ResourceChangeWire[],
  affectedUserIds: readonly string[] = [],
): string[] {
  if (!changes.length) return [];
  const perms = new Set<PermissionKey>(ANY_CHANGE_PERMS);
  const userIds = new Set(affectedUserIds);

  for (const change of changes) {
    const rule = AUDIENCE[change.resource];
    for (const key of rule.perms(change)) perms.add(key);
    if (rule.includesSubject && change.id) userIds.add(change.id);
  }

  return [...[...perms].map(permRoom), ...[...userIds].map(userRoom)];
}

/** 使用者 ↔ perm room 的同步（§3.3、§6.2）。 */
@Injectable()
export class RealtimeAudience {
  constructor(private readonly permissionService: PermissionService) {}

  /** 新連線：依權限集合加入 perm room。 */
  async syncRooms(socket: RealtimeSocket): Promise<void> {
    const { permissions, isSuperAdmin } = await this.permissionService.getPermissionSet(
      socket.data.userId,
    );
    await socket.join(permRoomsFor(permissions, isSuperAdmin));
  }

  /**
   * 權限集合改變的人：他們的連線換 room，否則會繼續收到（或收不到）不該收的事件。
   * 呼叫前權限快取必須已失效，否則會拿到舊集合。
   */
  async refreshAudience(io: RealtimeServer, userIds: readonly string[]): Promise<void> {
    for (const id of new Set(userIds)) {
      // 沒有連線的人不必解析權限（省一次 DB）。只看本機 adapter：
      // 裝了跨節點 adapter 之後要拿掉這個捷徑（§10.3）。
      if (!io.sockets.adapter.rooms.has(userRoom(id))) continue;
      const { permissions, isSuperAdmin } = await this.permissionService.getPermissionSet(id);
      const room = io.in(userRoom(id));
      room.socketsLeave([...ALL_PERM_ROOMS]);
      room.socketsJoin(permRoomsFor(permissions, isSuperAdmin));
    }
  }
}
