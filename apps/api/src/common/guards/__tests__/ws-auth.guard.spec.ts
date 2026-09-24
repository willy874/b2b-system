import type { ExecutionContext } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';

import type { AccessTokenVerifier } from '@/common/auth';

import { WsAuthGuard } from '../ws-auth.guard';

const identity = {
  userId: 'user-1',
  email: 'a@example.com',
  tokenVersion: 0,
  expiresAt: Date.now() + 60_000,
};

function createContext(data: Record<string, unknown>, type = 'ws') {
  const socket = { id: 's1', data, disconnect: vi.fn() };
  const context = {
    getType: () => type,
    switchToWs: () => ({ getClient: () => socket }),
  } as unknown as ExecutionContext;
  return { context, socket };
}

function createGuard(result: Awaited<ReturnType<AccessTokenVerifier['checkUser']>>) {
  const verifier = { checkUser: vi.fn().mockResolvedValue(result) };
  return { guard: new WsAuthGuard(verifier as unknown as AccessTokenVerifier), verifier };
}

describe('WsAuthGuard（docs/architecture/backend/08-realtime.md §4）', () => {
  it('非 ws 的執行環境直接放行', async () => {
    const { guard, verifier } = createGuard({ ok: false, code: 'AUTH_TOKEN_INVALID' });
    const { context } = createContext({}, 'http');
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifier.checkUser).not.toHaveBeenCalled();
  });

  it('使用者仍有效 → 放行', async () => {
    const { guard, verifier } = createGuard({ ok: true, user: {} as never });
    const { context, socket } = createContext({ ...identity });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifier.checkUser).toHaveBeenCalledWith('user-1', 0);
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it.each(['AUTH_ACCOUNT_DISABLED', 'AUTH_TOKEN_STALE', 'AUTH_TOKEN_INVALID'] as const)(
    '重驗失敗（%s）→ 拒絕並斷線',
    async (code) => {
      const { guard } = createGuard({ ok: false, code });
      const { context, socket } = createContext({ ...identity });
      await expect(guard.canActivate(context)).resolves.toBe(false);
      expect(socket.disconnect).toHaveBeenCalledWith(true);
    },
  );

  it('授權期限已過（沒續期）→ 拒絕並斷線，不必查使用者', async () => {
    const { guard, verifier } = createGuard({ ok: true, user: {} as never });
    const { context, socket } = createContext({ ...identity, expiresAt: Date.now() - 1 });
    await expect(guard.canActivate(context)).resolves.toBe(false);
    expect(verifier.checkUser).not.toHaveBeenCalled();
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });

  it('socket 上沒有身分 → 拒絕並斷線', async () => {
    const { guard } = createGuard({ ok: true, user: {} as never });
    const { context, socket } = createContext({});
    await expect(guard.canActivate(context)).resolves.toBe(false);
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
});
