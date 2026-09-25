import { HttpResponse, http } from 'msw';

import { MOCK_API_BASE, mockState } from '../config';
import {
  APPROVAL_FIXTURES,
  AUDIT_LOG_FIXTURES,
  PERMISSION_FIXTURES,
  PERMISSION_RESOURCE_NAME_KEY,
  ROLE_FIXTURES,
  USER_FIXTURES,
} from '../resources/fixtures';

/** 目前登入的 mock 使用者（profile 回的是第一筆）。 */
const SELF_ID = USER_FIXTURES[0]!.id;

type Failure = { id: string; code: string; details?: Record<string, unknown> };

const forbidden = (permission: string) =>
  HttpResponse.json(
    {
      error: { code: 'AUTHZ_FORBIDDEN', message: 'forbidden', details: { missing: [permission] } },
    },
    { status: 403 },
  );

/**
 * 批次端點（ADR-0009）：逐筆套用與後端相同的檢查，回 `{ succeeded, failed }`。
 * 只回結果、不改 fixture——列表重新整理後資料不變。
 */
function batchHandler(
  path: string,
  permission: string,
  check: (id: string, body: Record<string, unknown>) => Failure | undefined,
) {
  return http.post(`${MOCK_API_BASE}${path}`, async ({ request }) => {
    if (!mockState.permissions.includes(permission)) return forbidden(permission);
    const body = (await request.json()) as { ids: string[] } & Record<string, unknown>;
    const failed: Failure[] = [];
    const succeeded: string[] = [];
    for (const id of body.ids) {
      const failure = check(id, body);
      if (failure) failed.push(failure);
      else succeeded.push(id);
    }
    return HttpResponse.json({ data: { succeeded, failed } });
  });
}

function checkUser(
  id: string,
  extra?: (user: (typeof USER_FIXTURES)[number]) => string | undefined,
) {
  const user = USER_FIXTURES.find((item) => item.id === id);
  if (!user) return { id, code: 'USER_NOT_FOUND' };
  if (id === SELF_ID) return { id, code: 'AUTHZ_SELF_MODIFY' };
  const code = extra?.(user);
  return code ? { id, code } : undefined;
}

const paginate = <T>(items: T[]) => ({
  items,
  pagination: { offset: 0, limit: 20, total: items.length },
});

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
  http.get(`${MOCK_API_BASE}/roles/:id/permissions`, () =>
    HttpResponse.json({ data: { permissions: PERMISSION_FIXTURES.slice(0, 2) } }),
  ),
  http.get(`${MOCK_API_BASE}/roles/:id/users`, () => HttpResponse.json({ data: paginate([]) })),

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

  batchHandler('/users/batch-delete', 'user:delete', (id) => checkUser(id)),
  batchHandler('/users/batch-status', 'user:update', (id) => checkUser(id)),
  batchHandler('/users/batch-unlock', 'user:update', (id) => {
    const user = USER_FIXTURES.find((item) => item.id === id);
    if (!user) return { id, code: 'USER_NOT_FOUND' };
    return user.status === 'locked' ? undefined : { id, code: 'USER_NOT_LOCKED' };
  }),
  batchHandler('/roles/batch-delete', 'role:delete', (id) => {
    const role = ROLE_FIXTURES.find((item) => item.id === id);
    if (!role) return { id, code: 'ROLE_NOT_FOUND' };
    if (role.isSystem) return { id, code: 'ROLE_SYSTEM_PROTECTED' };
    if (role.userCount > 0)
      return { id, code: 'ROLE_IN_USE', details: { userCount: role.userCount } };
    return undefined;
  }),
];
