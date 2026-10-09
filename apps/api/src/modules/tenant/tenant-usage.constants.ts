/**
 * 儲存使用率達到這個比例就標成警示，並在越過時通知平台管理者（docs/architecture/05-tenancy.md §14.2 D8）。
 * 固定值：門檻是產品的決定，不是部署的設定；要依租戶調整時再改成 feature 參數。
 */
export const TENANT_USAGE_WARNING_RATIO = 0.8;

/** 租戶清單的「近期請求數」是近幾天（含今天）。 */
export const TENANT_USAGE_RECENT_DAYS = 7;

/**
 * 所有租戶的已用量合計越過止水線的這些比例時通知平台管理者（docs/architecture/backend/25-image.md §12 D8）；
 * 由高到低，一次彙總只通知越過的最高那一個。
 */
export const STORAGE_TOTAL_NOTIFY_RATIOS = [1, 0.8] as const;
export const STORAGE_TOTAL_WARNING_RATIO = 0.8;
