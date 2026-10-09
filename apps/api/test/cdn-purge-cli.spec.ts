import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { CDN_PURGE_ACTION, runCdnPurge } from '@/cli/cdn-purge';
import { NginxCdnEdgePurger } from '@/core/storage';
import { platformAuditLogs } from '@/db/platform/schema';

import type { PlatformTestDatabase } from './db';
import { createPlatformTestDatabase } from './db';
import { TEST_TENANT } from './global-setup';

/** 測試的平台 DB 名稱（global-setup）；container 不一定被視為本機，一律帶上確認。 */
const CONFIRM = 'b2b_platform_test';

let server: Server;
let port: number;
let platformDb: PlatformTestDatabase;
let closePlatform: () => Promise<void>;
const received: Array<{ url: string | undefined; body: string }> = [];

function edge(): NginxCdnEdgePurger {
  return new NginxCdnEdgePurger({
    purgeUrl: `http://cdn-purge.test:${port}`,
    secret: randomBytes(48),
    timeoutMs: 2000,
    // 兩個邊緣節點（headless Service 解析出兩個位址）：測試裡都指向同一個假的端點
    resolve: async () => ['127.0.0.1', '127.0.0.1'],
  });
}

async function lastAudit() {
  const [row] = await platformDb
    .select()
    .from(platformAuditLogs)
    .where(and(eq(platformAuditLogs.action, CDN_PURGE_ACTION)))
    .orderBy(desc(platformAuditLogs.id))
    .limit(1);
  return row;
}

describe('cli:cdn-purge（docs/architecture/backend/09-file.md §16.7）', () => {
  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => (body += chunk.toString('utf8')));
      req.on('end', () => {
        received.push({ url: req.url, body });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"purged":1,"missing":1}');
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
    const created = createPlatformTestDatabase();
    platformDb = created.db;
    closePlatform = async () => created.client.end();
  });

  beforeEach(() => {
    received.length = 0;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
    await closePlatform();
  });

  it('--tenant ＋ --path：加上租戶的 bucket，送到每一個節點；寫平台稽核', async () => {
    const outcome = await runCdnPurge(
      {
        kind: 'paths',
        tenant: TEST_TENANT.code,
        keys: ['images/a/r1/sm.webp', 'images/a/master.jpg'],
        confirm: CONFIRM,
      },
      process.env,
      edge(),
    );

    expect(outcome).toMatchObject({ paths: 2, dryRun: false });
    expect(received.map((entry) => entry.url)).toEqual(['/_purge', '/_purge']);
    expect((JSON.parse(received[0]?.body ?? '{}') as { paths: string[] }).paths).toEqual([
      '/storage/b2b-test/images/a/r1/sm.webp',
      '/storage/b2b-test/images/a/master.jpg',
    ]);
    expect(await lastAudit()).toMatchObject({
      actorEmail: 'system',
      resourceType: 'cdn',
      resourceId: TEST_TENANT.code,
      result: 'success',
      metadata: { via: 'cli', paths: 2 },
    });
  });

  it('--all 沒有確認 → 只列出節點，不送清理、不寫稽核', async () => {
    const before = await lastAudit();
    const outcome = await runCdnPurge({ kind: 'all' }, process.env, edge());
    expect(outcome).toEqual({ paths: undefined, nodes: ['127.0.0.1', '127.0.0.1'], dryRun: true });
    expect(received).toHaveLength(0);
    expect((await lastAudit())?.id).toBe(before?.id);
  });

  it('--all --confirm <平台 database 名稱> → 每個節點清空整個快取', async () => {
    const outcome = await runCdnPurge({ kind: 'all', confirm: CONFIRM }, process.env, edge());
    expect(outcome).toMatchObject({ paths: 'all', dryRun: false });
    expect(received.map((entry) => entry.url)).toEqual(['/_purge/all', '/_purge/all']);
    expect(await lastAudit()).toMatchObject({ resourceId: null, metadata: { paths: 'all' } });
  });

  it('找不到租戶 → 拋錯', async () => {
    await expect(
      runCdnPurge(
        { kind: 'paths', tenant: 'no-such-tenant', keys: ['x'], confirm: CONFIRM },
        process.env,
        edge(),
      ),
    ).rejects.toThrow('no-such-tenant');
  });
});
