import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, ilike, inArray, like, lt, or, sql } from 'drizzle-orm';
import type { SQL, SQLWrapper } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB, containsPattern, prefixPattern } from '@/core/database';
import type { PermissionRow, RoleInsert, RoleRow } from '@/db/schema';
import {
  isActiveRole,
  isDeleted,
  isRoleHolderTuple,
  isRolePermissionTuple,
  notDeleted,
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

/** 回收桶的一列（`listDeleted`）；刪除者取自刪除時寫入的 `updated_by`（刪除之後不再有人更新這一列）。 */
export interface DeletedRoleRow {
  id: string;
  name: string;
  description: string | null;
  deletedAt: Date;
  deletedBy: { id: string; name: string } | null;
}

/** 刪除者：`users` 的別名（刪除者本人也可能已被刪除，仍顯示名字）。 */
const deleter = alias(users, 'deleter');

export interface RoleWithCounts extends RoleRow {
  permissionCount: number;
  userCount: number;
}

/** 匯入匯出的一筆角色：計數加上明確授予的權限鍵（docs/architecture/backend/22-data-transfer.md §12.1）。 */
export interface RoleExportRow extends RoleWithCounts {
  permissionKeys: string[];
}

/** 匯出的範圍：勾選的 id，或列表的篩選條件（去掉分頁與排序）。 */
export type RoleExportScope =
  | { ids: readonly string[] }
  | { filter: Pick<ListRoleDto, 'keyword' | 'isSystem'> };

export interface RoleExportCursor {
  createdAt: Date;
  id: string;
}

// 子查詢裡的邊以別名 t 表示；條件與 db/schema 的 isRolePermissionTuple()／isRoleHolderTuple() 相同
const permissionCountOf = (roleId: SQLWrapper | string) =>
  sql<number>`(SELECT count(*)::int FROM ${relationTuples} t
    WHERE t.object_type = ${TENANT_OBJECT_TYPE} AND t.object_id = ${TENANT_OBJECT_ID}
      AND t.subject_type = ${ROLE_OBJECT_TYPE} AND t.subject_relation = ${ROLE_HOLDER_RELATION}
      AND t.relation <> ${SUPER_ADMIN_RELATION} AND t.subject_id = ${roleId}::text)`;

// 軟刪除使用者不會清掉持有角色的邊，計數要排除已刪除的使用者（與 listUsers 一致）。
// 以角色為起點、不看角色本身是否刪除：刪除的角色保留持有者邊（docs/architecture/backend/14-revisions.md §9.2 D2），呼叫端要先確認角色的狀態
// （列表與 withCounts 只對未刪除的角色計算）
const userCountOf = (roleId: SQLWrapper | string) =>
  sql<number>`(SELECT count(*)::int FROM ${relationTuples} t INNER JOIN ${users} u ON u.id::text = t.subject_id
    WHERE t.object_type = ${ROLE_OBJECT_TYPE} AND t.relation = ${ROLE_HOLDER_RELATION}
      AND t.subject_type = ${USER_SUBJECT_TYPE} AND t.subject_relation = ''
      AND t.object_id = ${roleId}::text AND u.deleted_at IS NULL /* notDeleted */)`;

/**
 * 持有這個角色的邊（`role:<roleId>#holder@user:*`）。**不看角色是否刪除**：刪除的角色保留這些邊
 * （休眠，還原時回來；docs/architecture/backend/14-revisions.md §9.2 D2 ②），以它為起點的查詢由呼叫端先確認角色的狀態。
 */
const holdersOf = (roleId: string) => and(isRoleHolderTuple(), eq(relationTuples.objectId, roleId));
/** 這個角色帶的權限鍵的邊（`tenant:self#<key>@role:<roleId>#holder`）。 */
const permissionsOf = (roleId: string) =>
  and(isRolePermissionTuple(), eq(relationTuples.subjectId, roleId));

/** `countUndeletedUsers` 每批帶多少個 id。 */
const COUNT_BATCH_SIZE = 1000;

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

  // ── 匯入匯出（docs/architecture/backend/22-data-transfer.md §12.1）────────

  /** 依建立時間的 keyset 逐頁讀；權限鍵一頁一次查詢。 */
  async exportPage(
    scope: RoleExportScope,
    after: RoleExportCursor | null,
    limit: number,
  ): Promise<RoleExportRow[]> {
    const rows = await this.db
      .select({
        role: roles,
        permissionCount: SORT_COLUMNS.permissionCount,
        userCount: SORT_COLUMNS.userCount,
      })
      .from(roles)
      .where(
        and(
          this.exportWhere(scope),
          after
            ? sql`(${roles.createdAt}, ${roles.id}) > (${after.createdAt.toISOString()}::timestamptz, ${after.id}::uuid)`
            : undefined,
        ),
      )
      .orderBy(asc(roles.createdAt), asc(roles.id))
      .limit(limit);
    return this.withPermissionKeys(
      rows.map((row) => ({
        ...row.role,
        permissionCount: row.permissionCount,
        userCount: row.userCount,
      })),
    );
  }

  async exportCount(scope: RoleExportScope): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(roles)
      .where(this.exportWhere(scope));
    return row?.total ?? 0;
  }

  /** 匯入的修改模式：以 id 或 slug（不分大小寫）找未刪除的角色。 */
  async findForImport(column: 'id' | 'slug', values: readonly string[]): Promise<RoleExportRow[]> {
    if (!values.length) return [];
    const match =
      column === 'id'
        ? inArray(roles.id, [...values])
        : sql`lower(${roles.slug}) IN ${values.map((value) => value.toLowerCase())}`;
    const rows = await this.db
      .select({
        role: roles,
        permissionCount: SORT_COLUMNS.permissionCount,
        userCount: SORT_COLUMNS.userCount,
      })
      .from(roles)
      .where(and(match, isActiveRole()));
    return this.withPermissionKeys(
      rows.map((row) => ({
        ...row.role,
        permissionCount: row.permissionCount,
        userCount: row.userCount,
      })),
    );
  }

  /** 匯入的新增模式：已經被使用的名稱或 slug（小寫）。 */
  async findTakenValues(column: 'name' | 'slug', values: readonly string[]): Promise<Set<string>> {
    if (!values.length) return new Set();
    const target = column === 'name' ? roles.name : roles.slug;
    const rows = await this.db
      .select({ value: sql<string>`lower(${target})` })
      .from(roles)
      .where(
        and(isActiveRole(), sql`lower(${target}) IN ${values.map((value) => value.toLowerCase())}`),
      );
    return new Set(rows.map((row) => row.value));
  }

  /** 匯入的比對目標與自動完成：名稱或 slug 含關鍵字的角色。 */
  async searchForImport(keyword: string, limit: number): Promise<RoleRow[]> {
    const pattern = containsPattern(keyword);
    return this.db
      .select()
      .from(roles)
      .where(
        and(
          isActiveRole(),
          keyword ? or(ilike(roles.name, pattern), ilike(roles.slug, pattern)) : undefined,
        ),
      )
      .orderBy(asc(roles.name), asc(roles.id))
      .limit(limit);
  }

  private exportWhere(scope: RoleExportScope): SQL | undefined {
    if ('ids' in scope) return and(isActiveRole(), inArray(roles.id, [...scope.ids]));
    const conditions: SQL[] = [isActiveRole()];
    if (scope.filter.keyword) {
      const pattern = containsPattern(scope.filter.keyword);
      conditions.push(sql`(${roles.name} ILIKE ${pattern} OR ${roles.slug} ILIKE ${pattern})`);
    }
    if (scope.filter.isSystem !== undefined) {
      conditions.push(eq(roles.isSystem, scope.filter.isSystem));
    }
    return and(...conditions);
  }

  /** 明確授予的權限鍵，依鍵排序；super-admin 的隱含全集不是權限鍵的邊（`isRolePermissionTuple` 已排除）。 */
  private async withPermissionKeys(rows: RoleWithCounts[]): Promise<RoleExportRow[]> {
    if (!rows.length) return [];
    const edges = await this.db
      .select({ roleId: relationTuples.subjectId, key: relationTuples.relation })
      .from(relationTuples)
      .where(
        and(
          isRolePermissionTuple(),
          inArray(
            relationTuples.subjectId,
            rows.map((row) => row.id),
          ),
        ),
      )
      .orderBy(asc(relationTuples.relation));
    const keys = new Map<string, string[]>();
    for (const edge of edges) {
      keys.set(edge.roleId, [...(keys.get(edge.roleId) ?? []), edge.key]);
    }
    return rows.map((row) => ({ ...row, permissionKeys: keys.get(row.id) ?? [] }));
  }

  async create(values: RoleInsert, tx?: DbOrTx): Promise<RoleRow> {
    const db = tx ?? this.db;
    const [row] = await db.insert(roles).values(values).returning();
    if (!row) throw new Error('建立角色失敗');
    return row;
  }

  /**
   * 改名稱或說明並遞增樂觀鎖的 `version`（角色自己的欄位只有這兩個會被編輯）。只在版本相符、且未刪除時才更新
   * （比對與寫入在同一個 UPDATE）；不符回 undefined。
   */
  async update(
    id: string,
    values: Partial<Pick<RoleInsert, 'name' | 'description' | 'updatedBy'>>,
    expectedVersion: number,
    tx?: DbOrTx,
  ): Promise<RoleRow | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .update(roles)
      .set({ ...values, version: sql`${roles.version} + 1` })
      .where(and(eq(roles.id, id), eq(roles.version, expectedVersion), isActiveRole()))
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

  /**
   * 在交易內以 `FOR UPDATE` 鎖住並讀出未刪除的角色列；不存在（或已刪除）時回 undefined。
   * 版本歷史的快照要讀鎖住之後的名稱與說明（docs/architecture/backend/14-revisions.md §4.1）。
   */
  async lockActiveRow(id: string, tx: DbOrTx): Promise<RoleRow | undefined> {
    const [row] = await tx
      .select()
      .from(roles)
      .where(and(eq(roles.id, id), isActiveRole()))
      .for('update');
    return row;
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
   * 軟刪除角色。持有者邊（`role:<id>#holder@user:*`）、權限鍵的邊、以角色為對象的資料夾授權都 **保留**：
   * 解析與使用者端的讀取已排除刪除的角色，還原時原本的持有者自動回來（docs/architecture/backend/14-revisions.md §9.2 D2）。
   * 關係圖的 revision 由 trigger（migration 0012）在 `deleted_at` 改變時 +1。
   */
  async softDelete(id: string, actorId: string, tx: DbOrTx): Promise<void> {
    await tx
      .update(roles)
      .set({ deletedAt: new Date(), updatedBy: actorId })
      .where(eq(roles.id, id));
  }

  /**
   * 持有這個角色的使用者 id（含已刪除的使用者；只用來推播）。不看角色是否刪除（D2 ②）：
   * 刪除角色時在 `lockActive` 之後、軟刪除之前呼叫。
   */
  async findHolderIds(roleId: string, db: DbOrTx = this.db): Promise<string[]> {
    const rows = await db
      .select({ userId: relationTuples.subjectId })
      .from(relationTuples)
      .where(holdersOf(roleId));
    return rows.map((row) => row.userId);
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

  /**
   * 這些使用者之中未刪除的人數。角色的「會失去／取回權限的人」（`PermissionService.findUserIdsHoldingRole`，
   * 含經由群組持有的）由呼叫端查好傳進來：`ROLE_IN_USE` 的 `userCount` 與還原的 `holdersRestored`。
   * 名單可能很長（大群組），分批計數，每批的 `IN` 清單有上限。
   */
  async countUndeletedUsers(userIds: readonly string[], db: DbOrTx = this.db): Promise<number> {
    let total = 0;
    const unique = [...new Set(userIds)];
    for (let start = 0; start < unique.length; start += COUNT_BATCH_SIZE) {
      // oxlint-disable-next-line no-await-in-loop -- 同一個連線（或交易）上依序計數
      const [row] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(users)
        .where(
          and(inArray(users.id, unique.slice(start, start + COUNT_BATCH_SIZE)), notDeleted(users)),
        );
      total += row?.total ?? 0;
    }
    return total;
  }

  /** 持有者列表。不看角色是否刪除（D2 ②）：呼叫端先以 `findById` 確認角色未刪除。 */
  async listUsers(roleId: string, offset: number, limit: number) {
    const holderOf = and(eq(sql`${users.id}::text`, relationTuples.subjectId), notDeleted(users));
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

  // ── 回收桶與還原（docs/architecture/backend/14-revisions.md §9.2 D2、D5、D9、D11）：這一段故意讀已刪除的列，一律用 isDeleted() ──

  /** 已刪除的角色；不存在或沒有被刪除回 undefined。 */
  async findDeletedById(id: string, tx?: DbOrTx): Promise<RoleRow | undefined> {
    const [row] = await (tx ?? this.db)
      .select()
      .from(roles)
      .where(and(eq(roles.id, id), isDeleted(roles)))
      .limit(1);
    return row;
  }

  /**
   * 清掉 `deleted_at`（只在仍是已刪除時；並行的兩個還原只有一個命中）。保留的持有者邊與權限鍵隨之生效，
   * 關係圖的 revision 由 trigger（migration 0012）+1。`version` 不遞增：與刪除一樣不是可編輯欄位的寫入
   * （docs/architecture/backend/03-api-conventions.md §11）。
   */
  async restore(id: string, actorId: string, tx: DbOrTx): Promise<RoleRow | undefined> {
    const [row] = await tx
      .update(roles)
      .set({ deletedAt: null, updatedBy: actorId })
      .where(and(eq(roles.id, id), isDeleted(roles)))
      .returning();
    return row;
  }

  async listDeleted(query: {
    offset: number;
    limit: number;
    keyword?: string;
  }): Promise<{ items: DeletedRoleRow[]; total: number }> {
    const conditions: SQL[] = [isDeleted(roles)];
    if (query.keyword) {
      const pattern = containsPattern(query.keyword);
      conditions.push(sql`(${roles.name} ILIKE ${pattern} OR ${roles.slug} ILIKE ${pattern})`);
    }
    const where = and(...conditions);
    const [rows, [counted]] = await Promise.all([
      this.db
        .select({
          id: roles.id,
          name: roles.name,
          description: roles.description,
          deletedAt: roles.deletedAt,
          deleterId: deleter.id,
          deleterName: deleter.displayName,
        })
        .from(roles)
        .leftJoin(deleter, eq(deleter.id, roles.updatedBy))
        .where(where)
        .orderBy(desc(roles.deletedAt), desc(roles.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(roles)
        .where(where),
    ]);
    return {
      items: rows.flatMap(({ deleterId, deleterName, deletedAt, ...row }) =>
        deletedAt
          ? [
              {
                ...row,
                deletedAt,
                deletedBy: deleterId && deleterName ? { id: deleterId, name: deleterName } : null,
              },
            ]
          : [],
      ),
      total: counted?.total ?? 0,
    };
  }

  /** 刪除超過保留期限的角色（依 id 的 keyset；docs/architecture/backend/14-revisions.md §9.2 D11）。系統角色刪不掉（trigger），不會出現在這裡。 */
  async findExpired(
    cutoff: Date,
    afterId: string | null,
    limit: number,
  ): Promise<Array<{ id: string; name: string; deletedAt: Date }>> {
    const rows = await this.db
      .select({ id: roles.id, name: roles.name, deletedAt: roles.deletedAt })
      .from(roles)
      .where(
        and(
          isDeleted(roles),
          lt(roles.deletedAt, cutoff),
          afterId ? gt(roles.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(roles.id))
      .limit(limit);
    return rows.flatMap(({ deletedAt, ...row }) => (deletedAt ? [{ ...row, deletedAt }] : []));
  }

  /**
   * 永久刪除一個已刪除的角色（在呼叫端的交易內；docs/architecture/backend/13-trash.md §6.2）。
   * 沒有任何表以外鍵參照 `roles`；關係圖是多型、沒有外鍵，以它為物件（持有者邊 `role:<id>#holder@user:*`）
   * 與為主體（權限鍵 `tenant:self#<key>@role:<id>#holder`、資料夾授權 `fileFolder:<f>#<等級>@role:<id>#holder`）
   * 的邊都要自己刪。回傳是否刪到（已被還原或已不在就是 false）。
   */
  async hardDelete(id: string, tx: DbOrTx): Promise<boolean> {
    const [row] = await tx
      .delete(roles)
      .where(and(eq(roles.id, id), isDeleted(roles)))
      .returning({ id: roles.id });
    if (!row) return false;
    await tx
      .delete(relationTuples)
      .where(
        or(
          and(eq(relationTuples.objectType, ROLE_OBJECT_TYPE), eq(relationTuples.objectId, id)),
          and(eq(relationTuples.subjectType, ROLE_OBJECT_TYPE), eq(relationTuples.subjectId, id)),
        ),
      );
    return true;
  }
}
