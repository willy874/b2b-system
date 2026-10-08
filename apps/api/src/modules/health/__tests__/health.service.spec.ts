import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { Env } from '@/core/config';
import type { PlatformDatabase } from '@/core/database';
import { AppException } from '@/core/errors';
import type { JobQueue } from '@/core/jobs';
import { ShutdownState } from '@/core/lifecycle';
import type { EventLoopMonitor } from '@/core/metrics';
import type { ObjectStorage } from '@/core/storage';

import { HealthService } from '../health.service';

interface Options {
  execute?: () => Promise<unknown>;
  isStorageUp?: boolean;
  isJobsUp?: boolean;
  lagMs?: number;
  lagLimitMs?: number;
  shutdown?: ShutdownState;
}

function createService({
  execute = async () => [{ '?column?': 1 }],
  isStorageUp = true,
  isJobsUp = true,
  lagMs = 5,
  lagLimitMs = 1000,
  shutdown = new ShutdownState(),
}: Options = {}) {
  return new HealthService(
    { execute } as unknown as PlatformDatabase,
    { ping: vi.fn(async () => isStorageUp) } as unknown as ObjectStorage,
    { ping: vi.fn(async () => isJobsUp) } as unknown as JobQueue,
    { p99Ms: () => lagMs } as unknown as EventLoopMonitor,
    shutdown,
    { get: () => lagLimitMs } as unknown as ConfigService<Env, true>,
  );
}

describe('HealthService（docs/architecture/08-monitoring.md §4）', () => {
  it('liveness 回報 ok 與 uptime', () => {
    const result = createService().live();
    expect(result.status).toBe('ok');
    expect(result.uptime).toBeGreaterThanOrEqual(0);
    expect(() => new Date(result.timestamp).toISOString()).not.toThrow();
  });

  it('readiness 在每一項都正常時回 ok', async () => {
    const result = await createService().ready();
    expect(result.status).toBe('ok');
    expect(result.checks).toEqual({ database: 'ok', storage: 'ok', jobs: 'ok', eventLoop: 'ok' });
  });

  it('readiness 在平台 DB ping 失敗時回 503 SERVICE_NOT_READY，details 帶各項檢查', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('connection refused'));
    const error = await createService({ execute })
      .ready()
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(AppException);
    expect(error).toMatchObject({
      code: 'SERVICE_NOT_READY',
      details: { draining: false, checks: expect.objectContaining({ database: 'fail' }) },
    });
  });

  it('排空中：readiness 回 503 SERVICE_NOT_READY，不再做各項檢查', async () => {
    const shutdown = new ShutdownState();
    const execute = vi.fn(async () => [{ '?column?': 1 }]);
    shutdown.startDraining(10_000);

    await expect(createService({ execute, shutdown }).ready()).rejects.toMatchObject({
      code: 'SERVICE_NOT_READY',
      details: { draining: true },
    });
    expect(execute).not.toHaveBeenCalled();
  });

  it('排空中 liveness 照常回 ok：容器不該在排空期間被重啟', () => {
    const shutdown = new ShutdownState();
    shutdown.startDraining(10_000);
    expect(createService({ shutdown }).live().status).toBe('ok');
  });

  it('readiness 在物件儲存連不上時回 degraded', async () => {
    const result = await createService({ isStorageUp: false }).ready();
    expect(result.status).toBe('degraded');
    expect(result.checks?.storage).toBe('fail');
  });

  it('readiness 在背景工作的連線池連不上時回 degraded', async () => {
    const result = await createService({ isJobsUp: false }).ready();
    expect(result.status).toBe('degraded');
    expect(result.checks?.jobs).toBe('fail');
  });

  it('event loop 延遲超過門檻時回 degraded', async () => {
    const result = await createService({ lagMs: 1500, lagLimitMs: 1000 }).ready();
    expect(result.status).toBe('degraded');
    expect(result.checks?.eventLoop).toBe('fail');
  });

  it('門檻設 0 時不檢查 event loop', async () => {
    const result = await createService({ lagMs: 99_999, lagLimitMs: 0 }).ready();
    expect(result.status).toBe('ok');
    expect(result.checks).not.toHaveProperty('eventLoop');
  });

  it('單一項卡住時在逾時後回 fail，不讓探針等到逾時', async () => {
    vi.useFakeTimers();
    try {
      const pending = createService({ isStorageUp: true, execute: () => new Promise(() => {}) })
        .ready()
        .catch((caught: unknown) => caught);
      await vi.advanceTimersByTimeAsync(2000);
      expect(await pending).toMatchObject({
        code: 'SERVICE_NOT_READY',
        details: { checks: expect.objectContaining({ database: 'fail' }) },
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
