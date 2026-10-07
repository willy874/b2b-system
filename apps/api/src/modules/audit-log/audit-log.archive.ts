import { sql } from 'drizzle-orm';

import type { Database } from '@/core/database';
import { auditLogs } from '@/db/schema';

import { AUDIT_LOG_ARCHIVE_BATCH_SIZE } from './audit-log.constants';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 把早於 `now − retentionDays 天` 的紀錄分批搬到冷表，回傳總筆數。保留天數是租戶的參數
 * `auditLog.hotRetentionDays`（docs/architecture/05-tenancy.md §13.3 D7），由呼叫端讀出傳入。
 * 不依賴 DI：排程工作與 `pnpm db:archive-audit-logs` 共用（docs/coding-standards/07-layer-dependencies.md §3.2 註 3）。
 *
 * `archive_audit_logs()` 是 `SECURITY DEFINER`，應用程式的 role 不需要 `audit_logs` 的 DELETE 權限
 * （docs/architecture/backend/10-jobs.md §9.2 D8）。
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

/** 一個被刪除的月份分區（`drop_expired_audit_archive_partitions` 的回傳）。 */
export interface PurgedAuditPartition {
  partition: string;
  rows: number;
}

/**
 * 冷表的分區維護（docs/architecture/backend/06-audit-log.md §10）：預建這個月與下個月的分區；租戶設了保留天數（不是 `-1`）時，
 * 以 DROP 整個月份分區刪除早於「現在 − 保留天數」的紀錄，並在熱表寫一筆 `auditLog.purge`（每個分區一筆）。
 * 實際保留至少是熱表的天數：熱表搬過來的紀錄不會一到冷表就被刪。資料庫函式另有 365 天的硬下限。
 * 不依賴 DI：排程工作與 `pnpm db:archive-audit-logs` 共用。
 */
export async function maintainAuditArchive(
  db: Pick<Database, 'execute' | 'insert'>,
  options: { retentionDays: number; hotRetentionDays: number; foreverValue: number },
  now = new Date(),
): Promise<PurgedAuditPartition[]> {
  const nextMonth = new Date(now.getTime() + 31 * DAY_MS);
  await db.execute(
    sql`SELECT ensure_audit_archive_partitions(${now.toISOString()}::timestamptz, ${nextMonth.toISOString()}::timestamptz)`,
  );
  if (options.retentionDays === options.foreverValue) return [];

  const effectiveDays = Math.max(options.retentionDays, options.hotRetentionDays);
  const cutoff = new Date(now.getTime() - effectiveDays * DAY_MS).toISOString().slice(0, 10);
  const rows = await db.execute<{ partition_name: string; row_count: string | number }>(
    sql`SELECT partition_name, row_count FROM drop_expired_audit_archive_partitions(${cutoff}::date)`,
  );
  const purged = [...rows].map((row) => ({
    partition: row.partition_name,
    rows: Number(row.row_count),
  }));
  if (purged.length > 0) {
    // 刪除本身也要留下紀錄（寫進熱表，不會被這次刪掉）
    await db.insert(auditLogs).values(
      purged.map((item) => ({
        occurredAt: now,
        actorId: null,
        actorEmail: 'system',
        action: 'auditLog.purge',
        resourceType: 'auditLog',
        resourceName: item.partition,
        result: 'success' as const,
        metadata: {
          partition: item.partition,
          rows: item.rows,
          retentionDays: effectiveDays,
          cutoff,
        },
      })),
    );
  }
  return purged;
}
