import { and, eq, inArray, isNull, notInArray } from 'drizzle-orm';

import type { ScriptDatabase } from '../connect';
import {
  permissions,
  relationTuples,
  rolePermissionTuple,
  roles,
  superAdminTuple,
} from '../schema';
import type { PermissionKey } from '../seeds/permissions';
import { PERMISSION_SEED } from '../seeds/permissions';
import { ROLE_SEED } from '../seeds/roles';
import { recordRoleBaseline } from './role-baseline';

export interface PermissionCatalogResult {
  /** 權限目錄的筆數。 */
  count: number;
  /** 資料庫裡有、權限目錄沒有的鍵：只回報不刪除，要以 migration 明確處理。 */
  orphans: string[];
}

/** ① 權限目錄：冪等 upsert；孤兒只回報不刪除。 */
export async function seedPermissions(db: ScriptDatabase): Promise<PermissionCatalogResult> {
  for (const [resource, action, nameI18nKey, sortOrder] of PERMISSION_SEED) {
    // oxlint-disable-next-line no-await-in-loop -- 權限目錄只有幾十筆，依序 upsert
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
  return { count: seededKeys.length, orphans: orphans.map((row) => row.key) };
}

export interface SystemRoleResult {
  /** 這次新建立的系統角色（slug）。 */
  created: string[];
  /** 已存在、略過權限同步的系統角色（slug）。 */
  existing: string[];
}

/** ② 系統角色 ＋ ③ 角色權限（只在角色「新建立」時寫入權限）。 */
export async function seedRoles(db: ScriptDatabase): Promise<SystemRoleResult> {
  const result: SystemRoleResult = { created: [], existing: [] };
  for (const seed of ROLE_SEED) {
    // oxlint-disable-next-line no-await-in-loop -- 系統角色只有幾個，依序處理
    const [existing] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.slug, seed.slug), isNull(roles.deletedAt)))
      .limit(1);

    if (existing) {
      // name / description 不覆寫（管理員可能已在 UI 中改過），is_system 強制為 true
      if (!existing.isSystem) {
        // oxlint-disable-next-line no-await-in-loop -- 同上
        await db.update(roles).set({ isSystem: true }).where(eq(roles.id, existing.id));
      }
      // oxlint-disable-next-line no-await-in-loop -- 同上
      if (seed.permissions === '*') await ensureSuperAdminTuple(db, existing.id);
      result.existing.push(seed.slug);
      continue;
    }

    // oxlint-disable-next-line no-await-in-loop -- 同上
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

    // oxlint-disable-next-line no-await-in-loop -- 同上
    if (seed.permissions === '*') await ensureSuperAdminTuple(db, created.id);
    // oxlint-disable-next-line no-await-in-loop -- 同上
    else if (seed.permissions.length) await grantPermissions(db, created.id, seed.permissions);
    // oxlint-disable-next-line no-await-in-loop -- 同上
    await recordRoleBaseline(db, created, seed.permissions === '*' ? [] : seed.permissions);
    result.created.push(seed.slug);
  }
  return result;
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
