import { resolve } from 'node:path';

import { config as loadEnv } from 'dotenv';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import postgres from 'postgres';

import { SecretBox, TENANT_SECRET_PURPOSE } from '@/core/crypto';
import { toTenantFeatureParamOverrides } from '@/core/tenant/tenant-feature-params';
import type { TenantFeatureParamOverrides } from '@/core/tenant/tenant-feature-params';

import { createPlatformScriptClient, createScriptClient } from './connect';
import type { PlatformScriptDatabase, ScriptDatabase } from './connect';
import * as platformSchema from './platform/schema';
import type { TenantStatus } from './platform/schema';
import { assertDisposableDatabases } from './script-guard';

export { createPlatformScriptClient, createScriptClient } from './connect';
export type { PlatformScriptDatabase, ScriptDatabase } from './connect';

/**
 * CLI 腳本（migrate / seed / reset）用的連線：不經過 Nest DI。
 * 平台 DB 來自 `PLATFORM_DATABASE_URL`；租戶 DB 的連線字串從平台 DB 的 `tenants` 解密而來
 * （docs/architecture/05-tenancy.md §10.2 D1、D4）。
 */
export function loadScriptEnv(): void {
  loadEnv({ path: resolve(process.cwd(), '.env'), quiet: true });
  loadEnv({ path: resolve(process.cwd(), '../../.env'), quiet: true });
}

/** 與 api 相同的金鑰規則：`TENANT_SECRET_KEY`，沒有時（僅開發）由 `JWT_SECRET` 推導。 */
export function tenantSecretBox(): SecretBox {
  const seed = process.env.JWT_SECRET;
  if (!process.env.TENANT_SECRET_KEY && !seed) {
    throw new Error('TENANT_SECRET_KEY 或 JWT_SECRET 至少要設定一個，才能解開租戶的連線字串');
  }
  return SecretBox.fromConfig(process.env.TENANT_SECRET_KEY, seed ?? '', TENANT_SECRET_PURPOSE);
}

export interface ScriptTenant {
  id: string;
  code: string;
  status: TenantStatus;
  databaseUrl: string;
  /** feature 參數的覆寫（docs/architecture/05-tenancy.md §13.2 D2）。 */
  featureParams: TenantFeatureParamOverrides;
}

/** 未刪除的租戶；給了 `code` 就只回傳那一個（找不到時拋錯）。 */
export async function listScriptTenants(
  platform: PlatformScriptDatabase,
  options: { code?: string; activeOnly?: boolean; includeDisabled?: boolean } = {},
): Promise<ScriptTenant[]> {
  const { tenants } = platformSchema;
  const rows = await platform
    .select()
    .from(tenants)
    .where(
      and(
        isNull(tenants.deletedAt),
        options.code ? eq(tenants.code, options.code) : undefined,
        options.activeOnly
          ? options.includeDisabled
            ? inArray(tenants.status, ['active', 'disabled'])
            : eq(tenants.status, 'active')
          : undefined,
      ),
    )
    .orderBy(tenants.code);
  if (options.code && !rows.length)
    throw new Error(`找不到租戶 ${options.code}（先跑 db:migrate）`);
  const box = tenantSecretBox();
  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    status: row.status,
    databaseUrl: box.decrypt(row.databaseUrlEncrypted),
    featureParams: toTenantFeatureParamOverrides(row.featureParams),
  }));
}

/**
 * 依序在每個 `active` 租戶的 DB 執行 `fn`（給了 `code` 就只有那一個）。`includeDisabled`：停用中的也算
 * （它的 DB 還在，例：補權限目錄）；佈建中、佈建失敗的 DB 可能不完整，一律不算。
 *
 * 預設第一個失敗的租戶就中止（reset、seed:dev 這類只針對開發環境的腳本）。給了 `onError` 時改成逐一處理：
 * 失敗的租戶交給它，其他租戶照常執行，最後回傳失敗的租戶代碼（docs/architecture/05-tenancy.md §10.2 D14）。
 */
export async function forEachScriptTenant(
  fn: (db: ScriptDatabase, tenant: ScriptTenant) => Promise<void>,
  options: {
    code?: string;
    includeDisabled?: boolean;
    onError?: (tenant: ScriptTenant, error: unknown) => void;
  } = {},
): Promise<string[]> {
  const { onError, ...filter } = options;
  const failed: string[] = [];
  const platform = createPlatformScriptClient();
  try {
    for (const tenant of await listScriptTenants(platform.db, { ...filter, activeOnly: true })) {
      const { client, db } = createScriptClient(tenant.databaseUrl);
      try {
        console.info(`── 租戶 ${tenant.code}`);
        // oxlint-disable-next-line no-await-in-loop -- 依序處理，一次只開一個租戶的連線
        await fn(db, tenant);
      } catch (error) {
        if (!onError) throw error;
        onError(tenant, error);
        failed.push(tenant.code);
      } finally {
        // oxlint-disable-next-line no-await-in-loop -- 同上
        await client.end();
      }
    }
  } finally {
    await platform.client.end();
  }
  return failed;
}

/**
 * 會清空資料或寫入測試資料的腳本（`db:reset`、`db:seed:dev`、`db:seed:e2e`）在任何寫入之前呼叫：
 * 檢查平台 DB 與這次會動到的租戶 DB（給了 `code` 就只有那一個），規則見 `script-guard.ts`。
 */
export async function assertDisposableScriptTargets(
  script: string,
  options: { code?: string } = {},
): Promise<void> {
  // 執行者的 NODE_ENV 在建立任何連線之前先擋
  if (process.env.NODE_ENV === 'production') throw new Error(`${script} 不可在 production 執行`);
  const platformUrl = process.env.PLATFORM_DATABASE_URL;
  if (!platformUrl) throw new Error('PLATFORM_DATABASE_URL 未設定');
  const platform = createPlatformScriptClient(platformUrl);
  try {
    const targets = await listScriptTenants(platform.db, { ...options, activeOnly: true });
    await assertDisposableDatabases(platform.db, {
      script,
      platformUrl,
      tenantUrls: targets.map((tenant) => tenant.databaseUrl),
    });
  } finally {
    await platform.client.end();
  }
}

/** seed:dev、seed:e2e 的目標租戶：`SEED_TENANT`，預設是 `DEFAULT_TENANT_CODE`（`default`）。 */
export function seedTenantCode(): string {
  return process.env.SEED_TENANT || process.env.DEFAULT_TENANT_CODE || 'default';
}

/**
 * 資料庫不存在時建立它（連到同一台伺服器的 `postgres` 資料庫執行 `CREATE DATABASE`）。
 * 開發與測試用；正式環境的 DB 角色通常沒有 `CREATEDB`，這時錯誤訊息會指出要手動建立。
 */
export async function ensureDatabase(url: string): Promise<void> {
  const probe = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await probe`select 1`;
    return;
  } catch (error) {
    if ((error as { code?: string }).code !== '3D000') throw error;
  } finally {
    await probe.end();
  }
  const target = new URL(url);
  const name = decodeURIComponent(target.pathname.slice(1));
  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = postgres(admin.toString(), { max: 1, onnotice: () => {} });
  try {
    await client.unsafe(`CREATE DATABASE "${name.replaceAll('"', '""')}"`);
    console.info(`已建立資料庫 ${name}`);
  } catch (error) {
    throw new Error(
      `資料庫 ${name} 不存在且無法建立，請手動建立後重跑：${(error as Error).message}`,
      {
        cause: error,
      },
    );
  } finally {
    await client.end();
  }
}
