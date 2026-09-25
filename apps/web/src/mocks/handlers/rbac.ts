import { HttpResponse, http } from 'msw';

import { MOCK_API_BASE } from '../config';
import {
  AUDIT_LOG_FIXTURES,
  PERMISSION_FIXTURES,
  PERMISSION_RESOURCE_NAME_KEY,
  ROLE_FIXTURES,
  USER_FIXTURES,
} from '../resources/fixtures';

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
];
