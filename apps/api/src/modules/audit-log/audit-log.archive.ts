import { sql } from 'drizzle-orm';

import type { Database } from '@/core/database';

import { AUDIT_LOG_ARCHIVE_BATCH_SIZE } from './audit-log.constants';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 把早於 `now − retentionDays 天` 的紀錄分批搬到冷表，回傳總筆數。保留天數是租戶的參數
 * `auditLog.hotRetentionDays`（docs/adr/0033-feature-params-and-webhook-targets.md D7），由呼叫端讀出傳入。
 * 不依賴 DI：排程工作與 `pnpm db:archive-audit-logs` 共用（docs/conventions/07-layer-dependencies.md §3.2 註 3）。
 *
 * `archive_audit_logs()` 是 `SECURITY DEFINER`，應用程式的 role 不需要 `audit_logs` 的 DELETE 權限
 * （docs/adr/0016-background-jobs.md D8）。
 */
export async function archiveAuditLogs(
  db: Pick<Database, 'execute'>,
  retentionDays: number,
  now = new Date(),
  batchSize = AUDIT_LOG_ARCHIVE_BATCH_SIZE,
): Promise<{ moved: number; cutoff: Date }> {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  let moved = 0;
  for (;;) {
    // 每批一個獨立交易，批與批之間熱表可以正常寫入；刻意依序執行，同時跑只會互搶鎖
    // oxlint-disable-next-line no-await-in-loop -- 見上一行
    const [row] = await db.execute<{ moved: number }>(
      sql`SELECT archive_audit_logs(${cutoff.toISOString()}::timestamptz, ${batchSize}) AS moved`,
    );
    const batch = row?.moved ?? 0;
    moved += batch;
    if (batch < batchSize) break;
  }
  return { moved, cutoff };
}
