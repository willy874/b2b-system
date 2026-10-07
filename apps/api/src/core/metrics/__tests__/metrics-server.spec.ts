import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cacheLookups } from '../instruments';
import { handleMetricsRequest, metricsPortOf } from '../metrics-server';
import { enableDefaultMetrics } from '../registry';

describe('handleMetricsRequest（給 Prometheus 的 /metrics，docs/architecture/08-monitoring.md §2.1）', () => {
  const server = createServer((req, res) => void handleMetricsRequest(req, res));
  let baseUrl = '';

  beforeAll(async () => {
    // MetricsServer 真的開 port 時才登記 Node 的標準指標
    enableDefaultMetrics();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('GET /metrics 回 Prometheus 文字格式，含 api 的指標與 Node 的標準指標', async () => {
    cacheLookups.inc({ cache: 'permission', result: 'hit' });
    const res = await fetch(`${baseUrl}/metrics`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');
    const body = await res.text();
    expect(body).toContain('api_cache_lookups_total{cache="permission",result="hit"}');
    expect(body).toContain('nodejs_eventloop_lag_p99_seconds');
  });

  it('其他路徑一律 404：這個 port 上沒有別的東西', async () => {
    expect((await fetch(`${baseUrl}/health`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/metrics`, { method: 'POST' })).status).toBe(404);
  });
});

describe('metricsPortOf（MONITORING_ENABLED 與兩個程序的 port，docs/architecture/08-monitoring.md §1.1）', () => {
  const ports = { METRICS_PORT: 9464, EXTERNAL_METRICS_PORT: 9465 };

  it('監控開啟時：內部 api 用 METRICS_PORT、對外 API 用 EXTERNAL_METRICS_PORT', () => {
    expect(metricsPortOf({ ...ports, MONITORING_ENABLED: true, API_SURFACE: 'internal' })).toBe(
      9464,
    );
    expect(metricsPortOf({ ...ports, MONITORING_ENABLED: true, API_SURFACE: 'external' })).toBe(
      9465,
    );
  });

  it('監控關閉時一律不開，不論 port 設成多少', () => {
    expect(metricsPortOf({ ...ports, MONITORING_ENABLED: false, API_SURFACE: 'internal' })).toBe(0);
    expect(metricsPortOf({ ...ports, MONITORING_ENABLED: false, API_SURFACE: 'external' })).toBe(0);
  });
});
