import {
  AUDIT_LOG_HOT_RETENTION_DAYS_PARAM,
  AUDIT_LOG_RETENTION_DAYS_PARAM,
  resolveTenantFeatureParam,
} from '@/core/tenant';
import { archiveAuditLogs, maintainAuditArchive } from '@/modules/audit-log/audit-log.archive';

import { forEachScriptTenant, loadScriptEnv } from './client';

/**
 * 稽核日誌熱 → 冷搬移的手動入口（docs/architecture/backend/06-audit-log.md §8）。
 * 平常由背景工作 `auditLog.archive` 每天執行；排程出問題時用這支補跑，行為相同。
 */
async function main(): Promise<void> {
  loadScriptEnv();
  await forEachScriptTenant(async (db, tenant) => {
    // 保留天數是租戶的參數（docs/architecture/05-tenancy.md §13.3 D7），與排程讀同一份登記
    const retentionDays = resolveTenantFeatureParam(
      AUDIT_LOG_HOT_RETENTION_DAYS_PARAM,
      tenant.featureParams,
    );
    const { moved, cutoff } = await archiveAuditLogs(db, retentionDays);
    console.info(`稽核日誌搬移完成：${moved} 筆早於 ${cutoff.toISOString()} 的紀錄已移到冷表`);
    // 與排程相同：預建冷表分區、依保留期限刪除過期的月份
    const purged = await maintainAuditArchive(db, {
      retentionDays: resolveTenantFeatureParam(
        AUDIT_LOG_RETENTION_DAYS_PARAM,
        tenant.featureParams,
      ),
      hotRetentionDays: retentionDays,
      foreverValue: AUDIT_LOG_RETENTION_DAYS_PARAM.foreverValue,
    });
    for (const item of purged)
      console.info(`已刪除過期的冷表分區 ${item.partition}（${item.rows} 筆）`);
  });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
