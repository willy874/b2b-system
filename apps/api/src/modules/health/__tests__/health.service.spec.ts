import { describe, expect, it, vi } from 'vitest';

import type { Database } from '@/core/database';

import { HealthService } from '../health.service';

function createService(execute: () => Promise<unknown>) {
  return new HealthService({ execute } as unknown as Database);
}

describe('HealthService', () => {
  it('liveness 回報 ok 與 uptime', () => {
    const result = createService(async () => undefined).live();
    expect(result.status).toBe('ok');
    expect(result.uptime).toBeGreaterThanOrEqual(0);
    expect(() => new Date(result.timestamp).toISOString()).not.toThrow();
  });

  it('readiness 在 DB ping 成功時回 ok', async () => {
    const result = await createService(async () => [{ '?column?': 1 }]).ready();
    expect(result.status).toBe('ok');
    expect(result.checks).toEqual({ database: 'ok' });
  });

  it('readiness 在 DB ping 失敗時回 degraded', async () => {
    const execute = vi.fn().mockRejectedValue(new Error('connection refused'));
    const result = await createService(execute).ready();
    expect(result.status).toBe('degraded');
    expect(result.checks).toEqual({ database: 'fail' });
  });
});
