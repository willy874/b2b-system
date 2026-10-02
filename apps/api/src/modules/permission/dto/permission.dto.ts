import { z } from 'zod';

import { defineSchema } from '@/core/validation';
import { ALL_PERMISSION_KEYS } from '@/db/seeds/permissions';

/**
 * ★ 前後端共用權限鍵的關鍵：這個 enum 會以 `PermissionKey` 出現在 OpenAPI，
 * `packages/api-sdk` 據此產生常數，前端只做 re-export（docs/architecture/backend/03-api-conventions.md §12）。
 */
export const PermissionKeySchema = defineSchema(
  'PermissionKey',
  z.enum(ALL_PERMISSION_KEYS as [string, ...string[]]),
);

export const PermissionSchema = defineSchema(
  'Permission',
  z.object({
    id: z.string().uuid(),
    key: PermissionKeySchema,
    resource: z.string(),
    action: z.string(),
    nameI18nKey: z.string(),
    description: z.string().nullable(),
    sortOrder: z.number().int(),
    /** 子能力：同資源、這個鍵包含的鍵（docs/rbac/02-permission-catalog.md §9）。 */
    includes: z.array(PermissionKeySchema),
    /** 依賴：少了它就無法完整操作的 read（可以跨資源）。 */
    requires: z.array(PermissionKeySchema),
  }),
);

export const PermissionSourceSchema = defineSchema(
  'PermissionSource',
  z.enum(['explicit', 'implied']),
);

/** 角色實際持有的一個鍵：明確授予的，或由其他鍵（遞迴）帶出來的。 */
export const EffectivePermissionSchema = defineSchema(
  'EffectivePermission',
  z.object({
    key: PermissionKeySchema,
    /** 同時是明確與隱含的鍵算 `explicit`。 */
    source: PermissionSourceSchema,
    /** 帶出這個鍵的明確鍵（`source = implied` 時至少一個；super-admin 是空陣列）。 */
    impliedBy: z.array(PermissionKeySchema),
  }),
);

export const PermissionGroupSchema = defineSchema(
  'PermissionGroup',
  z.object({
    resource: z.string(),
    nameI18nKey: z.string(),
    keys: z.array(PermissionKeySchema),
  }),
);

export const PermissionCatalogSchema = defineSchema(
  'PermissionCatalog',
  z.object({
    items: z.array(PermissionSchema),
    groups: z.array(PermissionGroupSchema),
  }),
);

export type PermissionDto = z.infer<typeof PermissionSchema>;
export type EffectivePermissionDto = z.infer<typeof EffectivePermissionSchema>;
export type PermissionCatalogDto = z.infer<typeof PermissionCatalogSchema>;
