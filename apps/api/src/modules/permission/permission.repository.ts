import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { PermissionKey } from '@/common/types';
import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB } from '@/core/database';
import type { PermissionRow } from '@/db/schema';
import {
  isActiveRole,
  isHumanUser,
  isRoleHolderTuple,
  isRolePermissionTuple,
  notDeleted,
  permissions,
  relationTuples,
  roles,
  users,
} from '@/db/schema';

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

  /**
   * 這些人之中未刪除、`active` 的 **人**（依 id 排序）：收通知的是人，服務帳號不收
   * （docs/architecture/06-external-api.md §9.2 D1）。
   */
  async filterActiveUserIds(userIds: readonly string[]): Promise<string[]> {
    if (userIds.length === 0) return [];
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          inArray(users.id, [...userIds]),
          eq(users.status, 'active'),
          notDeleted(users),
          isHumanUser(),
        ),
      )
      .orderBy(asc(users.id));
    return rows.map((row) => row.id);
  }
}
