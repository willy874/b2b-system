import { z } from 'zod';

import { defineSchema } from '@/core/validation';
import {
  EffectivePermissionSchema,
  PermissionSchema,
} from '@/modules/permission/dto/permission.dto';

export const RoleSchema = defineSchema(
  'Role',
  z.object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    isSystem: z.boolean(),
    permissionCount: z.number().int(),
    userCount: z.number().int(),
    /** 樂觀鎖版本：`PATCH` 時帶上（docs/architecture/backend/14-revisions.md §9.2 D3）。 */
    version: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);

/** `POST /roles/:id/restore` 的回應：還原後的角色 ＋ 重新生效的持有者人數（docs/architecture/backend/14-revisions.md §9 R3）。 */
export const RestoredRoleSchema = defineSchema(
  'RestoredRole',
  RoleSchema.extend({
    /** 刪除時保留的持有者邊中仍存在的使用者；R3 之前刪除的角色沒有保留的邊，是 0。 */
    holdersRestored: z.number().int(),
  }),
);

export const RolePermissionsSchema = defineSchema(
  'RolePermissions',
  z.object({
    /** 明確授予的權限（角色帶的權限鍵的邊，不含依賴樹帶來的）。 */
    permissions: z.array(PermissionSchema),
    /** 實際持有的鍵：明確的 ＋ 權限依賴樹帶出的（docs/architecture/iam/02-permission-catalog.md §9）。 */
    effective: z.array(EffectivePermissionSchema),
    /** super-admin 角色：隱含全集、不能改權限。 */
    isSuperAdmin: z.boolean(),
  }),
);

export const RoleHolderSchema = defineSchema(
  'RoleHolder',
  z.object({
    id: z.string().uuid(),
    /** `service`：服務帳號（只在對外 API 開放時列出），前端連到服務帳號頁。 */
    kind: z.enum(['human', 'service']),
    email: z.string(),
    displayName: z.string(),
    status: z.enum(['pending', 'active', 'inactive', 'locked']),
  }),
);

export type RoleDto = z.infer<typeof RoleSchema>;
export type RestoredRoleDto = z.infer<typeof RestoredRoleSchema>;
