/**
 * Feature flag：暫時的上線開關（docs/architecture/05-tenancy.md §11）。與 `TENANT_FEATURES`（長期的模組，docs/architecture/frontend/02-plugin-system.md §9）不同，
 * 每個 flag 都有 `removeBy`，到期前要連同判斷與舊的程式碼路徑一起刪除（D11、D12）。
 */
export interface FeatureFlagDefinition {
  /** `<模組>.<名稱>`（camelCase），例：`levelEditor.v2`。上線後不改名：改名等於新 flag，覆寫會遺失。 */
  key: string;
  /** 給平台管理者看的說明（apps/platform 的列表頁）。 */
  description: string;
  /** 兩級覆寫都沒有時的值；全面開放時可以改成 `true` 並部署（D12 ①）。 */
  defaultEnabled: boolean;
  /** 負責移除的人或團隊。 */
  owner: string;
  /** 預計移除的日期（`YYYY-MM-DD`，UTC）；過了還在目錄裡，測試就失敗（D11）。 */
  removeBy: string;
}

/**
 * flag 的目錄（D1）。新增一列即可：DTO、平台管理頁、到期檢查都讀這份清單。
 *
 * key 在 OpenAPI 上是字串而不是 enum：目錄常常是空的（沒有試行中的功能），空的 enum 產不出可用的型別，
 * 所以 key 由伺服器依這份目錄驗證（不認得的回 `VALIDATION_FAILED` 或 `FEATURE_FLAG_NOT_FOUND`）。
 */
export const FEATURE_FLAGS: readonly FeatureFlagDefinition[] = [];

/** 全平台層的覆寫（D2）。沒有列 = 不覆寫。 */
export const FEATURE_FLAG_GLOBAL_STATES = ['on', 'off'] as const;
export type FeatureFlagGlobalState = (typeof FEATURE_FLAG_GLOBAL_STATES)[number];

/** 租戶層的覆寫：`{ [key]: boolean }`，沒列出 = 不覆寫。 */
export type FeatureFlagOverrides = Readonly<Record<string, boolean>>;

export const FEATURE_FLAG_KEY_PATTERN = /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 「全平台 ＋ 租戶」兩級覆寫的生效值（D3）：全平台 `off` 一律關（緊急開關，蓋過租戶層）→ 租戶層有值就用它 →
 * 全平台 `on` → 預設值。feature flag 與 MFA 的方式（docs/architecture/backend/21-mfa.md §5、D4）共用這個規則。
 */
export function resolveToggle(
  defaultEnabled: boolean,
  global: FeatureFlagGlobalState | undefined,
  tenant: boolean | undefined,
): boolean {
  if (global === 'off') return false;
  if (tenant !== undefined) return tenant;
  if (global === 'on') return true;
  return defaultEnabled;
}

/** flag 的生效值（D3）：`resolveToggle` 的規則。 */
export function resolveFeatureFlag(
  definition: Pick<FeatureFlagDefinition, 'defaultEnabled'>,
  global: FeatureFlagGlobalState | undefined,
  tenant: boolean | undefined,
): boolean {
  return resolveToggle(definition.defaultEnabled, global, tenant);
}

/**
 * 從 DB 讀出的租戶覆寫只留布林值（jsonb 可能被手動改壞）。不認得的 key 留著無害：判斷只查目錄裡的 key，
 * 平台管理 API 回傳前另外以目錄過濾（`pickKnownOverrides`）。
 */
export function toFeatureFlagOverrides(value: unknown): FeatureFlagOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === 'boolean',
    ),
  );
}

/** 只留目錄裡有的 key，依目錄的順序：程式移除 flag 之後，DB 殘留的覆寫不會流到 API（D12）。 */
export function pickKnownOverrides(
  overrides: FeatureFlagOverrides,
  catalog: readonly FeatureFlagDefinition[],
): Record<string, boolean> {
  const known: Record<string, boolean> = {};
  for (const { key } of catalog) {
    const value = overrides[key];
    if (value !== undefined) known[key] = value;
  }
  return known;
}

/** 目錄本身的錯誤（格式、重複、日期）；啟動時與測試都檢查。 */
export function catalogProblems(catalog: readonly FeatureFlagDefinition[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const flag of catalog) {
    if (!FEATURE_FLAG_KEY_PATTERN.test(flag.key)) {
      problems.push(`${flag.key}：key 要是 <模組>.<名稱>（camelCase）`);
    }
    if (seen.has(flag.key)) problems.push(`${flag.key}：key 重複`);
    seen.add(flag.key);
    if (!DATE_PATTERN.test(flag.removeBy) || Number.isNaN(Date.parse(flag.removeBy))) {
      problems.push(`${flag.key}：removeBy 要是 YYYY-MM-DD`);
    }
  }
  return problems;
}

/** `removeBy` 早於 `today`（`YYYY-MM-DD`）的 flag（D11）。 */
export function expiredFeatureFlags(
  catalog: readonly FeatureFlagDefinition[],
  today: string,
): FeatureFlagDefinition[] {
  return catalog.filter((flag) => flag.removeBy < today);
}
