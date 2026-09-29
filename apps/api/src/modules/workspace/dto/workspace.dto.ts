import { z } from 'zod';

import { PaginationSchema, SortSchema } from '@/core/http';
import { defineSchema } from '@/core/validation';
import { PermissionKeySchema } from '@/modules/permission/dto/permission.dto';
import { RoleSummarySchema, UserStatusSchema } from '@/modules/user/dto/user.dto';

/** 網址用的識別碼：小寫英數與連字號，不以連字號開頭或結尾。 */
export const WORKSPACE_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,48}[a-z0-9])?$/;

// ── 平台：工作區管理（workspace:*）──────────────────────────────

export const WorkspaceSchema = defineSchema(
  'Workspace',
  z.object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    memberCount: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);

export const WorkspaceAdminSchema = defineSchema(
  'WorkspaceAdmin',
  z.object({
    id: z.string().uuid(),
    email: z.string(),
    displayName: z.string(),
  }),
);

/** 平台管理員看得到的詳情：名稱與管理員，看不到工作區裡的內容（docs/adr/0018-workspace-tenancy.md D5）。 */
export const WorkspaceDetailSchema = defineSchema(
  'WorkspaceDetail',
  WorkspaceSchema.extend({ admins: z.array(WorkspaceAdminSchema) }),
);

export const ListWorkspaceSchema = PaginationSchema.extend({
  keyword: z.string().trim().max(100).optional(),
}).extend(SortSchema(['createdAt', 'name', 'slug']).shape);

export const CreateWorkspaceSchema = defineSchema(
  'CreateWorkspaceRequest',
  z.object({
    name: z.string().trim().min(1).max(64),
    /** 不帶時由名稱產生；建立後不可變。 */
    slug: z.string().trim().regex(WORKSPACE_SLUG_PATTERN).optional(),
    description: z.string().trim().max(500).optional(),
    /** 第一位管理員（D13）。 */
    adminUserId: z.string().uuid(),
  }),
);

export const UpdateWorkspaceSchema = defineSchema(
  'UpdateWorkspaceRequest',
  z
    .object({
      name: z.string().trim().min(1).max(64).optional(),
      description: z.string().trim().max(500).nullable().optional(),
    })
    .refine((value) => Object.keys(value).length > 0, {
      message: 'at least one field is required',
    }),
);

export const AssignWorkspaceAdminSchema = defineSchema(
  'AssignWorkspaceAdminRequest',
  z.object({ userId: z.string().uuid() }),
);

// ── 使用者自己：能進入的工作區 ───────────────────────────────────

export const MyWorkspaceSchema = defineSchema(
  'MyWorkspace',
  z.object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    /** false：super-admin 進得去但不是成員（D5）。 */
    isMember: z.boolean(),
    lastAccessedAt: z.string().nullable(),
  }),
);

export const MyWorkspaceListSchema = defineSchema(
  'MyWorkspaceList',
  z.object({ items: z.array(MyWorkspaceSchema) }),
);

// ── 工作區範圍 ─────────────────────────────────────────────────

/** 目前工作區的身分：前端的 `can()` 以「平台的鍵 ∪ 這裡的鍵」判斷（D17）。 */
export const WorkspaceMeSchema = defineSchema(
  'WorkspaceMe',
  z.object({
    workspace: MyWorkspaceSchema,
    roles: z.array(RoleSummarySchema),
    /** 工作區範圍的鍵（平台範圍的在 `/auth/profile`）。 */
    permissions: z.array(PermissionKeySchema),
  }),
);

export const WorkspaceMemberSchema = defineSchema(
  'WorkspaceMember',
  z.object({
    id: z.string().uuid(),
    email: z.string(),
    displayName: z.string(),
    status: UserStatusSchema,
    roles: z.array(RoleSummarySchema),
    joinedAt: z.string(),
  }),
);

export const ListWorkspaceMemberSchema = PaginationSchema.extend({
  keyword: z.string().trim().max(100).optional(),
  roleId: z.string().uuid().optional(),
}).extend(SortSchema(['joinedAt', 'email', 'displayName']).shape);

export const UpdateWorkspaceMemberRolesSchema = defineSchema(
  'UpdateWorkspaceMemberRolesRequest',
  z.object({ roleIds: z.array(z.string().uuid()).max(50) }),
);

export const WorkspaceMemberRolesSchema = defineSchema(
  'WorkspaceMemberRoles',
  z.object({ roles: z.array(RoleSummarySchema) }),
);

/** 工作區角色的清單（指派用）：工作區管理員不需要平台的 `role:read`。 */
export const WorkspaceRoleSchema = defineSchema(
  'WorkspaceRole',
  z.object({
    id: z.string().uuid(),
    slug: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    isSystem: z.boolean(),
    permissions: z.array(PermissionKeySchema),
  }),
);

export const WorkspaceRoleListSchema = defineSchema(
  'WorkspaceRoleList',
  z.object({ items: z.array(WorkspaceRoleSchema) }),
);

export type WorkspaceDto = z.infer<typeof WorkspaceSchema>;
export type WorkspaceDetailDto = z.infer<typeof WorkspaceDetailSchema>;
export type ListWorkspaceDto = z.infer<typeof ListWorkspaceSchema>;
export type CreateWorkspaceDto = z.infer<typeof CreateWorkspaceSchema>;
export type UpdateWorkspaceDto = z.infer<typeof UpdateWorkspaceSchema>;
export type AssignWorkspaceAdminDto = z.infer<typeof AssignWorkspaceAdminSchema>;
export type MyWorkspaceDto = z.infer<typeof MyWorkspaceSchema>;
export type MyWorkspaceListDto = z.infer<typeof MyWorkspaceListSchema>;
export type WorkspaceMeDto = z.infer<typeof WorkspaceMeSchema>;
export type WorkspaceMemberDto = z.infer<typeof WorkspaceMemberSchema>;
export type ListWorkspaceMemberDto = z.infer<typeof ListWorkspaceMemberSchema>;
export type UpdateWorkspaceMemberRolesDto = z.infer<typeof UpdateWorkspaceMemberRolesSchema>;
export type WorkspaceMemberRolesDto = z.infer<typeof WorkspaceMemberRolesSchema>;
export type WorkspaceRoleDto = z.infer<typeof WorkspaceRoleSchema>;
export type WorkspaceRoleListDto = z.infer<typeof WorkspaceRoleListSchema>;
