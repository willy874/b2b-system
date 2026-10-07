import { describe, expect, it } from 'vitest';

import { metricsRegistry, ObservedGauge } from '../registry';

async function valuesOf(name: string) {
  const metric = metricsRegistry.getSingleMetric(name);
  if (!metric) throw new Error(`沒有指標 ${name}`);
  return (await metric.get()).values;
}

describe('ObservedGauge（抓取時才去問的 gauge）', () => {
  it('抓取時回報每個來源目前的值，同一組標籤相加', async () => {
    const gauge = new ObservedGauge({
      name: 'test_observed_sum',
      help: 'test',
      labelNames: ['cache'] as const,
    });
    const first = {};
    const second = {};
    gauge.observe(first, (report) => report({ cache: 'a' }, 2));
    gauge.observe(second, (report) => {
      report({ cache: 'a' }, 3);
      report({ cache: 'b' }, 1);
    });

    const values = await valuesOf('test_observed_sum');
    expect(values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ labels: { cache: 'a' }, value: 5 }),
        expect.objectContaining({ labels: { cache: 'b' }, value: 1 }),
      ]),
    );
  });

  it('取消登記之後不再回報，舊的值也不留下（沒有標籤的 gauge 回 0）', async () => {
    const gauge = new ObservedGauge({ name: 'test_observed_unobserve', help: 'test' });
    const owner = {};
    const unobserve = gauge.observe(owner, (report) => report({}, 7));
    expect(await valuesOf('test_observed_unobserve')).toEqual([
      expect.objectContaining({ value: 7 }),
    ]);

    unobserve();
    expect(await valuesOf('test_observed_unobserve')).toEqual([
      expect.objectContaining({ value: 0 }),
    ]);
  });

  it('一個來源失敗不影響其他來源', async () => {
    const gauge = new ObservedGauge({ name: 'test_observed_failure', help: 'test' });
    const ok = {};
    const broken = {};
    gauge.observe(broken, () => Promise.reject(new Error('db down')));
    gauge.observe(ok, (report) => report({}, 4));

    expect(await valuesOf('test_observed_failure')).toEqual([
      expect.objectContaining({ value: 4 }),
    ]);
  });
});
