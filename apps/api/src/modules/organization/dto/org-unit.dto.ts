import { z } from 'zod';

import { PaginationSchema } from '@/core/http';
import { defineSchema } from '@/core/validation';

import { ORG_UNIT_MEMBER_BATCH_LIMIT } from '../organization.constants';

/** 部門名稱：NFC 正規化（與群組、角色相同），同一個上層之下不分大小寫唯一。 */
const OrgUnitNameSchema = z.string().trim().normalize('NFC').min(1).max(64);
/** 代碼：給匯入與外部系統對應，只允許英數與 `-`、`_`、`.`。 */
const OrgUnitCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9._-]+$/);

export const OrgUnitSchema = defineSchema(
  'OrgUnit',
  z.object({
    id: z.string().uuid(),
    parentId: z.string().uuid().nullable(),
    name: z.string(),
    code: z.string().nullable(),
    description: z.string().nullable(),
    sortOrder: z.number().int(),
    /** 直接成員數（不含下層部門；已刪除的使用者不算）。 */
    memberCount: z.number().int(),
    /** 主管數。 */
    managerCount: z.number().int(),
    /** 主管（依名稱）：組織圖的節點顯示主管名字（docs/architecture/backend/23-organization.md §8）。 */
    managers: z.array(z.object({ userId: z.string().uuid(), displayName: z.string() })),
    /** 樂觀鎖版本：`PATCH`、`move` 時帶上。 */
    version: z.number().int(),
    createdAt: z.string(),
    updatedAt: z.string(),
  }),
);

/** 上層路徑的一段（麵包屑），最上層在前。 */
export const OrgUnitPathItemSchema = defineSchema(
  'OrgUnitPathItem',
  z.object({ id: z.string().uuid(), name: z.string() }),
);

export const OrgUnitDetailSchema = defineSchema(
  'OrgUnitDetail',
  OrgUnitSchema.extend({
    /** 從最上層到上一層（不含自己）。 */
    path: z.array(OrgUnitPathItemSchema),
  }),
);

/** `GET /org-units`：整棵樹（扁平陣列，前端依 `parentId` 組回樹）。 */
export const OrgUnitTreeSchema = defineSchema(
  'OrgUnitTree',
  z.object({ items: z.array(OrgUnitSchema) }),
);

export const ListOrgUnitSchema = z.object({
  /** 只回名稱或代碼符合的部門，以及它們的上層（樹才接得起來）。 */
  keyword: z.string().trim().max(100).optional(),
});

export const CreateOrgUnitSchema = defineSchema(
  'CreateOrgUnitRequest',
  z.object({
    name: OrgUnitNameSchema,
    parentId: z.string().uuid().nullable().optional(),
    code: OrgUnitCodeSchema.nullable().optional(),
    description: z.string().trim().max(500).nullable().optional(),
  }),
);

export const UpdateOrgUnitSchema = defineSchema(
  'UpdateOrgUnitRequest',
  z
    .object({
      name: OrgUnitNameSchema.optional(),
      code: OrgUnitCodeSchema.nullable().optional(),
      description: z.string().trim().max(500).nullable().optional(),
      /** 樂觀鎖：編輯開始時看到的 `version`；不同回 409 `ORG_UNIT_VERSION_CONFLICT`。 */
      version: z.number().int().min(1),
    })
    // `version` 不是要改的欄位：只帶它等於什麼都沒改
    .refine(({ version: _version, ...fields }) => Object.keys(fields).length > 0, {
      message: 'at least one field is required',
    }),
);

export const MoveOrgUnitSchema = defineSchema(
  'MoveOrgUnitRequest',
  z.object({
    /** 新的上層；null = 搬到最上層。 */
    parentId: z.string().uuid().nullable(),
    /** 排在這個同層部門之前；省略 = 排在最後。 */
    beforeId: z.string().uuid().nullable().optional(),
    version: z.number().int().min(1),
  }),
);

export const OrgUnitMemberSchema = defineSchema(
  'OrgUnitMember',
  z.object({
    userId: z.string().uuid(),
    displayName: z.string(),
    email: z.string(),
    status: z.enum(['pending', 'active', 'inactive', 'locked']),
    /** 這一列所屬的部門（`includeDescendants` 時可能是下層部門）。 */
    unitId: z.string().uuid(),
    unitName: z.string(),
    isManager: z.boolean(),
    isPrimary: z.boolean(),
    title: z.string().nullable(),
  }),
);

export const ListOrgUnitMembersSchema = PaginationSchema.extend({
  includeDescendants: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  keyword: z.string().trim().max(100).optional(),
});

const MemberFieldsSchema = z.object({
  userId: z.string().uuid(),
  isManager: z.boolean().optional(),
  /** 設為主要部門時，那個人原本的主要部門會在同一個交易內取消。 */
  isPrimary: z.boolean().optional(),
  title: z.string().trim().max(64).nullable().optional(),
});

/** 差異語意（與群組成員相同）：`add` 已是成員時當作 `update`；同一個人不能同時出現在兩處以上。 */
export const UpdateOrgUnitMembersSchema = defineSchema(
  'UpdateOrgUnitMembersRequest',
  z
    .object({
      add: z.array(MemberFieldsSchema).max(ORG_UNIT_MEMBER_BATCH_LIMIT).default([]),
      update: z.array(MemberFieldsSchema).max(ORG_UNIT_MEMBER_BATCH_LIMIT).default([]),
      remove: z.array(z.string().uuid()).max(ORG_UNIT_MEMBER_BATCH_LIMIT).default([]),
    })
    .refine(
      ({ add, update, remove }) => {
        const ids = [...add.map((m) => m.userId), ...update.map((m) => m.userId), ...remove];
        return new Set(ids).size === ids.length;
      },
      { message: 'a user can appear only once', path: ['remove'] },
    ),
);

/** `GET /users/:id/org-units` 的一列：那個人所屬的部門。 */
export const UserOrgUnitSchema = defineSchema(
  'UserOrgUnit',
  z.object({
    unitId: z.string().uuid(),
    name: z.string(),
    /** 從最上層到上一層（不含自己）。 */
    path: z.array(OrgUnitPathItemSchema),
    isManager: z.boolean(),
    isPrimary: z.boolean(),
    title: z.string().nullable(),
  }),
);

export const UserOrgUnitsSchema = defineSchema(
  'UserOrgUnits',
  z.object({ items: z.array(UserOrgUnitSchema) }),
);

export type OrgUnitDto = z.infer<typeof OrgUnitSchema>;
export type OrgUnitDetailDto = z.infer<typeof OrgUnitDetailSchema>;
export type OrgUnitPathItemDto = z.infer<typeof OrgUnitPathItemSchema>;
export type ListOrgUnitDto = z.infer<typeof ListOrgUnitSchema>;
export type CreateOrgUnitDto = z.infer<typeof CreateOrgUnitSchema>;
export type UpdateOrgUnitDto = z.infer<typeof UpdateOrgUnitSchema>;
export type MoveOrgUnitDto = z.infer<typeof MoveOrgUnitSchema>;
export type OrgUnitMemberDto = z.infer<typeof OrgUnitMemberSchema>;
export type ListOrgUnitMembersDto = z.infer<typeof ListOrgUnitMembersSchema>;
export type UpdateOrgUnitMembersDto = z.infer<typeof UpdateOrgUnitMembersSchema>;
export type OrgUnitMemberChange = z.infer<typeof MemberFieldsSchema>;
export type UserOrgUnitDto = z.infer<typeof UserOrgUnitSchema>;
