/**
 * 單次查詢的時間範圍上限（天），與後端 `AUDIT_LOG_MAX_RANGE_DAYS`
 * （apps/api/src/modules/audit-log/audit-log.constants.ts）一致；超過會被後端回 400。
 * 沒選日期時後端查「現在往前 90 天」。
 */
export const AUDIT_LOG_MAX_RANGE_DAYS = 90;

/** offset 的上限（後端 `AUDIT_LOG_MAX_OFFSET`，與其他列表的 `LIST_MAX_OFFSET` 相同）；網址帶更大的值時回到第一頁。 */
export const AUDIT_LOG_MAX_OFFSET = 10_000;

/**
 * 稽核的總數最多數到這裡（`apps/api/src/modules/audit-log/audit-log.constants.ts` 的 `AUDIT_LOG_COUNT_CAP`）：
 * 到了代表「至少這麼多」，摘要改說「以上」（docs/architecture/backend/06-audit-log.md §7.2）。
 */
export const AUDIT_LOG_COUNT_CAP = AUDIT_LOG_MAX_OFFSET + 100;
