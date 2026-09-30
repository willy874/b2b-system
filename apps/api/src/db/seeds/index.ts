import { and, desc, eq, inArray, isNull, ne, notInArray, sql } from 'drizzle-orm';

import type { ScriptDatabase } from '../client';
import {
  createPlatformScriptClient,
  forEachScriptTenant,
  loadScriptEnv,
  seedTenantCode,
} from '../client';
import {
  auditLogs,
  isRolePermissionTuple,
  permissions,
  relationTuples,
  rolePermissionTuple,
  roles,
  superAdminTuple,
} from '../schema';
import type { PermissionKey } from './permissions';
import { PERMISSION_SEED, permissionClosure } from './permissions';
import { seedPlatformAdmin } from './platform-admin';
import { recordRoleBaseline } from './role-revisions';
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
      if (seed.permissions === '*') await ensureSuperAdminTuple(db, existing.id);
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

    if (seed.permissions === '*') await ensureSuperAdminTuple(db, created.id);
    else if (seed.permissions.length) await grantPermissions(db, created.id, seed.permissions);
    await recordRoleBaseline(db, created, seed.permissions === '*' ? [] : seed.permissions);
    console.info(`系統角色 ${seed.slug} 已建立`);
  }
}

/**
 * super-admin 是隱含全集：租戶節點上一條 `superAdmin` 的邊，沒有任何權限鍵的邊。
 * 冪等；角色已存在時也補一次（G3 之前由 roles 上的 trigger 寫入）。
 */
async function ensureSuperAdminTuple(db: ScriptDatabase, roleId: string): Promise<void> {
  await db.insert(relationTuples).values(superAdminTuple(roleId)).onConflictDoNothing();
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
    .insert(relationTuples)
    .values(rows.map((row) => rolePermissionTuple(roleId, row.key)))
    .onConflictDoNothing();
}

/**
 * ④ 權限依賴樹讓角色實際持有的鍵多於明確授予的（docs/rbac/02-permission-catalog.md §9.3）：
 * 每個多出鍵的角色寫一筆稽核 `role.permissionsImplied`，不靜默改變。冪等：同一個角色、同一組多出的鍵只寫一次。
 */
export async function recordImpliedPermissions(db: ScriptDatabase): Promise<void> {
  const rows = await db
    .select({ roleId: roles.id, roleName: roles.name, key: permissions.key })
    .from(roles)
    .innerJoin(
      relationTuples,
      and(isRolePermissionTuple(), eq(relationTuples.subjectId, sql`${roles.id}::text`)),
    )
    .innerJoin(permissions, eq(permissions.key, relationTuples.relation))
    .where(and(isNull(roles.deletedAt), ne(roles.slug, 'super-admin')));
  const byRole = new Map<string, { name: string; keys: PermissionKey[] }>();
  for (const row of rows) {
    const entry = byRole.get(row.roleId) ?? { name: row.roleName, keys: [] };
    entry.keys.push(row.key as PermissionKey);
    byRole.set(row.roleId, entry);
  }

  for (const [roleId, { name, keys }] of byRole) {
    const explicit = new Set(keys);
    const implied = [...permissionClosure(keys)].filter((key) => !explicit.has(key)).toSorted();
    if (implied.length === 0) continue;
    // oxlint-disable-next-line no-await-in-loop -- seed 腳本，角色數量少，依序執行
    const [last] = await db
      .select({ metadata: auditLogs.metadata })
      .from(auditLogs)
      .where(and(eq(auditLogs.action, 'role.permissionsImplied'), eq(auditLogs.resourceId, roleId)))
      .orderBy(desc(auditLogs.occurredAt))
      .limit(1);
    const previous = (last?.metadata as { implied?: string[] } | null)?.implied;
    if (previous && previous.join(',') === implied.join(',')) continue;
    // oxlint-disable-next-line no-await-in-loop -- 同上
    await db.insert(auditLogs).values({
      action: 'role.permissionsImplied',
      actorId: null,
      actorEmail: 'system',
      resourceType: 'role',
      resourceId: roleId,
      resourceName: name,
      result: 'success',
      metadata: {
        reason: 'permission dependency tree',
        explicit: [...explicit].toSorted(),
        implied,
      },
    });
    console.info(`角色 ${name} 經權限依賴樹多出：${implied.join(', ')}`);
  }
}

export async function runSeed(db: ScriptDatabase): Promise<void> {
  await seedPermissions(db);
  await seedRoles(db);
  await recordImpliedPermissions(db);
  await seedSuperAdmin(db);
}

/** 權限目錄與系統角色（每個租戶都要有；新增權限後 `db:seed` 會補上）。 */
export async function seedCatalog(db: ScriptDatabase): Promise<void> {
  await seedPermissions(db);
  await seedRoles(db);
  await recordImpliedPermissions(db);
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
