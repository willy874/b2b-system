import { Inject, Injectable } from '@nestjs/common';
import { and, asc, eq, ilike, inArray, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { TENANT_DB, containsPattern } from '@/core/database';
import {
  GROUP_MEMBER_RELATION,
  GROUP_OBJECT_TYPE,
  groups,
  isActiveGroup,
  isActiveRole,
  notDeleted,
  relationTuples,
  ROLE_HOLDER_RELATION,
  ROLE_OBJECT_TYPE,
  roles,
  USER_SUBJECT_TYPE,
  users,
  WILDCARD_SUBJECT_ID,
} from '@/db/schema';

import { EVERYONE_SUBJECT_ID, GRANT_LEVELS } from './file-grant.levels';
import type { GrantLevel, GrantSubjectType } from './file-grant.levels';

/** 資料夾在關係圖上的型別（file.authz.ts 的 `FILE_FOLDER_TYPE`）。 */
const FOLDER_OBJECT_TYPE = 'fileFolder';

/** 一筆授權的識別：資料夾 × 對象。 */
export interface GrantKey {
  folderId: string;
  subjectType: GrantSubjectType;
  /** `everyone` 固定是 `EVERYONE_SUBJECT_ID`。 */
  subjectId: string;
}

/** 資料夾上的一筆授權（關係圖上的一條邊，以 API 的形狀表示）。 */
export interface FolderGrant extends GrantKey {
  level: GrantLevel;
  /** null = 不過期；過期的授權在解析時忽略，清單上仍列出。 */
  expiresAt: Date | null;
  grantedAt: Date;
  grantedBy: string | null;
}

/** 授權清單的一列：附上對象的顯示名稱（`everyone` 是空字串，前端以語系顯示）。 */
export interface FolderGrantWithSubject extends FolderGrant {
  subjectName: string;
}

export interface GrantSubjectRow {
  id: string;
  name: string;
  /** 角色是 slug、使用者是 username：同名時用來分辨（群組沒有）。 */
  hint: string | null;
}

/**
 * 授權對象 → 邊的主體：角色是 `role:<id>#holder`、使用者是 `user:<id>`、群組是 `group:<id>#member`、
 * 所有人是 `user:*`。
 */
function subjectOf(subjectType: GrantSubjectType, subjectId: string) {
  switch (subjectType) {
    case 'role':
      return { type: ROLE_OBJECT_TYPE, id: subjectId, relation: ROLE_HOLDER_RELATION };
    case 'group':
      return { type: GROUP_OBJECT_TYPE, id: subjectId, relation: GROUP_MEMBER_RELATION };
    case 'user':
      return { type: USER_SUBJECT_TYPE, id: subjectId, relation: '' };
    case 'everyone':
      return { type: USER_SUBJECT_TYPE, id: WILDCARD_SUBJECT_ID, relation: '' };
  }
}

/** 邊的主體 → 授權對象（反過來）；不是授權形狀的邊回傳 null。 */
function grantSubjectOf(row: {
  subjectType: string;
  subjectId: string;
  subjectRelation: string;
}): Pick<GrantKey, 'subjectType' | 'subjectId'> | null {
  if (row.subjectType === ROLE_OBJECT_TYPE && row.subjectRelation === ROLE_HOLDER_RELATION) {
    return { subjectType: 'role', subjectId: row.subjectId };
  }
  if (row.subjectType === GROUP_OBJECT_TYPE && row.subjectRelation === GROUP_MEMBER_RELATION) {
    return { subjectType: 'group', subjectId: row.subjectId };
  }
  if (row.subjectType === USER_SUBJECT_TYPE && row.subjectRelation === '') {
    return row.subjectId === WILDCARD_SUBJECT_ID
      ? { subjectType: 'everyone', subjectId: EVERYONE_SUBJECT_ID }
      : { subjectType: 'user', subjectId: row.subjectId };
  }
  return null;
}

/** 資料夾等級的邊（關係是四個等級之一）。 */
function isFolderGrant(folderIds: readonly string[]): SQL {
  return and(
    eq(relationTuples.objectType, FOLDER_OBJECT_TYPE),
    inArray(relationTuples.objectId, [...folderIds]),
    inArray(relationTuples.relation, [...GRANT_LEVELS]),
  ) as SQL;
}

function isSubject(key: GrantKey): SQL {
  const subject = subjectOf(key.subjectType, key.subjectId);
  return and(
    eq(relationTuples.subjectType, subject.type),
    eq(relationTuples.subjectId, subject.id),
    eq(relationTuples.subjectRelation, subject.relation),
  ) as SQL;
}

/**
 * 對象必須還存在（未刪除）：多型的邊沒有外鍵，刪除角色或使用者不清授權，在這裡濾掉
 * （docs/rbac/07-resource-grants.md §3.1）。
 */
const LIVE_SUBJECT = sql`(
  ${relationTuples.subjectId} = ${WILDCARD_SUBJECT_ID}
  OR (${relationTuples.subjectType} = ${ROLE_OBJECT_TYPE} AND EXISTS (
    SELECT 1 FROM ${roles} WHERE ${roles.id}::text = ${relationTuples.subjectId} AND ${isActiveRole()}))
  OR (${relationTuples.subjectType} = ${USER_SUBJECT_TYPE} AND EXISTS (
    SELECT 1 FROM ${users} WHERE ${users.id}::text = ${relationTuples.subjectId} AND ${notDeleted(users)}))
  OR (${relationTuples.subjectType} = ${GROUP_OBJECT_TYPE} AND EXISTS (
    SELECT 1 FROM ${groups} WHERE ${groups.id}::text = ${relationTuples.subjectId} AND ${isActiveGroup()}))
)`;

const GRANT_COLUMNS = {
  folderId: relationTuples.objectId,
  level: relationTuples.relation,
  subjectType: relationTuples.subjectType,
  subjectId: relationTuples.subjectId,
  subjectRelation: relationTuples.subjectRelation,
  expiresAt: relationTuples.expiresAt,
  grantedAt: relationTuples.createdAt,
  grantedBy: relationTuples.createdBy,
};

type GrantColumns = {
  folderId: string;
  level: string;
  subjectType: string;
  subjectId: string;
  subjectRelation: string;
  expiresAt: Date | null;
  grantedAt: Date;
  grantedBy: string | null;
};

function toGrant(row: GrantColumns): FolderGrant | null {
  const subject = grantSubjectOf(row);
  if (!subject) return null;
  return {
    folderId: row.folderId,
    ...subject,
    level: row.level as GrantLevel,
    expiresAt: row.expiresAt,
    grantedAt: row.grantedAt,
    grantedBy: row.grantedBy,
  };
}

/**
 * 資料夾授權的存取（docs/rbac/07-resource-grants.md §8）：關係圖上 `fileFolder:<id>#<等級>@<對象>` 的邊。
 * 同一個對象在同一個資料夾只有一個等級——唯一索引含關係、擋不住，由 `set` 先刪後寫維持；
 * 授權的寫入都在資料夾樹的寫入佇列裡（`FileFolderTree.write`），不會並行。
 */
@Injectable()
export class FileFolderGrantRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  /** 這些資料夾上的授權（含已過期的，清單上要顯示），對象已刪除的不列。 */
  async listOn(folderIds: readonly string[], tx?: DbOrTx): Promise<FolderGrantWithSubject[]> {
    if (folderIds.length === 0) return [];
    const db = tx ?? this.db;
    const rows = await db
      .select({
        ...GRANT_COLUMNS,
        roleName: roles.name,
        userName: users.displayName,
        groupName: groups.name,
      })
      .from(relationTuples)
      .leftJoin(
        roles,
        and(
          eq(relationTuples.subjectType, ROLE_OBJECT_TYPE),
          eq(sql`${roles.id}::text`, relationTuples.subjectId),
          isActiveRole(),
        ),
      )
      .leftJoin(
        users,
        and(
          eq(relationTuples.subjectType, USER_SUBJECT_TYPE),
          eq(sql`${users.id}::text`, relationTuples.subjectId),
          notDeleted(users),
        ),
      )
      .leftJoin(
        groups,
        and(
          eq(relationTuples.subjectType, GROUP_OBJECT_TYPE),
          eq(sql`${groups.id}::text`, relationTuples.subjectId),
          isActiveGroup(),
        ),
      )
      .where(isFolderGrant(folderIds))
      .orderBy(asc(relationTuples.createdAt), asc(relationTuples.id));
    return rows.flatMap(({ roleName, userName, groupName, ...row }) => {
      const grant = toGrant(row);
      if (!grant) return [];
      const subjectName = {
        everyone: '',
        role: roleName,
        user: userName,
        group: groupName,
      }[grant.subjectType];
      return subjectName === null ? [] : [{ ...grant, subjectName }];
    });
  }

  async find(key: GrantKey, tx?: DbOrTx): Promise<FolderGrant | undefined> {
    const db = tx ?? this.db;
    const [row] = await db
      .select(GRANT_COLUMNS)
      .from(relationTuples)
      .where(and(isFolderGrant([key.folderId]), isSubject(key), LIVE_SUBJECT))
      .limit(1);
    return (row && toGrant(row)) ?? undefined;
  }

  /** 新增或覆寫（同一對象在同一資料夾只有一個等級）。 */
  async set(
    key: GrantKey,
    values: { level: GrantLevel; expiresAt: Date | null; grantedBy: string | null },
    tx: DbOrTx,
  ): Promise<FolderGrant> {
    await this.delete(key, tx);
    const subject = subjectOf(key.subjectType, key.subjectId);
    const [row] = await tx
      .insert(relationTuples)
      .values({
        objectType: FOLDER_OBJECT_TYPE,
        objectId: key.folderId,
        relation: values.level,
        subjectType: subject.type,
        subjectId: subject.id,
        subjectRelation: subject.relation,
        expiresAt: values.expiresAt,
        createdBy: values.grantedBy,
      })
      .returning(GRANT_COLUMNS);
    const grant = row && toGrant(row);
    if (!grant) throw new Error('寫入授權失敗');
    return grant;
  }

  /** 移除這個對象在這個資料夾上的授權；回傳被移除的那一筆。 */
  async delete(key: GrantKey, tx: DbOrTx): Promise<FolderGrant | undefined> {
    const [row] = await tx
      .delete(relationTuples)
      .where(and(isFolderGrant([key.folderId]), isSubject(key)))
      .returning(GRANT_COLUMNS);
    return (row && toGrant(row)) ?? undefined;
  }

  /** 對象存在（未刪除）。 */
  async subjectExists(subjectType: GrantSubjectType, id: string, tx?: DbOrTx): Promise<boolean> {
    if (subjectType === 'everyone') return id === EVERYONE_SUBJECT_ID;
    const db = tx ?? this.db;
    const table = { role: roles, user: users, group: groups }[subjectType];
    const [row] = await db
      .select({ one: sql<number>`1` })
      .from(table)
      .where(and(eq(table.id, id), notDeleted(table)))
      .limit(1);
    return Boolean(row);
  }

  /** 授權對象的候選：名稱（角色）或顯示名稱／帳號（使用者）部分比對。 */
  async searchSubjects(
    subjectType: GrantSubjectType,
    keyword: string | undefined,
    limit: number,
  ): Promise<GrantSubjectRow[]> {
    const pattern = keyword ? containsPattern(keyword) : undefined;
    if (subjectType === 'everyone') return [{ id: EVERYONE_SUBJECT_ID, name: '', hint: null }];
    if (subjectType === 'group') {
      return this.db
        .select({ id: groups.id, name: groups.name, hint: sql<string | null>`NULL` })
        .from(groups)
        .where(and(isActiveGroup(), pattern ? ilike(groups.name, pattern) : undefined))
        .orderBy(asc(groups.name), asc(groups.id))
        .limit(limit);
    }
    if (subjectType === 'role') {
      return this.db
        .select({ id: roles.id, name: roles.name, hint: roles.slug })
        .from(roles)
        .where(and(isActiveRole(), pattern ? ilike(roles.name, pattern) : undefined))
        .orderBy(asc(roles.name), asc(roles.id))
        .limit(limit);
    }
    return this.db
      .select({ id: users.id, name: users.displayName, hint: users.username })
      .from(users)
      .where(
        and(
          notDeleted(users),
          eq(users.status, 'active'),
          pattern
            ? or(ilike(users.displayName, pattern), ilike(sql`${users.username}::text`, pattern))
            : undefined,
        ),
      )
      .orderBy(asc(users.displayName), asc(users.id))
      .limit(limit);
  }
}
