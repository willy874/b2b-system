import type { PermissionKey } from '@/db/seeds/permissions';

import type { TenantFeature } from '../tenant';

/**
 * 權限鍵屬於哪些可啟用的 feature（docs/architecture/05-tenancy.md §15.2 D1）：列出的 feature 全部啟用，這個鍵才存在。
 * 只用在「給人看的清單」——權限目錄、角色持有的鍵、`/auth/profile` 的 `permissions`、權限來源——讓平台未開放的功能整個隱藏；
 * 授權判斷不經過這裡，未啟用 feature 的端點本來就由 `FeatureGuard` 回 404。
 */
const RESOURCE_FEATURES: Partial<Record<string, TenantFeature>> = {
  file: 'file',
  job: 'job',
  auditLog: 'auditLog',
  identityProvider: 'identityProvider',
  group: 'group',
  serviceAccount: 'externalApi',
  webhook: 'webhook',
  announcement: 'announcement',
  orgUnit: 'organization',
  approvalFlow: 'approvalChain',
  gallery: 'gallery',
};

/** 不是整個資源、只有個別的鍵屬於某個 feature。 */
const KEY_FEATURES: Partial<Record<PermissionKey, TenantFeature>> = {
  // 強制定案與重新展開只存在於多階段審批（docs/architecture/backend/20-approval.md §9.8）
  'approval:override': 'approvalChain',
};

/** 鍵所屬的 feature；空陣列 = 常駐。 */
export function permissionFeaturesOf(key: PermissionKey): TenantFeature[] {
  const [resource, action] = key.split(':') as [string, string];
  const features = new Set<TenantFeature>();
  const byResource = RESOURCE_FEATURES[resource];
  if (byResource) features.add(byResource);
  const byKey = KEY_FEATURES[key];
  if (byKey) features.add(byKey);
  // 各資源的匯出都經由匯入／匯出（docs/architecture/backend/22-data-transfer.md §13 D11）
  if (action === 'export') features.add('dataTransfer');
  return [...features];
}

/** 這個鍵所屬的 feature 是否都在 `enabled` 裡。 */
export function isPermissionAvailable(
  key: PermissionKey,
  enabled: readonly TenantFeature[],
): boolean {
  return permissionFeaturesOf(key).every((feature) => enabled.includes(feature));
}
