import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';

import type { Database, DbOrTx } from '@/core/database';
import { anyUuid, TENANT_DB } from '@/core/database';
import { resourceTags, tags } from '@/db/schema';
import type { TagColor, TagInsert, TagRow } from '@/db/schema';

/** 一個資源上的一個標籤（批次取得時帶上資源 id）。 */
export interface AssignedTag {
  resourceId: string;
  id: string;
  name: string;
  color: TagColor;
}

/** 標籤的定義與指派（docs/architecture/backend/18-tag.md §7.2 D2）。 */
@Injectable()
export class TagRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  // ── 定義 ─────────────────────────────────────────────

  /** 一個標籤組的全部標籤，依名稱排序（不分頁，D11）。 */
  listByScope(scope: string): Promise<TagRow[]> {
    return this.db
      .select()
      .from(tags)
      .where(eq(tags.scope, scope))
      .orderBy(asc(sql`lower(${tags.name})`), asc(tags.id));
  }

  async findById(id: string, tx?: DbOrTx): Promise<TagRow | undefined> {
    const [row] = await (tx ?? this.db).select().from(tags).where(eq(tags.id, id));
    return row;
  }

  /** 這些 id 之中屬於 `scope` 的標籤。 */
  findInScope(scope: string, ids: readonly string[], tx?: DbOrTx): Promise<TagRow[]> {
    if (!ids.length) return Promise.resolve([]);
    return (tx ?? this.db)
      .select()
      .from(tags)
      .where(and(eq(tags.scope, scope), inArray(tags.id, [...ids])));
  }

  /** 匯入匯出（docs/architecture/backend/22-data-transfer.md §12.4）：這些標籤組的標籤，依組、名稱排序。 */
  listByScopes(scopes: readonly string[]): Promise<TagRow[]> {
    if (!scopes.length) return Promise.resolve([]);
    return this.db
      .select()
      .from(tags)
      .where(inArray(tags.scope, [...scopes]))
      .orderBy(asc(tags.scope), asc(sql`lower(${tags.name})`), asc(tags.id));
  }

  /** 這些 id 的標籤（不分組）。 */
  findByIds(ids: readonly string[]): Promise<TagRow[]> {
    if (!ids.length) return Promise.resolve([]);
    return this.db
      .select()
      .from(tags)
      .where(inArray(tags.id, [...ids]));
  }

  /** 這個標籤組裡名稱（不分大小寫）是這些的標籤。 */
  findByNames(scope: string, names: readonly string[], tx?: DbOrTx): Promise<TagRow[]> {
    if (!names.length) return Promise.resolve([]);
    return (tx ?? this.db)
      .select()
      .from(tags)
      .where(
        and(
          eq(tags.scope, scope),
          sql`lower(${tags.name}) IN ${names.map((name) => name.toLowerCase())}`,
        ),
      );
  }

  async countInScope(scope: string, tx: DbOrTx): Promise<number> {
    const [row] = await tx.select({ total: count() }).from(tags).where(eq(tags.scope, scope));
    return row?.total ?? 0;
  }

  /** 同一個標籤組同時建立兩個不會一起超過上限：以標籤組為 key 的交易層 advisory lock。 */
  async lockScope(scope: string, tx: DbOrTx): Promise<void> {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`tags:${scope}`}))`);
  }

  /** 同一個資源的標籤寫入排隊：讀出目前的標籤、算出新的、寫回之間不會被另一個寫入插隊。 */
  async lockResource(resourceType: string, resourceId: string, tx: DbOrTx): Promise<void> {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`resource_tags:${resourceType}:${resourceId}`}))`,
    );
  }

  async create(values: TagInsert, tx: DbOrTx): Promise<TagRow> {
    const [row] = await tx.insert(tags).values(values).returning();
    if (!row) throw new Error('tags 寫入沒有回傳列');
    return row;
  }

  /** 條件式 UPDATE（樂觀鎖）：版本不符或列已不在回 `undefined`。 */
  async update(
    id: string,
    values: Partial<Pick<TagInsert, 'name' | 'color' | 'updatedBy'>>,
    expectedVersion: number,
    tx: DbOrTx,
  ): Promise<TagRow | undefined> {
    const [row] = await tx
      .update(tags)
      .set({ ...values, version: sql`${tags.version} + 1`, updatedAt: new Date() })
      .where(and(eq(tags.id, id), eq(tags.version, expectedVersion)))
      .returning();
    return row;
  }

  /** 標籤目前的 `version`；不存在回 undefined（樂觀鎖沒命中時重讀）。 */
  async findVersion(id: string, tx: DbOrTx): Promise<number | undefined> {
    const [row] = await tx
      .select({ version: tags.version })
      .from(tags)
      .where(eq(tags.id, id))
      .limit(1);
    return row?.version;
  }

  /** 硬刪除（D4）；指派由外鍵 CASCADE。回傳刪除前貼著的資源數（稽核用）。 */
  async delete(id: string, tx: DbOrTx): Promise<number | undefined> {
    const [assigned] = await tx
      .select({ total: count() })
      .from(resourceTags)
      .where(eq(resourceTags.tagId, id));
    const rows = await tx.delete(tags).where(eq(tags.id, id)).returning({ id: tags.id });
    return rows.length ? (assigned?.total ?? 0) : undefined;
  }

  // ── 指派 ─────────────────────────────────────────────

  /**
   * 這些資源各自的標籤（依名稱排序）。資源 id 可能是整棵資料夾樹（上萬個）：以一個陣列參數傳遞，
   * 不受參數個數上限影響（docs/architecture/backend/09-file.md §11）。
   */
  tagsOf(
    resourceType: string,
    resourceIds: readonly string[],
    tx?: DbOrTx,
  ): Promise<AssignedTag[]> {
    if (!resourceIds.length) return Promise.resolve([]);
    return (tx ?? this.db)
      .select({
        resourceId: resourceTags.resourceId,
        id: tags.id,
        name: tags.name,
        color: sql<TagColor>`${tags.color}`,
      })
      .from(resourceTags)
      .innerJoin(tags, eq(tags.id, resourceTags.tagId))
      .where(
        and(
          eq(resourceTags.resourceType, resourceType),
          anyUuid(resourceTags.resourceId, resourceIds),
        ),
      )
      .orderBy(asc(sql`lower(${tags.name})`), asc(tags.id));
  }

  /** 整批取代一個資源的標籤：刪掉不在新清單的、插入新的（已有的保留原本的建立時間）。 */
  async replace(
    resourceType: string,
    resourceId: string,
    tagIds: readonly string[],
    actorId: string,
    tx: DbOrTx,
  ): Promise<void> {
    const ofResource = and(
      eq(resourceTags.resourceType, resourceType),
      eq(resourceTags.resourceId, resourceId),
    );
    await tx
      .delete(resourceTags)
      .where(
        tagIds.length
          ? and(ofResource, sql`${resourceTags.tagId} NOT IN ${[...tagIds]}`)
          : ofResource,
      );
    if (!tagIds.length) return;
    await tx
      .insert(resourceTags)
      .values(tagIds.map((tagId) => ({ tagId, resourceType, resourceId, createdBy: actorId })))
      .onConflictDoNothing();
  }

  /** 資源永久刪除時清掉它們的指派（D9）。 */
  async removeAllFor(
    resourceType: string,
    resourceIds: readonly string[],
    tx: DbOrTx,
  ): Promise<void> {
    if (!resourceIds.length) return;
    await tx
      .delete(resourceTags)
      .where(
        and(
          eq(resourceTags.resourceType, resourceType),
          inArray(resourceTags.resourceId, [...resourceIds]),
        ),
      );
  }
}
