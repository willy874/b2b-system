import {
  backendContextNames,
  HttpContext,
  MAIN_BACKEND,
  registerHttpContext,
  resetHttpContexts,
} from '@b2b-system/web-core/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchLogoutMutation } from '../fetcher';

let fetchMock: ReturnType<typeof vi.fn>;

/** 最後一次 fetch 的 init。 */
function lastInit(): RequestInit {
  return fetchMock.mock.lastCall?.[1] as RequestInit;
}

beforeEach(() => {
  fetchMock = vi.fn(
    async () => new Response(JSON.stringify({ data: { success: true } }), { status: 200 }),
  );
  vi.stubGlobal('fetch', fetchMock);
  registerHttpContext(
    new HttpContext({ name: backendContextNames(MAIN_BACKEND).base, baseUrl: '/api' }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetHttpContexts();
});

describe('fetchLogoutMutation（docs/architecture/04-sso.md §3.4）', () => {
  it('★ keepalive：按完登出立刻關分頁，請求仍會送完', async () => {
    await fetchLogoutMutation({ accessToken: 'token' });

    expect(fetchMock.mock.lastCall?.[0]).toBe('/api/platform/auth/logout');
    expect(lastInit()).toMatchObject({
      method: 'POST',
      keepalive: true,
      credentials: 'same-origin',
    });
  });

  it('有 access token：以 bearer 登出', async () => {
    await fetchLogoutMutation({ accessToken: 'token' });

    const headers = new Headers(lastInit().headers);
    expect(headers.get('authorization')).toBe('Bearer token');
    expect(headers.get('x-refresh-request')).toBeNull();
  });

  it('沒有 access token：以 refresh cookie 登出，帶 x-refresh-request（CSRF 緩解）', async () => {
    await fetchLogoutMutation({});

    const headers = new Headers(lastInit().headers);
    expect(headers.get('authorization')).toBeNull();
    expect(headers.get('x-refresh-request')).toBe('1');
    expect(lastInit().keepalive).toBe(true);
  });
});
