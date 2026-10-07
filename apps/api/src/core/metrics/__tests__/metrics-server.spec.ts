import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { cacheLookups } from '../instruments';
import { handleMetricsRequest } from '../metrics-server';

describe('handleMetricsRequest（給 Prometheus 的 /metrics，docs/architecture/08-monitoring.md §2.1）', () => {
  const server = createServer((req, res) => void handleMetricsRequest(req, res));
  let baseUrl = '';

  beforeAll(async () => {
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
