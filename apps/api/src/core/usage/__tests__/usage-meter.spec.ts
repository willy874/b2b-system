import type { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Env } from '../../config';
import { runInTenantContext } from '../../tenant';
import type { TenantContext } from '../../tenant';
import { TenantUsageSnapshots } from '../tenant-usage-snapshots';
import type { UsageCounterRepository, UsageCountRow } from '../usage-counter.repository';
import { usageDate, usageDateDaysBefore } from '../usage-date';
import { UsageMeter } from '../usage-meter';
import { UsageRequestMiddleware } from '../usage-request.middleware';

function inTenant<T>(id: string, fn: () => T): T {
  return runInTenantContext({ id } as unknown as TenantContext, fn);
}

function setupMeter(add: (rows: readonly UsageCountRow[]) => Promise<void> = async () => {}) {
  const repo = { add: vi.fn(add) };
  return { meter: new UsageMeter(repo as unknown as UsageCounterRepository), repo };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('UsageMeter（docs/architecture/05-tenancy.md §14.2 D3）', () => {
  it('依租戶與日期合併成一列一次寫出', async () => {
    const { meter, repo } = setupMeter();
    inTenant('t1', () => {
      meter.count('requestsInternal');
      meter.count('requestsInternal');
      meter.count('jobsExecuted');
    });
    inTenant('t2', () => meter.count('requestsExternal'));
    await meter.flush();
    expect(repo.add).toHaveBeenCalledExactlyOnceWith([
      {
        tenantId: 't1',
        date: usageDate(),
        requestsInternal: 2,
        requestsExternal: 0,
        jobsExecuted: 1,
      },
      {
        tenantId: 't2',
        date: usageDate(),
        requestsInternal: 0,
        requestsExternal: 1,
        jobsExecuted: 0,
      },
    ]);
  });

  it('沒有租戶脈絡（平台的請求）不記', async () => {
    const { meter, repo } = setupMeter();
    meter.count('requestsInternal');
    await meter.flush();
    expect(repo.add).toHaveBeenCalledWith([]);
  });

  it('跨過午夜：記在發生的那一天', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-08T23:59:59.000Z'));
    const { meter, repo } = setupMeter();
    inTenant('t1', () => meter.count('requestsInternal'));
    vi.setSystemTime(new Date('2026-10-09T00:00:01.000Z'));
    inTenant('t1', () => meter.count('requestsInternal'));
    await meter.flush();
    expect(repo.add.mock.calls[0]?.[0].map((row) => row.date)).toEqual([
      '2026-10-08',
      '2026-10-09',
    ]);
  });

  it('寫入失敗：這一輪的計數丟掉，下一輪不重送（不讓記憶體一直長）', async () => {
    const { meter, repo } = setupMeter(async () => {
      throw new Error('db down');
    });
    inTenant('t1', () => meter.count('requestsInternal'));
    await expect(meter.flush()).resolves.toBeUndefined();
    await meter.flush();
    expect(repo.add.mock.calls[1]?.[0]).toEqual([]);
  });

  it('關機前寫出最後一輪', async () => {
    const { meter, repo } = setupMeter();
    inTenant('t1', () => meter.count('jobsExecuted'));
    await meter.onApplicationShutdown();
    expect(repo.add.mock.calls[0]?.[0]).toHaveLength(1);
  });
});

function setupMiddleware(surface: Env['API_SURFACE']) {
  const meter = { count: vi.fn() };
  const config = { get: vi.fn(() => surface) } as unknown as ConfigService<Env, true>;
  const middleware = new UsageRequestMiddleware(meter as unknown as UsageMeter, config);
  const run = (url: string) => {
    const next = vi.fn();
    middleware.use({ originalUrl: url } as Request, {} as Response, next);
    expect(next).toHaveBeenCalledOnce();
  };
  return { meter, run };
}

describe('UsageRequestMiddleware（docs/architecture/05-tenancy.md §14.2 D10）', () => {
  it('內部 api 記 requestsInternal、對外 API 記 requestsExternal', () => {
    const internal = setupMiddleware('internal');
    internal.run('/users?offset=0');
    expect(internal.meter.count).toHaveBeenCalledWith('requestsInternal');
    const external = setupMiddleware('external');
    external.run('/v1/users');
    expect(external.meter.count).toHaveBeenCalledWith('requestsExternal');
  });

  it('健康檢查不算', () => {
    const { meter, run } = setupMiddleware('internal');
    run('/health');
    run('/health/ready');
    expect(meter.count).not.toHaveBeenCalled();
  });
});

describe('TenantUsageSnapshots', () => {
  it('合併每個來源的量', async () => {
    const snapshots = new TenantUsageSnapshots();
    snapshots.register('user', async () => ({ usersActive: 3, usersTotal: 4 }));
    snapshots.register('file', async () => ({ storageUsedBytes: 10 }));
    await expect(snapshots.collect()).resolves.toEqual({
      usersActive: 3,
      usersTotal: 4,
      storageUsedBytes: 10,
    });
  });

  it('同一個來源登記兩次 → 拋錯', () => {
    const snapshots = new TenantUsageSnapshots();
    snapshots.register('user', async () => ({}));
    expect(() => snapshots.register('user', async () => ({}))).toThrow('重複登記');
  });
});

describe('usageDateDaysBefore', () => {
  it.each([
    ['2026-10-08', 0, '2026-10-08'],
    ['2026-10-08', 6, '2026-10-02'],
    ['2026-03-01', 1, '2026-02-28'],
    ['2027-01-01', 400, '2025-11-27'],
  ])('%s 往前 %i 天 → %s', (date, days, expected) => {
    expect(usageDateDaysBefore(date, days)).toBe(expected);
  });
});
