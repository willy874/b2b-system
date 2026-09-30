import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNull, like, sql } from 'drizzle-orm';
import type { SQL, SQLWrapper } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB, containsPattern, prefixPattern } from '@/core/database';
import type { PermissionRow, RoleInsert, RoleRow } from '@/db/schema';
import {
  isActiveRole,
  isRoleHolderTuple,
  isRolePermissionTuple,
  permissions,
  relationTuples,
  ROLE_HOLDER_RELATION,
  ROLE_OBJECT_TYPE,
  rolePermissionTuple,
  roles,
  SUPER_ADMIN_RELATION,
  TENANT_OBJECT_ID,
  TENANT_OBJECT_TYPE,
  USER_SUBJECT_TYPE,
  users,
} from '@/db/schema';

import type { ListRoleDto } from './dto/list-role.dto';

export interface RoleWithCounts extends RoleRow {
  permissionCount: number;
  userCount: number;
}

// 子查詢裡的邊以別名 t 表示；條件與 db/schema 的 isRolePermissionTuple()／isRoleHolderTuple() 相同
const permissionCountOf = (roleId: SQLWrapper | string) =>
  sql<number>`(SELECT count(*)::int FROM ${relationTuples} t
    WHERE t.object_type = ${TENANT_OBJECT_TYPE} AND t.object_id = ${TENANT_OBJECT_ID}
      AND t.subject_type = ${ROLE_OBJECT_TYPE} AND t.subject_relation = ${ROLE_HOLDER_RELATION}
      AND t.relation <> ${SUPER_ADMIN_RELATION} AND t.subject_id = ${roleId}::text)`;

// 軟刪除使用者不會清掉持有角色的邊，計數要排除已刪除的使用者（與 listUsers 一致）
const userCountOf = (roleId: SQLWrapper | string) =>
  sql<number>`(SELECT count(*)::int FROM ${relationTuples} t INNER JOIN ${users} u ON u.id::text = t.subject_id
    WHERE t.object_type = ${ROLE_OBJECT_TYPE} AND t.relation = ${ROLE_HOLDER_RELATION}
      AND t.subject_type = ${USER_SUBJECT_TYPE} AND t.subject_relation = ''
      AND t.object_id = ${roleId}::text AND u.deleted_at IS NULL)`;

/** 持有這個角色的邊（`role:<roleId>#holder@user:*`）。 */
const holdersOf = (roleId: string) => and(isRoleHolderTuple(), eq(relationTuples.objectId, roleId));
/** 這個角色帶的權限鍵的邊（`tenant:self#<key>@role:<roleId>#holder`）。 */
const permissionsOf = (roleId: string) =>
  and(isRolePermissionTuple(), eq(relationTuples.subjectId, roleId));

// 單表 select 時 Drizzle 會把 ${roles.id} 輸出成不帶表名的 "id"，在子查詢裡會被解析成 users.id；
// 明確寫出表名才會關聯到外層的角色
const OUTER_ROLE_ID = sql`${roles}.${sql.identifier(roles.id.name)}`;

// 按數量排序時每個符合條件的角色都要先算完子查詢才能排；權限數走 relation_tuples 的主體索引、
// 持有者數走物件索引，角色數量級（數十～數百）下成本可忽略。持有者成長到百萬級再考慮反正規化成計數欄位。
const SORT_COLUMNS = {
  createdAt: roles.createdAt,
  name: roles.name,
  slug: roles.slug,
  permissionCount: permissionCountOf(OUTER_ROLE_ID),
  userCount: userCountOf(OUTER_ROLE_ID),
} as const;

@Injectable()
export class RoleRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  async findById(id: string): Promise<RoleRow | undefined> {
    const [row] = await this.db
      .select()
      .from(roles)
      .where(and(eq(roles.id, id), isActiveRole()))
      .limit(1);
    return row;
  }

  async findBySlug(slug: string): Promise<RoleRow | undefined> {
    const [row] = await this.db
      .select()
      .from(roles)
      .where(and(eq(roles.slug, slug), isActiveRole()))
      .limit(1);
    return row;
  }

  /** 名稱不分大小寫（與唯一索引 `roles_name_key` 的 `lower(name)` 一致）。 */
  async findByName(name: string): Promise<RoleRow | undefined> {
    const [row] = await this.db
      .select()
      .from(roles)
      .where(and(sql`lower(${roles.name}) = lower(${name})`, isActiveRole()))
      .limit(1);
    return row;
  }

  async findSlugsLike(prefix: string): Promise<string[]> {
    const rows = await this.db
      .select({ slug: roles.slug })
      .from(roles)
      .where(and(like(roles.slug, prefixPattern(prefix)), isActiveRole()));
    return rows.map((row) => row.slug);
  }

  async withCounts(id: string): Promise<RoleWithCounts | undefined> {
    const role = await this.findById(id);
    if (!role) return undefined;
    const [counts] = await this.db
      .select({
        permissionCount: permissionCountOf(id),
        userCount: userCountOf(id),
      })
      .from(roles)
      .where(eq(roles.id, id))
      .limit(1);
    return {
      ...role,
      permissionCount: counts?.permissionCount ?? 0,
      userCount: counts?.userCount ?? 0,
    };
  }

  async list(query: ListRoleDto): Promise<{ items: RoleWithCounts[]; total: number }> {
    const conditions: SQL[] = [isActiveRole()];
    if (query.keyword) {
      const pattern = containsPattern(query.keyword);
      conditions.push(sql`(${roles.name} ILIKE ${pattern} OR ${roles.slug} ILIKE ${pattern})`);
    }
    if (query.isSystem !== undefined) conditions.push(eq(roles.isSystem, query.isSystem));
    const where = and(...conditions);
    // 依 sort 陣列的順序排；最後以 id 收尾，讓同值的列在分頁之間順序穩定
    const orderBy = query.sort.map(({ sort, order }) =>
      order === 'asc' ? asc(SORT_COLUMNS[sort]) : desc(SORT_COLUMNS[sort]),
    );

    const [items, [counted]] = await Promise.all([
      this.db
        .select({
          role: roles,
          permissionCount: SORT_COLUMNS.permissionCount,
          userCount: SORT_COLUMNS.userCount,
        })
        .from(roles)
        .where(where)
        .orderBy(...orderBy, desc(roles.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(roles)
        .where(where),
    ]);

    return {
      items: items.map((row) => ({
        ...row.role,
        permissionCount: row.permissionCount,
        userCount: row.userCount,
      })),
      total: counted?.total ?? 0,
    };
  }

  async create(values: RoleInsert, tx?: DbOrTx): Promise<RoleRow> {
    const db = tx ?? this.db;
    const [row] = await db.insert(roles).values(values).returning();
    if (!row) throw new Error('建立角色失敗');
    return row;
  }

  /**
   * 改名稱或說明並遞增樂觀鎖的 `version`（角色自己的欄位只有這兩個會被編輯）。帶 `expectedVersion` 時
   * 只在版本相符、且未刪除時才更新（比對與寫入在同一個 UPDATE）；不符回 undefined。
   */
  async update(
    id: string,
    values: Partial<Pick<RoleInsert, 'name' | 'description' | 'updatedBy'>>,
    expectedVersion?: number,
    tx?: DbOrTx,
  ): Promise<RoleRow | undefined> {
    const db = tx ?? this.db;
    const conditions = [eq(roles.id, id)];
    if (expectedVersion !== undefined) {
      conditions.push(eq(roles.version, expectedVersion), isActiveRole());
    }
    const [row] = await db
      .update(roles)
      .set({ ...values, version: sql`${roles.version} + 1` })
      .where(and(...conditions))
      .returning();
    return row;
  }

  /** 未刪除的角色目前的 `version`；不存在或已刪除回 undefined（樂觀鎖衝突時重讀）。 */
  async findVersion(id: string, tx?: DbOrTx): Promise<number | undefined> {
    const [row] = await (tx ?? this.db)
      .select({ version: roles.version })
      .from(roles)
      .where(and(eq(roles.id, id), isActiveRole()))
      .limit(1);
    return row?.version;
  }

  /** 在交易內以 `FOR UPDATE` 鎖住未刪除的角色列；不存在（或已刪除）時回 false。 */
  async lockActive(id: string, tx: DbOrTx): Promise<boolean> {
    const [row] = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.id, id), isActiveRole()))
      .for('update');
    return Boolean(row);
  }

  /**
   * 軟刪除角色並刪掉「持有這個角色」的邊；回傳原本的持有者（刪除與取得在同一條語句）。
   * 角色帶的權限鍵、以角色為對象的資料夾授權留著：解析時已排除刪除的角色。
   */
  async softDelete(id: string, actorId: string, tx: DbOrTx): Promise<string[]> {
    await tx
      .update(roles)
      .set({ deletedAt: new Date(), updatedBy: actorId })
      .where(eq(roles.id, id));
    const removed = await tx
      .delete(relationTuples)
      .where(holdersOf(id))
      .returning({ userId: relationTuples.subjectId });
    return removed.map((row) => row.userId);
  }

  async listPermissions(roleId: string, db: DbOrTx = this.db): Promise<PermissionRow[]> {
    return db
      .select({
        id: permissions.id,
        key: permissions.key,
        resource: permissions.resource,
        action: permissions.action,
        nameI18nKey: permissions.nameI18nKey,
        description: permissions.description,
        sortOrder: permissions.sortOrder,
        createdAt: permissions.createdAt,
      })
      .from(relationTuples)
      .innerJoin(permissions, eq(permissions.key, relationTuples.relation))
      .where(permissionsOf(roleId))
      .orderBy(asc(permissions.sortOrder));
  }

  async listPermissionKeys(roleId: string, db: DbOrTx = this.db): Promise<string[]> {
    const rows = await this.listPermissions(roleId, db);
    return rows.map((row) => row.key);
  }

  /** 呼叫端先以 `PermissionService.assertKeysExist` 確認鍵都在目錄裡。 */
  async addPermissions(
    roleId: string,
    keys: readonly string[],
    actorId: string | null,
    tx: DbOrTx,
  ): Promise<void> {
    if (!keys.length) return;
    await tx
      .insert(relationTuples)
      .values(keys.map((key) => rolePermissionTuple(roleId, key, actorId)))
      .onConflictDoNothing();
  }

  async removePermissions(roleId: string, keys: readonly string[], tx: DbOrTx): Promise<void> {
    if (!keys.length) return;
    await tx
      .delete(relationTuples)
      .where(and(permissionsOf(roleId), inArray(relationTuples.relation, [...keys])));
  }

  async countUsers(roleId: string, db: DbOrTx = this.db): Promise<number> {
    const [row] = await db
      .select({ total: sql<number>`count(*)::int` })
      .from(relationTuples)
      .innerJoin(
        users,
        and(eq(sql`${users.id}::text`, relationTuples.subjectId), isNull(users.deletedAt)),
      )
      .where(holdersOf(roleId));
    return row?.total ?? 0;
  }

  async listUsers(roleId: string, offset: number, limit: number) {
    const holderOf = and(
      eq(sql`${users.id}::text`, relationTuples.subjectId),
      isNull(users.deletedAt),
    );
    const [items, [counted]] = await Promise.all([
      this.db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          status: users.status,
        })
        .from(relationTuples)
        .innerJoin(users, holderOf)
        .where(holdersOf(roleId))
        .orderBy(asc(users.email))
        .limit(limit)
        .offset(offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(relationTuples)
        .innerJoin(users, holderOf)
        .where(holdersOf(roleId)),
    ]);
    return { items, total: counted?.total ?? 0 };
  }

  async searchByName(keyword: string): Promise<RoleRow[]> {
    return this.db
      .select()
      .from(roles)
      .where(and(ilike(roles.name, prefixPattern(keyword)), isActiveRole()));
  }
}
