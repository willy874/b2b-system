import { Injectable, Logger } from '@nestjs/common';

import { getRequestContext } from '../http/request-context';
import type {
  DomainEvent,
  DomainEventHandler,
  DomainEventMeta,
  DomainEventPayloads,
} from './domain-events';

type AnyHandler = (payload: unknown, meta: DomainEventMeta) => void | Promise<void>;

/**
 * 行程內的領域事件匯流排（規則見 `domain-events.ts`）。
 *
 * - `publish()` 是 fire-and-forget：不拋錯、不等 handler，HTTP 回應不會因此變慢。
 * - 分派非同步但 **依序**：同一個 bus 的事件照發佈順序處理，每個 handler await 完才輪到下一個。
 *   所以同一次操作先發的 `permissions.changed` 一定比 `resource.changed` 先處理完。
 * - handler 的錯誤彼此隔離：記錄後吞掉。
 */
@Injectable()
export class DomainEventBus {
  private readonly logger = new Logger(DomainEventBus.name);
  private readonly handlers = new Map<DomainEvent, Set<AnyHandler>>();
  private queue: Promise<void> = Promise.resolve();

  publish<T extends DomainEvent>(type: T, payload: DomainEventPayloads[T]): void {
    try {
      const context = getRequestContext();
      const meta: DomainEventMeta = {
        occurredAt: new Date(),
        clientId: context?.clientId,
        requestId: context?.requestId,
      };
      this.queue = this.queue.then(() => this.dispatch(type, payload, meta));
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
    let pending: Promise<void>;
    do {
      pending = this.queue;
      await pending;
    } while (pending !== this.queue);
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
