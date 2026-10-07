import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';

import { seedPermissions, seedRoles } from '../bootstrap';
import type { ScriptDatabase } from '../client';
import {
  createPlatformScriptClient,
  forEachScriptTenant,
  loadScriptEnv,
  seedTenantCode,
} from '../client';
import { auditLogs, isRolePermissionTuple, permissions, relationTuples, roles } from '../schema';
import type { PermissionKey } from './permissions';
import { permissionClosure } from './permissions';
import { seedPlatformAdmin } from './platform-admin';
import { seedSuperAdmin } from './super-admin';

/** ①～③ 權限目錄、系統角色與角色權限（db/bootstrap；佈建新租戶時也用同一套）。 */
async function seedPermissionsAndRoles(db: ScriptDatabase): Promise<void> {
  const catalog = await seedPermissions(db);
  if (catalog.orphans.length) {
    console.warn(
      `資料庫中存在 seed 未定義的權限，請以 migration 明確處理：${catalog.orphans.join(', ')}`,
    );
  }
  console.info(`權限目錄：${catalog.count} 筆`);
  const systemRoles = await seedRoles(db);
  for (const slug of systemRoles.created) console.info(`系統角色 ${slug} 已建立`);
  for (const slug of systemRoles.existing) console.info(`系統角色 ${slug} 已存在，略過權限同步`);
}

/**
 * ④ 權限依賴樹讓角色實際持有的鍵多於明確授予的（docs/architecture/iam/02-permission-catalog.md §9.3）：
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

/** 一個租戶的完整 seed：權限目錄、系統角色、第一位 super-admin（`tenantCode` 用在啟用連結的 `?tenant=`）。 */
export async function runSeed(
  db: ScriptDatabase,
  tenantCode: string = seedTenantCode(),
): Promise<void> {
  await seedCatalog(db);
  await seedSuperAdmin(db, tenantCode);
}

/** 權限目錄與系統角色（每個租戶都要有；新增權限後 `db:seed` 會補上）。 */
export async function seedCatalog(db: ScriptDatabase): Promise<void> {
  await seedPermissionsAndRoles(db);
  await recordImpliedPermissions(db);
}

/**
 * 先建平台管理者，再在每個租戶補上權限目錄與系統角色（每個租戶各一份；停用中的也補，重新啟用時才不會缺權限）。
 * `SUPER_ADMIN_EMAIL` 的 super-admin **只** 建在 `seedTenant`（預設 `default`）：其他租戶的第一位管理員由佈建建立，
 * 不能讓營運方共用的帳密出現在客戶的租戶裡（docs/architecture/05-tenancy.md §10.2 D12）。
 *
 * 平台的部分失敗就拋錯；單一租戶失敗不中止其他租戶，回傳失敗的租戶代碼（docs/architecture/05-tenancy.md §10.2 D14）。
 */
export async function seedAll(seedTenant = seedTenantCode()): Promise<{ failed: string[] }> {
  const platform = createPlatformScriptClient();
  try {
    await seedPlatformAdmin(platform.db);
  } finally {
    await platform.client.end();
  }
  const failed = await forEachScriptTenant(
    (db, tenant) => (tenant.code === seedTenant ? runSeed(db, tenant.code) : seedCatalog(db)),
    {
      includeDisabled: true,
      onError: (tenant, error) => console.error(`租戶 ${tenant.code}：seed 失敗`, error),
    },
  );
  return { failed };
}

/** `pnpm db:seed [--strict]`。結束碼的規則同 `db:migrate`：平台失敗才非零，`--strict` 時租戶失敗也非零。 */
async function main(): Promise<void> {
  loadScriptEnv();
  const { failed } = await seedAll();
  if (failed.length) {
    console.error(`seed 失敗的租戶：${failed.join(', ')}（修好後重跑 db:seed）`);
    if (process.argv.includes('--strict')) process.exitCode = 1;
    return;
  }
  console.info('seed 完成');
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
}
