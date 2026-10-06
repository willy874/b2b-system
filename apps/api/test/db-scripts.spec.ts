import { and, eq, isNull, sql } from 'drizzle-orm';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';

import { createPlatformScriptClient, tenantSecretBox } from '@/db/client';
import type { PlatformScriptDatabase } from '@/db/connect';
import { migrateAll } from '@/db/migrate';
import { registerTenant } from '@/db/platform/register-tenant';
import { platformAdmins, platformEnvironment, tenantDomains, tenants } from '@/db/platform/schema';
import { markProductionEnvironment, readPlatformEnvironment } from '@/db/script-guard';
import { E2E_PLATFORM_ADMIN, seedE2e } from '@/db/seeds/e2e';
import { seedAll } from '@/db/seeds/index';
import { PERMISSION_SEED } from '@/db/seeds/permissions';
import { seedPlatformAdmin } from '@/db/seeds/platform-admin';
import { PlatformAuthTokenRepository } from '@/modules/platform-admin/platform-auth-token.repository';

/**
 * migrate／seed 腳本的租戶處理與防呆（docs/architecture/05-tenancy.md §8、§10.2 D14；backend/02-database.md §6.1）。
 * 用自己的平台 DB（同一個 container 的另一個 database），不碰其他測試共用的租戶登記。
 */
const DATABASES = ['b2b_scripts_platform', 'b2b_scripts_default', 'b2b_scripts_ok'] as const;

let baseUrl: string;
let platformUrl: string;
let platform: ReturnType<typeof createPlatformScriptClient>;
let originalPlatformUrl: string | undefined;

function urlOf(database: string, credentials?: { user: string; password: string }): string {
  const url = new URL(baseUrl);
  url.pathname = `/${database}`;
  if (credentials) {
    url.username = credentials.user;
    url.password = credentials.password;
  }
  return url.toString();
}

/** 角色不存在：連線時認證就失敗（不是「database 不存在」，ensureDatabase 不會試著建立）。 */
const unreachableUrl = () => urlOf('b2b_scripts_nobody', { user: 'nobody', password: 'nobody' });

const defaultTenant = () => ({
  code: 'default',
  name: '預設租戶',
  databaseUrl: urlOf('b2b_scripts_default'),
  storageBucket: 'b2b-scripts-default',
  domains: ['scripts.test'],
});

async function register(
  code: string,
  databaseUrl: string,
  status?: 'provisioning' | 'failed',
): Promise<string> {
  const id = await registerTenant(
    platform.db,
    { code, name: code, databaseUrl, storageBucket: `b2b-scripts-${code}`, domains: [] },
    tenantSecretBox(),
  );
  if (status) await platform.db.update(tenants).set({ status }).where(eq(tenants.id, id));
  return id;
}

async function tableExists(database: string, table: string): Promise<boolean> {
  const client = postgres(urlOf(database), { max: 1, onnotice: () => {} });
  try {
    const [row] = await client<
      { exists: boolean }[]
    >`SELECT to_regclass(${table}) IS NOT NULL AS exists`;
    return row?.exists ?? false;
  } finally {
    await client.end();
  }
}

async function liveTenantsWithCode(db: PlatformScriptDatabase, code: string) {
  return db
    .select({ id: tenants.id })
    .from(tenants)
    .where(and(eq(tenants.code, code), isNull(tenants.deletedAt)));
}

async function domainsOf(tenantId: string): Promise<string[]> {
  const rows = await platform.db
    .select({ domain: tenantDomains.domain })
    .from(tenantDomains)
    .where(eq(tenantDomains.tenantId, tenantId));
  return rows.map((row) => row.domain);
}

const e2eAdmins = () =>
  platform.db.select().from(platformAdmins).where(eq(platformAdmins.email, E2E_PLATFORM_ADMIN));

const tokens = () => new PlatformAuthTokenRepository(platform.db as never);
const tokenOf = (link: string) => new URL(link).searchParams.get('token') ?? '';

beforeAll(async () => {
  baseUrl = inject('platformDatabaseUrl');
  platformUrl = urlOf('b2b_scripts_platform');
  const admin = postgres(baseUrl, { max: 1, onnotice: () => {} });
  for (const name of DATABASES) {
    // oxlint-disable-next-line no-await-in-loop -- 測試準備，依序建立
    await admin.unsafe(`CREATE DATABASE ${name}`);
  }
  await admin.end();
  // seed／seed:e2e 讀 PLATFORM_DATABASE_URL：這個檔案的期間指向自己的平台 DB
  originalPlatformUrl = process.env.PLATFORM_DATABASE_URL;
  process.env.PLATFORM_DATABASE_URL = platformUrl;
  vi.spyOn(console, 'info').mockImplementation(() => {});
});

afterAll(async () => {
  vi.restoreAllMocks();
  process.env.PLATFORM_DATABASE_URL = originalPlatformUrl;
  await platform?.client.end();
  const admin = postgres(baseUrl, { max: 1, onnotice: () => {} });
  for (const name of DATABASES) {
    // oxlint-disable-next-line no-await-in-loop -- 依序清掉
    await admin.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  }
  await admin.end();
});

describe('db:migrate（05-tenancy.md §8、§10.2 D14）', () => {
  it('平台 DB 一個租戶都沒有時登記預設租戶，並跑完它的 migration', async () => {
    const result = await migrateAll({ platformUrl, defaultTenant: defaultTenant() });
    platform = createPlatformScriptClient(platformUrl);

    expect(result).toEqual({ migrated: ['default'], skipped: [], failed: [] });
    const [registered] = await liveTenantsWithCode(platform.db, 'default');
    expect(await domainsOf(registered!.id)).toEqual(['scripts.test']);
    expect(await tableExists('b2b_scripts_default', 'users')).toBe(true);
  });

  it('略過佈建中與佈建失敗的租戶；其他租戶失敗不拋錯，也不影響排在後面的租戶', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // 代碼依字母排序處理：壞掉的 aaa-broken 排在 ok 前面
    await register('aaa-broken', unreachableUrl());
    await register('failed-one', unreachableUrl(), 'failed');
    await register('prov-one', unreachableUrl(), 'provisioning');
    await register('ok', urlOf('b2b_scripts_ok'));

    const result = await migrateAll({ platformUrl });

    expect(result.failed).toEqual(['aaa-broken']);
    expect(result.skipped.toSorted()).toEqual(['failed-one', 'prov-one']);
    expect(result.migrated.toSorted()).toEqual(['default', 'ok']);
    expect(await tableExists('b2b_scripts_ok', 'users')).toBe(true);
  });

  it('刪除預設租戶之後再跑兩次：都成功、不重新登記，網域也不會被掛回去', async () => {
    const [original] = await liveTenantsWithCode(platform.db, 'default');
    await platform.db.delete(tenantDomains).where(eq(tenantDomains.tenantId, original!.id));
    await platform.db
      .update(tenants)
      .set({ deletedAt: new Date() })
      .where(eq(tenants.id, original!.id));

    await migrateAll({ platformUrl, defaultTenant: defaultTenant() });
    await migrateAll({ platformUrl, defaultTenant: defaultTenant() });

    expect(await liveTenantsWithCode(platform.db, 'default')).toEqual([]);
    const [owner] = await platform.db
      .select()
      .from(tenantDomains)
      .where(eq(tenantDomains.domain, 'scripts.test'));
    expect(owner).toBeUndefined();
  });

  it('代碼 default 已經屬於另一個新租戶時，不改動它的網域', async () => {
    const id = await registerTenant(
      platform.db,
      {
        ...defaultTenant(),
        databaseUrl: urlOf('b2b_scripts_ok'),
        // 已刪除的預設租戶仍佔著它的 bucket（tenants_storage_bucket_key）
        storageBucket: 'b2b-scripts-new-default',
        domains: ['new-default.test'],
      },
      tenantSecretBox(),
    );

    await migrateAll({ platformUrl, defaultTenant: defaultTenant() });

    expect(await domainsOf(id)).toEqual(['new-default.test']);
  });
});

describe('db:seed（05-tenancy.md §10.2 D14）', () => {
  it('單一租戶失敗不中止其他租戶，回傳失敗的租戶', async () => {
    const { failed } = await seedAll('none');

    expect(failed).toEqual(['aaa-broken']);
    const ok = postgres(urlOf('b2b_scripts_ok'), { max: 1, onnotice: () => {} });
    const [row] = await ok<{ total: number }[]>`SELECT count(*)::int AS total FROM permissions`;
    await ok.end();
    expect(row?.total).toBe(PERMISSION_SEED.length);
  });
});

describe('會寫入測試資料的腳本的防呆（backend/02-database.md §6.1）', () => {
  it('db:seed:e2e 在 NODE_ENV=production 時拋錯，而且沒有寫入已知密碼的平台管理者', async () => {
    const nodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    process.env.SEED_TENANT = 'ok';
    try {
      await expect(seedE2e()).rejects.toThrow('production');
    } finally {
      process.env.NODE_ENV = nodeEnv;
      delete process.env.SEED_TENANT;
    }
    expect(await e2eAdmins()).toEqual([]);
  });

  it('production 的 db:migrate 在平台 DB 寫入環境標記；之後 db:seed:e2e 不寫入任何東西', async () => {
    await migrateAll({ platformUrl, production: true });
    expect(await readPlatformEnvironment(platform.db)).toBe('production');

    process.env.SEED_TENANT = 'ok';
    try {
      await expect(seedE2e()).rejects.toThrow('platform_environment');
    } finally {
      delete process.env.SEED_TENANT;
      await platform.db.delete(platformEnvironment);
    }
    expect(await e2eAdmins()).toEqual([]);
  });

  it('同一個標記：再次寫入是冪等的', async () => {
    await markProductionEnvironment(platform.db);
    await markProductionEnvironment(platform.db);
    const rows = await platform.db.select().from(platformEnvironment);
    expect(rows.map((row) => row.name)).toEqual(['production']);
    await platform.db.delete(platformEnvironment);
  });
});

describe('第一位平台管理者（rbac/05-seed-and-bootstrap.md §5.1）', () => {
  const PRODUCTION = {
    NODE_ENV: 'production',
    PLATFORM_ADMIN_EMAIL: 'boot@example.com',
    PLATFORM_APP_URL: 'https://accounts.example.com',
  };

  it('production 沒有提供密碼：建成 pending、不印密碼，印出的連結可以拿來設定密碼', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { setupLink } = await seedPlatformAdmin(platform.db, PRODUCTION);

    const [admin] = await platform.db.select().from(platformAdmins);
    expect(admin).toMatchObject({
      email: 'boot@example.com',
      status: 'pending',
      passwordHash: null,
    });
    expect(setupLink).toMatch(/^https:\/\/accounts\.example\.com\/setup\?token=/);
    const output = warn.mock.calls.flat().join('\n');
    expect(output).toContain(setupLink);
    expect(output).not.toContain('密碼：');
    // PlatformAccountService.setup 用的就是這個查詢：未使用、未過期的 activation token
    expect(await tokens().findUsable(tokenOf(setupLink!), 'activation')).toMatchObject({
      adminId: admin!.id,
    });
  });

  it('還沒設定密碼時再跑一次：換發新的連結，舊的作廢', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const [admin] = await platform.db.select().from(platformAdmins);
    const before = await platform.db.execute<{ total: number }>(
      sql`SELECT count(*)::int AS total FROM platform_auth_tokens WHERE used_at IS NULL`,
    );
    expect(before[0]?.total).toBe(1);

    const { setupLink } = await seedPlatformAdmin(platform.db, PRODUCTION);

    expect(await tokens().findUsable(tokenOf(setupLink!), 'activation')).toMatchObject({
      adminId: admin!.id,
    });
    const after = await platform.db.execute<{ total: number }>(
      sql`SELECT count(*)::int AS total FROM platform_auth_tokens WHERE used_at IS NULL`,
    );
    expect(after[0]?.total).toBe(1);
  });

  it('PLATFORM_ADMIN_PASSWORD 不符合密碼政策：失敗，而且沒有建立帳號', async () => {
    await platform.db.delete(platformAdmins);

    await expect(
      seedPlatformAdmin(platform.db, { ...PRODUCTION, PLATFORM_ADMIN_PASSWORD: 'short-pw' }),
    ).rejects.toThrow('PLATFORM_ADMIN_PASSWORD');

    expect(await platform.db.select().from(platformAdmins)).toEqual([]);
  });
});
