import { HttpResponse, http } from 'msw';

import { MOCK_API_BASE } from '../config';
import {
  AUDIT_LOG_FIXTURES,
  PERMISSION_FIXTURES,
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
        groups: [...new Set(PERMISSION_FIXTURES.map((item) => item.resource))].map((resource) => ({
          resource,
          nameI18nKey: `permission.resource.${resource}`,
          keys: PERMISSION_FIXTURES.filter((item) => item.resource === resource).map(
            (item) => item.key,
          ),
        })),
      },
    }),
  ),

  http.get(`${MOCK_API_BASE}/audit-logs`, () =>
    HttpResponse.json({ data: paginate(AUDIT_LOG_FIXTURES) }),
  ),
];
