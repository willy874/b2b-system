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
