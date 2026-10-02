import { AUDIT_LOG_HOT_RETENTION_DAYS_PARAM, resolveTenantFeatureParam } from '@/core/tenant';
import { archiveAuditLogs } from '@/modules/audit-log/audit-log.archive';

import { forEachScriptTenant, loadScriptEnv } from './client';

/**
 * 稽核日誌熱 → 冷搬移的手動入口（docs/architecture/backend/06-audit-log.md §8）。
 * 平常由背景工作 `auditLog.archive` 每天執行；排程出問題時用這支補跑，行為相同。
 */
async function main(): Promise<void> {
  loadScriptEnv();
  await forEachScriptTenant(async (db, tenant) => {
    // 保留天數是租戶的參數（docs/adr/0033-feature-params-and-webhook-targets.md D7），與排程讀同一份登記
    const retentionDays = resolveTenantFeatureParam(
      AUDIT_LOG_HOT_RETENTION_DAYS_PARAM,
      tenant.featureParams,
    );
    const { moved, cutoff } = await archiveAuditLogs(db, retentionDays);
    console.info(`稽核日誌搬移完成：${moved} 筆早於 ${cutoff.toISOString()} 的紀錄已移到冷表`);
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
