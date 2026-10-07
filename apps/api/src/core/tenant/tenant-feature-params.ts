import { isCidrList } from '../rate-limit/ip';
import { requireTenant } from './tenant-context';
import type { TenantFeature } from './tenant-features';

/**
 * 可啟用 feature 的參數（docs/architecture/05-tenancy.md §13.2 D1）：平台管理者為每個租戶設定的配額與上限。
 * 值存在平台 DB 的 `tenants.feature_params`（只存覆寫值），經 `TenantDirectory` 進到 `TenantContext.featureParams`。
 *
 * 目錄在 `core/`：`TenantContext` 與背景工作佇列都要讀，`core/` 不 import `modules/`。參數的效果由各擁有者模組實作，
 * 對照見 docs/architecture/05-tenancy.md §5.3。
 */
export const TENANT_FEATURE_PARAM_UNITS = ['days', 'megabytes', 'count', 'perMinute'] as const;
export type TenantFeatureParamUnit = (typeof TENANT_FEATURE_PARAM_UNITS)[number];

interface TenantFeatureParamBase<K extends string> {
  /** `<feature>.<名稱>`（camelCase）；上線後不改名：改名等於新參數，既有的覆寫會遺失。 */
  key: K;
  /**
   * 所屬的 feature：管理頁把參數列在這個 feature 的那一列下。feature 關閉時參數照常生效（D5）。
   * `null`：不屬於任何可開關的 feature、對整個租戶生效的限制（例：登入的速率），管理頁另列一區。
   */
  feature: TenantFeature | null;
}

export interface TenantIntegerParam<K extends string = string> extends TenantFeatureParamBase<K> {
  type: 'integer';
  defaultValue: number;
  min: number;
  max: number;
  unit: TenantFeatureParamUnit;
  /** 代表「不限（永久）」的特殊值，不受 `min`／`max` 限制（例：保留期限的 -1）。沒有就不允許。 */
  foreverValue?: number;
}

export interface TenantStringParam<K extends string = string> extends TenantFeatureParamBase<K> {
  type: 'string';
  defaultValue: string;
  maxLength: number;
  /** 值必須整個符合；沒有就只限長度。 */
  pattern?: RegExp;
  /** 正規表示式寫不清楚的格式（例：CIDR 清單）。 */
  validate?: (value: string) => boolean;
}

export type TenantFeatureParamDefinition<K extends string = string> =
  | TenantIntegerParam<K>
  | TenantStringParam<K>;

export type TenantFeatureParamValue = number | string;

/** 租戶層的覆寫：`{ [key]: value }`，沒列出 = 預設值。 */
export type TenantFeatureParamOverrides = Readonly<Record<string, TenantFeatureParamValue>>;

/** D7：稽核熱表保留天數；早於「現在 − 天數」的紀錄由 `auditLog.archive` 搬到冷表。 */
export const AUDIT_LOG_HOT_RETENTION_DAYS_PARAM = {
  key: 'auditLog.hotRetentionDays',
  feature: 'auditLog',
  type: 'integer',
  defaultValue: 90,
  min: 7,
  max: 3650,
  unit: 'days',
} as const satisfies TenantIntegerParam;

/**
 * 稽核冷表的保留天數（docs/architecture/backend/06-audit-log.md §10 D3）：每天的 `auditLog.archive` 以 DROP 整個月份分區刪除早於它的紀錄。
 * `-1` = 永久保留。最少 365 天（資料庫函式另有同樣的硬下限）；實際至少保留 `auditLog.hotRetentionDays`。只有平台管理者能改。
 */
export const AUDIT_LOG_RETENTION_DAYS_PARAM = {
  key: 'auditLog.retentionDays',
  feature: 'auditLog',
  type: 'integer',
  defaultValue: 365,
  min: 365,
  max: 36_500,
  unit: 'days',
  foreverValue: -1,
} as const satisfies TenantIntegerParam;

/** D8：所有檔案的大小合計上限（MB = 1024 × 1024 位元組；含上傳中與回收桶裡的檔案）。 */
export const FILE_STORAGE_QUOTA_MB_PARAM = {
  key: 'file.storageQuotaMb',
  feature: 'file',
  type: 'integer',
  defaultValue: 2048,
  min: 1,
  max: 10_485_760,
  unit: 'megabytes',
} as const satisfies TenantIntegerParam;

/** D9：這個租戶所有種類的背景工作同時執行的筆數（跨程序）。 */
export const JOB_MAX_CONCURRENCY_PARAM = {
  key: 'job.maxConcurrency',
  feature: 'job',
  type: 'integer',
  defaultValue: 10,
  min: 1,
  max: 100,
  unit: 'count',
} as const satisfies TenantIntegerParam;

/** D10：外部 IdP 連線數上限。 */
export const IDENTITY_PROVIDER_MAX_PROVIDERS_PARAM = {
  key: 'identityProvider.maxProviders',
  feature: 'identityProvider',
  type: 'integer',
  defaultValue: 10,
  min: 1,
  max: 100,
  unit: 'count',
} as const satisfies TenantIntegerParam;

/** D11：整個租戶的 webhook 訂閱裡不重複的目標網址數。 */
export const WEBHOOK_MAX_URLS_PARAM = {
  key: 'webhook.maxUrls',
  feature: 'webhook',
  type: 'integer',
  defaultValue: 1,
  min: 1,
  max: 500,
  unit: 'count',
} as const satisfies TenantIntegerParam;

/**
 * 匯入一次的列數上限（docs/architecture/backend/22-data-transfer.md §10）：決定分析與套用的伺服器負載，
 * 由平台控制，不讓租戶自己調高。
 */
export const DATA_TRANSFER_IMPORT_MAX_ROWS_PARAM = {
  key: 'dataTransfer.importMaxRows',
  feature: 'dataTransfer',
  type: 'integer',
  defaultValue: 5000,
  min: 100,
  max: 20_000,
  unit: 'count',
} as const satisfies TenantIntegerParam;

/** 匯入分析的檔案大小上限（MB）；`POST /data-transfers/imports` 的請求本體上限是它的兩倍。 */
export const DATA_TRANSFER_IMPORT_MAX_SIZE_MB_PARAM = {
  key: 'dataTransfer.importMaxSizeMb',
  feature: 'dataTransfer',
  type: 'integer',
  defaultValue: 10,
  min: 1,
  max: 50,
  unit: 'megabytes',
} as const satisfies TenantIntegerParam;

/** 匯出一次的列數上限。 */
export const DATA_TRANSFER_EXPORT_MAX_ROWS_PARAM = {
  key: 'dataTransfer.exportMaxRows',
  feature: 'dataTransfer',
  type: 'integer',
  defaultValue: 100_000,
  min: 1000,
  max: 1_000_000,
  unit: 'count',
} as const satisfies TenantIntegerParam;

/**
 * 這個租戶的登入類請求（`@RateLimit('auth')`）每分鐘合計的上限（docs/architecture/backend/03-api-conventions.md §8）：
 * 一個租戶被攻擊時，攻擊流量（與它消耗的 argon2）不拖垮其他租戶的登入。沒覆寫時用環境變數 `AUTH_TENANT_RATE_LIMIT`。
 */
export const RATE_LIMIT_AUTH_PER_MINUTE_PARAM = {
  key: 'rateLimit.authPerMinute',
  feature: null,
  type: 'integer',
  defaultValue: 1200,
  min: 60,
  max: 100_000,
  unit: 'perMinute',
} as const satisfies TenantIntegerParam;

/**
 * 這個租戶信任的來源網段（逗號分隔的 IP 或 CIDR，平台管理者設定）：來自這些網段的登入，以 IP 計的登入上限放寬 10 倍
 * （企業 NAT 後整間公司共用一個 IP）。只放寬 IP 桶：帳號、漸進延遲、租戶桶不變（docs/architecture/backend/03-api-conventions.md §8）。
 */
export const RATE_LIMIT_TRUSTED_CIDRS_PARAM = {
  key: 'rateLimit.trustedCidrs',
  feature: null,
  type: 'string',
  defaultValue: '',
  maxLength: 1000,
  validate: isCidrList,
} as const satisfies TenantStringParam;

/**
 * 參數的目錄（D1），依 `TENANT_FEATURES` 的順序排。新增一列即可：DTO、平台管理頁、讀取時的驗證都讀這份清單。
 * key 以 `TenantFeatureParamKey` 出現在 OpenAPI，前端以 `satisfies Record<TenantFeatureParamKey, …>` 對照語系。
 */
export const TENANT_FEATURE_PARAMS = [
  FILE_STORAGE_QUOTA_MB_PARAM,
  AUDIT_LOG_HOT_RETENTION_DAYS_PARAM,
  AUDIT_LOG_RETENTION_DAYS_PARAM,
  JOB_MAX_CONCURRENCY_PARAM,
  IDENTITY_PROVIDER_MAX_PROVIDERS_PARAM,
  WEBHOOK_MAX_URLS_PARAM,
  DATA_TRANSFER_IMPORT_MAX_ROWS_PARAM,
  DATA_TRANSFER_IMPORT_MAX_SIZE_MB_PARAM,
  DATA_TRANSFER_EXPORT_MAX_ROWS_PARAM,
  // 不屬於 feature 的租戶限制（feature: null）
  RATE_LIMIT_AUTH_PER_MINUTE_PARAM,
  RATE_LIMIT_TRUSTED_CIDRS_PARAM,
] as const satisfies readonly TenantFeatureParamDefinition[];

export type TenantFeatureParamKey = (typeof TENANT_FEATURE_PARAMS)[number]['key'];

export const TENANT_FEATURE_PARAM_KEYS = TENANT_FEATURE_PARAMS.map(({ key }) => key) as [
  TenantFeatureParamKey,
  ...TenantFeatureParamKey[],
];

const BY_KEY: ReadonlyMap<string, TenantFeatureParamDefinition> = new Map(
  TENANT_FEATURE_PARAMS.map((param) => [param.key, param]),
);

export function findTenantFeatureParam(key: string): TenantFeatureParamDefinition | undefined {
  return BY_KEY.get(key);
}

/**
 * 值不符合定義時的原因（`null` = 符合）：給 API 的 `VALIDATION_FAILED` 與讀取時的過濾共用。
 */
export function tenantFeatureParamProblem(
  param: TenantFeatureParamDefinition,
  value: unknown,
): string | null {
  if (param.type === 'integer') {
    if (typeof value !== 'number' || !Number.isInteger(value)) return 'must be an integer';
    if (param.foreverValue !== undefined && value === param.foreverValue) return null;
    if (value < param.min) return `must be >= ${param.min}`;
    if (value > param.max) return `must be <= ${param.max}`;
    return null;
  }
  if (typeof value !== 'string') return 'must be a string';
  if (value.length > param.maxLength) return `must be at most ${param.maxLength} characters`;
  if (param.pattern && !param.pattern.test(value)) return 'invalid format';
  if (param.validate && !param.validate(value)) return 'invalid format';
  return null;
}

/**
 * 從 DB 讀出的覆寫只留目錄裡的 key 且值通過驗證的項目，依目錄的順序（D2）：程式移除參數或收緊範圍之後，
 * 殘留的值回到預設，不讓請求失敗；jsonb 被手動改壞也一樣。
 */
export function toTenantFeatureParamOverrides(value: unknown): TenantFeatureParamOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const overrides: Record<string, TenantFeatureParamValue> = {};
  for (const param of TENANT_FEATURE_PARAMS) {
    const item = raw[param.key];
    if (item === undefined || tenantFeatureParamProblem(param, item) !== null) continue;
    overrides[param.key] = item as TenantFeatureParamValue;
  }
  return overrides;
}

type ValueOf<P extends TenantFeatureParamDefinition> = P extends TenantIntegerParam
  ? number
  : string;

/** 某個覆寫表下的生效值：有通過驗證的覆寫就用它，否則是預設值。 */
export function resolveTenantFeatureParam<P extends TenantFeatureParamDefinition>(
  param: P,
  overrides: TenantFeatureParamOverrides,
): ValueOf<P> {
  const value = overrides[param.key];
  const valid = value !== undefined && tenantFeatureParamProblem(param, value) === null;
  return (valid ? value : param.defaultValue) as ValueOf<P>;
}

/**
 * 目前租戶的生效值（D6）。沒有租戶脈絡時拋 `TENANT_NOT_FOUND`（`requireTenant()`）：參數一定屬於某個租戶，
 * 呼叫端忘了 `runInTenant` 不能悄悄退回預設值。
 */
export function tenantFeatureParam<P extends TenantFeatureParamDefinition>(param: P): ValueOf<P> {
  return resolveTenantFeatureParam(param, requireTenant().featureParams);
}
