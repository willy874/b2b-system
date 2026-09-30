import { Injectable, Logger } from '@nestjs/common';

import { getRequestContext } from '../http/request-context';
import { currentTenant } from '../tenant/tenant-context';
import { DomainEvent } from './domain-events';
import type { DomainEventHandler, DomainEventMeta, DomainEventPayloads } from './domain-events';

type AnyHandler = (payload: unknown, meta: DomainEventMeta) => void | Promise<void>;

/** 沒有租戶脈絡時發佈的事件（平台層級：停用整個租戶的連線、單一登出）走這條。 */
const PLATFORM_LANE = '-';

/**
 * 走優先通道的事件：踢線（停用、刪除使用者）要即時，不能排在同一個租戶的大量 room 同步之後。
 * 它們與其他事件沒有先後依賴：session 作廢由 `token_version` 保證，推播只是讓前端早點知道。
 */
const PRIORITY_EVENTS: ReadonlySet<DomainEvent> = new Set([DomainEvent.SESSIONS_REVOKED]);

/** 事件排進哪一條佇列：每個租戶一條，另加一條優先通道。 */
function laneOf(type: DomainEvent): string {
  const tenant = currentTenant()?.id ?? PLATFORM_LANE;
  return PRIORITY_EVENTS.has(type) ? `${tenant}:priority` : tenant;
}

/**
 * 行程內的領域事件匯流排（規則見 `domain-events.ts`）。
 *
 * - `publish()` 是 fire-and-forget：不拋錯、不等 handler，HTTP 回應不會因此變慢。
 * - 分派非同步，**同一條佇列內依序**：事件照發佈順序處理，每個 handler await 完才輪到下一個。
 *   所以同一次操作先發的 `permissions.changed` 一定比 `resource.changed` 先處理完。
 * - 佇列依發佈當下的租戶分開（docs/architecture/backend/08-realtime.md §7.2）：一個租戶的大量權限變更
 *   不會拖慢其他租戶的推播；`sessions.revoked` 另走優先通道，不排在同租戶的 room 同步之後。
 * - handler 的錯誤彼此隔離：記錄後吞掉。
 */
@Injectable()
export class DomainEventBus {
  private readonly logger = new Logger(DomainEventBus.name);
  private readonly handlers = new Map<DomainEvent, Set<AnyHandler>>();
  /** 每條佇列目前的尾端；處理完就移除，不隨租戶數累積。 */
  private readonly lanes = new Map<string, Promise<void>>();

  publish<T extends DomainEvent>(type: T, payload: DomainEventPayloads[T]): void {
    try {
      const context = getRequestContext();
      const meta: DomainEventMeta = {
        occurredAt: new Date(),
        clientId: context?.clientId,
        requestId: context?.requestId,
      };
      this.enqueue(laneOf(type), () => this.dispatch(type, payload, meta));
    } catch (error) {
      this.logger.error({ err: error, event: type }, '領域事件發佈失敗（已忽略）');
    }
  }

  /** 回傳取消訂閱的函式。 */
  subscribe<T extends DomainEvent>(type: T, handler: DomainEventHandler<T>): () => void {
    const set = this.handlers.get(type) ?? new Set<AnyHandler>();
    const entry = handler as AnyHandler;
    set.add(entry);
    this.handlers.set(type, set);
    return () => {
      set.delete(entry);
    };
  }

  /** 等到目前排隊中（含處理中衍生）的事件全部處理完。供測試使用。 */
  async drain(): Promise<void> {
    while (this.lanes.size > 0) {
      // oxlint-disable-next-line no-await-in-loop -- 等這一輪之後再看有沒有處理中衍生的新事件
      await Promise.all(this.lanes.values());
    }
  }

  /**
   * 接在佇列尾端。`then` 在發佈者的 async context 裡掛上，handler 執行時仍在發佈當下的租戶脈絡
   * （`TENANT_DB`、room 名稱都依賴它）。`dispatch` 自己吞掉錯誤，佇列不會因為 rejection 斷掉。
   */
  private enqueue(lane: string, task: () => Promise<void>): void {
    const tail = (this.lanes.get(lane) ?? Promise.resolve()).then(task);
    this.lanes.set(lane, tail);
    void tail.then(() => {
      if (this.lanes.get(lane) === tail) this.lanes.delete(lane);
    });
  }

  private async dispatch(
    type: DomainEvent,
    payload: unknown,
    meta: DomainEventMeta,
  ): Promise<void> {
    // 先複製一份：handler 執行中取消訂閱不影響這一輪
    const handlers = Array.from(this.handlers.get(type) ?? []);
    for (const handler of handlers) {
      try {
        await handler(payload, meta);
      } catch (error) {
        this.logger.error({ err: error, event: type }, '領域事件處理失敗（已忽略）');
      }
    }
  }
}
