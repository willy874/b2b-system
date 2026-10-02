/**
 * 可以由平台管理者為每個租戶開關的 feature（docs/adr/0021-runtime-feature-activation.md D8、D11）。
 *
 * 值存在平台 DB 的 `tenants.features`；api 以 `@RequireFeature()` 擋下未啟用 feature 的端點（`FEATURE_DISABLED`），
 * `/auth/profile` 回傳目前租戶啟用的清單，前端據此安裝或移除對應的 plugin。
 * 其餘 feature 是常駐的（ADR-0021「原本待決、已定案的事項」2），不在這份清單。
 * 各 id 停用時的行為（哪些端點 404、哪些資料與背景工作照舊）見 docs/adr/0029-toggleable-platform-features.md。
 *
 * 新增一個 id 時：平台 DB 的預設值（`db/platform/schema/tenants.ts`）要不要跟著加，要另外決定——
 * 既有租戶不會因為這裡多了一個值就自動啟用。
 */
export const TENANT_FEATURES = [
  'file',
  'auditLog',
  'job',
  // ADR-0029：原本常駐、改為可由平台關閉的通用能力
  'trash',
  'systemSetting',
  'identityProvider',
  'tenantSwitch',
  // ADR-0030：對外送出事件（webhook）
  'webhook',
  // ADR-0031：公告與排程通知
  'announcement',
] as const;

export type TenantFeature = (typeof TENANT_FEATURES)[number];

/**
 * 從 DB 讀出的值只留認得的 id（依 `TENANT_FEATURES` 的順序、去重）：
 * 程式降版或移除 feature 後，DB 裡殘留的舊 id 不會流到前端或 guard。
 */
export function toTenantFeatures(values: readonly string[]): TenantFeature[] {
  const present = new Set(values);
  return TENANT_FEATURES.filter((feature) => present.has(feature));
}
