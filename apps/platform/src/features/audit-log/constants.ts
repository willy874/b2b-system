/**
 * 單次查詢的時間範圍上限（天），與後端一致；超過會被後端回 400。
 * 沒選日期時後端查「現在往前 90 天」。
 */
export const AUDIT_LOG_MAX_RANGE_DAYS = 90;
