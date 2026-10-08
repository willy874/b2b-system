import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { containsPattern, TENANT_DB } from '@/core/database';
import {
  apiTokens,
  isActiveRole,
  isRoleHolderTuple,
  notDeleted,
  relationTuples,
  roleHolderTuple,
  roles,
  users,
} from '@/db/schema';
import type { RoleRow, UserInsert, UserRow } from '@/db/schema';

import type { ListServiceAccountDto } from './dto/service-account.dto';

export interface ServiceAccountRoleSummary {
  id: string;
  slug: string;
  name: string;
  isSystem: boolean;
}

export interface ServiceAccountRow extends UserRow {
  roles: ServiceAccountRoleSummary[];
  activeTokenCount: number;
}

const ROLE_AGGREGATE = sql<ServiceAccountRoleSummary[]>`
  COALESCE(
    json_agg(
      json_build_object('id', ${roles.id}, 'slug', ${roles.slug}, 'name', ${roles.name}, 'isSystem', ${roles.isSystem})
      ORDER BY ${roles.slug}
    ) FILTER (WHERE ${roles.id} IS NOT NULL),
    '[]'
  )`;

/** 仍有效的 token 數：未撤銷、未過期、建立後帳號的 `token_version` 沒變（docs/architecture/06-external-api.md §9.2 D5）。 */
const ACTIVE_TOKEN_COUNT = sql<number>`(
  SELECT count(*)::int FROM ${apiTokens} t
  WHERE t.user_id = ${users.id} AND t.revoked_at IS NULL AND t.expires_at > now()
    AND t.account_version = ${users.tokenVersion}
)`;

/** 匯出的範圍（docs/architecture/backend/22-data-transfer.md §12.6）：勾選的 id，或列表的篩選條件。 */
export type ServiceAccountExportScope =
  | { ids: readonly string[] }
  | { filter: Pick<ListServiceAccountDto, 'keyword'> };

export interface ServiceAccountExportCursor {
  createdAt: Date;
  id: string;
}

interface JoinedRow {
  account: UserRow;
  roles: ServiceAccountRoleSummary[];
  activeTokenCount: number;
}

function toRow({ account, roles: held, activeTokenCount }: JoinedRow): ServiceAccountRow {
  return Object.assign(account, { roles: held, activeTokenCount });
}

/** 帳號 ⋈ 持有角色的邊（`role:<r>#holder@user:<users.id>`）。 */
const HELD_BY_ACCOUNT = and(
  isRoleHolderTuple(),
  eq(relationTuples.subjectId, sql`${users.id}::text`),
);
/** 邊 ⋈ 未刪除的角色。 */
const HELD_ROLE = and(eq(sql`${roles.id}::text`, relationTuples.objectId), isActiveRole());

const SORT_COLUMNS = { createdAt: users.createdAt, name: users.displayName } as const;

function isServiceAccount(): SQL {
  return eq(users.kind, 'service');
}

function heldBy(accountId: string): SQL | undefined {
  return and(isRoleHolderTuple(), eq(relationTuples.subjectId, accountId));
}

/**
 * 服務帳號（`users.kind = 'service'`，docs/architecture/06-external-api.md §9.2 D1）的查詢。
 * 它就是 `users` 的一列：角色的邊、權限快取、稽核的 `actor_id` 都與人共用。
 */
@Injectable()
export class ServiceAccountRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  async list(query: ListServiceAccountDto): Promise<{ items: ServiceAccountRow[]; total: number }> {
    const conditions: SQL[] = [notDeleted(users), isServiceAccount()];
    if (query.keyword) conditions.push(ilike(users.displayName, containsPattern(query.keyword)));
    const where = and(...conditions);
    const orderBy = query.sort.map(({ sort, order }) =>
      order === 'asc' ? asc(SORT_COLUMNS[sort]) : desc(SORT_COLUMNS[sort]),
    );
    const [rows, [counted]] = await Promise.all([
      this.db
        .select({ account: users, roles: ROLE_AGGREGATE, activeTokenCount: ACTIVE_TOKEN_COUNT })
        .from(users)
        .leftJoin(relationTuples, HELD_BY_ACCOUNT)
        .leftJoin(roles, HELD_ROLE)
        .where(where)
        .groupBy(users.id)
        .orderBy(...orderBy, desc(users.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(users)
        .where(where),
    ]);
    return {
      items: rows.map(toRow),
      total: counted?.total ?? 0,
    };
  }

  /** 匯出：依建立時間的 keyset 逐頁讀。token 本身（含前綴）不匯出，只有有效的 token 數。 */
  async exportPage(
    scope: ServiceAccountExportScope,
    after: ServiceAccountExportCursor | null,
    limit: number,
  ): Promise<ServiceAccountRow[]> {
    const rows = await this.db
      .select({ account: users, roles: ROLE_AGGREGATE, activeTokenCount: ACTIVE_TOKEN_COUNT })
      .from(users)
      .leftJoin(relationTuples, HELD_BY_ACCOUNT)
      .leftJoin(roles, HELD_ROLE)
      .where(
        and(
          this.exportWhere(scope),
          after
            ? sql`(${users.createdAt}, ${users.id}) > (${after.createdAt.toISOString()}::timestamptz, ${after.id}::uuid)`
            : undefined,
        ),
      )
      .groupBy(users.id)
      .orderBy(asc(users.createdAt), asc(users.id))
      .limit(limit);
    return rows.map(toRow);
  }

  async exportCount(scope: ServiceAccountExportScope): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`count(*)::int` })
      .from(users)
      .where(this.exportWhere(scope));
    return row?.total ?? 0;
  }

  private exportWhere(scope: ServiceAccountExportScope): SQL | undefined {
    const conditions: SQL[] = [notDeleted(users), isServiceAccount()];
    if ('ids' in scope) conditions.push(inArray(users.id, [...scope.ids]));
    else if (scope.filter.keyword) {
      conditions.push(ilike(users.displayName, containsPattern(scope.filter.keyword)));
    }
    return and(...conditions);
  }

  async findById(id: string, tx?: DbOrTx): Promise<ServiceAccountRow | undefined> {
    const [row] = await (tx ?? this.db)
      .select({ account: users, roles: ROLE_AGGREGATE, activeTokenCount: ACTIVE_TOKEN_COUNT })
      .from(users)
      .leftJoin(relationTuples, HELD_BY_ACCOUNT)
      .leftJoin(roles, HELD_ROLE)
      .where(and(eq(users.id, id), notDeleted(users), isServiceAccount()))
      .groupBy(users.id)
      .limit(1);
    return row ? toRow(row) : undefined;
  }

  async create(values: UserInsert, tx: DbOrTx): Promise<UserRow> {
    const [row] = await tx
      .insert(users)
      .values({ ...values, kind: 'service' })
      .returning();
    if (!row) throw new Error('建立服務帳號失敗');
    return row;
  }

  /**
   * 版本相符、未刪除時才更新，並遞增 `version`（樂觀鎖，docs/architecture/backend/14-revisions.md §9.2 D3）；停用時一併遞增 `token_version`，
   * 讓它所有的 token 失效（D5）。不符回 undefined。
   */
  async update(
    id: string,
    values: Partial<Pick<UserInsert, 'displayName' | 'status' | 'updatedBy'>>,
    expectedVersion: number,
    revokeTokens: boolean,
    tx: DbOrTx,
  ): Promise<UserRow | undefined> {
    const [row] = await tx
      .update(users)
      .set({
        ...values,
        updatedAt: new Date(),
        version: sql`${users.version} + 1`,
        ...(revokeTokens ? { tokenVersion: sql`${users.tokenVersion} + 1` } : {}),
      })
      .where(
        and(
          eq(users.id, id),
          eq(users.version, expectedVersion),
          notDeleted(users),
          isServiceAccount(),
        ),
      )
      .returning();
    return row;
  }

  /** 未刪除的服務帳號目前的 `version`；不存在或已刪除回 undefined（樂觀鎖沒命中時重讀）。 */
  async findVersion(id: string, tx: DbOrTx): Promise<number | undefined> {
    const [row] = await tx
      .select({ version: users.version })
      .from(users)
      .where(and(eq(users.id, id), notDeleted(users), isServiceAccount()))
      .limit(1);
    return row?.version;
  }

  /** 軟刪除並遞增 `token_version`：它的 token 全部失效。 */
  async softDelete(id: string, actorId: string, tx: DbOrTx): Promise<void> {
    await tx
      .update(users)
      .set({
        deletedAt: new Date(),
        updatedBy: actorId,
        tokenVersion: sql`${users.tokenVersion} + 1`,
      })
      .where(and(eq(users.id, id), isServiceAccount()));
  }

  /** 鎖住帳號列直到交易結束（整批取代角色時序列化同一個帳號的並行修改）。 */
  async lockForUpdate(id: string, tx: DbOrTx): Promise<void> {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, id)).for('update');
  }

  async listRoles(id: string, tx?: DbOrTx): Promise<ServiceAccountRoleSummary[]> {
    return (tx ?? this.db)
      .select({ id: roles.id, slug: roles.slug, name: roles.name, isSystem: roles.isSystem })
      .from(relationTuples)
      .innerJoin(roles, HELD_ROLE)
      .where(heldBy(id))
      .orderBy(asc(roles.slug));
  }

  async findActiveRolesByIds(roleIds: readonly string[]): Promise<RoleRow[]> {
    if (!roleIds.length) return [];
    return this.db
      .select()
      .from(roles)
      .where(and(inArray(roles.id, [...roleIds]), isActiveRole()));
  }

  /**
   * 整批取代持有的角色。與使用者相同：只刪 **未刪除角色** 的邊（已刪除角色的邊休眠，角色還原時一起回來，
   * docs/architecture/backend/14-revisions.md §9.2 D2）；插入時以 `FOR SHARE` 鎖住角色列，不會留下指向剛被刪除的角色的邊。
   */
  async replaceRoles(
    id: string,
    roleIds: readonly string[],
    actorId: string,
    tx: DbOrTx,
  ): Promise<void> {
    const activeRoleIds = tx
      .select({ id: sql`${roles.id}::text` })
      .from(roles)
      .where(isActiveRole());
    await tx
      .delete(relationTuples)
      .where(and(heldBy(id), inArray(relationTuples.objectId, activeRoleIds)));
    await this.assignRoles(id, roleIds, actorId, tx);
  }

  async assignRoles(
    id: string,
    roleIds: readonly string[],
    actorId: string,
    tx: DbOrTx,
  ): Promise<void> {
    if (!roleIds.length) return;
    const active = await tx
      .select({ id: roles.id })
      .from(roles)
      .where(and(inArray(roles.id, [...new Set(roleIds)]), isActiveRole()))
      .for('share');
    if (!active.length) return;
    await tx
      .insert(relationTuples)
      .values(active.map(({ id: roleId }) => roleHolderTuple(roleId, id, actorId)))
      .onConflictDoNothing();
  }

  /** 帳號（未刪除）是否持有某個（未刪除的）角色；直接查 DB，不經權限快取。 */
  async hasRoleSlug(id: string, slug: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: relationTuples.subjectId })
      .from(relationTuples)
      .innerJoin(roles, HELD_ROLE)
      .where(and(heldBy(id), eq(roles.slug, slug)))
      .limit(1);
    return row !== undefined;
  }
}
