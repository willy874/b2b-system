import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { PermissionKey } from '@/common/types';
import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB } from '@/core/database';
import type { PermissionRow } from '@/db/schema';
import {
  isActiveRole,
  isRoleHolderTuple,
  isRolePermissionTuple,
  permissions,
  relationTuples,
  roles,
} from '@/db/schema';

import { SUPER_ADMIN_SLUG } from './permission.constants';

/** 同一張表的第二個別名：角色持有者的邊 ⋈ 那個角色帶的權限鍵的邊。 */
const grantedKey = alias(relationTuples, 'granted_key');

@Injectable()
export class PermissionRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  /** 使用者透過「這個角色以外」的（未刪除）角色持有的權限鍵（評估改動一個角色對持有者的影響）。 */
  async findPermissionKeysByUserExcludingRole(
    userId: string,
    roleId: string,
  ): Promise<PermissionKey[]> {
    const rows = await this.db
      .selectDistinct({ key: grantedKey.relation })
      .from(relationTuples)
      .innerJoin(roles, and(eq(sql`${roles.id}::text`, relationTuples.objectId), isActiveRole()))
      .innerJoin(
        grantedKey,
        and(isRolePermissionTuple(grantedKey), eq(grantedKey.subjectId, relationTuples.objectId)),
      )
      .where(
        and(
          isRoleHolderTuple(),
          eq(relationTuples.subjectId, userId),
          ne(relationTuples.objectId, roleId),
        ),
      );
    return rows.map((row) => row.key as PermissionKey);
  }

  /** 使用者是否持有這個角色。 */
  async userHasRole(userId: string, roleId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ one: sql<number>`1` })
      .from(relationTuples)
      .where(
        and(
          isRoleHolderTuple(),
          eq(relationTuples.objectId, roleId),
          eq(relationTuples.subjectId, userId),
        ),
      )
      .limit(1);
    return Boolean(row);
  }

  async findAllPermissionKeys(): Promise<PermissionKey[]> {
    const rows = await this.db.select({ key: permissions.key }).from(permissions);
    return rows.map((row) => row.key as PermissionKey);
  }

  async findPermissionKeysByRoles(roleIds: readonly string[]): Promise<PermissionKey[]> {
    if (roleIds.length === 0) return [];
    const rows = await this.db
      .selectDistinct({ key: relationTuples.relation })
      .from(relationTuples)
      .where(and(isRolePermissionTuple(), inArray(relationTuples.subjectId, [...roleIds])));
    return rows.map((row) => row.key as PermissionKey);
  }

  /** super-admin 是隱含全集、沒有任何權限鍵的邊，指派前要另外用 slug 判斷。 */
  async includesSuperAdminRole(roleIds: readonly string[]): Promise<boolean> {
    if (roleIds.length === 0) return false;
    const [row] = await this.db
      .select({ one: sql<number>`1` })
      .from(roles)
      .where(and(inArray(roles.id, [...roleIds]), eq(roles.slug, SUPER_ADMIN_SLUG)))
      .limit(1);
    return Boolean(row);
  }

  async listCatalog(): Promise<PermissionRow[]> {
    return this.db.select().from(permissions).orderBy(asc(permissions.sortOrder));
  }

  async findIdsByKeys(keys: readonly string[], db: DbOrTx = this.db): Promise<Map<string, string>> {
    if (keys.length === 0) return new Map();
    const rows = await db
      .select({ id: permissions.id, key: permissions.key })
      .from(permissions)
      .where(inArray(permissions.key, [...keys]));
    return new Map(rows.map((row) => [row.key, row.id]));
  }

  /** 角色的持有者（角色的權限變更時，要推播給誰）。 */
  async findUserIdsByRole(roleId: string): Promise<string[]> {
    const rows = await this.db
      .select({ userId: relationTuples.subjectId })
      .from(relationTuples)
      .where(and(isRoleHolderTuple(), eq(relationTuples.objectId, roleId)));
    return rows.map((row) => row.userId);
  }
}
