import { createServer } from 'node:http';
import type { IncomingHttpHeaders, Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { JobQueue } from '../../jobs';
import { runInTenantContext } from '../../tenant';
import type { TenantContext } from '../../tenant';
import {
  CDN_STATUS_SIGNED_CONTENT,
  cdnPurgeSignature,
  NginxCdnEdgePurger,
} from '../cdn-edge-purger';
import { CDN_PURGE_JOB, CdnPurgeJob, QueuedCdnPurger } from '../cdn-purger';
import { CDN_PURGE_SECRET, cdnConfigOf } from './cdn.fixture';

function inTenant<T>(fn: () => T): T {
  return runInTenantContext(
    { id: 't1', code: 'acme', storageBucket: 'b2b-acme' } as TenantContext,
    fn,
  );
}

function fakeJobs() {
  return {
    enqueue: vi.fn(async () => 'job-id'),
    register: vi.fn(),
  };
}

describe('QueuedCdnPurger.schedule（docs/architecture/backend/09-file.md §16.6）', () => {
  it('物件 key 加上目前租戶的 bucket，依 FILE_CDN_PURGE_BATCH_SIZE 分批入列 cdn.purge（重複的只列一次）', async () => {
    const jobs = fakeJobs();
    const purger = new QueuedCdnPurger(
      jobs as unknown as JobQueue,
      cdnConfigOf({ FILE_CDN_PURGE_BATCH_SIZE: '2' }),
    );
    await inTenant(() =>
      purger.schedule([
        'images/a/r1/sm.jpg',
        'images/a/r1/md.jpg',
        'images/a/r1/sm.jpg',
        'images/a/master.jpg',
      ]),
    );

    expect(jobs.enqueue).toHaveBeenCalledTimes(2);
    expect(jobs.enqueue).toHaveBeenNthCalledWith(1, CDN_PURGE_JOB, {
      paths: ['/storage/b2b-acme/images/a/r1/sm.jpg', '/storage/b2b-acme/images/a/r1/md.jpg'],
    });
    expect(jobs.enqueue).toHaveBeenNthCalledWith(2, CDN_PURGE_JOB, {
      paths: ['/storage/b2b-acme/images/a/master.jpg'],
    });
  });

  it('FILE_CDN_PURGE_ON_DELETE=false 或沒有路徑 → 不入列', async () => {
    const jobs = fakeJobs();
    const off = new QueuedCdnPurger(
      jobs as unknown as JobQueue,
      cdnConfigOf({ FILE_CDN_PURGE_ON_DELETE: 'false' }),
    );
    await inTenant(() => off.schedule(['images/a/master.jpg']));
    const on = new QueuedCdnPurger(jobs as unknown as JobQueue, cdnConfigOf());
    await inTenant(() => on.schedule([]));
    expect(jobs.enqueue).not.toHaveBeenCalled();
  });

  it('入列失敗不拋錯（刪除本身照常完成），沒有租戶脈絡也不拋錯', async () => {
    const jobs = fakeJobs();
    jobs.enqueue.mockRejectedValueOnce(new Error('platform db down'));
    const purger = new QueuedCdnPurger(jobs as unknown as JobQueue, cdnConfigOf());
    await expect(inTenant(() => purger.schedule(['images/a/master.jpg']))).resolves.toBeUndefined();
    await expect(purger.schedule(['images/a/master.jpg'])).resolves.toBeUndefined();
  });
});

interface Received {
  url: string | undefined;
  headers: IncomingHttpHeaders;
  body: string;
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))),
  );
});

/** 假的邊緣清理端點：記下收到的請求，依 `respond` 回應。 */
async function fakeEdge(
  respond: (received: Received) => { status: number; body?: string; delayMs?: number } = () => ({
    status: 200,
    body: '{"purged":1,"missing":0}',
  }),
): Promise<{ port: number; received: Received[] }> {
  const received: Received[] = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
    req.on('end', () => {
      const entry = { url: req.url, headers: req.headers, body };
      received.push(entry);
      const reply = respond(entry);
      setTimeout(() => {
        res.writeHead(reply.status, { 'Content-Type': 'application/json' });
        res.end(reply.body ?? '{}');
      }, reply.delayMs ?? 0);
    });
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: (server.address() as AddressInfo).port, received };
}

function edgePurger(port: number, addresses: string[], timeoutMs = 2000) {
  return new NginxCdnEdgePurger({
    purgeUrl: `http://cdn-purge:${port}`,
    secret: CDN_PURGE_SECRET,
    timeoutMs,
    resolve: async () => addresses,
    now: () => Date.parse('2026-10-09T12:00:00Z'),
  });
}

describe('NginxCdnEdgePurger（deploy/cdn.js 的清理端點）', () => {
  it('送到名稱解析出來的每一個位址，帶原本的 Host 與 X-Purge-Signature（ts ＋ 本體的 HMAC）', async () => {
    const edge = await fakeEdge();
    const results = await edgePurger(edge.port, ['127.0.0.1', '127.0.0.1']).purge({
      paths: ['/storage/b2b-acme/images/a/master.jpg'],
    });

    expect(results).toEqual([
      { address: '127.0.0.1', result: 'ok', purged: 1, missing: 0 },
      { address: '127.0.0.1', result: 'ok', purged: 1, missing: 0 },
    ]);
    expect(edge.received).toHaveLength(2);
    const [first] = edge.received;
    expect(first?.url).toBe('/_purge');
    expect(first?.headers.host).toBe(`cdn-purge:${edge.port}`);
    const body = JSON.parse(first?.body ?? '{}') as { paths: string[]; ts: number };
    expect(body).toEqual({ paths: ['/storage/b2b-acme/images/a/master.jpg'], ts: 1_791_547_200 });
    expect(first?.headers['x-purge-signature']).toBe(
      cdnPurgeSignature(CDN_PURGE_SECRET, body.ts, first?.body ?? ''),
    );
  });

  it('整個快取 → POST /_purge/all，本體只有 ts', async () => {
    const edge = await fakeEdge();
    await edgePurger(edge.port, ['127.0.0.1']).purge({ all: true });
    expect(edge.received[0]?.url).toBe('/_purge/all');
    expect(JSON.parse(edge.received[0]?.body ?? '{}')).toEqual({ ts: 1_791_547_200 });
  });

  it('非 200 → error；超過逾時 → timeout', async () => {
    const rejected = await fakeEdge(() => ({ status: 403 }));
    expect(await edgePurger(rejected.port, ['127.0.0.1']).purge({ paths: ['/x'] })).toEqual([
      { address: '127.0.0.1', result: 'error', detail: 'HTTP 403' },
    ]);
    const slow = await fakeEdge(() => ({ status: 200, delayMs: 2000 }));
    expect(await edgePurger(slow.port, ['127.0.0.1'], 500).purge({ paths: ['/x'] })).toEqual([
      { address: '127.0.0.1', result: 'timeout' },
    ]);
  });
});

describe('NginxCdnEdgePurger.status（GET /_status，docs/architecture/backend/09-file.md §16.10）', () => {
  const STATUS = {
    kids: ['k2', 'k1'],
    cache: { maxSize: '10g', inactive: '30d', valid: '30d' },
    build: 'abc123',
    startedAt: '2026-10-09T00:00:00Z',
  };

  it('每個位址各送一次 GET /_status?ts=…，簽章是 ts ＋ "GET /_status" 的 HMAC；回報 kid 與快取設定', async () => {
    const edge = await fakeEdge(() => ({ status: 200, body: JSON.stringify(STATUS) }));
    const results = await edgePurger(edge.port, ['127.0.0.1', '127.0.0.1']).status();

    expect(results).toEqual([
      { address: '127.0.0.1', result: 'ok', status: STATUS },
      { address: '127.0.0.1', result: 'ok', status: STATUS },
    ]);
    const [first] = edge.received;
    expect(first?.url).toBe('/_status?ts=1791547200');
    expect(first?.body).toBe('');
    expect(first?.headers['x-purge-signature']).toBe(
      cdnPurgeSignature(CDN_PURGE_SECRET, 1_791_547_200, CDN_STATUS_SIGNED_CONTENT),
    );
  });

  it('403 → rejected（清理密鑰不同）；形狀不對 → invalid；其他狀態 → error；逾時 → timeout', async () => {
    const rejected = await fakeEdge(() => ({ status: 403 }));
    expect(await edgePurger(rejected.port, ['127.0.0.1']).status()).toEqual([
      { address: '127.0.0.1', result: 'rejected', detail: 'HTTP 403' },
    ]);
    const invalid = await fakeEdge(() => ({ status: 200, body: '{"kids":"k1"}' }));
    expect((await edgePurger(invalid.port, ['127.0.0.1']).status())[0]?.result).toBe('invalid');
    const broken = await fakeEdge(() => ({ status: 500 }));
    expect(await edgePurger(broken.port, ['127.0.0.1']).status()).toEqual([
      { address: '127.0.0.1', result: 'error', detail: 'HTTP 500' },
    ]);
    const slow = await fakeEdge(() => ({ status: 200, delayMs: 2000 }));
    expect(await edgePurger(slow.port, ['127.0.0.1'], 500).status()).toEqual([
      { address: '127.0.0.1', result: 'timeout' },
    ]);
  });
});

function purgeJob(port: number) {
  const jobs = fakeJobs();
  const handler = new CdnPurgeJob(
    jobs as unknown as JobQueue,
    cdnConfigOf({
      FILE_CDN_PURGE_URL: `http://127.0.0.1:${port}`,
      FILE_CDN_PURGE_TIMEOUT_MS: '1000',
    }),
  );
  return { handler, jobs };
}
const context = (retryCount = 0) => ({ retryCount, signal: new AbortController().signal });

describe('CdnPurgeJob（cdn.purge）', () => {
  it('不論 CDN 開關都註冊（工作名稱固定出現在 OpenAPI）', () => {
    const jobs = fakeJobs();
    new CdnPurgeJob(
      jobs as unknown as JobQueue,
      cdnConfigOf({ FILE_CDN_ENABLED: 'false' }),
    ).onModuleInit();
    expect(jobs.register).toHaveBeenCalledWith(CDN_PURGE_JOB, expect.any(Function));
  });

  it('全部節點成功 → 完成，output 帶每個節點的結果', async () => {
    const edge = await fakeEdge();
    const output = await purgeJob(edge.port).handler.run({ paths: ['/storage/b/x'] }, context());
    expect(output).toEqual({
      paths: 1,
      nodes: [{ address: '127.0.0.1', result: 'ok', purged: 1, missing: 0 }],
    });
  });

  it('任一節點失敗 → 拋錯讓 pg-boss 整筆重試（清理是冪等的）', async () => {
    const edge = await fakeEdge(() => ({ status: 500 }));
    await expect(
      purgeJob(edge.port).handler.run({ paths: ['/storage/b/x'] }, context(5)),
    ).rejects.toThrow('邊緣快取的清理失敗');
  });

  it('手動清空整個快取 → POST /_purge/all，output 的 paths 是 all', async () => {
    const edge = await fakeEdge();
    const output = await purgeJob(edge.port).handler.run(
      { all: true, manual: { requestedBy: 'admin-1', tenantId: null, target: 'all' } },
      context(),
    );
    expect(edge.received[0]?.url).toBe('/_purge/all');
    expect(output).toMatchObject({ paths: 'all' });
  });

  it('沒有清理端點（CDN 已關掉）→ 略過', async () => {
    const handler = new CdnPurgeJob(
      fakeJobs() as unknown as JobQueue,
      cdnConfigOf({ FILE_CDN_ENABLED: 'false' }),
    );
    expect(await handler.run({ paths: ['/storage/b/x'] }, context())).toEqual({
      skipped: 'CDN_PURGE_NOT_CONFIGURED',
    });
  });
});
