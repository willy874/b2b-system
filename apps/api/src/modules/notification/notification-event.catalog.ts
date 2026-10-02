import { Injectable } from '@nestjs/common';

import type { AnyNotificationType } from './notification.definition';

/**
 * 事件目錄（docs/architecture/backend/16-notification-event.md §1、docs/architecture/backend/16-notification-event.md §9.2 D1、D2）：
 * 系統會發出哪些通知、各能經由哪些管道。擁有者模組在自己的 `*.module.ts` constructor 呼叫 `register()`，
 * 與 `SettingService.register()` 同一種做法；通知模組不認識任何業務模組。
 */
@Injectable()
export class NotificationEventCatalog {
  private readonly types = new Map<string, AnyNotificationType>();

  /** 重複的類型是程式錯誤，啟動就失敗。 */
  register(types: readonly AnyNotificationType[]): void {
    for (const kind of types) {
      if (this.types.has(kind.type)) throw new Error(`通知類型 ${kind.type} 重複登記`);
      this.types.set(kind.type, kind);
    }
  }

  /** 所有已登記的類型（登記順序）。 */
  list(): AnyNotificationType[] {
    return [...this.types.values()];
  }

  find(type: string): AnyNotificationType | undefined {
    return this.types.get(type);
  }

  /** 沒有登記就拋錯：`notify()` 發得出去的事件都要在目錄上，管理頁才不會漏列（D2）。 */
  get(type: string): AnyNotificationType {
    const kind = this.types.get(type);
    if (!kind) {
      throw new Error(
        `通知類型 ${type} 沒有登記（擁有者的 *.module.ts 要呼叫 NotificationEventCatalog.register）`,
      );
    }
    return kind;
  }
}
