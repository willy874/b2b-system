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
 * 沿著「成員」類關係走的一步：`t` 是邊、以 `t.object_id` 為那個使用者集合的節點。
 * 已刪除（軟刪除）的角色與群組不算——它們的邊保留（休眠），還原時回來。
 * 與 db/schema 的 isActiveRole()／isActiveGroup()（notDeleted）同一個條件。
 */
const MEMBERSHIP_STEP = sql`(
  (t.object_type = 'role' AND t.relation = ${ROLE_HOLDER_RELATION}
    AND EXISTS (SELECT 1 FROM roles r WHERE r.id::text = t.object_id AND r.deleted_at IS NULL /* notDeleted */))
  OR (t.object_type = ${GROUP_OBJECT_TYPE} AND t.relation = ${GROUP_MEMBER_RELATION}
    AND EXISTS (SELECT 1 FROM groups g WHERE g.id::text = t.object_id AND g.deleted_at IS NULL /* notDeleted */))
)`;

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
    now: Date,
    tx?: DbOrTx,
  ): Promise<Map<string, SubjectKey[]>> {
    return this.closures(
      userIds.flatMap((id) => [
        { root: id, type: 'user', id, rel: '' },
        { root: id, type: 'user', id: '*', rel: '' },
      ]),
      userIds,
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
    now: Date,
    tx?: DbOrTx,
  ): Promise<Map<SubjectKey, SubjectKey[]>> {
    return this.closures(
      usersets.map((key) => {
        const { object, relation } = parseSubjectKey(key);
        return { root: key, type: object.type, id: object.id, rel: relation };
      }),
      usersets,
      now,
      tx,
    );
  }

  /** 從 `seeds` 沿成員關係往上走的閉包（含起點），以 `root` 分組；`roots` 的每一個都會出現在結果裡。 */
  private async closures<Root extends string>(
    seeds: ReadonlyArray<{ root: Root; type: string; id: string; rel: string }>,
    roots: readonly Root[],
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
          AND ${MEMBERSHIP_STEP}
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
          AND ${MEMBERSHIP_STEP}
          AND (t.expires_at IS NULL OR t.expires_at > ${now.toISOString()}::timestamptz)
      )
      SELECT DISTINCT id FROM holders WHERE type = 'user' AND rel = '' AND id <> '*' ORDER BY id
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
