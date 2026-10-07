import { mkdtemp, rm } from 'node:fs/promises';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

import {
  createEventEnvelope,
  type DsnComponents,
  getEnvelopeEndpointWithUrlEncodedAuth,
  makeDsn,
  serializeEnvelope,
} from '@sentry/core';
import { transform } from 'esbuild';

import type { ApmConfig } from '@/config';
import { createApmServer } from '@/server';
import { createServices } from '@/services';

/**
 * 以 @sentry/core（瀏覽器 SDK 底層的同一套）產生 envelope 與收件網址，確認 apm-service 與 SDK 相容
 * （docs/architecture/07-apm-service.md）。
 */
// 收件時每個錯誤事件寫一行日誌（docs/architecture/frontend/19-observability.md §9.2 D6）；測試不需要看到
vi.mock('@/log', () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const PUBLIC_KEY = 'f'.repeat(32);
const TOKEN = 'test-apm-token-123456';
const RELEASE = '1a2b3c4';
const SOURCE = ['export function loadUser(user) {', '  return user.profile.id;', '}', ''].join(
  '\n',
);

let dataDir: string;
let server: Server;
let baseUrl: string;
let dsn: DsnComponents;

function config(overrides: Partial<ApmConfig> = {}): ApmConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    dataDir,
    org: 'b2b-system',
    projects: [{ id: '1', slug: 'backstage', publicKey: PUBLIC_KEY }],
    authToken: TOKEN,
    retentionDays: 30,
    maxEnvelopeBytes: 64 * 1024,
    maxSourcemapBytes: 1024 * 1024,
    rateLimitPerMinute: 1000,
    trustProxy: false,
    routeLabelLimit: 200,
    releaseLabelLimit: 10,
    ...overrides,
  };
}

async function start(overrides: Partial<ApmConfig> = {}): Promise<void> {
  const services = await createServices(config(overrides));
  server = createApmServer({ services, isAccessLogEnabled: false });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
  dsn = makeDsn(`http://${PUBLIC_KEY}@127.0.0.1:${port}/1`) as DsnComponents;
}

async function stop(): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'apm-it-'));
  await start();
});

afterEach(async () => {
  await stop();
  await rm(dataDir, { recursive: true, force: true });
});

function errorEvent(eventId: string, frame: { lineno: number; colno: number }) {
  return {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: 'javascript',
    level: 'error' as const,
    release: RELEASE,
    transaction: '/user/$userId',
    exception: {
      values: [
        {
          type: 'TypeError',
          value: "Cannot read properties of undefined (reading 'id')",
          stacktrace: {
            frames: [
              {
                filename: 'http://localhost:5173/assets/index-abc.js',
                function: 'o',
                in_app: true,
                ...frame,
              },
            ],
          },
        },
      ],
    },
    user: { id: 'u-1', email: 'alice@example.com' },
    tags: { host: 'acme.example.com' },
  };
}

async function send(event: ReturnType<typeof errorEvent>): Promise<Response> {
  const envelope = createEventEnvelope(event, dsn, {
    sdk: { name: 'sentry.javascript.browser', version: '11.4.0' },
  });
  return fetch(getEnvelopeEndpointWithUrlEncodedAuth(dsn), {
    method: 'POST',
    // 瀏覽器 SDK 送 text/plain，避免 CORS preflight
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    body: serializeEnvelope(envelope) as string,
  });
}

function api(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, ...init.headers },
  });
}

/** 壓縮過的程式與 sourcemap；回傳 `.profile` 在壓縮後的位置。 */
async function buildAndUpload(): Promise<{ lineno: number; colno: number }> {
  const result = await transform(SOURCE, {
    minify: true,
    sourcemap: 'external',
    sourcefile: 'src/features/user/load.ts',
    sourcesContent: true,
    format: 'esm',
  });
  const form = new FormData();
  form.set('name', '~/assets/index-abc.js.map');
  form.set('file', new Blob([result.map]), 'index-abc.js.map');
  const upload = await api(`/api/0/projects/b2b-system/backstage/releases/${RELEASE}/files/`, {
    method: 'POST',
    body: form,
  });
  expect(upload.status).toBe(201);
  const line = result.code.split('\n').findIndex((text) => text.includes('.profile'));
  return { lineno: line + 1, colno: (result.code.split('\n')[line] ?? '').indexOf('.profile') + 1 };
}

describe('apm-service（Sentry 相容 API）', () => {
  it('收件 → issues 分組 → 事件詳情以 sourcemap 還原堆疊', async () => {
    const frame = await buildAndUpload();
    const first = await send(errorEvent('a'.repeat(32), frame));
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ id: 'a'.repeat(32) });
    await send(errorEvent('b'.repeat(32), frame));

    const issues = (await (
      await api('/api/0/projects/b2b-system/backstage/issues/')
    ).json()) as Array<Record<string, unknown>>;
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      title: "TypeError: Cannot read properties of undefined (reading 'id')",
      count: '2',
      userCount: 1,
      lastRelease: RELEASE,
      project: { slug: 'backstage' },
    });

    const detail = (await (
      await api(`/api/0/projects/b2b-system/backstage/events/${'b'.repeat(32)}/`)
    ).json()) as {
      entries: Array<{ type: string; data: { values: Array<Record<string, unknown>> } }>;
      user: unknown;
    };
    const exception = detail.entries.find((entry) => entry.type === 'exception');
    expect(exception?.data.values[0]).toMatchObject({
      type: 'TypeError',
      stacktrace: {
        frames: [
          {
            filename: 'src/features/user/load.ts',
            lineNo: 2,
            symbolicated: true,
            context: [[2, 'return user.profile.id;']],
            raw: { filename: 'http://localhost:5173/assets/index-abc.js', function: 'o' },
          },
        ],
      },
    });
    // 使用者只留 id（docs/architecture/frontend/19-observability.md §9.2 D7）
    expect(detail.user).toEqual({ id: 'u-1' });

    const latest = await api(
      `/api/0/organizations/b2b-system/issues/${String(issues[0]?.id)}/events/latest/`,
    );
    expect(latest.status).toBe(200);
  });

  it('issues 依 query 的 release 篩選', async () => {
    await send(errorEvent('c'.repeat(32), { lineno: 1, colno: 1 }));
    const none = await api('/api/0/projects/b2b-system/backstage/issues/?query=release:other');
    expect(await none.json()).toEqual([]);
    const some = await api(
      `/api/0/projects/b2b-system/backstage/issues/?query=release:${RELEASE}&statsPeriod=1h`,
    );
    expect(await some.json()).toHaveLength(1);
  });

  it('存下的錯誤事件依專案、等級、release 出現在 /metrics（Grafana 的錯誤數，docs/architecture/08-monitoring.md §5.1）', async () => {
    expect((await send(errorEvent('a'.repeat(32), { lineno: 1, colno: 1 }))).status).toBe(200);
    const metrics = await (await fetch(`${baseUrl}/metrics`)).text();
    expect(metrics).toContain(
      `apm_events_total{project="backstage",level="error",release="${RELEASE}"} 1`,
    );
  });

  it('接受 gzip 壓縮的 envelope（Node SDK）', async () => {
    const envelope = createEventEnvelope(errorEvent('d'.repeat(32), { lineno: 1, colno: 1 }), dsn);
    const response = await fetch(getEnvelopeEndpointWithUrlEncodedAuth(dsn), {
      method: 'POST',
      headers: { 'Content-Encoding': 'gzip' },
      body: gzipSync(Buffer.from(serializeEnvelope(envelope) as string)),
    });
    expect(response.status).toBe(200);
  });

  it('錯誤的 key → 401；查詢 API 沒有 token → 401', async () => {
    const wrong = await fetch(`${baseUrl}/api/1/envelope/?sentry_key=${'0'.repeat(32)}`, {
      method: 'POST',
      body: '{}\n',
    });
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ detail: 'sentry_key 與專案不符' });
    expect((await fetch(`${baseUrl}/api/0/projects/b2b-system/backstage/issues/`)).status).toBe(
      401,
    );
  });

  it('超過上限 → 413', async () => {
    const response = await fetch(getEnvelopeEndpointWithUrlEncodedAuth(dsn), {
      method: 'POST',
      body: `{}\n{"type":"event"}\n${JSON.stringify({ message: 'x'.repeat(70 * 1024) })}`,
    });
    expect(response.status).toBe(413);
  });

  it('超過速率 → 429 ＋ X-Sentry-Rate-Limits（SDK 依此暫停送出）', async () => {
    await stop();
    await start({ rateLimitPerMinute: 1 });
    expect((await send(errorEvent('e'.repeat(32), { lineno: 1, colno: 1 }))).status).toBe(200);
    const limited = await send(errorEvent('f'.repeat(32), { lineno: 1, colno: 1 }));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('x-sentry-rate-limits')).toMatch(/^\d+::organization$/);
    expect(Number(limited.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('transaction 的 Web Vitals 出現在 /metrics', async () => {
    const body = [
      JSON.stringify({ event_id: '1'.repeat(32), sent_at: new Date().toISOString() }),
      JSON.stringify({ type: 'transaction' }),
      JSON.stringify({
        type: 'transaction',
        transaction: '/user/$userId',
        contexts: { trace: { op: 'pageload' } },
        measurements: { lcp: { value: 1234, unit: 'millisecond' } },
      }),
    ].join('\n');
    expect(
      (await fetch(getEnvelopeEndpointWithUrlEncodedAuth(dsn), { method: 'POST', body })).status,
    ).toBe(200);
    const metrics = await (await fetch(`${baseUrl}/metrics`)).text();
    expect(metrics).toContain(
      'apm_web_vital_count{project="backstage",route="/user/$userId",name="lcp"} 1',
    );
    expect(metrics).toContain('apm_envelopes_total{result="accepted"} 1');
  });

  it('同名 sourcemap 再上傳 → 409；列出 release 的檔案', async () => {
    await buildAndUpload();
    const form = new FormData();
    form.set('name', '~/assets/index-abc.js.map');
    form.set('file', new Blob(['{}']));
    const again = await api(`/api/0/projects/b2b-system/backstage/releases/${RELEASE}/files/`, {
      method: 'POST',
      body: form,
    });
    expect(again.status).toBe(409);
    const files = (await (
      await api(`/api/0/projects/b2b-system/backstage/releases/${RELEASE}/files/`)
    ).json()) as Array<{ name: string }>;
    expect(files.map((file) => file.name)).toEqual(['~/assets/index-abc.js.map']);
  });

  it('未知端點 → 404；方法不對 → 405', async () => {
    expect((await fetch(`${baseUrl}/nope`)).status).toBe(404);
    expect((await fetch(`${baseUrl}/api/1/envelope/`)).status).toBe(405);
  });
});
