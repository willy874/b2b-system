import { Injectable } from '@nestjs/common';

import type { TenantFeature } from './tenant-features';

/**
 * 關閉一個 feature 會影響的東西（平台管理者關閉前的確認框列出數字）。
 * 值在這裡列成固定清單：前端以對照表翻譯，OpenAPI 也有明確的列舉。
 */
export const TENANT_FEATURE_IMPACT_KEYS = [
  // identityProvider（docs/architecture/04-sso.md §12）
  'identityProviderConnections',
  'ssoOnlyDomains',
  'passwordlessExternalUsers',
  // group（docs/architecture/iam/07-groups.md §8）
  'groups',
  'groupMembers',
  'groupRoleGrants',
  // organization（docs/architecture/backend/23-organization.md §6）
  'orgUnits',
  'orgUnitMembers',
  'approvalFlowsUsingOrg',
  // approvalChain（docs/architecture/backend/20-approval.md §9.11）
  'approvalFlows',
  'approvalRequestsInChain',
] as const;

export type TenantFeatureImpactKey = (typeof TENANT_FEATURE_IMPACT_KEYS)[number];

/** 在 **目前租戶** 的脈絡裡計算（呼叫端負責進入租戶）。 */
export type TenantFeatureImpactCounter = () => Promise<
  Partial<Record<TenantFeatureImpactKey, number>>
>;

/**
 * feature → 影響的計數。擁有 feature 的模組在 `onModuleInit` 登記（core 不認識業務模組，
 * docs/coding-standards/07-layer-dependencies.md §3.2）；沒有登記的 feature 沒有數字，確認框只顯示一般的說明。
 */
@Injectable()
export class TenantFeatureImpacts {
  private readonly counters = new Map<TenantFeature, TenantFeatureImpactCounter>();

  register(feature: TenantFeature, counter: TenantFeatureImpactCounter): void {
    if (this.counters.has(feature)) throw new Error(`feature ${feature} 的影響計數重複登記`);
    this.counters.set(feature, counter);
  }

  counterOf(feature: TenantFeature): TenantFeatureImpactCounter | undefined {
    return this.counters.get(feature);
  }
}
