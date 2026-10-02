import { Injectable } from '@nestjs/common';

import type { TenantFeature } from '@/core/tenant';

import type { AnyWebhookEventType } from './webhook.definition';

/**
 * 對外事件的目錄（docs/architecture/backend/17-webhook.md §9.2 D1）：系統會發出哪些事件。擁有者模組在自己的 `*.module.ts` constructor
 * 呼叫 `register()`，與通知的事件目錄同一種做法；webhook 模組不認識任何業務模組。
 */
@Injectable()
export class WebhookEventCatalog {
  private readonly events = new Map<string, AnyWebhookEventType>();

  /** 重複的事件是程式錯誤，啟動就失敗。 */
  register(events: readonly AnyWebhookEventType[]): void {
    for (const event of events) {
      if (this.events.has(event.type)) throw new Error(`對外事件 ${event.type} 重複登記`);
      this.events.set(event.type, event);
    }
  }

  /** 訂閱得到的事件（登記順序）：可訂閱、且所屬 feature 已啟用（沒有 feature 的一律列出）。 */
  subscribable(features: readonly TenantFeature[]): AnyWebhookEventType[] {
    return [...this.events.values()].filter(
      (event) => event.subscribable && (!event.feature || features.includes(event.feature)),
    );
  }

  /** 已登記而且可訂閱（不看 feature：訂閱存的是名稱，feature 之後再打開時就會送）。 */
  isSubscribable(type: string): boolean {
    return this.events.get(type)?.subscribable ?? false;
  }

  /** 沒有登記就拋錯：`emit()` 發得出去的事件都要在目錄上，訂閱頁才不會漏列（D1）。 */
  assertRegistered(type: string): void {
    if (!this.events.has(type)) {
      throw new Error(
        `對外事件 ${type} 沒有登記（擁有者的 *.module.ts 要呼叫 WebhookEventCatalog.register）`,
      );
    }
  }
}
