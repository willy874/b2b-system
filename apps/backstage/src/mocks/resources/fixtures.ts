import type {
  ApprovalRequest,
  AuditLog,
  Notification,
  Permission,
  Role,
  User,
} from '@/shared/api-sdk';

/**
 * 權限目錄（對應 apps/api/src/db/seeds/permissions.ts）。
 * mocks 不能 import apps/api，所以 key 與語系鍵以完整字面量寫在這裡
 * （docs/coding-standards/06-literal-strings.md §3.1）。
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
    resource: 'user',
    action: 'resetMfa',
    key: 'user:resetMfa',
    nameI18nKey: 'permission.user.resetMfa',
    sortOrder: 106,
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

type MockPermissionKey = (typeof PERMISSION_CATALOG)[number]['key'];

/**
 * 權限依賴樹（對應 apps/api/src/db/seeds/permissions.ts 的 PERMISSION_DEPENDENCIES，只取 mock 目錄裡有的鍵；
 * docs/architecture/iam/02-permission-catalog.md §9）。
 */
const PERMISSION_DEPENDENCIES: Partial<
  Record<MockPermissionKey, { includes?: MockPermissionKey[]; requires?: MockPermissionKey[] }>
> = {
  'user:create': { includes: ['user:update'] },
  'user:delete': { includes: ['user:update'] },
  'user:update': { includes: ['user:resetPassword', 'user:read'] },
  'user:resetPassword': { includes: ['user:read'] },
  'user:resetMfa': { includes: ['user:read'] },
  'user:assignRole': { includes: ['user:read'], requires: ['role:read'] },
  'role:create': { includes: ['role:update'] },
  'role:delete': { includes: ['role:update'] },
  'role:update': { includes: ['role:read'] },
  'role:grantPermission': { includes: ['role:read'], requires: ['permission:read'] },
  'system:update': { includes: ['system:read'] },
  'approval:review': { includes: ['approval:read'] },
};

/** 固定種子的資料工廠：測試與 dev mock 共用，確保可重現。 */
export const PERMISSION_FIXTURES: Permission[] = PERMISSION_CATALOG.map(
  ({ resource, action, key, nameI18nKey, sortOrder }) => ({
    id: `permission-${resource}-${action}`,
    key,
    resource,
    action,
    nameI18nKey,
    description: null,
    sortOrder,
    includes: PERMISSION_DEPENDENCIES[key]?.includes ?? [],
    requires: PERMISSION_DEPENDENCIES[key]?.requires ?? [],
  }),
);

/** 直接帶來的鍵（子能力 ∪ 依賴）。 */
function directlyImplied(key: string): string[] {
  const item = PERMISSION_FIXTURES.find((permission) => permission.key === key);
  return [...(item?.includes ?? []), ...(item?.requires ?? [])];
}

/** 依賴樹的閉包：持有這些鍵就同時持有的所有鍵。 */
export function permissionClosure(keys: Iterable<string>): Set<string> {
  const result = new Set<string>();
  const stack = [...keys];
  while (stack.length > 0) {
    const key = stack.pop() as string;
    if (result.has(key)) continue;
    result.add(key);
    stack.push(...directlyImplied(key));
  }
  return result;
}

/** 角色實際持有的鍵（`GET /roles/:id/permissions` 的 `effective`）。 */
export function effectivePermissions(explicit: readonly string[], isSuperAdmin = false) {
  const closure = isSuperAdmin
    ? new Set(PERMISSION_FIXTURES.map((item) => item.key))
    : permissionClosure(explicit);
  return PERMISSION_FIXTURES.filter((item) => closure.has(item.key)).map((item) => ({
    key: item.key,
    source:
      !isSuperAdmin && explicit.includes(item.key) ? ('explicit' as const) : ('implied' as const),
    impliedBy: isSuperAdmin
      ? []
      : explicit.filter(
          (candidate) =>
            candidate !== item.key && permissionClosure(directlyImplied(candidate)).has(item.key),
        ),
  }));
}

export const ROLE_FIXTURES: Role[] = [
  {
    id: 'role-admin',
    slug: 'admin',
    name: '系統管理員',
    description: '管理使用者、角色與權限。',
    isSystem: true,
    permissionCount: 16,
    userCount: 2,
    version: 1,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'role-editor',
    slug: 'content-editor',
    name: '內容編輯',
    description: null,
    isSystem: false,
    permissionCount: 2,
    userCount: 1,
    version: 1,
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
    tags: [],
    locale: 'zh-TW',
    timezone: 'Asia/Taipei',
    lastLoginAt: '2026-09-19T02:10:00.000Z',
    lockedUntil: null,
    mfaEnabled: false,
    version: 1,
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
    tags: [],
    locale: 'zh-TW',
    timezone: 'Asia/Taipei',
    lastLoginAt: null,
    lockedUntil: '2030-01-01T00:00:00.000Z',
    mfaEnabled: false,
    version: 1,
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

/**
 * 站內通知（docs/architecture/backend/15-notification.md §4 的三種類型，外加一種前端不認得的類型）。
 * 新的在前；時間相對於載入 mock 的時刻，相對時間才有意義。
 */
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

export const NOTIFICATION_FIXTURES: Notification[] = [
  {
    id: 'notification-pending',
    type: 'approval.pending',
    params: {
      approvalType: 'user.register',
      requesterName: 'carol@example.com',
      subject: 'Carol',
    },
    link: { route: 'approval.detail', params: { approvalId: 'approval-pending' } },
    actor: null,
    readAt: null,
    createdAt: minutesAgo(5),
  },
  {
    id: 'notification-roles',
    type: 'user.rolesChanged',
    params: { added: ['內容編輯'], removed: ['稽核人員'] },
    link: { route: 'account.profile', params: {} },
    actor: { id: 'user-admin', name: 'Super Admin' },
    readAt: null,
    createdAt: minutesAgo(90),
  },
  {
    id: 'notification-result',
    type: 'approval.result',
    params: { approvalType: 'fileFolder.access', subject: '設計稿', status: 'approved' },
    link: { route: 'file.folder', params: { folderId: '11111111-1111-4111-8111-111111111111' } },
    actor: { id: 'user-admin', name: 'Super Admin' },
    readAt: minutesAgo(60),
    createdAt: minutesAgo(26 * 60),
  },
  {
    id: 'notification-unknown',
    type: 'webhook.disabled',
    params: {},
    link: null,
    actor: null,
    readAt: minutesAgo(60),
    createdAt: minutesAgo(3 * 24 * 60),
  },
];
