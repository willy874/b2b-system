import { Injectable } from '@nestjs/common';

import type { AnnouncementTriggerDefinition } from './announcement.triggers';

/**
 * 公告的觸發點目錄（docs/adr/0031-announcements.md D12）：擁有者模組在自己的 `*.module.ts` constructor 登記，
 * 與通知的事件目錄同一種做法；公告模組不 import 任何擁有者。重複登記讓程序啟動失敗。
 */
@Injectable()
export class AnnouncementTriggerCatalog {
  private readonly definitions = new Map<string, AnnouncementTriggerDefinition>();

  register(definitions: readonly AnnouncementTriggerDefinition[]): void {
    for (const definition of definitions) {
      if (this.definitions.has(definition.event)) {
        throw new Error(`公告的觸發點 ${definition.event} 重複登記`);
      }
      this.definitions.set(definition.event, definition);
    }
  }

  /** 登記的順序。 */
  list(): AnnouncementTriggerDefinition[] {
    return [...this.definitions.values()];
  }

  find(event: string): AnnouncementTriggerDefinition | undefined {
    return this.definitions.get(event);
  }

  /** 觸發時用：沒有登記是呼叫端的程式錯誤。 */
  get(event: string): AnnouncementTriggerDefinition {
    const definition = this.definitions.get(event);
    if (!definition)
      throw new Error(`公告的觸發點 ${event} 沒有登記（擁有者的 module 要呼叫 register）`);
    return definition;
  }
}
