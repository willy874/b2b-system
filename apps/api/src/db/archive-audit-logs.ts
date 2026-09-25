import { sql } from 'drizzle-orm';

import {
  AUDIT_LOG_ARCHIVE_BATCH_SIZE,
  AUDIT_LOG_HOT_RETENTION_MS,
} from '@/modules/audit-log/audit-log.constants';

import { createScriptClient, loadScriptEnv } from './client';

/**
 * 稽核日誌熱 → 冷搬移（docs/architecture/backend/06-audit-log.md §8）。
 * 由排程（cron / k8s CronJob）每天執行一次；需要 `audit_logs` 的 DELETE 權限，
 * 應以維運 role 的 DATABASE_URL 執行，而不是應用程式的 role。
 */
async function main(): Promise<void> {
  loadScriptEnv();
  const { client, db } = createScriptClient();
  const cutoff = new Date(Date.now() - AUDIT_LOG_HOT_RETENTION_MS);

  let total = 0;
  for (;;) {
    // 每批一個獨立交易，批與批之間熱表可以正常寫入；刻意依序執行，同時跑只會互搶鎖
    // oxlint-disable-next-line no-await-in-loop -- 見上一行
    const [row] = await db.execute<{ moved: number }>(
      sql`SELECT archive_audit_logs(${cutoff.toISOString()}::timestamptz, ${AUDIT_LOG_ARCHIVE_BATCH_SIZE}) AS moved`,
    );
    const moved = row?.moved ?? 0;
    total += moved;
    if (moved < AUDIT_LOG_ARCHIVE_BATCH_SIZE) break;
  }

  console.info(`稽核日誌搬移完成：${total} 筆早於 ${cutoff.toISOString()} 的紀錄已移到冷表`);
  await client.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
