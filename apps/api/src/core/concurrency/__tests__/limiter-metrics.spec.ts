import { describe, expect, it } from 'vitest';

import { limiterRejected, metricsRegistry } from '../../metrics';
import { createLimiter, LimiterBusyError } from '../limiter';

async function gaugeValue(name: string, limiter: string): Promise<number | undefined> {
  const metric = metricsRegistry.getSingleMetric(name);
  const values = (await metric?.get())?.values ?? [];
  return values.find((value) => value.labels.limiter === limiter)?.value;
}

describe('createLimiter 的指標（docs/architecture/08-monitoring.md §2.2）', () => {
  it('有名稱時回報執行中與排隊中的數量', async () => {
    const limit = createLimiter({ name: 'test-gauges', concurrency: 1 });
    const releases: Array<() => void> = [];
    const first = limit(() => new Promise<void>((resolve) => releases.push(resolve)));
    const second = limit(async () => undefined);

    expect(await gaugeValue('api_limiter_active', 'test-gauges')).toBe(1);
    expect(await gaugeValue('api_limiter_waiting', 'test-gauges')).toBe(1);

    for (const release of releases) release();
    await Promise.all([first, second]);
    expect(await gaugeValue('api_limiter_active', 'test-gauges')).toBe(0);
    expect(await gaugeValue('api_limiter_waiting', 'test-gauges')).toBe(0);
  });

  it('等待名額已滿時記一筆被拒', async () => {
    const limit = createLimiter({ name: 'test-rejected', concurrency: 1, maxQueue: 0 });
    const blocker = limit(() => new Promise<void>((resolve) => setTimeout(resolve, 10)));

    await expect(limit(async () => undefined)).rejects.toBeInstanceOf(LimiterBusyError);
    await blocker;

    const { values } = await limiterRejected.get();
    expect(values).toContainEqual(
      expect.objectContaining({
        labels: { limiter: 'test-rejected', reason: 'queue-full' },
        value: 1,
      }),
    );
  });
});
