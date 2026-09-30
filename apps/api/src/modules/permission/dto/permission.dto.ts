import { z } from 'zod';

import { defineSchema } from '@/core/validation';
import { ALL_PERMISSION_KEYS } from '@/db/seeds/permissions';

/**
 * ★ 前後端共用權限鍵的關鍵：這個 enum 會以 `PermissionKey` 出現在 OpenAPI，
 * `packages/api-sdk` 據此產生常數，前端只做 re-export（ADR-0007）。
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
export type PermissionCatalogDto = z.infer<typeof PermissionCatalogSchema>;
