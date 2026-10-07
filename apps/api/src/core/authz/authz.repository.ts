import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import { authzRevision, relationTuples } from '@/db/schema';

import { TENANT_DB } from '../database';
import type { Database, DbOrTx } from '../database';
import { parseSubjectKey, subjectKey } from './authz.checker';
import type { SubjectKey } from './authz.checker';
import type { TupleEntry } from './authz.snapshot';
import {
  GROUP_MEMBER_RELATION,
  GROUP_OBJECT_TYPE,
  MAX_CLOSURE_DEPTH,
  ROLE_HOLDER_RELATION,
  TENANT_OBJECT,
} from './authz.types';

/**
 * 走哪些「成員」類關係：角色的持有者一律走；群組的成員只在租戶啟用 `group` 時走——停用時群組帶來的授權
 * （群組持有的角色、群組在資料夾上的授權、以群組指定的公告受眾）全部暫停，邊保留（docs/architecture/iam/07-groups.md §8）。
 * 是否啟用由呼叫端（`AuthzService`）決定，這一層只把它轉成查詢條件。
 */
export interface MembershipScope {
  groups: boolean;
}

/**
 * 沿著「成員」類關係走的一步：`t` 是邊、以 `t.object_id` 為那個使用者集合的節點。
 * 已刪除（軟刪除）的角色與群組不算——它們的邊保留（休眠），還原時回來。
 * 與 db/schema 的 isActiveRole()／isActiveGroup()（notDeleted）同一個條件。
 */
function membershipStep(scope: MembershipScope): SQL {
  const role = sql`(t.object_type = 'role' AND t.relation = ${ROLE_HOLDER_RELATION}
    AND EXISTS (SELECT 1 FROM roles r WHERE r.id::text = t.object_id AND r.deleted_at IS NULL /* notDeleted */))`;
  if (!scope.groups) return role;
  return sql`(${role}
  OR (t.object_type = ${GROUP_OBJECT_TYPE} AND t.relation = ${GROUP_MEMBER_RELATION}
    AND EXISTS (SELECT 1 FROM groups g WHERE g.id::text = t.object_id AND g.deleted_at IS NULL /* notDeleted */)))`;
}

/** 未過期：`expires_at` 為 null 或晚於 `now`（用 app 端的時間，與舊的解析一致）。 */
function active(now: Date): SQL | undefined {
  return or(isNull(relationTuples.expiresAt), gt(relationTuples.expiresAt, now));
}

@Injectable()
export class AuthzRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  /**
   * 每位使用者的主體閉包：本人、`user:*`，以及沿著「成員」類關係（`group#member`、`role#holder`）走得到的使用者集合
   * （巢狀群組、群組持有的角色）。已刪除（軟刪除）的角色與群組不算（docs/architecture/backend/05-rbac.md §4）。
   * 回傳的 Map 含每個傳入的 id；多人一次一條查詢。
   */
  async subjectClosures(
    userIds: readonly string[],
    scope: MembershipScope,
    now: Date,
    tx?: DbOrTx,
  ): Promise<Map<string, SubjectKey[]>> {
    return this.closures(
      userIds.flatMap((id) => [
        { root: id, type: 'user', id, rel: '' },
        { root: id, type: 'user', id: '*', rel: '' },
      ]),
      userIds,
      scope,
      now,
      tx,
    );
  }

  /**
   * 使用者集合（`group:<g>#member`、`role:<r>#holder`）往上的閉包：它自己，以及它的成員（因此）也會屬於的使用者集合——
   * 上層群組、群組與上層群組持有的角色。反提權用：把主體放進這個集合，主體就取得閉包裡每個集合的能力。
   * 起點本身不看是否刪除（還原時要問「還原之後會帶來什麼」），往上只走未刪除的。回傳的 Map 以起點的 key 為鍵。
   */
  async usersetClosures(
    usersets: readonly SubjectKey[],
    scope: MembershipScope,
    now: Date,
    tx?: DbOrTx,
  ): Promise<Map<SubjectKey, SubjectKey[]>> {
    return this.closures(
      usersets.map((key) => {
        const { object, relation } = parseSubjectKey(key);
        return { root: key, type: object.type, id: object.id, rel: relation };
      }),
      usersets,
      scope,
      now,
      tx,
    );
  }

  /**
   * 一位使用者的主體閉包，每個主體附上「怎麼來的」：從使用者本人（或 `user:*`）走到它的鏈，取最短的一條
   * （例：`role:r#holder` ← `[user:u, group:g#member, group:h#member, role:r#holder]`）。
   * `AuthzChecker.explain()` 的路徑從閉包裡的主體開始，接上這條鏈才是完整的說明（docs/architecture/iam/01-model.md §9.3 D14、G4b）。
   * 規則與 `subjectClosures` 相同（只走未刪除的角色與群組、未過期的邊）。
   */
  async closurePaths(
    userId: string,
    scope: MembershipScope,
    now: Date,
    tx?: DbOrTx,
  ): Promise<Map<SubjectKey, SubjectKey[]>> {
    const db = tx ?? this.db;
    const self = subjectKey('user', userId);
    const everyone = subjectKey('user', '*');
    const rows = await db.execute<{ key: string; path: string[] }>(sql`
      WITH RECURSIVE closure(type, id, rel, depth, path) AS (
        SELECT * FROM (VALUES
          ('user'::text, ${userId}::text, ''::text, 0, ARRAY[${self}::text]),
          ('user'::text, '*'::text, ''::text, 0, ARRAY[${everyone}::text])
        ) AS seed(type, id, rel, depth, path)
        UNION ALL
        SELECT t.object_type, t.object_id, t.relation, c.depth + 1,
          c.path || (t.object_type || ':' || t.object_id || '#' || t.relation)
        FROM ${relationTuples} t
        JOIN closure c
          ON t.subject_type = c.type AND t.subject_id = c.id AND t.subject_relation = c.rel
        WHERE c.depth < ${MAX_CLOSURE_DEPTH}
          AND ${membershipStep(scope)}
          AND (t.expires_at IS NULL OR t.expires_at > ${now.toISOString()}::timestamptz)
          -- 巢狀的循環由寫入端擋下；這裡再以路徑擋一次，資料異常時也不會無限展開
          AND NOT (t.object_type || ':' || t.object_id || '#' || t.relation) = ANY(c.path)
      )
      SELECT DISTINCT ON (path[array_length(path, 1)]) path[array_length(path, 1)] AS key, path
      FROM closure
      ORDER BY path[array_length(path, 1)], depth
    `);
    return new Map(rows.map((row) => [row.key, row.path]));
  }

  /** 從 `seeds` 沿成員關係往上走的閉包（含起點），以 `root` 分組；`roots` 的每一個都會出現在結果裡。 */
  private async closures<Root extends string>(
    seeds: ReadonlyArray<{ root: Root; type: string; id: string; rel: string }>,
    roots: readonly Root[],
    scope: MembershipScope,
    now: Date,
    tx?: DbOrTx,
  ): Promise<Map<Root, SubjectKey[]>> {
    const result = new Map<Root, SubjectKey[]>(roots.map((root) => [root, []]));
    if (seeds.length === 0) return result;
    const db = tx ?? this.db;
    const values = sql.join(
      seeds.map(
        (seed) =>
          sql`(${seed.root}::text, ${seed.type}::text, ${seed.id}::text, ${seed.rel}::text, 0)`,
      ),
      sql`, `,
    );
    const rows = await db.execute<{ root: Root; type: string; id: string; rel: string }>(sql`
      WITH RECURSIVE closure(root, type, id, rel, depth) AS (
        SELECT * FROM (VALUES ${values}) AS seed(root, type, id, rel, depth)
        UNION
        SELECT c.root, t.object_type, t.object_id, t.relation, c.depth + 1
        FROM ${relationTuples} t
        JOIN closure c
          ON t.subject_type = c.type AND t.subject_id = c.id AND t.subject_relation = c.rel
        WHERE c.depth < ${MAX_CLOSURE_DEPTH}
          AND ${membershipStep(scope)}
          AND (t.expires_at IS NULL OR t.expires_at > ${now.toISOString()}::timestamptz)
      )
      SELECT DISTINCT root, type, id, rel FROM closure
    `);
    for (const row of rows) result.get(row.root)?.push(subjectKey(row.type, row.id, row.rel));
    return result;
  }

  /**
   * 反向解析：在租戶節點上持有 `relations` 其中任一個（直接的邊，或經由「成員」類關係——`role#holder`、
   * 巢狀的 `group#member`——間接持有）的使用者 id。與 `subjectClosures` 走的是同一張圖、反方向：從租戶節點上的邊往主體展開，
   * 過期的邊與已刪除（軟刪除）的角色、群組不算。萬用字元主體（`user:*`）不展開：租戶型別的關係只允許 `role#holder`
   * 當主體（`buildTenantType`），不會出現。結果是 **候選**：呼叫端再以正向解析確認（見 `PermissionService`）。
   */
  async usersWithTenantRelations(
    relations: readonly string[],
    scope: MembershipScope,
    now: Date,
    tx?: DbOrTx,
  ): Promise<string[]> {
    if (relations.length === 0) return [];
    const db = tx ?? this.db;
    const wanted = sql.join(
      relations.map((relation) => sql`${relation}`),
      sql`, `,
    );
    const rows = await db.execute<{ id: string }>(sql`
      WITH RECURSIVE holders(type, id, rel, depth) AS (
        SELECT t.subject_type, t.subject_id, t.subject_relation, 0
        FROM ${relationTuples} t
        WHERE t.object_type = ${TENANT_OBJECT.type} AND t.object_id = ${TENANT_OBJECT.id}
          AND t.relation IN (${wanted})
          AND (t.expires_at IS NULL OR t.expires_at > ${now.toISOString()}::timestamptz)
        UNION
        SELECT t.subject_type, t.subject_id, t.subject_relation, h.depth + 1
        FROM ${relationTuples} t
        JOIN holders h ON t.object_type = h.type AND t.object_id = h.id AND t.relation = h.rel
        WHERE h.depth < ${MAX_CLOSURE_DEPTH}
          AND ${membershipStep(scope)}
          AND (t.expires_at IS NULL OR t.expires_at > ${now.toISOString()}::timestamptz)
      )
      SELECT DISTINCT id FROM holders WHERE type = 'user' AND rel = '' AND id <> '*' ORDER BY id
    `);
    return rows.map((row) => row.id);
  }

  /**
   * 反向解析：這些使用者集合（`group:<g>#member`、`role:<r>#holder`）裡的使用者 id，沿巢狀群組與群組持有的角色往下展開。
   * 與 `usersWithTenantRelations` 同一個遞迴、同樣的條件（過期的邊、已刪除的角色與群組不算），只是起點是指定的集合，
   * 不是租戶節點上的關係。起點本身已刪除時沒有結果（`membershipStep` 也套用在第一步）。
   */
  async usersInSubjectSets(
    sets: ReadonlyArray<{ type: string; id: string; relation: string }>,
    scope: MembershipScope,
    now: Date,
    tx?: DbOrTx,
  ): Promise<string[]> {
    if (sets.length === 0) return [];
    const db = tx ?? this.db;
    const seeds = sql.join(
      sets.map((set) => sql`(${set.type}, ${set.id}, ${set.relation})`),
      sql`, `,
    );
    const rows = await db.execute<{ id: string }>(sql`
      WITH RECURSIVE members(type, id, rel, depth) AS (
        SELECT t.subject_type, t.subject_id, t.subject_relation, 0
        FROM ${relationTuples} t
        WHERE (t.object_type, t.object_id, t.relation) IN (${seeds})
          AND ${membershipStep(scope)}
          AND (t.expires_at IS NULL OR t.expires_at > ${now.toISOString()}::timestamptz)
        UNION
        SELECT t.subject_type, t.subject_id, t.subject_relation, m.depth + 1
        FROM ${relationTuples} t
        JOIN members m ON t.object_type = m.type AND t.object_id = m.id AND t.relation = m.rel
        WHERE m.depth < ${MAX_CLOSURE_DEPTH}
          AND ${membershipStep(scope)}
          AND (t.expires_at IS NULL OR t.expires_at > ${now.toISOString()}::timestamptz)
      )
      SELECT DISTINCT id FROM members WHERE type = 'user' AND rel = '' AND id <> '*' ORDER BY id
    `);
    return rows.map((row) => row.id);
  }

  /** 關係圖目前的版本號（`relation_tuples` 每條寫入語句 +1，migration 0009）。 */
  async currentRevision(): Promise<number> {
    const [row] = await this.db.select({ revision: authzRevision.revision }).from(authzRevision);
    return row?.revision ?? 0;
  }

  /** 這些主體在某種物件上所有未過期的直接 tuple（例：操作者在租戶節點上的權限鍵、在資料夾上的等級）。 */
  async tuplesForSubjects(
    objectType: string,
    subjects: readonly SubjectKey[],
    now: Date,
    tx?: DbOrTx,
  ): Promise<TupleEntry[]> {
    if (subjects.length === 0) return [];
    const db = tx ?? this.db;
    const bySubject = subjects.map((key) => {
      const { object, relation } = parseSubjectKey(key);
      return and(
        eq(relationTuples.subjectType, object.type),
        eq(relationTuples.subjectId, object.id),
        eq(relationTuples.subjectRelation, relation),
      );
    });
    const rows = await db
      .select({
        objectId: relationTuples.objectId,
        relation: relationTuples.relation,
        subjectType: relationTuples.subjectType,
        subjectId: relationTuples.subjectId,
        subjectRelation: relationTuples.subjectRelation,
      })
      .from(relationTuples)
      .where(and(eq(relationTuples.objectType, objectType), or(...bySubject), active(now)));
    return rows.map((row) => ({
      object: { type: objectType, id: row.objectId },
      relation: row.relation,
      subject: subjectKey(row.subjectType, row.subjectId, row.subjectRelation),
    }));
  }
}
