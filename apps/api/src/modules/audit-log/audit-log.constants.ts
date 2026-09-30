const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 單次查詢的時間範圍上限（天）。沒帶 `from` / `to` 時查「現在往前 90 天」。
 * 範圍有上限，`count(*)` 與排序的成本才不會隨著資料累積無限成長。
 */
export const AUDIT_LOG_MAX_RANGE_DAYS = 90;

/**
 * 熱表保留天數：早於「現在 − 此天數」的紀錄會被 `archive_audit_logs()` 搬到冷表。
 * 必須 ≥ `AUDIT_LOG_MAX_RANGE_DAYS`，預設查詢範圍才會只落在熱表。
 */
export const AUDIT_LOG_HOT_RETENTION_DAYS = 90;

/** 每次搬移的筆數：一批一個短交易，避免長時間鎖住熱表。 */
export const AUDIT_LOG_ARCHIVE_BATCH_SIZE = 5000;

/**
 * offset 分頁的上限：深分頁要掃過 offset + limit 筆。
 * 再往後請縮小時間範圍或加篩選條件。
 */
export const AUDIT_LOG_MAX_OFFSET = 10_000;

/**
 * `total` 最多數到這裡（`count(*)` 包在 `LIMIT` 子查詢裡）：90 天數百萬列時每頁都精算太貴，
 * 能翻到的最後一頁（`AUDIT_LOG_MAX_OFFSET` ＋ 一頁）之後的數字沒有用處。
 */
export const AUDIT_LOG_COUNT_CAP = AUDIT_LOG_MAX_OFFSET + 100;

export const AUDIT_LOG_MAX_RANGE_MS = AUDIT_LOG_MAX_RANGE_DAYS * DAY_MS;
export const AUDIT_LOG_HOT_RETENTION_MS = AUDIT_LOG_HOT_RETENTION_DAYS * DAY_MS;

export interface AuditLogRange {
  from: Date;
  to: Date;
  /** 範圍有一部分早於熱表保留期，必須連冷表一起查 */
  includeArchive: boolean;
}

/**
 * 補齊查詢範圍並決定要查哪幾張表。
 *
 * - 都沒帶：`[now − 90 天, now]`
 * - 只帶 `to`：往前推 90 天
 * - 只帶 `from`：往後推 90 天，但不超過 `now`
 * - 都帶：原樣使用（跨度與先後由 DTO 驗證）
 *
 * 熱表永遠包含「`now − 保留天數` 之後」的全部紀錄（搬移的 cutoff 只會更早），
 * 所以 `from` 落在這之後就只需要查熱表。
 */
export function resolveAuditLogRange(query: { from?: Date; to?: Date }, now: Date): AuditLogRange {
  let { from, to } = query;
  if (!to) {
    to = from ? new Date(Math.min(now.getTime(), from.getTime() + AUDIT_LOG_MAX_RANGE_MS)) : now;
  }
  from ??= new Date(to.getTime() - AUDIT_LOG_MAX_RANGE_MS);
  const hotBoundary = now.getTime() - AUDIT_LOG_HOT_RETENTION_MS;
  return { from, to, includeArchive: from.getTime() < hotBoundary };
}
