import { HttpResponse, http } from 'msw/http';

import { MOCK_API_BASE, mockState } from '../config';
import { USER_FIXTURES } from '../resources/fixtures';

export const authHandlers = [
  http.post(`${MOCK_API_BASE}/auth/login`, async ({ request }) => {
    const body = (await request.json()) as { email: string; password: string };
    if (body.password === 'wrong') {
      return HttpResponse.json(
        { error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'invalid' } },
        { status: 401 },
      );
    }
    return HttpResponse.json({
      data: { accessToken: 'mock-access-token', tokenType: 'Bearer', expiresIn: 300 },
    });
  }),

  http.post(`${MOCK_API_BASE}/auth/refresh`, () =>
    HttpResponse.json({
      data: { accessToken: 'mock-access-token', tokenType: 'Bearer', expiresIn: 300 },
    }),
  ),

  // 永遠回 202（帳號列舉防護），與後端一致
  http.post(`${MOCK_API_BASE}/auth/register`, () =>
    HttpResponse.json({ data: { submitted: true } }, { status: 202 }),
  ),

  http.post(`${MOCK_API_BASE}/auth/logout`, () => HttpResponse.json({ data: { success: true } })),

  // 這個網域的租戶（docs/adr/0020-physical-tenant-isolation.md D7）
  http.get(`${MOCK_API_BASE}/tenant/current`, () =>
    HttpResponse.json({ data: { code: 'default', name: '預設租戶' } }),
  ),

  http.get(`${MOCK_API_BASE}/auth/profile`, () =>
    HttpResponse.json({
      data: {
        user: {
          id: USER_FIXTURES[0]!.id,
          email: USER_FIXTURES[0]!.email,
          username: USER_FIXTURES[0]!.username,
          displayName: USER_FIXTURES[0]!.displayName,
          status: USER_FIXTURES[0]!.status,
          lastLoginAt: USER_FIXTURES[0]!.lastLoginAt,
          preferences: { locale: 'zh-TW', timezone: 'Asia/Taipei' },
        },
        roles: USER_FIXTURES[0]!.roles,
        permissions: mockState.permissions,
        // 可啟用的 feature 全部開啟（docs/adr/0021-runtime-feature-activation.md D8）
        features: ['file', 'auditLog', 'job'],
        flags: [],
      },
    }),
  ),
];
