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
  ChangeSource.USER_CREDENTIAL,
  ChangeSource.APPROVAL,
  ChangeSource.FILE,
  ChangeSource.FILE_FOLDER,
  ChangeSource.SETTING,
  ChangeSource.TENANT_FEATURE,
  ChangeSource.NOTIFICATION,
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
