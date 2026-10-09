/**
 * 平台的通知類型（docs/architecture/backend/15-notification.md §6.2）。已發出的類型不改名：舊通知與前端的文案都以它對照。
 * apps/platform 的 `features/notification` 有同一張表的文案對照。
 */
export const PlatformNotificationType = {
  /** 租戶佈建完成，可以使用了。收件人：能建立租戶的平台管理者。 */
  TENANT_PROVISIONED: 'tenant.provisioned',
  /** 租戶佈建失敗，要看原因並重試。收件人同上。 */
  TENANT_PROVISION_FAILED: 'tenant.provisionFailed',
  /**
   * 租戶的儲存使用率越過警示門檻（docs/architecture/05-tenancy.md §14.2 D8）：越過時發一次，停在門檻以上不重發。
   * 收件人：能改租戶（調整配額）的平台管理者。
   */
  TENANT_STORAGE_NEAR_QUOTA: 'tenant.storageNearQuota',
  /**
   * 所有租戶的已用量合計越過儲存止水線的 80% 或 100%（docs/architecture/backend/25-image.md §12 D8）：越過時發一次。
   * `params.percent`。收件人：能改租戶的平台管理者（要清理或擴充儲存）。
   */
  STORAGE_TOTAL_NEAR_LIMIT: 'storage.totalNearLimit',
  /** 自己的角色被其他平台管理者換了。收件人：那位管理者。 */
  PLATFORM_ADMIN_ROLE_CHANGED: 'platformAdmin.roleChanged',
} as const;

export type PlatformNotificationType =
  (typeof PlatformNotificationType)[keyof typeof PlatformNotificationType];

/** apps/platform 的 route id（前端 `features/notification` 依它導向；已發出的 id 不改名）。 */
export const PlatformNotificationRoute = {
  TENANT_DETAIL: 'tenant.detail',
  TENANT_LIST: 'tenant.list',
  PROFILE: 'account.profile',
} as const;

/** 保留：已讀的留 30 天、未讀的最多 180 天（同租戶通知的預設，docs/architecture/backend/15-notification.md §12.2 D10）。 */
export const PLATFORM_NOTIFICATION_READ_RETENTION_DAYS = 30;
export const PLATFORM_NOTIFICATION_MAX_RETENTION_DAYS = 180;

/** 保留清理一批刪幾列（`deleteInBatches`）。 */
export const PLATFORM_NOTIFICATION_CLEANUP_BATCH_SIZE = 5_000;
