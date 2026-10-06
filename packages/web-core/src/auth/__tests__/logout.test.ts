import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NetworkError } from '../../client';
import { AppError } from '../../errors';
import { signOut } from '../logout';
import { SessionStore } from '../SessionStore';

let session: SessionStore;

beforeEach(() => {
  globalThis.localStorage?.clear();
  session = new SessionStore('logout-test');
});

afterEach(() => {
  session.dispose();
});

describe('signOut（docs/architecture/frontend/09-state-and-storage.md §5.2、docs/architecture/04-sso.md §3.4）', () => {
  it('先結束前端 session，再以 bearer 撤銷後端；完成時回傳 true', async () => {
    session.setTokens({ accessToken: 'token', expiresIn: 300 });
    const ended = vi.fn();
    session.events.on('ended', ended);
    const revoke = vi.fn(async () => {
      expect(ended).toHaveBeenCalledWith('logout');
    });

    await expect(signOut({ reason: 'logout', revoke, session })).resolves.toBe(true);

    expect(revoke).toHaveBeenCalledWith({ accessToken: 'token' });
    expect(session.hasSession()).toBe(false);
  });

  it('★ 續期暫時失敗（拿不到 token）→ 仍然登出，改以 refresh cookie 撤銷（不帶 accessToken）', async () => {
    session.setRefreshFn(() => Promise.reject(new NetworkError(new TypeError('Failed to fetch'))));
    session.setTokens({ accessToken: 'stale', expiresIn: 1 });
    const revoke = vi.fn(async () => ({ success: true }));

    await expect(signOut({ reason: 'logout', revoke, session })).resolves.toBe(true);

    expect(revoke).toHaveBeenCalledWith({});
    expect(session.hasSession()).toBe(false);
  });

  it.each([
    ['NetworkError', new NetworkError(new TypeError('Failed to fetch'))],
    ['500', new AppError('INTERNAL_ERROR', 500)],
    ['429', new AppError('RATE_LIMITED', 429)],
  ])('★ 撤銷失敗（%s）→ 回傳 false（登出未完成），前端 session 仍然結束', async (_name, error) => {
    session.setTokens({ accessToken: 'token', expiresIn: 300 });
    const revoke = vi.fn(() => Promise.reject(error));

    await expect(signOut({ reason: 'logout', revoke, session })).resolves.toBe(false);

    expect(session.hasSession()).toBe(false);
  });
});
