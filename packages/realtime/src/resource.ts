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
   * 再安裝或移除對應的 feature（docs/adr/0021-runtime-feature-activation.md D8）。推給整個租戶，沒有 `id`。
   */
  TENANT_FEATURE: 'tenantFeature',
  /**
   * 站內通知（`id` = 通知 id）：只推給收件人自己的 user room（docs/adr/0026-notification-center.md D8）。
   * 新通知是 `create`；在另一個裝置或分頁標為已讀是 `update`（全部已讀沒有 `id`）。
   */
  NOTIFICATION: 'notification',
  /** 事件管理的租戶政策（`id` = 事件類型，例：`approval.pending`；docs/adr/0028-notification-event-management.md D9）。 */
  NOTIFICATION_POLICY: 'notificationPolicy',
  /** 自己的通知設定（`id` = 事件類型）：只推給本人的其他分頁與裝置（ADR-0028 D15）。 */
  NOTIFICATION_PREFERENCE: 'notificationPreference',
  /**
   * 服務帳號（`id` = 服務帳號 id）：建立、改名、停用、刪除、改角色（docs/adr/0027-api-tokens-external-api.md D1）。
   * 改角色時另以 `role` 推角色的持有者變動。
   */
  SERVICE_ACCOUNT: 'serviceAccount',
  /**
   * API token（`id` = token id）：建立與撤銷。個人 token 以 `affectedUserIds` 推給本人的其他分頁；
   * 服務帳號的 token 以 `refs.serviceAccount` 帶上擁有者（它的有效 token 數會變）。
   */
  API_TOKEN: 'apiToken',
  /**
   * Webhook 訂閱（`id` = 訂閱 id）：建立、修改、停用（含連續失敗自動停用）、輪替密鑰、刪除（docs/adr/0030-webhooks.md）。
   */
  WEBHOOK: 'webhook',
  /**
   * Webhook 的投遞紀錄（`id` = 投遞紀錄 id）：每一次投遞嘗試；以 `refs.webhook` 帶上訂閱（它的最後投遞時間、失敗次數會變）。
   * 投遞不寫稽核。
   */
  WEBHOOK_DELIVERY: 'webhookDelivery',
  /**
   * 標籤的定義（`id` = 標籤 id；docs/adr/0032-tags.md D10）：建立、改名、改色、刪除。
   * 指派不推它：由擁有者推自己的資源（`file`、`fileFolder`、`user` update）。
   */
  TAG: 'tag',
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
