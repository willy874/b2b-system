import { Injectable } from '@nestjs/common';

import { currentTenant } from '@/core/tenant';

import type { ApprovalType } from './approval.constants';
import type { ApprovalHandler } from './approval.types';

/**
 * 審批類型 → handler。handler 由擁有資源的模組在 `onModuleInit` 註冊，
 * 讓 `ApprovalModule` 保持葉節點、不必反向依賴業務模組。
 */
@Injectable()
export class ApprovalHandlerRegistry {
  private readonly handlers = new Map<ApprovalType, ApprovalHandler>();

  register(handler: ApprovalHandler): void {
    if (this.handlers.has(handler.type)) {
      throw new Error(`審批類型 ${handler.type} 已經註冊過 handler`);
    }
    this.handlers.set(handler.type, handler);
  }

  /** 不在登記裡回 undefined（流程設定的路徑參數由使用者輸入）。 */
  find(type: string): ApprovalHandler | undefined {
    return this.handlers.get(type as ApprovalType);
  }

  all(): ApprovalHandler[] {
    return [...this.handlers.values()];
  }

  /**
   * 所屬 feature 在目前租戶沒有開放的類型（docs/architecture/05-tenancy.md §15.2 D3）：列表、待審數、匯出排除，詳情當作不存在。
   * 沒有租戶脈絡（測試）時為空。
   */
  hiddenTypes(): ApprovalType[] {
    const tenant = currentTenant();
    if (!tenant) return [];
    return this.all()
      .filter((handler) => handler.feature && !tenant.features.includes(handler.feature))
      .map((handler) => handler.type);
  }

  /** 找不到代表資料庫裡有程式不認識的類型（例：回滾版本），屬於部署問題而非使用者錯誤。 */
  get(type: string): ApprovalHandler {
    const handler = this.handlers.get(type as ApprovalType);
    if (!handler) throw new Error(`審批類型 ${type} 沒有註冊 handler`);
    return handler;
  }
}
