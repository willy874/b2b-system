import { Injectable } from '@nestjs/common';

import type { DbOrTx } from '@/core/database';
import type { ApprovalAssigneeKind, ApprovalAssigneeRule } from '@/db/schema';

import type { ApprovalAssigneeResolver } from './approval.types';

/**
 * 審核者規則的種類 → 解析器（docs/architecture/backend/20-approval.md §9.2、D15）。
 * 擁有者模組在 `onModuleInit` 登記；沒有登記的種類（例：組織管理模組沒有載入）當作不可用、展開為空。
 */
@Injectable()
export class ApprovalAssigneeRegistry {
  private readonly resolvers = new Map<ApprovalAssigneeKind, ApprovalAssigneeResolver>();

  register<Kind extends ApprovalAssigneeKind>(resolver: ApprovalAssigneeResolver<Kind>): void {
    if (this.resolvers.has(resolver.kind)) {
      throw new Error(`審核者規則 ${resolver.kind} 已經登記過`);
    }
    // Map 存不下「kind 與 rule 的對應」；取出時以 rule.kind 查，形狀一定對得上，轉型集中在這個類別裡
    this.resolvers.set(resolver.kind, resolver as unknown as ApprovalAssigneeResolver);
  }

  isAvailable(kind: ApprovalAssigneeKind): boolean {
    return this.resolvers.get(kind)?.isAvailable() ?? false;
  }

  /** 展開成使用者 id（未過濾帳號狀態；由呼叫端過濾）。不可用的種類回空陣列。 */
  async resolve(
    rule: ApprovalAssigneeRule,
    ctx: { requesterId: string | null },
    tx?: DbOrTx,
  ): Promise<string[]> {
    const resolver = this.resolvers.get(rule.kind);
    if (!resolver || !resolver.isAvailable()) return [];
    return resolver.resolve(rule as never, ctx, tx);
  }

  async describe(rule: ApprovalAssigneeRule): Promise<{ label: string; deleted: boolean } | null> {
    const resolver = this.resolvers.get(rule.kind);
    return resolver ? resolver.describe(rule as never) : null;
  }
}
