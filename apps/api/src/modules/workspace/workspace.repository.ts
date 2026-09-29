import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { WorkspaceScope } from '@/common/types';
import type { Database, DbOrTx } from '@/core/database';
import { DRIZZLE } from '@/core/database';
import type { WorkspaceInsert, WorkspaceRow } from '@/db/schema';
import {
  permissions,
  rolePermissions,
  roles,
  users,
  workspaceMemberRoles,
  workspaceMembers,
  workspaces,
} from '@/db/schema';
import type { PermissionKey } from '@/db/seeds/permissions';

import type { ListWorkspaceDto, ListWorkspaceMemberDto } from './dto/workspace.dto';

/** 角色摘要（與使用者清單的 `RoleSummary` 同形）。 */
export interface RoleSummaryRow {
  id: string;
  slug: string;
  name: string;
  isSystem: boolean;
}

export interface WorkspaceWithCount extends WorkspaceRow {
  memberCount: number;
}

export interface MemberRow {
  id: string;
  email: string;
  displayName: string;
  status: 'pending' | 'active' | 'inactive' | 'locked';
  joinedAt: Date;
  roles: RoleSummaryRow[];
}

const WORKSPACE_SORT_COLUMNS = {
  createdAt: workspaces.createdAt,
  name: workspaces.name,
  slug: workspaces.slug,
} as const;

const MEMBER_SORT_COLUMNS = {
  joinedAt: workspaceMembers.joinedAt,
  email: users.email,
  displayName: users.displayName,
} as const;

// 單表 select 時 Drizzle 會把 ${workspaces.id} 輸出成不帶表名的 "id"，在子查詢裡會被解析成 users.id；
// 明確寫出表名才會關聯到外層的工作區（同 role.repository.ts 的 OUTER_ROLE_ID）
const OUTER_WORKSPACE_ID = sql`${workspaces}.${sql.identifier(workspaces.id.name)}`;

/** 成員數：只算未刪除的使用者。 */
const MEMBER_COUNT = sql<number>`(
  SELECT count(*)::int FROM ${workspaceMembers} m
  JOIN ${users} u ON u.id = m.user_id AND u.deleted_at IS NULL
  WHERE m.workspace_id = ${OUTER_WORKSPACE_ID}
)`;

const ROLE_AGGREGATE = sql<RoleSummaryRow[]>`
  COALESCE(
    json_agg(
      json_build_object('id', ${roles.id}, 'slug', ${roles.slug}, 'name', ${roles.name}, 'isSystem', ${roles.isSystem})
      ORDER BY ${roles.slug}
    ) FILTER (WHERE ${roles.id} IS NOT NULL),
    '[]'
  )`;

/** LIKE 的萬用字元當成一般字元比對。 */
function escapeLike(value: string): string {
  return value.replaceAll(/[\\%_]/g, (char) => `\\${char}`);
}

@Injectable()
export class WorkspaceRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  // ── 工作區 ─────────────────────────────────────────────────

  async list(query: ListWorkspaceDto): Promise<{ items: WorkspaceWithCount[]; total: number }> {
    const conditions: SQL[] = [isNull(workspaces.deletedAt)];
    if (query.keyword) {
      const pattern = `%${escapeLike(query.keyword)}%`;
      const matched = or(ilike(workspaces.name, pattern), ilike(workspaces.slug, pattern));
      if (matched) conditions.push(matched);
    }
    const where = and(...conditions);
    const orderBy = query.sort.map(({ sort, order }) =>
      order === 'asc' ? asc(WORKSPACE_SORT_COLUMNS[sort]) : desc(WORKSPACE_SORT_COLUMNS[sort]),
    );
    const [items, total] = await Promise.all([
      this.db
        .select({ workspace: workspaces, memberCount: MEMBER_COUNT })
        .from(workspaces)
        .where(where)
        .orderBy(...orderBy, desc(workspaces.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db.$count(workspaces, where),
    ]);
    return {
      items: items.map((row) => ({ ...row.workspace, memberCount: row.memberCount })),
      total,
    };
  }

  async findById(id: string, tx?: DbOrTx): Promise<WorkspaceWithCount | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .select({ workspace: workspaces, memberCount: MEMBER_COUNT })
      .from(workspaces)
      .where(and(eq(workspaces.id, id), isNull(workspaces.deletedAt)))
      .limit(1);
    return row && { ...row.workspace, memberCount: row.memberCount };
  }

  async findBySlug(slug: string, tx?: DbOrTx): Promise<WorkspaceRow | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.slug, slug), isNull(workspaces.deletedAt)))
      .limit(1);
    return row;
  }

  /** 以 `base` 開頭的 slug（產生不重複的 slug 用）。 */
  async findSlugsLike(base: string): Promise<string[]> {
    const rows = await this.db
      .select({ slug: workspaces.slug })
      .from(workspaces)
      .where(
        and(sql`${workspaces.slug} LIKE ${`${escapeLike(base)}%`}`, isNull(workspaces.deletedAt)),
      );
    return rows.map((row) => row.slug);
  }

  async create(values: WorkspaceInsert, tx: DbOrTx): Promise<WorkspaceRow> {
    const [row] = await tx.insert(workspaces).values(values).returning();
    if (!row) throw new Error('建立工作區失敗');
    return row;
  }

  async update(
    id: string,
    values: Partial<Pick<WorkspaceInsert, 'name' | 'description' | 'updatedBy'>>,
    tx: DbOrTx,
  ): Promise<WorkspaceRow | undefined> {
    const [row] = await tx
      .update(workspaces)
      .set(values)
      .where(and(eq(workspaces.id, id), isNull(workspaces.deletedAt)))
      .returning();
    return row;
  }

  async softDelete(id: string, actorId: string, tx: DbOrTx): Promise<WorkspaceRow | undefined> {
    const [row] = await tx
      .update(workspaces)
      .set({ deletedAt: new Date(), updatedBy: actorId })
      .where(and(eq(workspaces.id, id), isNull(workspaces.deletedAt)))
      .returning();
    return row;
  }

  /** 使用者能進入的工作區：成員的；`all` 時是全部（super-admin，D5）。 */
  async listEnterable(
    userId: string,
    all: boolean,
  ): Promise<(WorkspaceRow & { isMember: boolean; lastAccessedAt: Date | null })[]> {
    const rows = await this.db
      .select({
        workspace: workspaces,
        memberId: workspaceMembers.userId,
        lastAccessedAt: workspaceMembers.lastAccessedAt,
      })
      .from(workspaces)
      .leftJoin(
        workspaceMembers,
        and(eq(workspaceMembers.workspaceId, workspaces.id), eq(workspaceMembers.userId, userId)),
      )
      .where(
        and(isNull(workspaces.deletedAt), all ? undefined : isNotNull(workspaceMembers.userId)),
      )
      .orderBy(asc(workspaces.name), asc(workspaces.id));
    return rows.map((row) => ({
      ...row.workspace,
      isMember: row.memberId !== null,
      lastAccessedAt: row.lastAccessedAt,
    }));
  }

  // ── 成員 ───────────────────────────────────────────────────

  async listMembers(
    ws: WorkspaceScope,
    query: ListWorkspaceMemberDto,
  ): Promise<{ items: MemberRow[]; total: number }> {
    const conditions: SQL[] = [
      eq(workspaceMembers.workspaceId, ws.workspaceId),
      isNull(users.deletedAt),
    ];
    if (query.keyword) {
      const pattern = `%${escapeLike(query.keyword)}%`;
      const matched = or(ilike(users.email, pattern), ilike(users.displayName, pattern));
      if (matched) conditions.push(matched);
    }
    if (query.roleId) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM ${workspaceMemberRoles} r WHERE r.workspace_id = ${workspaceMembers.workspaceId} AND r.user_id = ${workspaceMembers.userId} AND r.role_id = ${query.roleId})`,
      );
    }
    const where = and(...conditions);
    const orderBy = query.sort.map(({ sort, order }) =>
      order === 'asc' ? asc(MEMBER_SORT_COLUMNS[sort]) : desc(MEMBER_SORT_COLUMNS[sort]),
    );

    const [rows, [counted]] = await Promise.all([
      this.db
        .select({
          id: users.id,
          email: users.email,
          displayName: users.displayName,
          status: users.status,
          joinedAt: workspaceMembers.joinedAt,
          roles: ROLE_AGGREGATE,
        })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .leftJoin(
          workspaceMemberRoles,
          and(
            eq(workspaceMemberRoles.workspaceId, workspaceMembers.workspaceId),
            eq(workspaceMemberRoles.userId, workspaceMembers.userId),
          ),
        )
        .leftJoin(roles, and(eq(roles.id, workspaceMemberRoles.roleId), isNull(roles.deletedAt)))
        .where(where)
        .groupBy(users.id, workspaceMembers.joinedAt)
        .orderBy(...orderBy, desc(users.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(where),
    ]);
    return { items: rows, total: counted?.total ?? 0 };
  }

  /** 成員（未刪除的使用者）；不是成員回 undefined。 */
  async findMember(
    ws: WorkspaceScope,
    userId: string,
    tx?: DbOrTx,
  ): Promise<{ id: string; email: string; displayName: string } | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .select({ id: users.id, email: users.email, displayName: users.displayName })
      .from(workspaceMembers)
      .innerJoin(users, and(eq(users.id, workspaceMembers.userId), isNull(users.deletedAt)))
      .where(
        and(eq(workspaceMembers.workspaceId, ws.workspaceId), eq(workspaceMembers.userId, userId)),
      )
      .limit(1);
    return row;
  }

  /** 加入成員（已是成員則不動）；回傳是否新加入。 */
  async addMember(
    ws: WorkspaceScope,
    userId: string,
    addedBy: string | null,
    tx: DbOrTx,
  ): Promise<boolean> {
    const rows = await tx
      .insert(workspaceMembers)
      .values({ workspaceId: ws.workspaceId, userId, addedBy })
      .onConflictDoNothing()
      .returning({ userId: workspaceMembers.userId });
    return rows.length > 0;
  }

  /** 移除成員；工作區角色以外鍵 cascade 一起刪除。 */
  async removeMember(ws: WorkspaceScope, userId: string, tx: DbOrTx): Promise<boolean> {
    const rows = await tx
      .delete(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, ws.workspaceId), eq(workspaceMembers.userId, userId)),
      )
      .returning({ userId: workspaceMembers.userId });
    return rows.length > 0;
  }

  async touchLastAccessed(ws: WorkspaceScope, userId: string): Promise<void> {
    await this.db
      .update(workspaceMembers)
      .set({ lastAccessedAt: new Date() })
      .where(
        and(eq(workspaceMembers.workspaceId, ws.workspaceId), eq(workspaceMembers.userId, userId)),
      );
  }

  // ── 成員的工作區角色 ─────────────────────────────────────────

  async listMemberRoles(
    ws: WorkspaceScope,
    userId: string,
    tx?: DbOrTx,
  ): Promise<RoleSummaryRow[]> {
    const db = tx ?? this.db;
    return db
      .select({ id: roles.id, slug: roles.slug, name: roles.name, isSystem: roles.isSystem })
      .from(workspaceMemberRoles)
      .innerJoin(roles, and(eq(roles.id, workspaceMemberRoles.roleId), isNull(roles.deletedAt)))
      .where(
        and(
          eq(workspaceMemberRoles.workspaceId, ws.workspaceId),
          eq(workspaceMemberRoles.userId, userId),
        ),
      )
      .orderBy(asc(roles.slug));
  }

  /** 整批取代語意。 */
  async replaceMemberRoles(
    ws: WorkspaceScope,
    userId: string,
    roleIds: readonly string[],
    grantedBy: string | null,
    tx: DbOrTx,
  ): Promise<void> {
    await tx
      .delete(workspaceMemberRoles)
      .where(
        and(
          eq(workspaceMemberRoles.workspaceId, ws.workspaceId),
          eq(workspaceMemberRoles.userId, userId),
        ),
      );
    if (roleIds.length === 0) return;
    await tx.insert(workspaceMemberRoles).values(
      [...new Set(roleIds)].map((roleId) => ({
        workspaceId: ws.workspaceId,
        userId,
        roleId,
        grantedBy,
      })),
    );
  }

  async addMemberRole(
    ws: WorkspaceScope,
    userId: string,
    roleId: string,
    grantedBy: string | null,
    tx: DbOrTx,
  ): Promise<void> {
    await tx
      .insert(workspaceMemberRoles)
      .values({ workspaceId: ws.workspaceId, userId, roleId, grantedBy })
      .onConflictDoNothing();
  }

  /**
   * 持有這個權限鍵的成員（未刪除的使用者）：「至少要有一位能管理成員的人」（D12），
   * 以及平台管理員看得到的管理員清單。
   */
  async findMembersWithPermission(
    ws: WorkspaceScope,
    key: PermissionKey,
    tx?: DbOrTx,
  ): Promise<{ id: string; email: string; displayName: string }[]> {
    const db = tx ?? this.db;
    return db
      .selectDistinct({ id: users.id, email: users.email, displayName: users.displayName })
      .from(workspaceMemberRoles)
      .innerJoin(users, and(eq(users.id, workspaceMemberRoles.userId), isNull(users.deletedAt)))
      .innerJoin(roles, and(eq(roles.id, workspaceMemberRoles.roleId), isNull(roles.deletedAt)))
      .innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .innerJoin(
        permissions,
        and(eq(permissions.id, rolePermissions.permissionId), eq(permissions.key, key)),
      )
      .where(eq(workspaceMemberRoles.workspaceId, ws.workspaceId))
      .orderBy(asc(users.displayName));
  }

  /** 工作區的所有成員 id（工作區刪除、改名時通知與失效快取）。 */
  async findMemberIds(ws: WorkspaceScope, tx?: DbOrTx): Promise<string[]> {
    const db = tx ?? this.db;
    const rows = await db
      .select({ id: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, ws.workspaceId));
    return rows.map((row) => row.id);
  }

  // ── 工作區角色 ───────────────────────────────────────────────

  /** 所有工作區範圍的角色與它們的權限鍵（指派用的清單）。 */
  async listWorkspaceRoles(): Promise<
    {
      id: string;
      slug: string;
      name: string;
      description: string | null;
      isSystem: boolean;
      permissions: PermissionKey[];
    }[]
  > {
    return this.db
      .select({
        id: roles.id,
        slug: roles.slug,
        name: roles.name,
        description: roles.description,
        isSystem: roles.isSystem,
        permissions: sql<PermissionKey[]>`COALESCE(
          array_agg(${permissions.key} ORDER BY ${permissions.sortOrder}) FILTER (WHERE ${permissions.key} IS NOT NULL),
          '{}'
        )`,
      })
      .from(roles)
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(and(eq(roles.scope, 'workspace'), isNull(roles.deletedAt)))
      .groupBy(roles.id)
      .orderBy(desc(roles.isSystem), asc(roles.name));
  }

  async findRoleBySlug(slug: string, tx?: DbOrTx): Promise<{ id: string } | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .select({ id: roles.id })
      .from(roles)
      .where(and(eq(roles.slug, slug), isNull(roles.deletedAt)))
      .limit(1);
    return row;
  }

  // ── 使用者 ───────────────────────────────────────────────────

  /** 未刪除的使用者（指定管理員、加入成員時）。 */
  async findUsers(ids: readonly string[], tx?: DbOrTx): Promise<{ id: string; email: string }[]> {
    if (ids.length === 0) return [];
    const db = tx ?? this.db;
    return db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(inArray(users.id, [...ids]), isNull(users.deletedAt)));
  }
}
