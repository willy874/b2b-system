import { archiveAuditLogs } from '@/modules/audit-log/audit-log.archive';

import { createScriptClient, loadScriptEnv } from './client';

/**
 * 稽核日誌熱 → 冷搬移的手動入口（docs/architecture/backend/06-audit-log.md §8）。
 * 平常由背景工作 `auditLog.archive` 每天執行；排程出問題時用這支補跑，行為相同。
 */
async function main(): Promise<void> {
  loadScriptEnv();
  const { client, db } = createScriptClient();
  const { moved, cutoff } = await archiveAuditLogs(db);
  console.info(`稽核日誌搬移完成：${moved} 筆早於 ${cutoff.toISOString()} 的紀錄已移到冷表`);
  await client.end();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
