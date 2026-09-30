import { describe, expect, it, vi } from 'vitest';

import type { PlatformDatabase } from '@/core/database';
import type { ObjectStorage } from '@/core/storage';

import { HealthService } from '../health.service';

function createService(execute: () => Promise<unknown>, isStorageUp = true) {
  const storage = { ping: vi.fn(async () => isStorageUp) };
  return new HealthService(
    { execute } as unknown as PlatformDatabase,
    storage as unknown as ObjectStorage,
  );
}

describe('HealthService', () => {
  it('liveness 回報 ok 與 uptime', () => {
    const result = createService(async () => undefined).live();
    expect(result.status).toBe('ok');
    expect(result.uptime).toBeGreaterThanOrEqual(0);
    expect(() => new Date(result.timestamp).toISOString()).not.toThrow();
  });

  it('readiness 在 DB 與物件儲存都正常時回 ok', async () => {
    const result = await createService(async () => [{ '?column?': 1 }]).ready();
    expect(result.status).toBe('ok');
    expect(result.checks).toEqual({ database: 'ok', storage: 'ok' });
  });

  it('readiness 在 DB ping 失敗時回 degraded', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('connection refused'));
    const result = await createService(execute).ready();
    expect(result.status).toBe('degraded');
    expect(result.checks).toEqual({ database: 'fail', storage: 'ok' });
  });

  it('readiness 在物件儲存連不上時回 degraded', async () => {
    const result = await createService(async () => [], false).ready();
    expect(result.status).toBe('degraded');
    expect(result.checks).toEqual({ database: 'ok', storage: 'fail' });
  });
});
