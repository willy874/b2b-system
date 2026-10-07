import type { ConfigService } from '@nestjs/config';
import { describe, expect, it, vi } from 'vitest';

import type { Env } from '@/core/config';
import type { PlatformDatabase } from '@/core/database';
import type { JobQueue } from '@/core/jobs';
import type { EventLoopMonitor } from '@/core/metrics';
import type { ObjectStorage } from '@/core/storage';

import { HealthService } from '../health.service';

interface Options {
  execute?: () => Promise<unknown>;
  isStorageUp?: boolean;
  isJobsUp?: boolean;
  lagMs?: number;
  lagLimitMs?: number;
}

function createService({
  execute = async () => [{ '?column?': 1 }],
  isStorageUp = true,
  isJobsUp = true,
  lagMs = 5,
  lagLimitMs = 1000,
}: Options = {}) {
  return new HealthService(
    { execute } as unknown as PlatformDatabase,
    { ping: vi.fn(async () => isStorageUp) } as unknown as ObjectStorage,
    { ping: vi.fn(async () => isJobsUp) } as unknown as JobQueue,
    { p99Ms: () => lagMs } as unknown as EventLoopMonitor,
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

  it('readiness 在 DB ping 失敗時回 degraded', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('connection refused'));
    const result = await createService({ execute }).ready();
    expect(result.status).toBe('degraded');
    expect(result.checks?.database).toBe('fail');
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
      const pending = createService({ execute: () => new Promise(() => {}) }).ready();
      await vi.advanceTimersByTimeAsync(2000);
      const result = await pending;
      expect(result.checks?.database).toBe('fail');
    } finally {
      vi.useRealTimers();
    }
  });
});
