import { Injectable } from '@nestjs/common';
import type { OnApplicationBootstrap } from '@nestjs/common';

import { TRASH_PERMISSIONS, TRASH_RESOURCE_TYPES } from './trash.constants';
import type { TrashResourceType } from './trash.constants';
import type { TrashHandler } from './trash.types';

/**
 * 資源類型 → 回收桶 handler。handler 由擁有資源的模組在 `onModuleInit` 註冊，
 * 讓 `TrashModule` 不必反向依賴業務模組（與 `ApprovalHandlerRegistry` 同一個模式）。
 */
@Injectable()
export class TrashRegistry implements OnApplicationBootstrap {
  private readonly handlers = new Map<TrashResourceType, TrashHandler>();

  register(handler: TrashHandler): void {
    if (this.handlers.has(handler.type)) {
      throw new Error(`回收桶類型 ${handler.type} 已經註冊過 handler`);
    }
    if (!(TRASH_RESOURCE_TYPES as readonly string[]).includes(handler.type)) {
      throw new Error(`回收桶類型 ${handler.type} 不在 TRASH_RESOURCE_TYPES（trash.constants.ts）`);
    }
    if (!TRASH_PERMISSIONS.includes(handler.permission)) {
      throw new Error(
        `回收桶類型 ${handler.type} 的權限 ${handler.permission} 不在 TRASH_PERMISSIONS（trash.constants.ts）`,
      );
    }
    this.handlers.set(handler.type, handler);
  }

  /** DTO 的 enum 與註冊一致（啟動時檢查），找不到只會是程式錯誤。 */
  get(type: TrashResourceType): TrashHandler {
    const handler = this.handlers.get(type);
    if (!handler) throw new Error(`回收桶類型 ${type} 沒有註冊 handler`);
    return handler;
  }

  /** 依 `purgeOrder` 排好的 handler（永久刪除的順序）。 */
  inPurgeOrder(): TrashHandler[] {
    return [...this.handlers.values()].toSorted((a, b) => a.purgeOrder - b.purgeOrder);
  }

  /** 列在 `TRASH_RESOURCE_TYPES` 的類型都要有 handler：擁有者模組沒載入就讓程序啟動失敗。 */
  onApplicationBootstrap(): void {
    const missing = TRASH_RESOURCE_TYPES.filter((type) => !this.handlers.has(type));
    if (missing.length > 0) {
      throw new Error(`回收桶類型沒有註冊 handler：${missing.join(', ')}`);
    }
  }
}
