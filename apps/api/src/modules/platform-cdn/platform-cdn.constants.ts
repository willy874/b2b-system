import { defineJob } from '@/core/jobs';
import { CDN_PATH_PREFIX } from '@/core/storage';

/**
 * 邊緣的定期檢查（docs/architecture/backend/09-file.md §16.10、§17 D18）：每 5 分鐘（`FILE_CDN_HEALTH_CHECK_CRON`），
 * 結果寫進 `cdn_settings.last_check`、更新指標。平台工作：不屬於任何租戶。上一輪沒跑完時不再排（`exclusive`），失敗不重試（下一輪就是重試）。
 */
export const CDN_HEALTH_CHECK_JOB = defineJob<Record<string, never>>('cdn.healthCheck', {
  scope: 'platform',
  exclusive: true,
  retryLimit: 0,
  expireInSeconds: 2 * 60,
  deleteAfterSeconds: 24 * 60 * 60,
});

/**
 * 檢查對外網址用的路徑：bucket 名稱不合 S3 的規則（`_` 開頭），不會是任何租戶的 bucket；物件不存在，源站回 404，邊緣不快取 404（§17 D17）。
 */
export const CDN_CHECK_PATH_PREFIX = `${CDN_PATH_PREFIX}/__cdn-check`;

/** 平台稽核的 action（docs/architecture/backend/09-file.md §16.12）。 */
export const CDN_AUDIT_ACTION = {
  UPDATE: 'cdn.update',
  PURGE: 'cdn.purge',
} as const;

/** CDN 頁面列出的最近幾筆 `cdn.purge`。 */
export const CDN_RECENT_PURGES = 20;
