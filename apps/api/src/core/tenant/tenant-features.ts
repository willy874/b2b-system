/**
 * 可以由平台管理者為每個租戶開關的 feature（docs/architecture/frontend/02-plugin-system.md §9.2 D8、D11）。
 *
 * 值存在平台 DB 的 `tenants.features`；api 以 `@RequireFeature()` 擋下未啟用 feature 的端點（`FEATURE_DISABLED`），
 * `/auth/profile` 回傳目前租戶啟用的清單，前端據此安裝或移除對應的 plugin。
 * 其餘 feature 是常駐的（docs/architecture/frontend/02-plugin-system.md §9「原本待決、已定案的事項」2），不在這份清單。
 * 各 id 停用時的行為（哪些端點 404、哪些資料與背景工作照舊）見 docs/architecture/05-tenancy.md §12。
 *
 * 新增一個 id 時：平台 DB 的預設值（`db/platform/schema/tenants.ts`）要不要跟著加，要另外決定——
 * 既有租戶不會因為這裡多了一個值就自動啟用。
 */
export const TENANT_FEATURES = [
  'file',
  'auditLog',
  'job',
  // docs/architecture/05-tenancy.md §12：原本常駐、改為可由平台關閉的通用能力
  'trash',
  'systemSetting',
  'identityProvider',
  'tenantSwitch',
  // docs/architecture/backend/17-webhook.md §9：對外送出事件（webhook）
  'webhook',
  // docs/architecture/backend/19-announcement.md §9：公告與排程通知
  'announcement',
  // docs/architecture/06-external-api.md §3.1：服務帳號與對外 API（以 API token 呼叫的獨立入口），連同內部的 token 管理
  'externalApi',
  // docs/architecture/iam/07-groups.md §8：群組。停用時群組帶來的授權（成員關係）也暫停
  'group',
  // docs/architecture/backend/22-data-transfer.md：匯入／匯出
  'dataTransfer',
  // docs/architecture/backend/23-organization.md：組織管理（部門樹、成員、主管）。預設啟用，既有租戶由平台 migration 0022 啟用（D3）
  'organization',
  // docs/architecture/backend/20-approval.md §9：多階段審批（審批本身常駐）。同上，預設啟用（D17）
  'approvalChain',
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
