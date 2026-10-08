import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it } from 'vitest';

import { AppException } from '@/core/errors';
import { MemoryRateLimitStore } from '@/core/rate-limit';
import { runInTenantContext } from '@/core/tenant';
import type { TenantContext } from '@/core/tenant';

import type { ExternalRequest } from '../api-token-auth.guard';
import { ExternalRateLimitGuard } from '../external-rate-limit.guard';

const LIMITS: Record<string, number> = {
  EXTERNAL_RATE_LIMIT: 3,
  ANONYMOUS_RATE_LIMIT: 2,
};

interface CallOptions {
  tokenId?: string;
  tenantId?: string;
  ip?: string;
  remoteAddress?: string;
  type?: 'http' | 'ws';
}

const storages: MemoryRateLimitStore[] = [];

afterEach(() => {
  for (const storage of storages.splice(0)) storage.onModuleDestroy();
});

function createGuard() {
  const storage = new MemoryRateLimitStore();
  storages.push(storage);
  const config = { get: (key: string) => LIMITS[key] } as unknown as ConfigService<never, true>;
  const guard = new ExternalRateLimitGuard(storage, config);

  return async (options: CallOptions = {}) => {
    const request = {
      headers: {},
      ip: options.ip ?? (options.remoteAddress ? undefined : '203.0.113.10'),
      socket: { remoteAddress: options.remoteAddress },
      ...(options.tokenId
        ? { apiToken: { id: options.tokenId, expiresAt: new Date('2026-12-31T00:00:00Z') } }
        : {}),
    } as unknown as ExternalRequest;
    const headers: Record<string, string> = {};
    const context = {
      getType: () => options.type ?? 'http',
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({
          setHeader: (name: string, value: string) => {
            headers[name] = value;
          },
        }),
      }),
    } as unknown as ExecutionContext;
    const run = () =>
      guard.canActivate(context).then(
        () => ({ status: 200, error: undefined, headers }),
        (error: unknown) => {
          if (!(error instanceof AppException)) throw error;
          return { status: 429, error, headers };
        },
      );
    return options.tenantId
      ? runInTenantContext(
          { id: options.tenantId, code: options.tenantId } as unknown as TenantContext,
          run,
        )
      : run();
  };
}

async function statuses(times: number, call: () => Promise<{ status: number }>) {
  const results: number[] = [];
  for (let i = 0; i < times; i += 1) {
    // oxlint-disable-next-line no-await-in-loop -- 依序計數
    results.push((await call()).status);
  }
  return results;
}

describe('ExternalRateLimitGuard（docs/architecture/06-external-api.md §9.2 D13）', () => {
  it('認證過的請求以 token 計（EXTERNAL_RATE_LIMIT）', async () => {
    const call = createGuard();
    expect(await statuses(4, () => call({ tenantId: 't1', tokenId: 'tok-a' }))).toEqual([
      200, 200, 200, 429,
    ]);
  });

  it('同一個 IP 的兩把 token 各自有完整的額度', async () => {
    const call = createGuard();
    await statuses(3, () => call({ tenantId: 't1', tokenId: 'tok-a' }));
    expect((await call({ tenantId: 't1', tokenId: 'tok-a' })).status).toBe(429);
    expect((await call({ tenantId: 't1', tokenId: 'tok-b' })).status).toBe(200);
  });

  it('同一把 token 從不同 IP 呼叫：共用同一個額度', async () => {
    const call = createGuard();
    await statuses(3, () => call({ tenantId: 't1', tokenId: 'tok-a', ip: '203.0.113.10' }));
    expect((await call({ tenantId: 't1', tokenId: 'tok-a', ip: '198.51.100.7' })).status).toBe(429);
  });

  it('token 的 key 帶租戶：兩個租戶裡同一個 token id 不共用額度', async () => {
    const call = createGuard();
    await statuses(3, () => call({ tenantId: 't1', tokenId: 'tok-a' }));
    expect((await call({ tenantId: 't2', tokenId: 'tok-a' })).status).toBe(200);
  });

  it('token 的請求不佔用同一個 IP 的匿名額度', async () => {
    const call = createGuard();
    await statuses(3, () => call({ tenantId: 't1', tokenId: 'tok-a' }));
    expect(await statuses(2, () => call())).toEqual([200, 200]);
  });

  it('沒有 token 的請求（健康檢查）以 IP 計（ANONYMOUS_RATE_LIMIT）', async () => {
    const call = createGuard();
    expect(await statuses(3, () => call())).toEqual([200, 200, 429]);
    expect((await call({ ip: '198.51.100.7' })).status).toBe(200);
  });

  it('有 token 但不在租戶脈絡裡：以 IP 計', async () => {
    const call = createGuard();
    expect(await statuses(3, () => call({ tokenId: 'tok-a' }))).toEqual([200, 200, 429]);
  });

  it('沒有 req.ip 時以連線的位址計', async () => {
    const call = createGuard();
    await statuses(2, () => call({ remoteAddress: '192.0.2.1' }));
    expect((await call({ remoteAddress: '192.0.2.1' })).status).toBe(429);
    expect((await call({ remoteAddress: '192.0.2.2' })).status).toBe(200);
  });

  it('超過上限回 RATE_LIMITED，帶 Retry-After 標頭與 details.retryAfterSeconds', async () => {
    const call = createGuard();
    await statuses(2, () => call());
    const blocked = await call();
    expect(blocked.error?.code).toBe('RATE_LIMITED');
    const seconds = blocked.error?.details?.retryAfterSeconds;
    expect(seconds).toBeGreaterThanOrEqual(1);
    expect(blocked.headers['Retry-After']).toBe(String(seconds));
  });

  it('WebSocket 不計數', async () => {
    const call = createGuard();
    expect(await statuses(5, () => call({ type: 'ws' }))).toEqual([200, 200, 200, 200, 200]);
    expect((await call()).status).toBe(200);
  });
});
