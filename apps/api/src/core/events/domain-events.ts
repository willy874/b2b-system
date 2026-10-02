import type { ResourceChangeWire, SessionRevokedReason } from '@b2b-system/realtime';

/**
 * 業務 service 發佈、副作用（例：即時推播）訂閱的領域事件。
 *
 * 規則：
 * - 只能在交易 **提交之後** 發佈；rollback 的變更不會被任何人看到。
 * - 權限／使用者快取的失效仍然 **同步、明確地呼叫**，不走 bus——授權的正確性依賴它；
 *   bus 只負責「慢一點也沒關係」的副作用。
 */
export const DomainEvent = {
  /** 來源資源變了；`changes` 與前端 mutation 宣告的來源一致。 */
  RESOURCE_CHANGED: 'resource.changed',
  /**
   * 目前租戶的關係圖變了，任何人的權限集合都可能改變（快取已整個租戶失效）。由 `AuthzRevision` 發佈：
   * 本機的寫入之後、或收到其他程序的廣播之後（docs/rbac/01-domain-model.md §9.2 D7）。
   */
  PERMISSIONS_CHANGED: 'permissions.changed',
  /** 這些使用者的 `token_version` 遞增了：既有的 session 全部作廢。 */
  SESSIONS_REVOKED: 'sessions.revoked',
  /**
   * 目前的租戶開始服務：佈建完成、或停用後重新啟用（docs/architecture/05-tenancy.md §10.2 D12、D13）。
   * 在那個租戶的脈絡裡發佈；需要「每個租戶一份」初始資料的模組（例：檔案的系統資料夾）在這裡補上，
   * 不必等程序重啟時的 `forEachActive`。
   */
  TENANT_ACTIVATED: 'tenant.activated',
  /**
   * 平台管理者變更了租戶啟用的 feature（docs/architecture/frontend/02-plugin-system.md §9.2 D8）。平台的請求沒有租戶脈絡，
   * 所以以 `tenantId` 指明對象；在 `TenantDirectory.invalidate()` 之後發佈。
   */
  TENANT_FEATURES_CHANGED: 'tenant.featuresChanged',
} as const;

export type DomainEvent = (typeof DomainEvent)[keyof typeof DomainEvent];

export interface DomainEventPayloads {
  [DomainEvent.RESOURCE_CHANGED]: {
    changes: ResourceChangeWire[];
    /** 本人或角色持有者：除了 perm room 之外也要收到的人。 */
    affectedUserIds?: string[];
  };
  [DomainEvent.PERMISSIONS_CHANGED]: {
    /**
     * 已知直接受影響的人（例：被指派角色的人），只在發起寫入的程序上有；給需要逐人處理的訂閱者
     * （補建個人資料夾）。不是完整清單：推播的 room 一律重算整個租戶的連線。
     */
    userIds?: string[];
  };
  /**
   * 撤銷即時連線：`userIds` 是這些人的所有連線；`idpSessionUids` 只到同一個 IdP session 的連線（單一登出，
   * docs/architecture/04-sso.md §12.2 D5）。
   */
  [DomainEvent.SESSIONS_REVOKED]: {
    userIds?: string[];
    idpSessionUids?: string[];
    /** 整個租戶的連線（停用、刪除租戶）。 */
    tenantIds?: string[];
    reason: SessionRevokedReason;
  };
  [DomainEvent.TENANT_ACTIVATED]: Record<string, never>;
  [DomainEvent.TENANT_FEATURES_CHANGED]: { tenantId: string };
}

/** 發佈當下從請求 context 擷取的資訊；handler 執行時請求可能已經結束。 */
export interface DomainEventMeta {
  occurredAt: Date;
  /** 發起請求的分頁（`x-client-id`），只用來去重。 */
  clientId?: string;
  requestId?: string;
  /**
   * 由其他程序轉送來的（`DomainEventRelay`，docs/architecture/06-external-api.md §9.2 D18）：寫入發生在別的程序，
   * 那邊的訂閱者已經處理過持久化的副作用；只有以 `{ remote: true }` 訂閱的 handler（推播）收得到。
   */
  remote?: boolean;
}

export interface DomainEventSubscribeOptions {
  /**
   * 也接收其他程序轉送來的事件。只給「每個程序各做一次」的副作用（推播給本機的連線）；
   * 寫資料庫、撤銷 session 這類「整個系統做一次」的不要開，否則會在每個程序重複執行。
   */
  remote?: boolean;
}

export type DomainEventHandler<T extends DomainEvent> = (
  payload: DomainEventPayloads[T],
  meta: DomainEventMeta,
) => void | Promise<void>;
