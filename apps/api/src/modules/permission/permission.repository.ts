import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import type { PermissionKey } from '@/common/types';
import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB } from '@/core/database';
import type { PermissionRow } from '@/db/schema';
import {
  isActiveRole,
  isHumanUser,
  isRolePermissionTuple,
  notDeleted,
  permissions,
  relationTuples,
  roles,
  users,
} from '@/db/schema';

@Injectable()
export class PermissionRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  /**
   * 這些角色（未刪除的）帶的權限鍵，去重。自我鎖定用：actor 主體閉包裡「這個角色以外」的角色還帶來哪些鍵。
   * 不含 `superAdmin`（`isRolePermissionTuple`）：持有 super-admin 的人在呼叫端已豁免。
   */
  async findPermissionKeysOfRoles(roleIds: readonly string[]): Promise<PermissionKey[]> {
    if (roleIds.length === 0) return [];
    const rows = await this.db
      .selectDistinct({ key: relationTuples.relation })
      .from(relationTuples)
      .innerJoin(roles, and(eq(sql`${roles.id}::text`, relationTuples.subjectId), isActiveRole()))
      .where(and(isRolePermissionTuple(), inArray(relationTuples.subjectId, [...roleIds])));
    return rows.map((row) => row.key as PermissionKey);
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
