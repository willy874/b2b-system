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
    /** `grantedKey` 的名稱（權限目錄的語系鍵）。 */
    grantedNameI18nKey: z.string(),
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
        /**
         * 權限目錄的名稱與所屬資源（同權限目錄的 `nameI18nKey`、`groups[].nameI18nKey`）：
         * 查自己不需要 `permission:read`，畫面無法另外查目錄。
         */
        nameI18nKey: z.string(),
        resource: z.string(),
        resourceNameI18nKey: z.string(),
        /**
         * 依賴樹上直接的子能力與依賴（同權限目錄的 `includes`、`requires`），只列這位使用者也持有的鍵：
         * 畫面以此畫他的權限樹，不多透露目錄的其他部分。
         */
        includes: z.array(z.string()),
        requires: z.array(z.string()),
        sources: z.array(PermissionSourceSchema),
      }),
    ),
  }),
);

export type ExplainNodeDto = z.infer<typeof ExplainNodeSchema>;
export type PermissionSourcesDto = z.infer<typeof PermissionSourcesSchema>;
