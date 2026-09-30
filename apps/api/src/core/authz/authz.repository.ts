import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import { relationTuples } from '@/db/schema';

import { TENANT_DB } from '../database';
import type { Database, DbOrTx } from '../database';
import { parseSubjectKey, subjectKey } from './authz.checker';
import type { SubjectKey } from './authz.checker';
import type { TupleEntry } from './authz.snapshot';
import { ROLE_HOLDER_RELATION } from './authz.types';

/** 主體閉包的深度上限：巢狀群組（G4）之前只有「使用者 → 角色」一層，留一點餘裕。 */
const MAX_CLOSURE_DEPTH = 8;

/** 未過期：`expires_at` 為 null 或晚於 `now`（用 app 端的時間，與舊的解析一致）。 */
function active(now: Date): SQL | undefined {
  return or(isNull(relationTuples.expiresAt), gt(relationTuples.expiresAt, now));
}

@Injectable()
export class AuthzRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  /**
   * 每位使用者的主體閉包：本人、`user:*`，以及沿著「成員」類關係（目前只有 `role#holder`）走得到的使用者集合。
   * 已刪除（軟刪除）的角色不算，比照舊的解析（docs/architecture/backend/05-rbac.md §4）。
   * 回傳的 Map 含每個傳入的 id；多人一次一條查詢。
   */
  async subjectClosures(
    userIds: readonly string[],
    now: Date,
    tx?: DbOrTx,
  ): Promise<Map<string, SubjectKey[]>> {
    const result = new Map<string, SubjectKey[]>(userIds.map((id) => [id, []]));
    if (userIds.length === 0) return result;
    const db = tx ?? this.db;
    const seeds = sql.join(
      userIds.flatMap((id) => [
        sql`(${id}::text, 'user'::text, ${id}::text, ''::text, 0)`,
        sql`(${id}::text, 'user'::text, '*'::text, ''::text, 0)`,
      ]),
      sql`, `,
    );
    const rows = await db.execute<{ root: string; type: string; id: string; rel: string }>(sql`
      WITH RECURSIVE closure(root, type, id, rel, depth) AS (
        SELECT * FROM (VALUES ${seeds}) AS seed(root, type, id, rel, depth)
        UNION
        SELECT c.root, t.object_type, t.object_id, t.relation, c.depth + 1
        FROM ${relationTuples} t
        JOIN closure c
          ON t.subject_type = c.type AND t.subject_id = c.id AND t.subject_relation = c.rel
        WHERE c.depth < ${MAX_CLOSURE_DEPTH}
          AND t.object_type = 'role' AND t.relation = ${ROLE_HOLDER_RELATION}
          AND (t.expires_at IS NULL OR t.expires_at > ${now.toISOString()}::timestamptz)
          -- 與 db/schema/roles.ts 的 isActiveRole() 同一個條件
          AND EXISTS (SELECT 1 FROM roles r WHERE r.id::text = t.object_id AND r.deleted_at IS NULL)
      )
      SELECT DISTINCT root, type, id, rel FROM closure
    `);
    for (const row of rows) result.get(row.root)?.push(subjectKey(row.type, row.id, row.rel));
    return result;
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
