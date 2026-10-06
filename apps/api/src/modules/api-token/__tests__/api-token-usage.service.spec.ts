import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { currentTenant, runInTenantContext } from '@/core/tenant';
import type { Tenancy, TenantContext } from '@/core/tenant';

import { ApiTokenUsageService } from '../api-token-usage.service';
import type { ApiTokenRepository } from '../api-token.repository';

const NOW = new Date('2026-10-06T00:00:00.000Z');
const FLUSH_INTERVAL_MS = 60_000;

function setup() {
  /** 每次 touch 時所在的租戶、寫入的 token 與時間。 */
  const touches: Array<{ tenantId: string | undefined; ids: string[]; at: Date }> = [];
  const repo = {
    touch: vi.fn(async (ids: readonly string[], at: Date) => {
      touches.push({ tenantId: currentTenant()?.id, ids: [...ids], at });
    }),
  };
  const tenancy = {
    run: vi.fn(async <T>(tenantId: string, fn: () => Promise<T>) =>
      runInTenantContext({ id: tenantId } as unknown as TenantContext, fn),
    ),
  };
  const service = new ApiTokenUsageService(
    repo as unknown as ApiTokenRepository,
    tenancy as unknown as Tenancy,
  );
  return { service, repo, tenancy, touches };
}

function recordIn(service: ApiTokenUsageService, tenantId: string, tokenId: string): void {
  runInTenantContext({ id: tenantId } as unknown as TenantContext, () => service.record(tokenId));
}

const services: ApiTokenUsageService[] = [];

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.onApplicationShutdown()));
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function create() {
  const ctx = setup();
  services.push(ctx.service);
  return ctx;
}

describe('ApiTokenUsageService.flush（last_used_at 的批次寫入，docs/architecture/06-external-api.md §9.2 D8）', () => {
  it('依租戶分批：進入各自的租戶寫入那個租戶用過的 token', async () => {
    const ctx = create();
    recordIn(ctx.service, 't1', 'tok-a');
    recordIn(ctx.service, 't2', 'tok-b');
    recordIn(ctx.service, 't1', 'tok-c');
    await ctx.service.flush();
    expect(ctx.touches).toEqual([
      { tenantId: 't1', ids: ['tok-a', 'tok-c'], at: NOW },
      { tenantId: 't2', ids: ['tok-b'], at: NOW },
    ]);
  });

  it('同一把 token 用很多次只寫一次', async () => {
    const ctx = create();
    for (let i = 0; i < 5; i += 1) recordIn(ctx.service, 't1', 'tok-a');
    await ctx.service.flush();
    expect(ctx.repo.touch).toHaveBeenCalledWith(['tok-a'], NOW);
  });

  it('沒有用過的 token：不進入任何租戶', async () => {
    const ctx = create();
    await ctx.service.flush();
    expect(ctx.tenancy.run).not.toHaveBeenCalled();
  });

  it('寫過的不會在下一輪重寫', async () => {
    const ctx = create();
    recordIn(ctx.service, 't1', 'tok-a');
    await ctx.service.flush();
    await ctx.service.flush();
    expect(ctx.repo.touch).toHaveBeenCalledTimes(1);
  });

  it('一個租戶寫入失敗（停用、維護中）：記警告，其他租戶照常寫入', async () => {
    const ctx = create();
    ctx.tenancy.run.mockRejectedValueOnce(new Error('TENANT_UNAVAILABLE'));
    recordIn(ctx.service, 't1', 'tok-a');
    recordIn(ctx.service, 't2', 'tok-b');
    await expect(ctx.service.flush()).resolves.toBeUndefined();
    expect(ctx.touches).toEqual([{ tenantId: 't2', ids: ['tok-b'], at: NOW }]);
    expect(Logger.prototype.warn).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1' }),
      expect.any(String),
    );
  });

  it('寫入失敗的那一輪不重試（最後使用時間少記一次）', async () => {
    const ctx = create();
    ctx.tenancy.run.mockRejectedValueOnce(new Error('TENANT_UNAVAILABLE'));
    recordIn(ctx.service, 't1', 'tok-a');
    await ctx.service.flush();
    await ctx.service.flush();
    expect(ctx.repo.touch).not.toHaveBeenCalled();
  });
});

describe('ApiTokenUsageService.record 的計時（docs/architecture/06-external-api.md §9.2 D8）', () => {
  it('不在租戶脈絡裡呼叫是程式錯誤', () => {
    const ctx = create();
    expect(() => ctx.service.record('tok-a')).toThrow();
  });

  it('從沒呼叫過 record：時間過去也不寫入（內部 api 沒有計時器）', async () => {
    const ctx = create();
    await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS * 3);
    expect(ctx.tenancy.run).not.toHaveBeenCalled();
  });

  it('第一次 record 後每分鐘寫一次', async () => {
    const ctx = create();
    recordIn(ctx.service, 't1', 'tok-a');
    await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS - 1);
    expect(ctx.repo.touch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(ctx.repo.touch).toHaveBeenCalledTimes(1);

    recordIn(ctx.service, 't1', 'tok-b');
    await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);
    expect(ctx.repo.touch).toHaveBeenLastCalledWith(
      ['tok-b'],
      new Date(NOW.getTime() + 2 * FLUSH_INTERVAL_MS),
    );
  });

  it('多次 record 只有一個計時器：一分鐘內只寫一次', async () => {
    const ctx = create();
    recordIn(ctx.service, 't1', 'tok-a');
    recordIn(ctx.service, 't1', 'tok-b');
    recordIn(ctx.service, 't2', 'tok-c');
    await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS);
    expect(ctx.tenancy.run).toHaveBeenCalledTimes(2);
  });

  it('計時器不阻止程序結束（unref）', () => {
    const ctx = create();
    const unref = vi.fn();
    vi.spyOn(globalThis, 'setInterval').mockReturnValue({ unref } as unknown as NodeJS.Timeout);
    recordIn(ctx.service, 't1', 'tok-a');
    expect(unref).toHaveBeenCalledTimes(1);
  });
});

describe('ApiTokenUsageService.onApplicationShutdown（docs/architecture/06-external-api.md §9.2 D8）', () => {
  it('程序結束前把還沒寫的寫掉', async () => {
    const ctx = create();
    recordIn(ctx.service, 't1', 'tok-a');
    await ctx.service.onApplicationShutdown();
    expect(ctx.repo.touch).toHaveBeenCalledWith(['tok-a'], NOW);
  });

  it('結束後計時器停止：時間過去不再寫入', async () => {
    const ctx = create();
    recordIn(ctx.service, 't1', 'tok-a');
    await ctx.service.onApplicationShutdown();
    await vi.advanceTimersByTimeAsync(FLUSH_INTERVAL_MS * 2);
    expect(ctx.tenancy.run).toHaveBeenCalledTimes(1);
  });
});
