import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import type { ResourceChangeWire } from '@b2b-system/realtime';
import { Injectable } from '@nestjs/common';

import { PERMISSION } from '@/common/types';
import type { PermissionKey } from '@/common/types';
import { PermissionService } from '@/modules/permission/permission.service';

import { RealtimePublisher } from './realtime.publisher';
import { allPermRooms, permRoom, permRoomsFor, userRoom } from './realtime.rooms';

interface AudienceRule {
  /** 哪些 perm room 的人會因這筆變更需要重抓。 */
  perms: (change: ResourceChangeWire) => PermissionKey[];
  /** `change.id` 本人是否在受眾內（例：被改的那個人的 profile）。 */
  includesSubject: boolean;
  /**
   * 這個來源的寫入是否會新增稽核紀錄（`auditLog:read` 的人要重抓）。預設是；
   * 通知的建立與已讀不寫稽核（ADR-0026 D9），不必讓稽核頁重抓。
   */
  recordsAudit?: false;
}

const READERS_OF_USER_AND_ROLE: PermissionKey[] = [PERMISSION.USER_READ, PERMISSION.ROLE_READ];
const FILE_READERS: PermissionKey[] = [PERMISSION.FILE_READ, PERMISSION.FILE_ACCESS];

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
  // 群組列表與詳情（成員、持有的角色）；成員本人由呼叫端以 `affectedUserIds` 帶入
  [ChangeSource.GROUP]: { perms: () => [PERMISSION.GROUP_READ], includesSubject: false },
  // 沒有任何畫面顯示憑證
  [ChangeSource.USER_CREDENTIAL]: { perms: () => [], includesSubject: false },
  // 審批列表；匿名申請人（註冊）沒有連線，不必通知本人
  [ChangeSource.APPROVAL]: { perms: () => [PERMISSION.APPROVAL_READ], includesSubject: false },
  // 檔案列表與詳情。`file:access` 的人只看得到被授權的資料夾：payload 只有 id，
  // 收到看不到的變更只會多重抓一次（docs/rbac/07-resource-grants.md §9）
  [ChangeSource.FILE]: { perms: () => FILE_READERS, includesSubject: false },
  // 資料夾樹與麵包屑；資料夾授權變更也以 fileFolder update 推出
  [ChangeSource.FILE_FOLDER]: { perms: () => FILE_READERS, includesSubject: false },
  // 設定頁；公開設定（登入頁、預設時區）在下次載入時讀，不即時推給所有人
  [ChangeSource.SETTING]: { perms: () => [PERMISSION.SYSTEM_READ], includesSubject: false },
  // 平台層的變更，不經 `resource.changed` 事件：`tenant.featuresChanged` 直接推給整個租戶的 room
  // （RealtimeListener.onTenantFeaturesChanged）。出現在這裡代表呼叫端用錯事件，不推給任何人
  [ChangeSource.TENANT_FEATURE]: { perms: () => [], includesSubject: false },
  // 只推給收件人（呼叫端以 `affectedUserIds` 帶入；id 是通知 id，不是使用者 id）。
  // 通知是個人的東西：沒有任何 perm room 要知道（docs/adr/0026-notification-center.md D8）
  [ChangeSource.NOTIFICATION]: { perms: () => [], includesSubject: false, recordsAudit: false },
  // 只推給本人（呼叫端以 `affectedUserIds` 帶入）；個人設定不寫稽核
  [ChangeSource.NOTIFICATION_PREFERENCE]: {
    perms: () => [],
    includesSubject: false,
    recordsAudit: false,
  },
  // 服務帳號的列表與詳情（docs/adr/0027-api-tokens-external-api.md D14）
  [ChangeSource.SERVICE_ACCOUNT]: {
    perms: () => [PERMISSION.SERVICE_ACCOUNT_READ],
    includesSubject: false,
  },
  // 服務帳號的 token 列表（serviceAccount:read）與使用者詳情裡別人的個人 token（user:update）；
  // 本人的個人 token 由呼叫端以 `affectedUserIds` 帶入
  [ChangeSource.API_TOKEN]: {
    perms: () => [PERMISSION.SERVICE_ACCOUNT_READ, PERMISSION.USER_UPDATE],
    includesSubject: false,
  },
  // Webhook 的列表、詳情與投遞紀錄（docs/adr/0030-webhooks.md D6）；投遞不寫稽核
  [ChangeSource.WEBHOOK]: { perms: () => [PERMISSION.WEBHOOK_READ], includesSubject: false },
  [ChangeSource.WEBHOOK_DELIVERY]: {
    perms: () => [PERMISSION.WEBHOOK_READ],
    includesSubject: false,
    recordsAudit: false,
  },
  // 標籤的定義：進得了任一標籤組的人（docs/adr/0032-tags.md D10）
  [ChangeSource.TAG]: {
    perms: () => [PERMISSION.FILE_ACCESS, PERMISSION.FILE_READ, PERMISSION.USER_READ],
    includesSubject: false,
  },
  // 公告與發送紀錄（docs/adr/0031-announcements.md）；背景發送的狀態變化不寫稽核，但人的操作會寫，維持預設
  [ChangeSource.ANNOUNCEMENT]: {
    perms: () => [PERMISSION.ANNOUNCEMENT_READ],
    includesSubject: false,
  },
  // 事件管理頁（與系統設定同一群讀者，ADR-0028 D10）
  [ChangeSource.NOTIFICATION_POLICY]: {
    perms: () => [PERMISSION.SYSTEM_READ],
    includesSubject: false,
  },
};

/** 每次寫入都會新增一筆稽核（前端 `derivesFromAnyChange`）。 */
const ANY_CHANGE_PERMS: PermissionKey[] = [PERMISSION.AUDIT_LOG_READ];

/** 一批變更要推給哪些 room。`RealtimePublisher.emit` 會對聯集去重，同一條連線只收到一次。 */
export function resolveAudienceRooms(
  changes: readonly ResourceChangeWire[],
  affectedUserIds: readonly string[] = [],
): string[] {
  if (!changes.length) return [];
  const perms = new Set<PermissionKey>();
  const userIds = new Set(affectedUserIds);

  for (const change of changes) {
    const rule = AUDIENCE[change.resource];
    if (rule.recordsAudit !== false) for (const key of ANY_CHANGE_PERMS) perms.add(key);
    for (const key of rule.perms(change)) perms.add(key);
    if (rule.includesSubject && change.id) userIds.add(change.id);
  }

  return [...[...perms].map(permRoom), ...[...userIds].map(userRoom)];
}

/** `refreshAudience` 每批解析多少人的權限。 */
const REFRESH_BATCH_SIZE = 200;

/** 使用者 ↔ perm room 的同步（§3.3、§6.2）。 */
@Injectable()
export class RealtimeAudience {
  constructor(
    private readonly permissionService: PermissionService,
    private readonly publisher: RealtimePublisher,
  ) {}

  /** 新連線要加入的 perm room（依權限集合）。 */
  async roomsFor(userId: string): Promise<string[]> {
    const { permissions, isSuperAdmin } = await this.permissionService.getPermissionSet(userId);
    return permRoomsFor(permissions, isSuperAdmin);
  }

  /**
   * 權限集合改變的人：他們的連線換 room，否則會繼續收到（或收不到）不該收的事件。
   * 呼叫前權限快取必須已失效，否則會拿到舊集合。
   *
   * 一個角色可能有上千位持有者：權限以批次查詢（每批兩條 SQL），不是每人各查一次
   */
  async refreshAudience(userIds: readonly string[]): Promise<void> {
    // 沒有連線的人不必解析權限（省 DB）。只看本機的連線：
    // 裝了跨節點 adapter 之後要拿掉這個捷徑（§10.3）。
    const connected = [...new Set(userIds)].filter((id) =>
      this.publisher.countConnections(userRoom(id)),
    );
    if (connected.length === 0) return;

    const everyPermRoom = allPermRooms();
    for (let start = 0; start < connected.length; start += REFRESH_BATCH_SIZE) {
      const batch = connected.slice(start, start + REFRESH_BATCH_SIZE);
      // oxlint-disable-next-line no-await-in-loop -- 分批依序：限制同時佔用的 DB 連線與記憶體
      const sets = await this.permissionService.getPermissionSets(batch);
      for (const id of batch) {
        const set = sets.get(id);
        if (!set) continue;
        this.publisher.moveRooms(
          userRoom(id),
          everyPermRoom,
          permRoomsFor(set.permissions, set.isSuperAdmin),
        );
      }
    }
  }
}
