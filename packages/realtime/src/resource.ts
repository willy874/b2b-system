import { z } from 'zod';

/**
 * 伺服器會推的來源資源。前端的 `Resource`（apis/resources.ts）必須是它的超集：
 * `profile` 這類以登入者為視角的衍生只存在於前端。
 */
export const ChangeSource = {
  USER: 'user',
  ROLE: 'role',
  USER_ROLE: 'userRole',
  ROLE_PERMISSION: 'rolePermission',
  /**
   * 群組（`id` = 群組 id）：名稱、成員、持有的角色都以它宣告。成員的權限變了（加入、移出、群組的角色變了）時，
   * 呼叫端以 `affectedUserIds` 帶上群組（含巢狀）的所有成員，他們的 user room 會收到。
   */
  GROUP: 'group',
  USER_CREDENTIAL: 'userCredential',
  APPROVAL: 'approval',
  FILE: 'file',
  /** 檔案管理器的資料夾（建立、改名、移動、刪除）。 */
  FILE_FOLDER: 'fileFolder',
  /** 系統設定（`id` 是設定的 key）。 */
  SETTING: 'setting',
  /**
   * 平台管理者變更了租戶啟用的 feature；前端據此重新取得 profile（其中的 `features`），
   * 再安裝或移除對應的 feature（docs/architecture/frontend/02-plugin-system.md §9.2 D8）。推給整個租戶，沒有 `id`。
   */
  TENANT_FEATURE: 'tenantFeature',
  /**
   * 站內通知（`id` = 通知 id）：只推給收件人自己的 user room（docs/architecture/backend/15-notification.md §12.2 D8）。
   * 新通知是 `create`；在另一個裝置或分頁標為已讀是 `update`（全部已讀沒有 `id`）。
   */
  NOTIFICATION: 'notification',
  /** 事件管理的租戶政策（`id` = 事件類型，例：`approval.pending`；docs/architecture/backend/16-notification-event.md §9.2 D9）。 */
  NOTIFICATION_POLICY: 'notificationPolicy',
  /** 自己的通知設定（`id` = 事件類型）：只推給本人的其他分頁與裝置（docs/architecture/backend/16-notification-event.md §9.2 D15）。 */
  NOTIFICATION_PREFERENCE: 'notificationPreference',
  /**
   * 服務帳號（`id` = 服務帳號 id）：建立、改名、停用、刪除、改角色（docs/architecture/06-external-api.md §9.2 D1）。
   * 改角色時另以 `role` 推角色的持有者變動。
   */
  SERVICE_ACCOUNT: 'serviceAccount',
  /**
   * API token（`id` = token id）：建立與撤銷。個人 token 以 `affectedUserIds` 推給本人的其他分頁；
   * 服務帳號的 token 以 `refs.serviceAccount` 帶上擁有者（它的有效 token 數會變）。
   */
  API_TOKEN: 'apiToken',
  /**
   * Webhook 訂閱（`id` = 訂閱 id）：建立、修改、停用（含連續失敗自動停用）、輪替密鑰、刪除（docs/architecture/backend/17-webhook.md §9）。
   */
  WEBHOOK: 'webhook',
  /**
   * Webhook 的投遞紀錄（`id` = 投遞紀錄 id）：每一次投遞嘗試；以 `refs.webhook` 帶上訂閱（它的最後投遞時間、失敗次數會變）。
   * 投遞不寫稽核。
   */
  WEBHOOK_DELIVERY: 'webhookDelivery',
  /**
   * 標籤的定義（`id` = 標籤 id；docs/architecture/backend/18-tag.md §7.2 D10）：建立、改名、改色、刪除。
   * 指派不推它：由擁有者推自己的資源（`file`、`fileFolder`、`user` update）。
   */
  TAG: 'tag',
  /**
   * 公告（`id` = 公告 id；docs/architecture/backend/19-announcement.md §9）：建立、修改、送出、暫停、刪除、還原，以及背景發送改變的狀態。
   * 發送紀錄的變化（發送中、完成、撤回）也以它宣告（`update`），詳情頁的發送紀錄跟著重抓。
   */
  ANNOUNCEMENT: 'announcement',
  /** 匯入／匯出的傳輸（docs/architecture/backend/22-data-transfer.md §9.4）：只推給建立者，id 是傳輸 id */
  DATA_TRANSFER: 'dataTransfer',
  // ── 平台（apps/platform 的平台管理者，只推給平台的連線；docs/architecture/backend/08-realtime.md §3.6）──
  /** 租戶登記（`id` = 租戶 id）：建立、改名、網域、啟用的 feature、停用與啟用、刪除，以及背景佈建的結果。 */
  PLATFORM_TENANT: 'platformTenant',
  /** 平台管理者（`id` = 管理者 id）：新增、改名、換角色、停用、啟用。 */
  PLATFORM_ADMIN: 'platformAdmin',
  /** feature flag 的全平台覆寫（`id` = flag 的 key）。 */
  PLATFORM_FEATURE_FLAG: 'platformFeatureFlag',
  /** 所有租戶與平台的背景工作（`id` = 工作 id）：重試。 */
  PLATFORM_JOB: 'platformJob',
  /** 平台管理者自己的站內通知：只推給收件人（docs/architecture/backend/15-notification.md §6.2）。 */
  PLATFORM_NOTIFICATION: 'platformNotification',
} as const;

export type ChangeSource = (typeof ChangeSource)[keyof typeof ChangeSource];

export const ChangeKind = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
} as const;

export type ChangeKind = (typeof ChangeKind)[keyof typeof ChangeKind];

/** 一次推播最多帶幾筆變更；超過代表呼叫端該改用 `ANY_ID` 之類的粗粒度宣告。 */
export const MAX_CHANGES_PER_EVENT = 100;

const IdSchema = z.string().min(1).max(64);

const ChangeSourceSchema = z.enum([
  ChangeSource.USER,
  ChangeSource.ROLE,
  ChangeSource.USER_ROLE,
  ChangeSource.ROLE_PERMISSION,
  ChangeSource.GROUP,
  ChangeSource.USER_CREDENTIAL,
  ChangeSource.APPROVAL,
  ChangeSource.FILE,
  ChangeSource.FILE_FOLDER,
  ChangeSource.SETTING,
  ChangeSource.TENANT_FEATURE,
  ChangeSource.NOTIFICATION,
  ChangeSource.NOTIFICATION_POLICY,
  ChangeSource.NOTIFICATION_PREFERENCE,
  ChangeSource.SERVICE_ACCOUNT,
  ChangeSource.API_TOKEN,
  ChangeSource.WEBHOOK,
  ChangeSource.WEBHOOK_DELIVERY,
  ChangeSource.TAG,
  ChangeSource.ANNOUNCEMENT,
  ChangeSource.DATA_TRANSFER,
  ChangeSource.PLATFORM_TENANT,
  ChangeSource.PLATFORM_ADMIN,
  ChangeSource.PLATFORM_FEATURE_FLAG,
  ChangeSource.PLATFORM_JOB,
  ChangeSource.PLATFORM_NOTIFICATION,
]);

export const ResourceChangeWireSchema = z.object({
  resource: ChangeSourceSchema,
  kind: z.enum([ChangeKind.CREATE, ChangeKind.UPDATE, ChangeKind.DELETE]),
  id: IdSchema.optional(),
  refs: z
    .partialRecord(ChangeSourceSchema, z.array(IdSchema).max(MAX_CHANGES_PER_EVENT))
    .optional(),
});

export type ResourceChangeWire = z.infer<typeof ResourceChangeWireSchema>;

export const ResourceChangedSchema = z.object({
  changes: z.array(ResourceChangeWireSchema).max(MAX_CHANGES_PER_EVENT),
  /** 發起寫入的分頁（`x-client-id`）；該分頁收到時略過。 */
  origin: z.string().max(64).optional(),
});

export type ResourceChanged = z.infer<typeof ResourceChangedSchema>;

/**
 * 不帶個別 id 的版本：同一個 `{ resource, kind }` 只留一筆，拿掉 `id` 與 `refs`。前端把它當成「這個來源全部失效」，
 * 多重抓幾個 query，但不會漏。順序依第一次出現。
 */
export function coarsenChanges(changes: readonly ResourceChangeWire[]): ResourceChangeWire[] {
  const coarse = new Map<string, ResourceChangeWire>();
  for (const { resource, kind } of changes) {
    const key = `${resource}:${kind}`;
    if (!coarse.has(key)) coarse.set(key, { resource, kind });
  }
  return [...coarse.values()];
}

/** `changes` 超過 `MAX_CHANGES_PER_EVENT` 筆，或任一筆的任一個 `refs` 陣列超過：客戶端會整則拒收。 */
export function exceedsChangeLimit(changes: readonly ResourceChangeWire[]): boolean {
  if (changes.length > MAX_CHANGES_PER_EVENT) return true;
  return changes.some(
    (change) =>
      change.refs !== undefined &&
      Object.values(change.refs).some((ids) => (ids?.length ?? 0) > MAX_CHANGES_PER_EVENT),
  );
}

/**
 * 推播前讓變更符合合約的上限（docs/architecture/backend/08-realtime.md §9）：超過時改成 `coarsenChanges` 的結果，
 * 沒超過時原樣回傳。伺服器送出 `resource.changed` 之前、跨程序轉送之前都要套用，否則客戶端驗證失敗會整則丟掉。
 */
export function limitChanges(changes: readonly ResourceChangeWire[]): ResourceChangeWire[] {
  return exceedsChangeLimit(changes) ? coarsenChanges(changes) : [...changes];
}
