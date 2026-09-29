import type { ResourceChangeWire, SessionRevokedReason } from '@game-editor/realtime';

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
} as const;

export type DomainEvent = (typeof DomainEvent)[keyof typeof DomainEvent];

export interface DomainEventPayloads {
  [DomainEvent.RESOURCE_CHANGED]: {
    changes: ResourceChangeWire[];
    /** 本人或角色持有者：除了 perm room 之外也要收到的人。 */
    affectedUserIds?: string[];
    /**
     * 工作區範圍的來源（檔案、資料夾、成員）必填：只推給這個工作區的 room
     * （docs/adr/0018-workspace-tenancy.md D16）。
     */
    workspaceId?: string;
  };
  [DomainEvent.PERMISSIONS_CHANGED]: { userIds: string[] };
  [DomainEvent.SESSIONS_REVOKED]: { userIds: string[]; reason: SessionRevokedReason };
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
