import type { ResourceChangeWire, SessionRevokedReason } from '@b2b-system/realtime';

/**
 * 業務 service 發佈、副作用（例：即時推播）訂閱的領域事件。
 *
 * 規則：
 * - 只能在交易 **提交之後** 發佈，位置與 `permissionService.invalidateUsers()` 相同；
 *   rollback 的變更不會被任何人看到。
 * - 權限／使用者快取的失效仍然 **同步、明確地呼叫**，不走 bus——授權的正確性依賴它；
 *   bus 只負責「慢一點也沒關係」的副作用。
 */
export const DomainEvent = {
  /** 來源資源變了；`changes` 與前端 mutation 宣告的來源一致。 */
  RESOURCE_CHANGED: 'resource.changed',
  /** 這些使用者的權限集合改變了（快取已失效）。 */
  PERMISSIONS_CHANGED: 'permissions.changed',
  /** 這些使用者的 `token_version` 遞增了：既有的 session 全部作廢。 */
  SESSIONS_REVOKED: 'sessions.revoked',
  /**
   * 目前的租戶開始服務：佈建完成、或停用後重新啟用（docs/adr/0020-physical-tenant-isolation.md D12、D13）。
   * 在那個租戶的脈絡裡發佈；需要「每個租戶一份」初始資料的模組（例：檔案的系統資料夾）在這裡補上，
   * 不必等程序重啟時的 `forEachActive`。
   */
  TENANT_ACTIVATED: 'tenant.activated',
} as const;

export type DomainEvent = (typeof DomainEvent)[keyof typeof DomainEvent];

export interface DomainEventPayloads {
  [DomainEvent.RESOURCE_CHANGED]: {
    changes: ResourceChangeWire[];
    /** 本人或角色持有者：除了 perm room 之外也要收到的人。 */
    affectedUserIds?: string[];
  };
  [DomainEvent.PERMISSIONS_CHANGED]: { userIds: string[] };
  /**
   * 撤銷即時連線：`userIds` 是這些人的所有連線；`idpSessionUids` 只到同一個 IdP session 的連線（單一登出，
   * docs/adr/0019-sso-identity-platform.md D5）。
   */
  [DomainEvent.SESSIONS_REVOKED]: {
    userIds?: string[];
    idpSessionUids?: string[];
    /** 整個租戶的連線（停用、刪除租戶）。 */
    tenantIds?: string[];
    reason: SessionRevokedReason;
  };
  [DomainEvent.TENANT_ACTIVATED]: Record<string, never>;
}

/** 發佈當下從請求 context 擷取的資訊；handler 執行時請求可能已經結束。 */
export interface DomainEventMeta {
  occurredAt: Date;
  /** 發起請求的分頁（`x-client-id`），只用來去重。 */
  clientId?: string;
  requestId?: string;
}

export type DomainEventHandler<T extends DomainEvent> = (
  payload: DomainEventPayloads[T],
  meta: DomainEventMeta,
) => void | Promise<void>;
