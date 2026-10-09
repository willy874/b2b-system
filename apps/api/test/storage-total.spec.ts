import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Env } from '@/core/config';
import { TENANT_DB } from '@/core/database';
import type { Database } from '@/core/database';
import { ObjectStorage } from '@/core/storage';
import {
  platformAdmins,
  platformNotifications,
  tenants,
  tenantStorageUsage,
} from '@/db/platform/schema';
import { fileStorageUsage } from '@/db/schema';
import { upsertPlatformAdmin } from '@/db/seeds/platform-admin';
import { StorageTotalService } from '@/modules/tenant/storage-total.service';

import type { PlatformTestDatabase, TestDatabase } from './db';
import { createPlatformTestDatabase, createTestDatabase, truncateAll } from './db';
import { listenOnLoopback } from './http';
import { InMemoryObjectStorage } from './in-memory-object-storage';
import { inTestTenant } from './tenant';

/** apps/platform 的網域（PLATFORM_APP_URL 的預設值）。 */
const PLATFORM_HOST = 'localhost:5175';
const MIB = 1024 * 1024;
/** 止水線 4 MiB：測試裡的檔案大小遠小於租戶的容量（預設 2048 MB），擋下來的只會是止水線。 */
const LIMIT_MB = 4;

const SUPER_ADMIN = { email: 'storage-root@example.com', password: 'Quiet-Harbor-Lantern-26' };
const PLATFORM_ADMIN = 'storage-platform@example.com';

let app: INestApplication;
let http: App;
let db: TestDatabase;
let platformDb: PlatformTestDatabase;
let closeDbs: () => Promise<void>;
let homeId: string;
let tenantToken: string;
let platformToken: string;

interface StorageTotalBody {
  usedBytes: number;
  limitBytes: number | null;
  usageRatio: number | null;
  warningRatio: number;
  measuredAt: string | null;
  isStale: boolean;
}

async function signPlatformToken(email: string): Promise<string> {
  const [admin] = await platformDb
    .select()
    .from(platformAdmins)
    .where(eq(platformAdmins.email, email));
  if (!admin) throw new Error(`找不到平台管理者 ${email}`);
  const secret = app.get(ConfigService<Env, true>).get('JWT_SECRET', { infer: true });
  return app
    .get(JwtService)
    .signAsync(
      { sub: admin.id, ver: admin.tokenVersion, jti: randomUUID(), realm: 'platform' },
      { secret, expiresIn: 300 },
    );
}

async function storageTotal(): Promise<StorageTotalBody> {
  const response = await request(http)
    .get('/platform/tenants/storage-total')
    .set('Host', PLATFORM_HOST)
    .set('authorization', `Bearer ${platformToken}`)
    .expect(200);
  return (response.body as { data: StorageTotalBody }).data;
}

function startUpload(size: number) {
  return request(http)
    .post('/files')
    .set('authorization', `Bearer ${tenantToken}`)
    .send({ name: 'a.bin', contentType: 'application/octet-stream', size });
}

/** 測試租戶的已用量計數（`file_storage_usage` 單列）。 */
function setStorageUsed(bytes: number): Promise<void> {
  return inTestTenant(app, async () => {
    await app.get<Database>(TENANT_DB).update(fileStorageUsage).set({ usedBytes: bytes });
  });
}

describe('儲存的止水線（docs/architecture/backend/25-image.md §12 D8）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN.email;
    process.env.SUPER_ADMIN_PASSWORD = SUPER_ADMIN.password;
    process.env.STORAGE_TOTAL_LIMIT_MB = String(LIMIT_MB);
    // 背景工作不在測試裡自己跑：彙總由測試呼叫
    process.env.STORAGE_TOTAL_ROLLUP_CRON = '';

    const tenantDb = createTestDatabase();
    const platform = createPlatformTestDatabase();
    db = tenantDb.db;
    platformDb = platform.db;
    closeDbs = async () => {
      await tenantDb.client.end();
      await platform.client.end();
    };
    await truncateAll(db);
    const { runSeed } = await import('@/db/seeds/index');
    await runSeed(db as never);
    await upsertPlatformAdmin(platformDb, {
      email: PLATFORM_ADMIN,
      displayName: 'storage',
      password: 'PlatformPassword!2026',
      role: 'super-admin',
    });
    const [home] = await platformDb.select().from(tenants).where(eq(tenants.code, 'test'));
    if (!home) throw new Error('找不到測試租戶');
    homeId = home.id;
    await platformDb.delete(tenantStorageUsage);

    const { AppModule } = await import('@/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ObjectStorage)
      .useValue(new InMemoryObjectStorage())
      .compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    http = await listenOnLoopback(app);

    const login = await request(http).post('/auth/login').send(SUPER_ADMIN).expect(200);
    tenantToken = (login.body as { data: { accessToken: string } }).data.accessToken;
    platformToken = await signPlatformToken(PLATFORM_ADMIN);
  });

  afterAll(async () => {
    await setStorageUsed(0);
    await platformDb.delete(tenantStorageUsage);
    await app.close();
    await closeDbs();
    delete process.env.STORAGE_TOTAL_LIMIT_MB;
    delete process.env.STORAGE_TOTAL_ROLLUP_CRON;
  });

  it('還沒有任何量測：不擋上傳；平台看到的是過舊', async () => {
    await startUpload(1024).expect(201);
    expect(await storageTotal()).toMatchObject({
      usedBytes: 0,
      limitBytes: LIMIT_MB * MIB,
      measuredAt: null,
      isStale: true,
    });
  });

  it('彙總：寫入每個 active 租戶的已用量（與租戶的計數同一個數字），再跑一次是覆寫', async () => {
    await setStorageUsed(1 * MIB);
    await app.get(StorageTotalService).rollup();
    const [first] = await platformDb
      .select()
      .from(tenantStorageUsage)
      .where(eq(tenantStorageUsage.tenantId, homeId));
    expect(first?.usedBytes).toBe(1 * MIB);

    await setStorageUsed(2 * MIB);
    await app.get(StorageTotalService).rollup();
    const rows = await platformDb
      .select()
      .from(tenantStorageUsage)
      .where(eq(tenantStorageUsage.tenantId, homeId));
    expect(rows).toEqual([expect.objectContaining({ usedBytes: 2 * MIB })]);

    const total = await storageTotal();
    expect(total).toMatchObject({ limitBytes: LIMIT_MB * MIB, isStale: false });
    expect(total.usedBytes).toBeGreaterThanOrEqual(2 * MIB);
  });

  it('加上這次的大小超過止水線 → 409 STORAGE_TOTAL_LIMIT_REACHED（不帶平台的數字）；剛好到上限可以', async () => {
    await setStorageUsed(3 * MIB);
    await app.get(StorageTotalService).rollup();
    const headroom = LIMIT_MB * MIB - (await storageTotal()).usedBytes;
    expect(headroom).toBeGreaterThan(0);

    const blocked = await startUpload(headroom + 1).expect(409);
    expect(blocked.body).toEqual({
      error: expect.objectContaining({ code: 'STORAGE_TOTAL_LIMIT_REACHED' }),
    });
    expect((blocked.body as { error: { details?: unknown } }).error.details).toBeUndefined();

    await startUpload(headroom).expect(201);
  });

  it('越過 80% 時通知平台管理者，停在門檻以上不重發', async () => {
    await setStorageUsed(0);
    await app.get(StorageTotalService).rollup();
    await platformDb
      .delete(platformNotifications)
      .where(eq(platformNotifications.type, 'storage.totalNearLimit'));

    await setStorageUsed(Math.ceil(LIMIT_MB * MIB * 0.85));
    await app.get(StorageTotalService).rollup();
    await setStorageUsed(Math.ceil(LIMIT_MB * MIB * 0.9));
    await app.get(StorageTotalService).rollup();

    const [admin] = await platformDb
      .select()
      .from(platformAdmins)
      .where(eq(platformAdmins.email, PLATFORM_ADMIN));
    const sent = await platformDb
      .select()
      .from(platformNotifications)
      .where(eq(platformNotifications.type, 'storage.totalNearLimit'));
    const mine = sent.filter((row) => row.recipientId === admin?.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.link).toEqual({ route: 'tenant.list', params: {} });
  });
});
