import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { and, desc, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Env } from '@/core/config';
import { MailTransport } from '@/core/mail';
import {
  CDN_STATUS_SIGNED_CONTENT,
  CdnPurger,
  cdnPurgeSignature,
  nginxCdnSignature,
  ObjectStorage,
  ObjectUrlSigner,
} from '@/core/storage';
import { cdnSettings, platformAdmins, platformAuditLogs } from '@/db/platform/schema';
import { galleryItems } from '@/db/schema';
import { upsertPlatformAdmin } from '@/db/seeds/platform-admin';

import type { PlatformTestDatabase, TestDatabase } from './db';
import { createPlatformTestDatabase, createTestDatabase } from './db';
import { listenOnLoopback } from './http';
import { InMemoryObjectStorage } from './in-memory-object-storage';
import { inTestTenant, testTenantContext } from './tenant';

/**
 * CDN 設定管理（docs/architecture/backend/09-file.md §16.9～§16.12）。真 Postgres、兩個「程序」（同一份 AppModule 建出來的兩個 app，
 * 有各自的 `CdnSettings` 快取與廣播的 instanceId），邊緣是測試裡的假節點：依 `edge.mode` 模擬正常、不回應、清理密鑰不同、缺 kid。
 */

const AUTH_HOST = 'localhost:5175';
const HOME_HOST = '127.0.0.1';
const PASSWORD = 'PlatformPassword!2026';
const KEY_2 = randomBytes(48);
const KEY_1 = randomBytes(48);
const PURGE_SECRET = randomBytes(48);
const ASSET_KEY = 'images/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/master.webp';

type EdgeMode = 'ok' | 'silent' | 'wrongSecret' | 'missingKid';

/** 假的邊緣：清理埠的 `/_status`、`/_purge` 與對外的 `/storage/`（同一個埠）。 */
const edge = { mode: 'ok' as EdgeMode, port: 0, statusCalls: 0 };
let edgeServer: Server;

function startFakeEdge(): Promise<void> {
  edgeServer = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://edge');
    const reply = (status: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/_status') {
      edge.statusCalls += 1;
      if (edge.mode === 'silent') return; // 不回應：api 端逾時
      const ts = Number(url.searchParams.get('ts'));
      const expected = cdnPurgeSignature(PURGE_SECRET, ts, CDN_STATUS_SIGNED_CONTENT);
      if (edge.mode === 'wrongSecret' || req.headers['x-purge-signature'] !== expected) {
        return reply(403, { error: 'signature' });
      }
      return reply(200, {
        kids: edge.mode === 'missingKid' ? ['k1'] : ['k2', 'k1'],
        cache: { maxSize: '10g', inactive: '30d', valid: '30d' },
        build: 'test',
        startedAt: '2026-10-09T00:00:00Z',
      });
    }
    if (url.pathname.startsWith('/_purge')) return reply(200, { purged: 0, missing: 1 });
    if (url.pathname.startsWith('/storage/')) {
      const path = decodeURIComponent(url.pathname);
      const exp = Number(url.searchParams.get('exp'));
      const kid = url.searchParams.get('kid');
      const key = kid === 'k2' ? KEY_2 : kid === 'k1' ? KEY_1 : undefined;
      const valid = key && url.searchParams.get('sig') === nginxCdnSignature(key, path, exp);
      if (!valid) return reply(403, {}, { 'X-CDN-Reject': 'signature' });
      return reply(404, {});
    }
    return reply(404, {});
  });
  return new Promise((resolve) => {
    edgeServer.listen(0, '127.0.0.1', () => {
      edge.port = (edgeServer.address() as AddressInfo).port;
      resolve();
    });
  });
}

interface Process {
  app: INestApplication;
  http: App;
}

let a: Process;
let b: Process;
let platformDb: PlatformTestDatabase;
let closePlatformDb: () => Promise<void>;
let tenantDb: TestDatabase;
let closeTenantDb: () => Promise<void>;
const tokens: Record<'root' | 'operator' | 'auditor', string> = {
  root: '',
  operator: '',
  auditor: '',
};

async function startProcess(): Promise<Process> {
  const { AppModule } = await import('@/app.module');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(MailTransport)
    .useValue({ send: () => Promise.resolve({ messageId: '<x@test>' }) })
    .overrideProvider(ObjectStorage)
    .useValue(new InMemoryObjectStorage())
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  await app.init();
  return { app, http: await listenOnLoopback(app) };
}

async function signPlatformToken(email: string): Promise<string> {
  const [admin] = await platformDb
    .select()
    .from(platformAdmins)
    .where(eq(platformAdmins.email, email));
  if (!admin) throw new Error(`找不到平台管理者 ${email}`);
  const secret = a.app.get(ConfigService<Env, true>).get('JWT_SECRET', { infer: true });
  return a.app
    .get(JwtService)
    .signAsync(
      { sub: admin.id, ver: admin.tokenVersion, jti: randomUUID(), realm: 'platform' },
      { secret, expiresIn: 300 },
    );
}

function as(who: keyof typeof tokens, method: 'get' | 'put' | 'post', path: string, on = a) {
  const client = request(on.http);
  return client[method](path).set('Host', AUTH_HOST).set('authorization', `Bearer ${tokens[who]}`);
}

function dataOf<T>(response: { body: unknown }): T {
  return (response.body as { data: T }).data;
}

function errorOf(response: { body: unknown }): {
  code?: string;
  details?: Record<string, unknown>;
} {
  return (
    (response.body as { error?: { code?: string; details?: Record<string, unknown> } }).error ?? {}
  );
}

interface Overview {
  settings: {
    version: number;
    state: string | null;
    stateChangedBy: { email: string | null } | null;
  };
  effective: { serving: boolean; resources: string[]; issuedUrlsExpireAt: string | null };
  lastCheck: { ready: boolean } | null;
  deployment: { deployed: boolean; signingKid: string; purgeConfigured: boolean };
  purgeTargets: string[];
  recentPurges: Array<{ id: string; paths: number | 'all'; manual: { target: string } | null }>;
}

async function overview(): Promise<Overview> {
  return dataOf<Overview>(await as('auditor', 'get', '/platform/cdn').expect(200));
}

function put(body: Record<string, unknown>, who: keyof typeof tokens = 'operator') {
  return as(who, 'put', '/platform/cdn/settings').send(body);
}

/** 圖片資產的網址：走 CDN 時是 `FILE_CDN_ORIGIN` 底下，否則是 presigned。 */
async function signedUrl(process: Process): Promise<string> {
  const { url } = await inTestTenant(process.app, () =>
    process.app.get(ObjectUrlSigner).sign(ASSET_KEY, { expiresIn: 3600, cdn: 'imageAsset' }),
  );
  return url;
}

const cdnOrigin = () => `http://127.0.0.1:${edge.port}/storage/`;

async function cleanPlatformState(): Promise<void> {
  await platformDb.delete(cdnSettings);
  await platformDb.execute(
    sql`DELETE FROM pgboss.job WHERE name = 'cdn.purge' AND data->'payload' ? 'manual'`,
  );
}

describe('CDN 設定管理（docs/architecture/backend/09-file.md §16.9～§16.12）', () => {
  beforeAll(async () => {
    await startFakeEdge();
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = 'cdnset-root@example.com';
    process.env.SUPER_ADMIN_PASSWORD = 'Quiet-Harbor-Lantern-26';
    process.env.FILE_CDN_ENABLED = 'true';
    process.env.FILE_CDN_ORIGIN = `http://127.0.0.1:${edge.port}`;
    process.env.FILE_CDN_SIGNING_KEYS = `k2:${KEY_2.toString('base64')},k1:${KEY_1.toString('base64')}`;
    process.env.FILE_CDN_PURGE_URL = `http://127.0.0.1:${edge.port}`;
    process.env.FILE_CDN_PURGE_SECRET = PURGE_SECRET.toString('base64');
    process.env.FILE_CDN_PURGE_TIMEOUT_MS = '500';

    const platform = createPlatformTestDatabase();
    platformDb = platform.db;
    closePlatformDb = async () => platform.client.end();
    const tenant = createTestDatabase();
    tenantDb = tenant.db;
    closeTenantDb = async () => tenant.client.end();
    for (const role of ['super-admin', 'operator', 'auditor'] as const) {
      // oxlint-disable-next-line no-await-in-loop -- 依序建立三個管理者
      await upsertPlatformAdmin(platformDb, {
        email: `cdnset-${role}@example.com`,
        displayName: role,
        password: PASSWORD,
        role,
      });
    }
    await platformDb.delete(cdnSettings);

    a = await startProcess();
    b = await startProcess();
    // pgboss 的表在 app 啟動時建立
    await cleanPlatformState();
    tokens.root = await signPlatformToken('cdnset-super-admin@example.com');
    tokens.operator = await signPlatformToken('cdnset-operator@example.com');
    tokens.auditor = await signPlatformToken('cdnset-auditor@example.com');
  });

  afterAll(async () => {
    // 平台 DB 由所有測試檔共用：還原成沒有列（其他檔案預期階段 4 的行為）
    await cleanPlatformState();
    await a.app.close();
    await b.app.close();
    await closePlatformDb();
    await closeTenantDb();
    // 「不回應」模式留下的連線不會自己結束
    edgeServer.closeAllConnections();
    await new Promise((resolve) => edgeServer.close(resolve));
    for (const key of [
      'FILE_CDN_ENABLED',
      'FILE_CDN_ORIGIN',
      'FILE_CDN_SIGNING_KEYS',
      'FILE_CDN_PURGE_URL',
      'FILE_CDN_PURGE_SECRET',
      'FILE_CDN_PURGE_TIMEOUT_MS',
    ]) {
      delete process.env[key];
    }
  });

  it('沒有設定列：與階段 4 相同——開著、資源與參數都跟著環境變數，簽 CDN 網址', async () => {
    const view = await overview();
    expect(view.settings).toMatchObject({ version: 1, state: null });
    expect(view.effective).toMatchObject({
      serving: true,
      resources: ['fileVariant', 'imageAsset', 'galleryItem'],
    });
    expect(view.deployment).toMatchObject({
      deployed: true,
      signingKid: 'k2',
      purgeConfigured: true,
    });
    expect(view.purgeTargets.toSorted()).toEqual(['fileVariant', 'galleryItem', 'imageAsset']);
    expect(await signedUrl(a)).toMatch(new RegExp(`^${cdnOrigin()}`));
    expect(await signedUrl(b)).toMatch(new RegExp(`^${cdnOrigin()}`));
  });

  it('權限：auditor 只能看與執行檢查；operator 不能清空整個快取；租戶網域一律 404', async () => {
    edge.mode = 'ok';
    await as('auditor', 'post', '/platform/cdn/check').expect(200);
    expect(errorOf(await put({ version: 1, state: 'off' }, 'auditor').expect(403)).code).toBe(
      'AUTHZ_FORBIDDEN',
    );
    expect(
      errorOf(
        await as('auditor', 'post', '/platform/cdn/purge')
          .send({ target: { type: 'all' } })
          .expect(403),
      ).code,
    ).toBe('AUTHZ_FORBIDDEN');
    expect(
      errorOf(
        await as('operator', 'post', '/platform/cdn/purge')
          .send({ target: { type: 'all' } })
          .expect(403),
      ).details,
    ).toMatchObject({ missing: ['cdn:purgeAll'] });
    const tenantDomain = await request(a.http)
      .get('/platform/cdn')
      .set('Host', HOME_HOST)
      .set('authorization', `Bearer ${tokens.root}`);
    expect(tenantDomain.status).toBe(404);
    expect(errorOf(tenantDomain).code).toBe('PLATFORM_ONLY');
  });

  it('執行檢查：每個節點的 kid 與快取設定、對外網址與竄改的簽章；結果存進 last_check', async () => {
    edge.mode = 'ok';
    const result = dataOf<{
      ready: boolean;
      nodes: Array<{ address: string; kids: string[]; problems: string[] }>;
      publicUrl: { result: string };
      signatureEnforced: { result: string };
    }>(await as('operator', 'post', '/platform/cdn/check').expect(200));
    expect(result.ready).toBe(true);
    expect(result.nodes).toEqual([
      expect.objectContaining({ address: '127.0.0.1', kids: ['k2', 'k1'], problems: [] }),
    ]);
    expect(result.publicUrl.result).toBe('ok');
    expect(result.signatureEnforced.result).toBe('ok');
    expect((await overview()).lastCheck?.ready).toBe(true);
  });

  it('關閉：不檢查（邊緣不回應也能關），稽核 high；另一個程序經廣播改簽 presigned，不必重啟；清理照常入列', async () => {
    edge.mode = 'silent';
    const before = edge.statusCalls;
    const view = dataOf<Overview>(await put({ version: 1, state: 'off' }).expect(200));
    expect(edge.statusCalls).toBe(before);
    expect(view.settings).toMatchObject({
      version: 2,
      state: 'off',
      stateChangedBy: { email: 'cdnset-operator@example.com' },
    });
    expect(view.effective.serving).toBe(false);
    expect(view.effective.issuedUrlsExpireAt).not.toBeNull();

    expect(await signedUrl(a)).not.toMatch(new RegExp(`^${cdnOrigin()}`));
    await vi.waitFor(
      async () => expect(await signedUrl(b)).not.toMatch(new RegExp(`^${cdnOrigin()}`)),
      {
        timeout: 3000,
      },
    );

    const [audit] = await platformDb
      .select()
      .from(platformAuditLogs)
      .where(eq(platformAuditLogs.action, 'cdn.update'))
      .orderBy(desc(platformAuditLogs.id))
      .limit(1);
    expect(audit?.metadata).toMatchObject({
      before: { state: null },
      after: { state: 'off' },
      severity: 'high',
    });

    // 執行期關閉時清理照常（§17 D13）：邊緣還在，已發出的網址在效期內仍有效
    const bucket = (await testTenantContext(a.app)).storageBucket;
    await inTestTenant(a.app, () => a.app.get(CdnPurger).schedule([ASSET_KEY]));
    const rows = await platformDb.execute<{ paths: string[] }>(
      sql`SELECT data->'payload'->'paths' AS paths FROM pgboss.job
          WHERE name = 'cdn.purge' ORDER BY created_on DESC LIMIT 1`,
    );
    expect(rows[0]?.paths).toEqual([`/storage/${bucket}/${ASSET_KEY}`]);
  });

  it('樂觀鎖：舊的 version → 409 CDN_SETTINGS_VERSION_CONFLICT（details.current）', async () => {
    const response = await put({ version: 1, urlTtlCap: 600 }).expect(409);
    expect(errorOf(response)).toMatchObject({
      code: 'CDN_SETTINGS_VERSION_CONFLICT',
      details: { current: 2 },
    });
  });

  it.each([
    ['silent', 'timeout'],
    ['wrongSecret', 'purgeSecretRejected'],
    ['missingKid', 'signingKidMissing'],
  ] as const)('開啟前檢查：邊緣 %s → 409 CDN_NOT_READY（%s），不寫入', async (mode, problem) => {
    edge.mode = mode;
    const response = await put({ version: 2, state: 'on' }).expect(409);
    expect(errorOf(response)).toMatchObject({
      code: 'CDN_NOT_READY',
      details: { nodes: [{ address: '127.0.0.1', problems: [problem] }] },
    });
    expect((await overview()).settings.state).toBe('off');
  });

  it('檢查通過 → 開啟，兩個程序都改回 CDN 網址', async () => {
    edge.mode = 'ok';
    const view = dataOf<Overview>(await put({ version: 2, state: 'on' }).expect(200));
    expect(view.effective.serving).toBe(true);
    expect(await signedUrl(a)).toMatch(new RegExp(`^${cdnOrigin()}`));
    await vi.waitFor(
      async () => expect(await signedUrl(b)).toMatch(new RegExp(`^${cdnOrigin()}`)),
      {
        timeout: 3000,
      },
    );
  });

  it('只開放檔案的變體 → 圖片資產改回 presigned；稽核 normal', async () => {
    await put({ version: 3, resources: ['fileVariant'] }).expect(200);
    expect(await signedUrl(a)).not.toMatch(new RegExp(`^${cdnOrigin()}`));
    const [audit] = await platformDb
      .select()
      .from(platformAuditLogs)
      .where(eq(platformAuditLogs.action, 'cdn.update'))
      .orderBy(desc(platformAuditLogs.id))
      .limit(1);
    expect(audit?.metadata).toMatchObject({
      after: { resources: ['fileVariant'] },
      severity: 'normal',
    });
  });

  it('手動清理：依路徑與資源排入 cdn.purge（manual），找不到的資源 404；清空整個快取同時只能一筆；圖片庫的圖片列出每個版本的變體', async () => {
    const tenantId = (await testTenantContext(a.app)).id;
    const bucket = (await testTenantContext(a.app)).storageBucket;
    const byPath = dataOf<{ jobIds: string[]; paths: number }>(
      await as('operator', 'post', '/platform/cdn/purge')
        .send({ target: { type: 'paths', tenantId, paths: [ASSET_KEY] } })
        .expect(202),
    );
    expect(byPath.paths).toBe(1);
    const [job] = await platformDb.execute<{
      payload: { paths: string[]; manual: { target: string } };
    }>(sql`SELECT data->'payload' AS payload FROM pgboss.job WHERE id = ${byPath.jobIds[0]}::uuid`);
    expect(job?.payload).toMatchObject({
      paths: [`/storage/${bucket}/${ASSET_KEY}`],
      manual: { target: 'paths' },
    });

    const missing = await as('operator', 'post', '/platform/cdn/purge')
      .send({ target: { type: 'imageAsset', tenantId, id: randomUUID() } })
      .expect(404);
    expect(errorOf(missing).code).toBe('CDN_PURGE_TARGET_NOT_FOUND');
    const missingItem = await as('operator', 'post', '/platform/cdn/purge')
      .send({ target: { type: 'galleryItem', tenantId, id: randomUUID() } })
      .expect(404);
    expect(errorOf(missingItem).code).toBe('CDN_PURGE_TARGET_NOT_FOUND');

    // 圖片庫的圖片（modules/gallery 登記的解析器）：每個版本的每個尺寸 × 格式，回收桶裡的也算
    const [item] = await tenantDb
      .insert(galleryItems)
      .values({
        title: 'cdn-check',
        contentType: 'image/jpeg',
        size: 1,
        source: 'upload',
        rev: 2,
        variantRev: 2,
        variants: {
          width: 800,
          height: 400,
          formats: ['jpeg', 'webp'],
          renditions: { thumb: { width: 480, height: 240 }, medium: { width: 800, height: 400 } },
        },
        deletedAt: new Date(),
      } as typeof galleryItems.$inferInsert)
      .returning();
    const byItem = dataOf<{ jobIds: string[]; paths: number }>(
      await as('operator', 'post', '/platform/cdn/purge')
        .send({ target: { type: 'galleryItem', tenantId, id: item!.id } })
        .expect(202),
    );
    expect(byItem.paths).toBe(8);
    const [itemJob] = await platformDb.execute<{ payload: { paths: string[] } }>(
      sql`SELECT data->'payload' AS payload FROM pgboss.job WHERE id = ${byItem.jobIds[0]}::uuid`,
    );
    expect(itemJob?.payload.paths).toContain(
      `/storage/${bucket}/gallery/${item!.id}/r2/thumb.webp`,
    );
    await tenantDb.delete(galleryItems).where(eq(galleryItems.id, item!.id));
    await as('operator', 'post', '/platform/cdn/purge')
      .send({ target: { type: 'paths', tenantId, paths: ['../other-bucket/x'] } })
      .expect(400);

    const all = dataOf<{ paths: string }>(
      await as('root', 'post', '/platform/cdn/purge')
        .send({ target: { type: 'all' } })
        .expect(202),
    );
    expect(all.paths).toBe('all');
    const again = await as('root', 'post', '/platform/cdn/purge')
      .send({ target: { type: 'all' } })
      .expect(409);
    expect(errorOf(again).code).toBe('CDN_PURGE_IN_PROGRESS');

    const audits = await platformDb
      .select()
      .from(platformAuditLogs)
      .where(
        and(eq(platformAuditLogs.action, 'cdn.purge'), eq(platformAuditLogs.resourceType, 'cdn')),
      )
      .orderBy(desc(platformAuditLogs.id))
      .limit(3);
    expect(audits[0]?.metadata).toMatchObject({ all: true, severity: 'high' });
    expect(audits[1]?.metadata).toMatchObject({
      tenantId,
      target: 'galleryItem',
      paths: 8,
      severity: 'normal',
    });
    expect(audits[2]?.metadata).toMatchObject({
      tenantId,
      target: 'paths',
      paths: 1,
      severity: 'normal',
    });

    const recent = (await overview()).recentPurges;
    expect(recent[0]).toMatchObject({ paths: 'all', manual: { target: 'all' } });
  });
});
