import { ChangeKind, ChangeSource } from '@game-editor/realtime';
import type { ResourceChangeWire } from '@game-editor/realtime';
import { Injectable } from '@nestjs/common';

import { PERMISSION } from '@/common/types';
import type { PermissionKey } from '@/common/types';
import { PermissionService } from '@/modules/permission/permission.service';

import { RealtimePublisher } from './realtime.publisher';
import {
  ALL_PERM_ROOMS,
  isPermRoom,
  permRoom,
  permRoomsFor,
  userRoom,
  workspacePermRoom,
  workspacePermRoomsFor,
} from './realtime.rooms';

interface AudienceRule {
  /**
   * `workspace`：資源在某個工作區裡，受眾是該工作區持有權限鍵的成員，權限鍵是工作區範圍的
   * （docs/adr/0018-workspace-tenancy.md D16）；推播時必須帶 `workspaceId`。
   */
  scope: 'platform' | 'workspace';
  /** 哪些 perm room 的人會因這筆變更需要重抓。 */
  perms: (change: ResourceChangeWire) => PermissionKey[];
  /** `change.id` 本人是否在受眾內（例：被改的那個人的 profile）。 */
  includesSubject: boolean;
}

const READERS_OF_USER_AND_ROLE: PermissionKey[] = [PERMISSION.USER_READ, PERMISSION.ROLE_READ];
const FILE_READERS: PermissionKey[] = [PERMISSION.FILE_READ, PERMISSION.FILE_ACCESS];

/**
 * 來源 → 受眾（docs/architecture/backend/08-realtime.md §6.1），與前端 `apis/resources.ts` 的依賴圖對應。
 * 「持有該角色的所有人」不在這張表：由呼叫端以 `affectedUserIds` 帶入（它已經為了權限快取查過一次）。
 */
const AUDIENCE: Record<ChangeSource, AudienceRule> = {
  // 角色的持有者清單嵌入使用者名稱與狀態；本人的 profile
  [ChangeSource.USER]: {
    scope: 'platform',
    perms: () => READERS_OF_USER_AND_ROLE,
    includesSubject: true,
  },
  // 使用者嵌入角色摘要、角色的 userCount；本人的權限
  [ChangeSource.USER_ROLE]: {
    scope: 'platform',
    perms: () => READERS_OF_USER_AND_ROLE,
    includesSubject: true,
  },
  // 使用者嵌入角色名稱：只有改名／刪除才影響使用者畫面
  [ChangeSource.ROLE]: {
    scope: 'platform',
    perms: (change) =>
      change.kind === ChangeKind.CREATE ? [PERMISSION.ROLE_READ] : READERS_OF_USER_AND_ROLE,
    includesSubject: false,
  },
  // 權限數與清單
  [ChangeSource.ROLE_PERMISSION]: {
    scope: 'platform',
    perms: () => [PERMISSION.ROLE_READ],
    includesSubject: false,
  },
  // 沒有任何畫面顯示憑證
  [ChangeSource.USER_CREDENTIAL]: { scope: 'platform', perms: () => [], includesSubject: false },
  // 審批列表；匿名申請人（註冊）沒有連線，不必通知本人
  [ChangeSource.APPROVAL]: {
    scope: 'platform',
    perms: () => [PERMISSION.APPROVAL_READ],
    includesSubject: false,
  },
  // 檔案列表與詳情。`file:access` 的人只看得到被授權的資料夾：payload 只有 id，
  // 收到看不到的變更只會多重抓一次（docs/rbac/07-resource-grants.md §9）
  [ChangeSource.FILE]: { scope: 'workspace', perms: () => FILE_READERS, includesSubject: false },
  // 資料夾樹與麵包屑；資料夾授權變更也以 fileFolder update 推出
  [ChangeSource.FILE_FOLDER]: {
    scope: 'workspace',
    perms: () => FILE_READERS,
    includesSubject: false,
  },
  // 工作區管理列表；成員的切換器由呼叫端以 `affectedUserIds`（成員）帶入
  [ChangeSource.WORKSPACE]: {
    scope: 'platform',
    perms: () => [PERMISSION.WORKSPACE_READ],
    includesSubject: false,
  },
  // 成員清單；本人的工作區清單與在這個工作區的權限
  [ChangeSource.WORKSPACE_MEMBER]: {
    scope: 'workspace',
    perms: () => [PERMISSION.WORKSPACE_MEMBER_READ],
    includesSubject: true,
  },
};

/** 每次寫入都會新增一筆稽核（前端 `derivesFromAnyChange`）。 */
const ANY_CHANGE_PERMS: PermissionKey[] = [PERMISSION.AUDIT_LOG_READ];

/**
 * 一批變更要推給哪些 room。`RealtimePublisher.emit` 會對聯集去重，同一條連線只收到一次。
 * 工作區範圍的來源沒有 `workspaceId` 是呼叫端的錯誤：不推（寧可漏推也不跨工作區），回傳時標出。
 */
export function resolveAudienceRooms(
  changes: readonly ResourceChangeWire[],
  affectedUserIds: readonly string[] = [],
  workspaceId?: string,
): string[] {
  if (!changes.length) return [];
  const rooms = new Set<string>(ANY_CHANGE_PERMS.map(permRoom));
  for (const id of affectedUserIds) rooms.add(userRoom(id));

  for (const change of changes) {
    const rule = AUDIENCE[change.resource];
    if (rule.scope === 'workspace' && !workspaceId) continue;
    for (const key of rule.perms(change)) {
      rooms.add(
        rule.scope === 'workspace' && workspaceId
          ? workspacePermRoom(workspaceId, key)
          : permRoom(key),
      );
    }
    if (rule.includesSubject && change.id) rooms.add(userRoom(change.id));
  }

  return [...rooms];
}

/** 這批變更裡有沒有工作區範圍、卻沒帶 `workspaceId` 的來源（listener 記錄用）。 */
export function missingWorkspace(
  changes: readonly ResourceChangeWire[],
  workspaceId: string | undefined,
): boolean {
  return !workspaceId && changes.some((change) => AUDIENCE[change.resource].scope === 'workspace');
}

/** 使用者 ↔ perm room 的同步（§3.3、§6.2）。 */
@Injectable()
export class RealtimeAudience {
  constructor(
    private readonly permissionService: PermissionService,
    private readonly publisher: RealtimePublisher,
  ) {}

  /**
   * 連線要加入的 perm room：平台權限集合的，加上所屬每個工作區裡的權限集合的
   * （docs/adr/0018-workspace-tenancy.md D16）。不是成員的 super-admin 不加入那些工作區：
   * 他瀏覽非成員的工作區時，資料由重新聚焦時的重抓更新。
   */
  async roomsFor(userId: string): Promise<string[]> {
    const [{ permissions, isSuperAdmin }, workspaceIds] = await Promise.all([
      this.permissionService.getPermissionSet(userId),
      this.permissionService.findMemberWorkspaceIds(userId),
    ]);
    const scoped = await Promise.all(
      workspaceIds.map(async (workspaceId) => {
        const set = await this.permissionService.getWorkspacePermissionSet(userId, workspaceId);
        return set.canEnter
          ? workspacePermRoomsFor(workspaceId, set.permissions, set.isSuperAdmin)
          : [];
      }),
    );
    return [...permRoomsFor(permissions, isSuperAdmin), ...scoped.flat()];
  }

  /**
   * 權限集合或成員資格改變的人：他們的連線換 room，否則會繼續收到（或收不到）不該收的事件。
   * 移出目前所有的 perm room（含已經不屬於的工作區的）、再加入現在該在的。
   * 呼叫前權限快取必須已失效，否則會拿到舊集合。
   */
  async refreshAudience(userIds: readonly string[]): Promise<void> {
    for (const id of new Set(userIds)) {
      // 沒有連線的人不必解析權限（省一次 DB）。只看本機的連線：
      // 裝了跨節點 adapter 之後要拿掉這個捷徑（§10.3）。
      if (!this.publisher.countConnections(userRoom(id))) continue;
      // oxlint-disable-next-line no-await-in-loop -- 受影響的人數有限；權限集合有快取
      const next = await this.roomsFor(id);
      const current = this.publisher.roomsOf(userRoom(id)).filter(isPermRoom);
      this.publisher.moveRooms(userRoom(id), [...new Set([...ALL_PERM_ROOMS, ...current])], next);
    }
  }
}
