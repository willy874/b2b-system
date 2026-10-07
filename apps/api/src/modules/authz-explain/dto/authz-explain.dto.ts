import { z } from 'zod';

import { defineSchema } from '@/core/validation';

/**
 * 說明路徑上的一個節點（`型別:id#關係`）。操作者讀不到的節點只回型別與關係，`id`、`name` 是 null、`hidden` 是 true
 * （docs/architecture/iam/01-model.md §9.3 D14）。
 */
export const ExplainNodeSchema = defineSchema(
  'ExplainNode',
  z.object({
    /** `user`、`group`、`role`、`tenant`、`fileFolder`、`fileRoot`… */
    type: z.string(),
    id: z.string().nullable(),
    /** 經過的關係：`member`、`holder`、權限鍵、資料夾等級、`can_*`；節點本身（路徑的起點）是空字串。 */
    relation: z.string(),
    name: z.string().nullable(),
    hidden: z.boolean(),
  }),
);

export const PermissionSourceSchema = defineSchema(
  'PermissionSource',
  z.object({
    /** 角色上明確授予的鍵；與 `key` 不同時，`key` 是由它經權限依賴樹帶出的。 */
    grantedKey: z.string(),
    /** 從使用者本人到持有那個鍵的角色：`user → 群組… → role#holder`。 */
    via: z.array(ExplainNodeSchema),
  }),
);

export const PermissionSourcesSchema = defineSchema(
  'PermissionSources',
  z.object({
    /** super-admin：持有全部權限，`superAdminVia` 是怎麼成為 super-admin 的。 */
    isSuperAdmin: z.boolean(),
    superAdminVia: z.array(ExplainNodeSchema).nullable(),
    /** 有效的權限鍵（目錄順序），每個附上所有來源。super-admin 只列明確帶來的。 */
    items: z.array(
      z.object({
        key: z.string(),
        sources: z.array(PermissionSourceSchema),
      }),
    ),
  }),
);

export type ExplainNodeDto = z.infer<typeof ExplainNodeSchema>;
export type PermissionSourcesDto = z.infer<typeof PermissionSourcesSchema>;
