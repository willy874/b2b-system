import type { ApprovalRequest, AuditLog, Permission, Role, User } from '@/shared/api-sdk';

/**
 * 權限目錄（對應 apps/api/src/db/seeds/permissions.ts）。
 * mocks 不能 import apps/api，所以 key 與語系鍵以完整字面量寫在這裡
 * （docs/conventions/06-literal-strings.md §3.1）。
 */
const PERMISSION_CATALOG = [
  {
    resource: 'user',
    action: 'create',
    key: 'user:create',
    nameI18nKey: 'permission.user.create',
    sortOrder: 100,
  },
  {
    resource: 'user',
    action: 'read',
    key: 'user:read',
    nameI18nKey: 'permission.user.read',
    sortOrder: 101,
  },
  {
    resource: 'user',
    action: 'update',
    key: 'user:update',
    nameI18nKey: 'permission.user.update',
    sortOrder: 102,
  },
  {
    resource: 'user',
    action: 'delete',
    key: 'user:delete',
    nameI18nKey: 'permission.user.delete',
    sortOrder: 103,
  },
  {
    resource: 'user',
    action: 'assignRole',
    key: 'user:assignRole',
    nameI18nKey: 'permission.user.assignRole',
    sortOrder: 104,
  },
  {
    resource: 'user',
    action: 'resetPassword',
    key: 'user:resetPassword',
    nameI18nKey: 'permission.user.resetPassword',
    sortOrder: 105,
  },
  {
    resource: 'role',
    action: 'create',
    key: 'role:create',
    nameI18nKey: 'permission.role.create',
    sortOrder: 200,
  },
  {
    resource: 'role',
    action: 'read',
    key: 'role:read',
    nameI18nKey: 'permission.role.read',
    sortOrder: 201,
  },
  {
    resource: 'role',
    action: 'update',
    key: 'role:update',
    nameI18nKey: 'permission.role.update',
    sortOrder: 202,
  },
  {
    resource: 'role',
    action: 'delete',
    key: 'role:delete',
    nameI18nKey: 'permission.role.delete',
    sortOrder: 203,
  },
  {
    resource: 'role',
    action: 'grantPermission',
    key: 'role:grantPermission',
    nameI18nKey: 'permission.role.grantPermission',
    sortOrder: 204,
  },
  {
    resource: 'permission',
    action: 'read',
    key: 'permission:read',
    nameI18nKey: 'permission.permission.read',
    sortOrder: 300,
  },
  {
    resource: 'auditLog',
    action: 'read',
    key: 'auditLog:read',
    nameI18nKey: 'permission.auditLog.read',
    sortOrder: 400,
  },
  {
    resource: 'system',
    action: 'read',
    key: 'system:read',
    nameI18nKey: 'permission.system.read',
    sortOrder: 500,
  },
  {
    resource: 'system',
    action: 'update',
    key: 'system:update',
    nameI18nKey: 'permission.system.update',
    sortOrder: 501,
  },
  {
    resource: 'approval',
    action: 'read',
    key: 'approval:read',
    nameI18nKey: 'permission.approval.read',
    sortOrder: 600,
  },
  {
    resource: 'approval',
    action: 'review',
    key: 'approval:review',
    nameI18nKey: 'permission.approval.review',
    sortOrder: 601,
  },
] as const;

/** 權限資源 → 分組名稱的語系鍵。 */
export const PERMISSION_RESOURCE_NAME_KEY = {
  user: 'permission.resource.user',
  role: 'permission.resource.role',
  permission: 'permission.resource.permission',
  auditLog: 'permission.resource.auditLog',
  system: 'permission.resource.system',
  approval: 'permission.resource.approval',
} as const satisfies Record<(typeof PERMISSION_CATALOG)[number]['resource'], string>;

/** 固定種子的資料工廠：測試與 dev mock 共用，確保可重現。 */
export const PERMISSION_FIXTURES: Permission[] = PERMISSION_CATALOG.map(
  ({ resource, action, key, nameI18nKey, sortOrder }) => ({
    id: `permission-${resource}-${action}`,
    key,
    resource,
    action,
    // mock 的權限目錄只有平台範圍的資源
    scope: 'platform',
    nameI18nKey,
    description: null,
    sortOrder,
  }),
);

export const ROLE_FIXTURES: Role[] = [
  {
    id: 'role-admin',
    slug: 'admin',
    name: '系統管理員',
    description: '管理使用者、角色與權限。',
    isSystem: true,
    scope: 'platform',
    permissionCount: 16,
    userCount: 2,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'role-editor',
    slug: 'content-editor',
    name: '內容編輯',
    description: null,
    isSystem: false,
    scope: 'platform',
    permissionCount: 2,
    userCount: 1,
    createdAt: '2026-02-01T00:00:00.000Z',
    updatedAt: '2026-02-01T00:00:00.000Z',
  },
];

export const USER_FIXTURES: User[] = [
  {
    id: 'user-admin',
    email: 'admin@example.com',
    username: 'admin',
    displayName: 'Super Admin',
    status: 'active',
    roles: [{ id: 'role-admin', slug: 'admin', name: '系統管理員', isSystem: true }],
    locale: 'zh-TW',
    timezone: 'Asia/Taipei',
    lastLoginAt: '2026-09-19T02:10:00.000Z',
    lockedUntil: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'user-alice',
    email: 'alice@example.com',
    username: 'alice',
    displayName: 'Alice',
    status: 'locked',
    roles: [],
    locale: 'zh-TW',
    timezone: 'Asia/Taipei',
    lastLoginAt: null,
    lockedUntil: '2030-01-01T00:00:00.000Z',
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
  },
];

export const AUDIT_LOG_FIXTURES: AuditLog[] = [
  {
    id: '1',
    occurredAt: '2026-09-19T02:11:00.000Z',
    actorId: 'user-admin',
    actorEmail: 'admin@example.com',
    action: 'role.grantPermission',
    resourceType: 'role',
    resourceId: 'role-editor',
    resourceName: '內容編輯',
    result: 'success',
    errorCode: null,
    changes: {
      before: { permissions: ['user:read'] },
      after: { permissions: ['user:read', 'auditLog:read'] },
    },
    metadata: { requestId: 'req-1', ip: '127.0.0.1' },
  },
  {
    id: '2',
    occurredAt: '2026-09-19T02:12:00.000Z',
    actorId: 'user-alice',
    actorEmail: 'alice@example.com',
    action: 'authz.denied',
    resourceType: 'authz',
    resourceId: null,
    resourceName: null,
    result: 'failure',
    errorCode: 'AUTHZ_FORBIDDEN',
    changes: null,
    metadata: { route: 'GET /users', required: ['user:read'], missing: ['user:read'] },
  },
];

export const APPROVAL_FIXTURES: ApprovalRequest[] = [
  {
    id: 'approval-pending',
    type: 'user.register',
    status: 'pending',
    payload: { email: 'carol@example.com', displayName: 'Carol' },
    requesterId: null,
    requesterName: 'carol@example.com',
    reason: '加入關卡設計組',
    reviewerId: null,
    reviewerName: null,
    reviewComment: null,
    reviewedAt: null,
    resultResourceId: null,
    createdAt: '2026-09-24T08:00:00.000Z',
    updatedAt: '2026-09-24T08:00:00.000Z',
  },
  {
    id: 'approval-rejected',
    type: 'user.register',
    status: 'rejected',
    payload: { email: 'dave@example.com', displayName: 'Dave' },
    requesterId: null,
    requesterName: 'dave@example.com',
    reason: null,
    reviewerId: 'user-admin',
    reviewerName: 'admin@example.com',
    reviewComment: '請改用公司信箱',
    reviewedAt: '2026-09-23T09:00:00.000Z',
    resultResourceId: null,
    createdAt: '2026-09-23T08:00:00.000Z',
    updatedAt: '2026-09-23T09:00:00.000Z',
  },
];
