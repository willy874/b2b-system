import { HttpResponse, http } from 'msw';

import { MOCK_API_BASE, mockState } from '../config';
import {
  APPROVAL_FIXTURES,
  AUDIT_LOG_FIXTURES,
  effectivePermissions,
  PERMISSION_FIXTURES,
  PERMISSION_RESOURCE_NAME_KEY,
  ROLE_FIXTURES,
  USER_FIXTURES,
} from '../resources/fixtures';

/** 目前登入的 mock 使用者（profile 回的是第一筆）。 */
const SELF_ID = USER_FIXTURES[0]!.id;

type Failure = { code: string; details?: Record<string, unknown> };

const forbidden = (permission: string) =>
  HttpResponse.json(
    {
      error: { code: 'AUTHZ_FORBIDDEN', message: 'forbidden', details: { missing: [permission] } },
    },
    { status: 403 },
  );

function failureStatus(code: string): number {
  if (code === 'VALIDATION_FAILED') return 400;
  if (code.endsWith('_NOT_FOUND')) return 404;
  if (code.startsWith('AUTHZ_')) return 403;
  return 409;
}

/**
 * 單筆寫入端點：套用與後端相同的檢查，失敗回對應的錯誤。批次操作由前端佇列逐筆呼叫這些端點（ADR-0012）。
 * 只回結果、不改 fixture——列表重新整理後資料不變。
 */
function writeHandler(
  method: 'patch' | 'post' | 'delete',
  path: string,
  permission: string,
  check: (id: string) => Failure | undefined,
  respond: (id: string) => Response,
) {
  return http[method](`${MOCK_API_BASE}${path}`, ({ params }) => {
    if (!mockState.permissions.includes(permission)) return forbidden(permission);
    const id = String(params.id);
    const failure = check(id);
    if (!failure) return respond(id);
    return HttpResponse.json(
      { error: { code: failure.code, message: failure.code, details: failure.details } },
      { status: failureStatus(failure.code) },
    );
  });
}

const noContent = () => new HttpResponse(null, { status: 204 });

/** mock 的回收桶：已刪除的使用者（id 與 email 不和 `USER_FIXTURES` 重複）。 */
const DELETED_USER_FIXTURES = USER_FIXTURES.slice(0, 2).map((user) =>
  Object.assign(structuredClone(user), {
    id: `${user.id}-deleted`,
    email: `deleted-${user.email}`,
    username: null,
  }),
);

/** mock 的回收桶：已刪除的角色（自訂角色的複本，id 與名稱不和 `ROLE_FIXTURES` 重複）。 */
const DELETED_ROLE_FIXTURES = ROLE_FIXTURES.filter((role) => !role.isSystem)
  .slice(0, 1)
  .map((role) =>
    Object.assign(structuredClone(role), {
      id: `${role.id}-deleted`,
      slug: `${role.slug}-deleted`,
      name: `${role.name}（已刪除）`,
    }),
  );

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const toRoleTrashItem = (role: (typeof ROLE_FIXTURES)[number]) => ({
  id: role.id,
  type: 'role' as const,
  name: role.name,
  description: role.description,
  deletedAt: role.updatedAt,
  deletedBy: { id: SELF_ID, name: USER_FIXTURES[0]!.displayName },
  purgeAt: new Date(Date.parse(role.updatedAt) + THIRTY_DAYS_MS).toISOString(),
});

const toTrashItem = (user: (typeof USER_FIXTURES)[number]) => ({
  id: user.id,
  type: 'user' as const,
  name: user.displayName,
  description: user.email,
  deletedAt: user.updatedAt,
  deletedBy: { id: SELF_ID, name: USER_FIXTURES[0]!.displayName },
  purgeAt: new Date(Date.parse(user.updatedAt) + THIRTY_DAYS_MS).toISOString(),
});
const userResponse = (id: string) =>
  HttpResponse.json({ data: USER_FIXTURES.find((item) => item.id === id) });

function checkUser(
  id: string,
  extra?: (user: (typeof USER_FIXTURES)[number]) => string | undefined,
) {
  const user = USER_FIXTURES.find((item) => item.id === id);
  if (!user) return { code: 'USER_NOT_FOUND' };
  if (id === SELF_ID) return { code: 'AUTHZ_SELF_MODIFY' };
  const code = extra?.(user);
  return code ? { code } : undefined;
}

const paginate = <T>(items: T[]) => ({
  items,
  pagination: { offset: 0, limit: 20, total: items.length },
});

/** mock 模式下每個角色明確授予的鍵（PATCH 會改它）；預設取目錄的前兩個。 */
const rolePermissionState = new Map<string, string[]>();

function roleExplicitKeys(id: string): string[] {
  return rolePermissionState.get(id) ?? PERMISSION_FIXTURES.slice(0, 2).map((item) => item.key);
}

function rolePermissionsBody(id: string) {
  const isSuperAdmin = ROLE_FIXTURES.find((role) => role.id === id)?.slug === 'super-admin';
  const explicit = isSuperAdmin ? [] : roleExplicitKeys(id);
  return {
    permissions: PERMISSION_FIXTURES.filter((item) => explicit.includes(item.key)),
    effective: effectivePermissions(explicit, isSuperAdmin),
    isSuperAdmin,
  };
}

/** 角色的 mock 版本：第 1 版少一個權限、第 2 版等於目前的內容（新的在後）。 */
function roleRevisions(id: string) {
  const role = ROLE_FIXTURES.find((item) => item.id === id);
  if (!role) return [];
  const keys = roleExplicitKeys(id).toSorted();
  const actor = { id: USER_FIXTURES[0]!.id, name: USER_FIXTURES[0]!.displayName };
  return [
    {
      version: 1,
      createdAt: role.createdAt,
      actor: null,
      tooLarge: false,
      snapshot: { name: role.name, description: null, permissionKeys: keys.slice(1) },
    },
    {
      version: 2,
      createdAt: role.updatedAt,
      actor,
      tooLarge: false,
      snapshot: { name: role.name, description: role.description, permissionKeys: keys },
    },
  ];
}

export const rbacHandlers = [
  http.get(`${MOCK_API_BASE}/users`, () => HttpResponse.json({ data: paginate(USER_FIXTURES) })),
  http.get(`${MOCK_API_BASE}/users/:id`, ({ params }) => {
    const user = USER_FIXTURES.find((item) => item.id === params.id);
    return user
      ? HttpResponse.json({ data: user })
      : HttpResponse.json(
          { error: { code: 'USER_NOT_FOUND', message: 'not found' } },
          { status: 404 },
        );
  }),

  http.get(`${MOCK_API_BASE}/roles`, () => HttpResponse.json({ data: paginate(ROLE_FIXTURES) })),
  http.get(`${MOCK_API_BASE}/roles/:id`, ({ params }) => {
    const role = ROLE_FIXTURES.find((item) => item.id === params.id);
    return role
      ? HttpResponse.json({ data: role })
      : HttpResponse.json(
          { error: { code: 'ROLE_NOT_FOUND', message: 'not found' } },
          { status: 404 },
        );
  }),
  http.get(`${MOCK_API_BASE}/roles/:id/permissions`, ({ params }) =>
    HttpResponse.json({ data: rolePermissionsBody(String(params.id)) }),
  ),
  http.patch(`${MOCK_API_BASE}/roles/:id/permissions`, async ({ params, request }) => {
    if (!mockState.permissions.includes('role:grantPermission')) {
      return forbidden('role:grantPermission');
    }
    const id = String(params.id);
    const body = (await request.json()) as { add: string[]; remove: string[] };
    const next = new Set(roleExplicitKeys(id));
    for (const key of body.remove) next.delete(key);
    for (const key of body.add) next.add(key);
    rolePermissionState.set(id, [...next]);
    return HttpResponse.json({ data: rolePermissionsBody(id) });
  }),
  http.get(`${MOCK_API_BASE}/roles/:id/users`, () => HttpResponse.json({ data: paginate([]) })),
  // 版本紀錄（ADR-0025 R5）：每個角色兩版，第 2 版等於目前的內容；讀要 role:read、還原要 role:update
  http.get(`${MOCK_API_BASE}/roles/:id/revisions`, ({ params }) => {
    if (!mockState.permissions.includes('role:read')) return forbidden('role:read');
    return HttpResponse.json({
      data: paginate(
        roleRevisions(String(params.id))
          .toReversed()
          .map(({ snapshot: _snapshot, ...summary }) => summary),
      ),
    });
  }),
  http.get(`${MOCK_API_BASE}/roles/:id/revisions/:version`, ({ params }) => {
    if (!mockState.permissions.includes('role:read')) return forbidden('role:read');
    const revision = roleRevisions(String(params.id)).find(
      (item) => item.version === Number(params.version),
    );
    return revision
      ? HttpResponse.json({ data: revision })
      : HttpResponse.json(
          { error: { code: 'REVISION_NOT_FOUND', message: 'not found' } },
          { status: 404 },
        );
  }),
  writeHandler(
    'post',
    '/roles/:id/revisions/:version/revert',
    'role:update',
    (id) => (ROLE_FIXTURES.some((item) => item.id === id) ? undefined : { code: 'ROLE_NOT_FOUND' }),
    (id) => HttpResponse.json({ data: ROLE_FIXTURES.find((item) => item.id === id) }),
  ),

  http.get(`${MOCK_API_BASE}/permissions`, () =>
    HttpResponse.json({
      data: {
        items: PERMISSION_FIXTURES,
        groups: Object.entries(PERMISSION_RESOURCE_NAME_KEY).map(([resource, nameI18nKey]) => ({
          resource,
          nameI18nKey,
          keys: PERMISSION_FIXTURES.filter((item) => item.resource === resource).map(
            (item) => item.key,
          ),
        })),
      },
    }),
  ),

  // 列表只回摘要，`changes` / `metadata` 由明細端點提供（與後端一致）
  http.get(`${MOCK_API_BASE}/audit-logs`, () =>
    HttpResponse.json({
      data: paginate(
        AUDIT_LOG_FIXTURES.map(({ changes: _c, metadata: _m, ...summary }) => summary),
      ),
    }),
  ),
  http.get(`${MOCK_API_BASE}/audit-logs/:id`, ({ params }) => {
    const log = AUDIT_LOG_FIXTURES.find((item) => item.id === params.id);
    return log
      ? HttpResponse.json({ data: log })
      : HttpResponse.json(
          { error: { code: 'VALIDATION_FAILED', message: 'not found' } },
          { status: 400 },
        );
  }),

  http.get(`${MOCK_API_BASE}/approvals`, () =>
    HttpResponse.json({ data: paginate(APPROVAL_FIXTURES) }),
  ),
  http.get(`${MOCK_API_BASE}/approvals/:id`, ({ params }) => {
    const approval = APPROVAL_FIXTURES.find((item) => item.id === params.id);
    return approval
      ? HttpResponse.json({ data: approval })
      : HttpResponse.json(
          { error: { code: 'APPROVAL_NOT_FOUND', message: 'not found' } },
          { status: 404 },
        );
  }),
  // 審核：沒有 approval:review 回 403（MSW 要模擬權限行為，docs/conventions/04-testing.md §3）
  http.post(`${MOCK_API_BASE}/approvals/:id/:decision`, async ({ params, request }) => {
    if (!mockState.permissions.includes('approval:review')) {
      return HttpResponse.json(
        {
          error: {
            code: 'AUTHZ_FORBIDDEN',
            message: 'forbidden',
            details: { missing: ['approval:review'] },
          },
        },
        { status: 403 },
      );
    }
    const approval = APPROVAL_FIXTURES.find((item) => item.id === params.id);
    if (!approval) {
      return HttpResponse.json(
        { error: { code: 'APPROVAL_NOT_FOUND', message: 'not found' } },
        { status: 404 },
      );
    }
    if (approval.status !== 'pending') {
      return HttpResponse.json(
        { error: { code: 'APPROVAL_ALREADY_REVIEWED', message: 'reviewed' } },
        { status: 409 },
      );
    }
    const body = (await request.json()) as { comment?: string };
    const approved = params.decision === 'approve';
    return HttpResponse.json({
      data: {
        ...approval,
        status: approved ? 'approved' : 'rejected',
        reviewerId: 'user-admin',
        reviewerName: 'admin@example.com',
        reviewComment: body.comment ?? null,
        reviewedAt: new Date().toISOString(),
        resultResourceId: approved ? 'user-carol' : null,
      },
    });
  }),

  writeHandler('delete', '/users/:id', 'user:delete', (id) => checkUser(id), noContent),
  // 回收桶（ADR-0025 D9）：mock 模式以 fixture 的複本當成已刪除的使用者與角色，只示範列表與還原
  // 檔案與資料夾（R4）：mock 模式沒有檔案管理器的資料，只示範權限與空的分頁
  http.get(`${MOCK_API_BASE}/trash`, ({ request }) => {
    const type = new URL(request.url).searchParams.get('type');
    const permission =
      type === 'role'
        ? 'role:delete'
        : type === 'file' || type === 'fileFolder'
          ? 'file:delete'
          : 'user:delete';
    if (!mockState.permissions.includes(permission)) return forbidden(permission);
    const items: Array<ReturnType<typeof toTrashItem> | ReturnType<typeof toRoleTrashItem>> =
      type === 'role'
        ? DELETED_ROLE_FIXTURES.map(toRoleTrashItem)
        : type === 'user' || type === null
          ? DELETED_USER_FIXTURES.map(toTrashItem)
          : [];
    return HttpResponse.json({ data: paginate(items) });
  }),
  writeHandler(
    'post',
    '/roles/:id/restore',
    'role:delete',
    (id) => {
      if (ROLE_FIXTURES.some((item) => item.id === id)) return { code: 'ROLE_NOT_DELETED' };
      return DELETED_ROLE_FIXTURES.some((item) => item.id === id)
        ? undefined
        : { code: 'ROLE_NOT_FOUND' };
    },
    (id) => {
      const role = DELETED_ROLE_FIXTURES.find((item) => item.id === id);
      return HttpResponse.json({ data: { ...role, holdersRestored: role?.userCount ?? 0 } });
    },
  ),
  writeHandler(
    'post',
    '/users/:id/restore',
    'user:delete',
    (id) => {
      if (USER_FIXTURES.some((item) => item.id === id)) return { code: 'USER_NOT_DELETED' };
      return DELETED_USER_FIXTURES.some((item) => item.id === id)
        ? undefined
        : { code: 'USER_NOT_FOUND' };
    },
    (id) => HttpResponse.json({ data: DELETED_USER_FIXTURES.find((item) => item.id === id) }),
  ),
  // 樂觀鎖：不帶 version → 400；帶的 version 與 fixture 不同 → 409（與後端相同；docs/architecture/backend/03-api-conventions.md §11）
  http.patch(`${MOCK_API_BASE}/users/:id`, async ({ params, request }) => {
    if (!mockState.permissions.includes('user:update')) return forbidden('user:update');
    const id = String(params.id);
    const { version } = (await request.json()) as { version?: number };
    const invalid: Failure | undefined =
      version === undefined ? { code: 'VALIDATION_FAILED' } : undefined;
    const failure = invalid ?? checkUser(id);
    const current = USER_FIXTURES.find((item) => item.id === id)?.version;
    const conflict: Failure | undefined =
      !failure && version !== current
        ? { code: 'USER_VERSION_CONFLICT', details: { current } }
        : undefined;
    const error: Failure | undefined = failure ?? conflict;
    if (!error) return userResponse(id);
    return HttpResponse.json(
      { error: { code: error.code, message: error.code, details: error.details } },
      { status: failureStatus(error.code) },
    );
  }),
  writeHandler(
    'post',
    '/users/:id/unlock',
    'user:update',
    (id) => checkUser(id, (user) => (user.status === 'locked' ? undefined : 'USER_NOT_LOCKED')),
    userResponse,
  ),
  writeHandler(
    'delete',
    '/roles/:id',
    'role:delete',
    (id) => {
      const role = ROLE_FIXTURES.find((item) => item.id === id);
      if (!role) return { code: 'ROLE_NOT_FOUND' };
      if (role.isSystem) return { code: 'ROLE_SYSTEM_PROTECTED' };
      if (role.userCount > 0)
        return { code: 'ROLE_IN_USE', details: { userCount: role.userCount } };
      return undefined;
    },
    noContent,
  ),
];
