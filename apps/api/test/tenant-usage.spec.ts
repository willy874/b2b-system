import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import type { App } from 'supertest/types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { Env } from '@/core/config';
import { TENANT_DB } from '@/core/database';
import type { Database } from '@/core/database';
import { UsageMeter, usageDate, usageDateDaysBefore } from '@/core/usage';
import {
  platformAdmins,
  platformNotifications,
  tenants,
  tenantUsageDaily,
} from '@/db/platform/schema';
import type { PlatformAdminRole } from '@/db/platform/schema';
import { fileStorageUsage, notDeleted, users } from '@/db/schema';
import { upsertPlatformAdmin } from '@/db/seeds/platform-admin';
import { TenantUsageService } from '@/modules/tenant/tenant-usage.service';

import type { PlatformTestDatabase } from './db';
import { createPlatformTestDatabase } from './db';
import { listenOnLoopback } from './http';
import { inTestTenant } from './tenant';

/** apps/platform 的網域（PLATFORM_APP_URL 的預設值）。 */
const AUTH_HOST = 'localhost:5175';
/** 測試租戶的網域（test/global-setup.ts）。 */
const HOME_HOST = '127.0.0.1';
const MIB = 1024 * 1024;

let app: INestApplication;
let http: App;
let platformDb: PlatformTestDatabase;
let closePlatform: () => Promise<void>;
let homeId: string;
const ROLES = ['super-admin', 'auditor'] as const;
const tokens = new Map<PlatformAdminRole, string>();

interface UsageBody {
  summary: {
    usersActive: number | null;
    usersTotal: number | null;
    storageUsedBytes: number | null;
    storageQuotaBytes: number | null;
    storageUsageRatio: number | null;
    recentRequests: number;
    snapshotAt: string | null;
  };
  warningRatio: number;
  daily: Array<{ date: string; usersTotal: number | null; requestsInternal: number }>;
}

interface ListBody {
  items: Array<{ id: string; code: string; usage: UsageBody['summary'] }>;
}

function dataOf<T>(response: { body: unknown }): T {
  return (response.body as { data: T }).data;
}

function platform(path: string, role: PlatformAdminRole = 'super-admin') {
  return request(http)
    .get(path)
    .set('Host', AUTH_HOST)
    .set('authorization', `Bearer ${tokens.get(role)}`);
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

async function todayRow() {
  const [row] = await platformDb
    .select()
    .from(tenantUsageDaily)
    .where(and(eq(tenantUsageDaily.tenantId, homeId), eq(tenantUsageDaily.date, usageDate())));
  return row;
}

/** 測試租戶的已用量（`file_storage_usage` 單列）。 */
function setStorageUsed(bytes: number): Promise<void> {
  return inTestTenant(app, async () => {
    await app.get<Database>(TENANT_DB).update(fileStorageUsage).set({ usedBytes: bytes });
  });
}

function nearQuotaNotifications() {
  return platformDb
    .select()
    .from(platformNotifications)
    .where(eq(platformNotifications.type, 'tenant.storageNearQuota'));
}

describe('租戶用量（docs/architecture/05-tenancy.md §5.4）', () => {
  beforeAll(async () => {
    process.env.JWT_SECRET = 'test-secret-that-is-long-enough-32ch';
    const created = createPlatformTestDatabase();
    platformDb = created.db;
    closePlatform = async () => created.client.end();
    await Promise.all(
      ROLES.map((role) =>
        upsertPlatformAdmin(platformDb, {
          email: `usage-${role}@example.com`,
          displayName: role,
          password: 'PlatformPassword!2026',
          role,
        }),
      ),
    );
    const [home] = await platformDb.select().from(tenants).where(eq(tenants.code, 'test'));
    if (!home) throw new Error('找不到測試租戶');
    homeId = home.id;

    const { AppModule } = await import('@/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.init();
    http = await listenOnLoopback(app);
    const signed = await Promise.all(
      ROLES.map((role) => signPlatformToken(`usage-${role}@example.com`)),
    );
    ROLES.forEach((role, index) => tokens.set(role, signed[index] ?? ''));
  });

  afterAll(async () => {
    await setStorageUsed(0);
    await app.close();
    await closePlatform();
  });

  it('租戶網域上的請求每分鐘加進當天的列；健康檢查與平台網域的請求不算', async () => {
    await app.get(UsageMeter).flush();
    const before = (await todayRow())?.requestsInternal ?? 0;

    await request(http).get('/tenant/current').set('Host', HOME_HOST).expect(200);
    await request(http).get('/tenant/current').set('Host', HOME_HOST).expect(200);
    // 沒登入被擋下的請求一樣佔用服務，也算
    await request(http).get('/users').set('Host', HOME_HOST).expect(401);
    await request(http).get('/health').set('Host', HOME_HOST);
    await platform('/platform/tenants').expect(200);
    await app.get(UsageMeter).flush();

    expect((await todayRow())?.requestsInternal).toBe(before + 3);
  });

  it('多次寫入是相加，不是覆寫（多個程序同時寫入同一列）', async () => {
    const meter = app.get(UsageMeter);
    await meter.flush();
    const before = (await todayRow())?.requestsInternal ?? 0;
    await inTestTenant(app, async () => meter.count('requestsInternal'));
    await meter.flush();
    await inTestTenant(app, async () => {
      meter.count('requestsInternal');
      meter.count('requestsInternal');
    });
    await meter.flush();
    expect((await todayRow())?.requestsInternal).toBe(before + 3);
  });

  it('彙總：每個 active 租戶寫入當天的快照，與租戶 DB 的實際數字一致；再跑一次是覆寫', async () => {
    await setStorageUsed(5 * MIB);
    await app.get(TenantUsageService).rollup();

    const expected = await inTestTenant(app, async () => {
      const [row] = await app
        .get<Database>(TENANT_DB)
        .select({ total: sql<number>`count(*)::int` })
        .from(users)
        .where(and(eq(users.kind, 'human'), notDeleted(users)));
      return row?.total ?? 0;
    });
    const usage = dataOf<UsageBody>(
      await platform(`/platform/tenants/${homeId}/usage`).expect(200),
    );
    expect(usage.summary.usersTotal).toBe(expected);
    expect(usage.summary.storageUsedBytes).toBe(5 * MIB);
    expect(usage.summary.storageQuotaBytes).toBe(2048 * MIB);
    expect(usage.summary.snapshotAt).not.toBeNull();
    expect(usage.daily).toHaveLength(30);
    expect(usage.daily.at(-1)).toMatchObject({ date: usageDate(), usersTotal: expected });
    // 沒有資料的日子也有一筆
    expect(usage.daily[0]).toMatchObject({ usersTotal: null, requestsInternal: 0 });

    await setStorageUsed(6 * MIB);
    await app.get(TenantUsageService).rollup();
    expect((await todayRow())?.storageUsedBytes).toBe(6 * MIB);
  });

  it('越過配額的警示門檻時通知能改租戶的平台管理者，停在門檻以上不重發', async () => {
    await platformDb.delete(platformNotifications);
    await setStorageUsed(100 * MIB);
    await app.get(TenantUsageService).rollup();
    expect(await nearQuotaNotifications()).toHaveLength(0);

    // 2048 MB 的 90%
    await setStorageUsed(Math.ceil(2048 * 0.9) * MIB);
    await app.get(TenantUsageService).rollup();
    const sent = await nearQuotaNotifications();
    const [superAdmin] = await platformDb
      .select()
      .from(platformAdmins)
      .where(eq(platformAdmins.email, 'usage-super-admin@example.com'));
    const [auditor] = await platformDb
      .select()
      .from(platformAdmins)
      .where(eq(platformAdmins.email, 'usage-auditor@example.com'));
    expect(sent.map((row) => row.recipientId)).toContain(superAdmin?.id);
    // auditor 只有 tenant:read，不能調整配額
    expect(sent.map((row) => row.recipientId)).not.toContain(auditor?.id);
    expect(sent[0]?.params).toMatchObject({ code: 'test', percent: 90 });

    await app.get(TenantUsageService).rollup();
    expect(await nearQuotaNotifications()).toHaveLength(sent.length);
  });

  it('清單：每列帶用量摘要；依儲存使用率降冪時沒有快照的排最後', async () => {
    const list = dataOf<ListBody>(
      await platform('/platform/tenants?sort=-storageUsage&limit=100', 'auditor').expect(200),
    );
    expect(list.items[0]?.id).toBe(homeId);
    expect(list.items[0]?.usage.storageUsageRatio).toBeCloseTo(0.9, 2);
    const ratios = list.items.map((item) => item.usage.storageUsageRatio);
    const firstNull = ratios.indexOf(null);
    if (firstNull !== -1)
      expect(ratios.slice(firstNull).every((ratio) => ratio === null)).toBe(true);

    const invalid = await platform('/platform/tenants?sort=name').expect(400);
    expect((invalid.body as { error: { code: string } }).error.code).toBe('VALIDATION_FAILED');
  });

  it('保留期限以前的日資料在彙總時刪掉', async () => {
    const old = usageDateDaysBefore(usageDate(), 401);
    await platformDb
      .insert(tenantUsageDaily)
      .values({ tenantId: homeId, date: old, requestsInternal: 1 })
      .onConflictDoNothing();
    await app.get(TenantUsageService).rollup();
    const rows = await platformDb
      .select()
      .from(tenantUsageDaily)
      .where(and(eq(tenantUsageDaily.tenantId, homeId), eq(tenantUsageDaily.date, old)));
    expect(rows).toHaveLength(0);
  });

  it('找不到租戶 → TENANT_NOT_FOUND', async () => {
    const missing = await platform(`/platform/tenants/${randomUUID()}/usage`).expect(404);
    expect((missing.body as { error: { code: string } }).error.code).toBe('TENANT_NOT_FOUND');
  });
});
