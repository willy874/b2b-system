import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, gt, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { DRIZZLE } from '@/core/database';
import type {
  GrantLevel,
  GrantSubjectType,
  ResourceGrantInsert,
  ResourceGrantRow,
  ResourceType,
} from '@/db/schema';
import {
  EVERYONE_SUBJECT_ID,
  resourceGrants,
  roles,
  users,
  workspaceMemberRoles,
  workspaceMembers,
} from '@/db/schema';

/** 一筆授權的識別：資源 × 對象。 */
export interface GrantKey {
  resourceType: ResourceType;
  resourceId: string;
  subjectType: GrantSubjectType;
  subjectId: string;
}

/** 授權清單的一列：附上對象的顯示名稱。 */
export interface GrantWithSubject extends ResourceGrantRow {
  subjectName: string;
}

export interface GrantSubjectRow {
  subjectType: GrantSubjectType;
  id: string;
  name: string;
  /** 角色是 slug、使用者是 username：同名時用來分辨。 */
  hint: string | null;
}

/** LIKE 的萬用字元當成一般字元比對。 */
function escapeLike(value: string): string {
  return value.replaceAll(/[\\%_]/g, (char) => `\\${char}`);
}

/** 未過期：`expires_at` 為 null 或晚於 `now`。 */
function active(now: Date): SQL | undefined {
  return or(isNull(resourceGrants.expiresAt), gt(resourceGrants.expiresAt, now));
}

/**
 * 對象必須還存在（未刪除）：`subject_id` 沒有外鍵，刪除角色或使用者不清授權列，
 * 在這裡把它們濾掉（docs/rbac/07-resource-grants.md §3.1）。
 */
const LIVE_SUBJECT = sql`(
  ${resourceGrants.subjectType} = 'everyone'
  OR (${resourceGrants.subjectType} = 'role' AND EXISTS (
    SELECT 1 FROM ${roles} WHERE ${roles.id} = ${resourceGrants.subjectId} AND ${roles.deletedAt} IS NULL))
  OR (${resourceGrants.subjectType} = 'user' AND EXISTS (
    SELECT 1 FROM ${users} WHERE ${users.id} = ${resourceGrants.subjectId} AND ${users.deletedAt} IS NULL))
)`;

@Injectable()
export class ResourceGrantRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * 使用者在這個工作區持有的工作區角色（未刪除）。資源都在某個工作區裡，
   * 授權對象的角色是工作區角色（docs/adr/0018-workspace-tenancy.md D7）。
   */
  async findRoleIdsOfMember(userId: string, workspaceId: string, tx?: DbOrTx): Promise<string[]> {
    const db = tx ?? this.db;
    const rows = await db
      .select({ id: workspaceMemberRoles.roleId })
      .from(workspaceMemberRoles)
      .innerJoin(roles, and(eq(roles.id, workspaceMemberRoles.roleId), isNull(roles.deletedAt)))
      .where(
        and(
          eq(workspaceMemberRoles.userId, userId),
          eq(workspaceMemberRoles.workspaceId, workspaceId),
        ),
      );
    return rows.map((row) => row.id);
  }

  /** 這些對象在這幾種資源上所有未過期的授權。 */
  async findActiveForSubjects(
    resourceTypes: readonly ResourceType[],
    subjects: { userId: string; roleIds: readonly string[] },
    now: Date,
    tx?: DbOrTx,
  ): Promise<Pick<ResourceGrantRow, 'resourceId' | 'level'>[]> {
    const db = tx ?? this.db;
    const bySubject = or(
      and(eq(resourceGrants.subjectType, 'user'), eq(resourceGrants.subjectId, subjects.userId)),
      subjects.roleIds.length > 0
        ? and(
            eq(resourceGrants.subjectType, 'role'),
            inArray(resourceGrants.subjectId, [...subjects.roleIds]),
          )
        : undefined,
      // 所有人：呼叫端已經過閘門（能進檔案管理器）
      eq(resourceGrants.subjectType, 'everyone'),
    );
    return db
      .select({ resourceId: resourceGrants.resourceId, level: resourceGrants.level })
      .from(resourceGrants)
      .where(and(inArray(resourceGrants.resourceType, [...resourceTypes]), bySubject, active(now)));
  }

  /** 這些資源上的授權（含已過期的，清單上要顯示），對象已刪除的不列。 */
  async listOnResources(
    resourceType: ResourceType,
    resourceIds: readonly string[],
    tx?: DbOrTx,
  ): Promise<GrantWithSubject[]> {
    if (resourceIds.length === 0) return [];
    const db = tx ?? this.db;
    const rows = await db
      .select({
        grant: resourceGrants,
        roleName: roles.name,
        userName: users.displayName,
      })
      .from(resourceGrants)
      .leftJoin(
        roles,
        and(
          eq(resourceGrants.subjectType, 'role'),
          eq(roles.id, resourceGrants.subjectId),
          isNull(roles.deletedAt),
        ),
      )
      .leftJoin(
        users,
        and(
          eq(resourceGrants.subjectType, 'user'),
          eq(users.id, resourceGrants.subjectId),
          isNull(users.deletedAt),
        ),
      )
      .where(
        and(
          eq(resourceGrants.resourceType, resourceType),
          inArray(resourceGrants.resourceId, [...resourceIds]),
        ),
      )
      .orderBy(asc(resourceGrants.grantedAt), asc(resourceGrants.id));
    return rows.flatMap(({ grant, roleName, userName }) => {
      // `everyone` 沒有名稱可 join：前端以語系顯示「所有人」
      const subjectName =
        grant.subjectType === 'everyone' ? '' : grant.subjectType === 'role' ? roleName : userName;
      return subjectName === null ? [] : [{ ...grant, subjectName }];
    });
  }

  async findOne(key: GrantKey, tx?: DbOrTx): Promise<ResourceGrantRow | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .select()
      .from(resourceGrants)
      .where(and(...keyConditions(key), LIVE_SUBJECT))
      .limit(1);
    return row;
  }

  /** 新增或覆寫（同一對象在同一資源只有一筆）。 */
  async upsert(
    values: GrantKey & { level: GrantLevel; expiresAt: Date | null; grantedBy: string | null },
    tx?: DbOrTx,
  ): Promise<ResourceGrantRow> {
    const db = tx ?? this.db;
    const [row] = await db
      .insert(resourceGrants)
      .values(values)
      .onConflictDoUpdate({
        target: [
          resourceGrants.resourceType,
          resourceGrants.resourceId,
          resourceGrants.subjectType,
          resourceGrants.subjectId,
        ],
        set: {
          level: values.level,
          expiresAt: values.expiresAt,
          grantedBy: values.grantedBy,
          grantedAt: new Date(),
        },
      })
      .returning();
    if (!row) throw new Error('寫入授權失敗');
    return row;
  }

  /** 一次寫入多筆；已存在的對象略過（中斷繼承時複製授權用）。 */
  async insertMissing(values: ResourceGrantInsert[], tx?: DbOrTx): Promise<ResourceGrantRow[]> {
    if (values.length === 0) return [];
    const db = tx ?? this.db;
    return db.insert(resourceGrants).values(values).onConflictDoNothing().returning();
  }

  async delete(key: GrantKey, tx?: DbOrTx): Promise<ResourceGrantRow | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .delete(resourceGrants)
      .where(and(...keyConditions(key)))
      .returning();
    return row;
  }

  /**
   * 對象存在（未刪除），而且屬於這個工作區：角色必須是工作區角色、使用者必須是成員
   * （docs/adr/0018-workspace-tenancy.md D7）。
   */
  async subjectExists(
    subjectType: GrantSubjectType,
    id: string,
    workspaceId: string,
    tx?: DbOrTx,
  ): Promise<boolean> {
    if (subjectType === 'everyone') return id === EVERYONE_SUBJECT_ID;
    const db = tx ?? this.db;
    if (subjectType === 'role') {
      const [row] = await db
        .select({ one: sql<number>`1` })
        .from(roles)
        .where(and(eq(roles.id, id), eq(roles.scope, 'workspace'), isNull(roles.deletedAt)))
        .limit(1);
      return Boolean(row);
    }
    const [row] = await db
      .select({ one: sql<number>`1` })
      .from(workspaceMembers)
      .innerJoin(users, and(eq(users.id, workspaceMembers.userId), isNull(users.deletedAt)))
      .where(and(eq(workspaceMembers.userId, id), eq(workspaceMembers.workspaceId, workspaceId)))
      .limit(1);
    return Boolean(row);
  }

  /**
   * 授權對象的候選：名稱（角色）或顯示名稱／帳號（使用者）部分比對。
   * 只列這個工作區用得上的：工作區角色、工作區的成員。
   */
  async searchSubjects(
    subjectType: GrantSubjectType,
    keyword: string | undefined,
    limit: number,
    workspaceId: string,
  ): Promise<GrantSubjectRow[]> {
    const pattern = keyword ? `%${escapeLike(keyword)}%` : undefined;
    if (subjectType === 'everyone') {
      return [{ subjectType, id: EVERYONE_SUBJECT_ID, name: '', hint: null }];
    }
    if (subjectType === 'role') {
      const rows = await this.db
        .select({ id: roles.id, name: roles.name, hint: roles.slug })
        .from(roles)
        .where(
          and(
            isNull(roles.deletedAt),
            eq(roles.scope, 'workspace'),
            pattern ? ilike(roles.name, pattern) : undefined,
          ),
        )
        .orderBy(asc(roles.name), asc(roles.id))
        .limit(limit);
      return rows.map((row) => ({ subjectType, id: row.id, name: row.name, hint: row.hint }));
    }
    const rows = await this.db
      .select({ id: users.id, name: users.displayName, hint: users.username })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          isNull(users.deletedAt),
          eq(users.status, 'active'),
          pattern
            ? or(ilike(users.displayName, pattern), ilike(sql`${users.username}::text`, pattern))
            : undefined,
        ),
      )
      .orderBy(asc(users.displayName), asc(users.id))
      .limit(limit);
    return rows.map((row) => ({ subjectType, id: row.id, name: row.name, hint: row.hint }));
  }
}

function keyConditions(key: GrantKey): SQL[] {
  return [
    eq(resourceGrants.resourceType, key.resourceType),
    eq(resourceGrants.resourceId, key.resourceId),
    eq(resourceGrants.subjectType, key.subjectType),
    eq(resourceGrants.subjectId, key.subjectId),
  ];
}
