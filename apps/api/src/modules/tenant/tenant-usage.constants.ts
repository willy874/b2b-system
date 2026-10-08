/**
 * 儲存使用率達到這個比例就標成警示，並在越過時通知平台管理者（docs/architecture/05-tenancy.md §14.2 D8）。
 * 固定值：門檻是產品的決定，不是部署的設定；要依租戶調整時再改成 feature 參數。
 */
export const TENANT_USAGE_WARNING_RATIO = 0.8;

/** 租戶清單的「近期請求數」是近幾天（含今天）。 */
export const TENANT_USAGE_RECENT_DAYS = 7;
