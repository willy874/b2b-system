import { and, eq, inArray, isNull, notInArray } from 'drizzle-orm';

import type { ScriptDatabase } from '../client';
import {
  createPlatformScriptClient,
  forEachScriptTenant,
  loadScriptEnv,
  seedTenantCode,
} from '../client';
import { permissions, rolePermissions, roles } from '../schema';
import type { PermissionKey } from './permissions';
import { PERMISSION_SEED } from './permissions';
import { seedPlatformAdmin } from './platform-admin';
import { ROLE_SEED } from './roles';
import { seedSuperAdmin } from './super-admin';

/** ① 權限目錄：冪等 upsert；孤兒只警告不刪除。 */
export async function seedPermissions(db: ScriptDatabase): Promise<void> {
  for (const [resource, action, nameI18nKey, sortOrder] of PERMISSION_SEED) {
    await db
      .insert(permissions)
      .values({ key: `${resource}:${action}`, resource, action, nameI18nKey, sortOrder })
      .onConflictDoUpdate({
        target: permissions.key,
        set: { resource, action, nameI18nKey, sortOrder },
      });
  }

  const seededKeys = PERMISSION_SEED.map(([resource, action]) => `${resource}:${action}`);
  const orphans = await db
    .select({ key: permissions.key })
    .from(permissions)
    .where(notInArray(permissions.key, seededKeys));
  if (orphans.length) {
    console.warn(
      `資料庫中存在 seed 未定義的權限，請以 migration 明確處理：${orphans
        .map((row) => row.key)
        .join(', ')}`,
    );
  }
  console.info(`權限目錄：${seededKeys.length} 筆`);
}

/** ② 系統角色 ＋ ③ 角色權限（只在角色「新建立」時寫入權限）。 */
export async function seedRoles(db: ScriptDatabase): Promise<void> {
  for (const seed of ROLE_SEED) {
    const [existing] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.slug, seed.slug), isNull(roles.deletedAt)))
      .limit(1);

    if (existing) {
      // name / description 不覆寫（管理員可能已在 UI 中改過），is_system 強制為 true
      if (!existing.isSystem) {
        await db.update(roles).set({ isSystem: true }).where(eq(roles.id, existing.id));
      }
      console.info(`系統角色 ${seed.slug} 已存在，略過權限同步`);
      continue;
    }

    const [created] = await db
      .insert(roles)
      .values({
        slug: seed.slug,
        name: seed.name,
        description: seed.description,
        isSystem: true,
      })
      .returning();
    if (!created) throw new Error(`建立系統角色失敗：${seed.slug}`);

    if (seed.permissions !== '*' && seed.permissions.length) {
      await grantPermissions(db, created.id, seed.permissions);
    }
    console.info(`系統角色 ${seed.slug} 已建立`);
  }
}

export async function grantPermissions(
  db: ScriptDatabase,
  roleId: string,
  keys: readonly PermissionKey[],
): Promise<void> {
  if (!keys.length) return;
  const rows = await db
    .select({ id: permissions.id, key: permissions.key })
    .from(permissions)
    .where(inArray(permissions.key, [...keys]));

  const missing = keys.filter((key) => !rows.some((row) => row.key === key));
  if (missing.length) throw new Error(`權限不存在：${missing.join(', ')}`);

  await db
    .insert(rolePermissions)
    .values(rows.map((row) => ({ roleId, permissionId: row.id })))
    .onConflictDoNothing();
}

export async function runSeed(db: ScriptDatabase): Promise<void> {
  await seedPermissions(db);
  await seedRoles(db);
  await seedSuperAdmin(db);
}

/** 權限目錄與系統角色（每個租戶都要有；新增權限後 `db:seed` 會補上）。 */
export async function seedCatalog(db: ScriptDatabase): Promise<void> {
  await seedPermissions(db);
  await seedRoles(db);
}

/**
 * 先建平台管理者，再在每個租戶補上權限目錄與系統角色（每個租戶各一份；停用中的也補，重新啟用時才不會缺權限）。
 * `SUPER_ADMIN_EMAIL` 的 super-admin **只** 建在 `SEED_TENANT`（預設 `default`）：其他租戶的第一位管理員由佈建建立，
 * 不能讓營運方共用的帳密出現在客戶的租戶裡（docs/adr/0020-physical-tenant-isolation.md D12）。
 */
async function main(): Promise<void> {
  loadScriptEnv();
  const platform = createPlatformScriptClient();
  try {
    await seedPlatformAdmin(platform.db);
  } finally {
    await platform.client.end();
  }
  const seedTenant = seedTenantCode();
  await forEachScriptTenant(
    (db, tenant) => (tenant.code === seedTenant ? runSeed(db) : seedCatalog(db)),
    { includeDisabled: true },
  );
  console.info('seed 完成');
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
