import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, gt, inArray, lt, ne, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';

import type { Database, DbOrTx } from '@/core/database';
import { containsPattern, TENANT_DB } from '@/core/database';
import {
  galleryAlbumItems,
  galleryAlbums,
  galleryItems,
  isDeleted,
  notDeleted,
  users,
} from '@/db/schema';
import type { GalleryAlbumInsert, GalleryAlbumRow, GalleryItemRow } from '@/db/schema';

/** 相簿的一列 ＋ 張數 ＋ 封面那一張（指定的封面，或最新的一張）。 */
export interface GalleryAlbumWithCover extends GalleryAlbumRow {
  itemCount: number;
  cover: GalleryItemRow | null;
}

const deleter = alias(users, 'gallery_album_deleter');
const coverItem = alias(galleryItems, 'gallery_album_cover');

/** 相簿裡看得到的圖片（處理完成、沒刪除）。 */
const VISIBLE_MEMBER = sql`EXISTS (SELECT 1 FROM ${galleryItems} gi WHERE gi.id = ${galleryAlbumItems.itemId} AND gi.deleted_at IS NULL /* notDeleted */ AND gi.status = 'ready')`;

/**
 * 相簿（docs/architecture/backend/26-gallery.md §7）。張數與封面在查詢時算：相簿的數量少，
 * 軟刪除與還原的圖片也不必回頭維護計數（實作紀錄 D15）。
 */
@Injectable()
export class GalleryAlbumRepository {
  constructor(@Inject(TENANT_DB) private readonly db: Database) {}

  async listWithCovers(ids?: readonly string[]): Promise<GalleryAlbumWithCover[]> {
    const counts = this.db
      .select({
        albumId: galleryAlbumItems.albumId,
        count: sql<number>`count(*)::int`.as('count'),
      })
      .from(galleryAlbumItems)
      .where(VISIBLE_MEMBER)
      .groupBy(galleryAlbumItems.albumId)
      .as('counts');
    // 封面：指定的那一張還看得到就用它，否則相簿裡最新的一張
    const coverId = sql<string | null>`coalesce(
      (SELECT ci.id FROM ${galleryItems} ci WHERE ci.id = ${galleryAlbums.coverItemId} AND ci.deleted_at IS NULL /* notDeleted */ AND ci.status = 'ready'),
      (SELECT li.id FROM ${galleryAlbumItems} lai JOIN ${galleryItems} li ON li.id = lai.item_id
        WHERE lai.album_id = ${galleryAlbums.id} AND li.deleted_at IS NULL /* notDeleted */ AND li.status = 'ready'
        ORDER BY li.sort_at DESC, li.id DESC LIMIT 1)
    )`;
    const rows = await this.db
      .select({ album: galleryAlbums, count: counts.count, coverId })
      .from(galleryAlbums)
      .leftJoin(counts, eq(counts.albumId, galleryAlbums.id))
      .where(and(notDeleted(galleryAlbums), ids ? inArray(galleryAlbums.id, [...ids]) : undefined))
      .orderBy(asc(sql`lower(${galleryAlbums.name})`), asc(galleryAlbums.id));
    const coverIds = rows.flatMap((row) => (row.coverId ? [row.coverId] : []));
    const covers =
      coverIds.length > 0
        ? await this.db.select().from(coverItem).where(inArray(coverItem.id, coverIds))
        : [];
    const byId = new Map(covers.map((cover) => [cover.id, cover]));
    return rows.map((row) =>
      Object.assign(row.album, {
        itemCount: row.count ?? 0,
        cover: row.coverId ? (byId.get(row.coverId) ?? null) : null,
      }),
    );
  }

  async findActive(id: string, tx?: DbOrTx): Promise<GalleryAlbumRow | undefined> {
    const [row] = await (tx ?? this.db)
      .select()
      .from(galleryAlbums)
      .where(and(eq(galleryAlbums.id, id), notDeleted(galleryAlbums)));
    return row;
  }

  async findDeletedById(id: string): Promise<GalleryAlbumRow | undefined> {
    const [row] = await this.db
      .select()
      .from(galleryAlbums)
      .where(and(eq(galleryAlbums.id, id), isDeleted(galleryAlbums)));
    return row;
  }

  /** 名稱（不分大小寫）已被另一個沒刪除的相簿用掉時，回那個相簿的 id。 */
  async findNameConflict(
    name: string,
    excludeId?: string,
    tx?: DbOrTx,
  ): Promise<string | undefined> {
    const [row] = await (tx ?? this.db)
      .select({ id: galleryAlbums.id })
      .from(galleryAlbums)
      .where(
        and(
          sql`lower(${galleryAlbums.name}) = lower(${name})`,
          notDeleted(galleryAlbums),
          excludeId ? ne(galleryAlbums.id, excludeId) : undefined,
        ),
      );
    return row?.id;
  }

  async create(values: GalleryAlbumInsert, tx: DbOrTx): Promise<GalleryAlbumRow> {
    const [row] = await tx.insert(galleryAlbums).values(values).returning();
    if (!row) throw new Error('建立相簿失敗');
    return row;
  }

  async update(
    id: string,
    fields: { name?: string; description?: string | null; coverItemId?: string | null },
    version: number,
    actorId: string,
    tx: DbOrTx,
  ): Promise<GalleryAlbumRow | undefined> {
    const [row] = await tx
      .update(galleryAlbums)
      .set({
        ...fields,
        version: sql`${galleryAlbums.version} + 1`,
        updatedAt: new Date(),
        updatedBy: actorId,
      })
      .where(
        and(
          eq(galleryAlbums.id, id),
          eq(galleryAlbums.version, version),
          notDeleted(galleryAlbums),
        ),
      )
      .returning();
    return row;
  }

  async findVersion(id: string, tx?: DbOrTx): Promise<number | undefined> {
    const [row] = await (tx ?? this.db)
      .select({ version: galleryAlbums.version })
      .from(galleryAlbums)
      .where(and(eq(galleryAlbums.id, id), notDeleted(galleryAlbums)));
    return row?.version;
  }

  /** 鎖住相簿的列（加入與移出圖片時，與刪除互斥）。 */
  async lockActive(id: string, tx: DbOrTx): Promise<GalleryAlbumRow | undefined> {
    const [row] = await tx
      .select()
      .from(galleryAlbums)
      .where(and(eq(galleryAlbums.id, id), notDeleted(galleryAlbums)))
      .for('update');
    return row;
  }

  /** 這張圖在不在相簿裡（設封面時檢查）。 */
  async contains(albumId: string, itemId: string, tx?: DbOrTx): Promise<boolean> {
    const [row] = await (tx ?? this.db)
      .select({ itemId: galleryAlbumItems.itemId })
      .from(galleryAlbumItems)
      .where(and(eq(galleryAlbumItems.albumId, albumId), eq(galleryAlbumItems.itemId, itemId)));
    return Boolean(row);
  }

  /** 加入（已經在的略過）；只加看得到的圖片。回傳實際加入的 id。 */
  async addItems(
    albumId: string,
    itemIds: readonly string[],
    actorId: string | null,
    tx: DbOrTx,
  ): Promise<string[]> {
    if (itemIds.length === 0) return [];
    const visible = await tx
      .select({ id: galleryItems.id })
      .from(galleryItems)
      .where(
        and(
          inArray(galleryItems.id, [...itemIds]),
          notDeleted(galleryItems),
          // 處理中的也可以先加入（上傳時就選了相簿）；處理失敗的不行
          ne(galleryItems.status, 'failed'),
        ),
      );
    if (visible.length === 0) return [];
    const rows = await tx
      .insert(galleryAlbumItems)
      .values(visible.map(({ id }) => ({ albumId, itemId: id, addedBy: actorId })))
      .onConflictDoNothing()
      .returning({ itemId: galleryAlbumItems.itemId });
    return rows.map((row) => row.itemId);
  }

  async removeItems(albumId: string, itemIds: readonly string[], tx: DbOrTx): Promise<string[]> {
    if (itemIds.length === 0) return [];
    const rows = await tx
      .delete(galleryAlbumItems)
      .where(
        and(
          eq(galleryAlbumItems.albumId, albumId),
          inArray(galleryAlbumItems.itemId, [...itemIds]),
        ),
      )
      .returning({ itemId: galleryAlbumItems.itemId });
    return rows.map((row) => row.itemId);
  }

  async softDelete(id: string, actorId: string, tx: DbOrTx): Promise<GalleryAlbumRow | undefined> {
    const [row] = await tx
      .update(galleryAlbums)
      .set({ deletedAt: new Date(), updatedBy: actorId, updatedAt: new Date() })
      .where(and(eq(galleryAlbums.id, id), notDeleted(galleryAlbums)))
      .returning();
    return row;
  }

  async restore(id: string, actorId: string, tx: DbOrTx): Promise<GalleryAlbumRow | undefined> {
    const [row] = await tx
      .update(galleryAlbums)
      .set({ deletedAt: null, updatedBy: actorId, updatedAt: new Date() })
      .where(and(eq(galleryAlbums.id, id), isDeleted(galleryAlbums)))
      .returning();
    return row;
  }

  async listDeleted(query: { offset: number; limit: number; keyword?: string }): Promise<{
    items: Array<{
      id: string;
      name: string;
      description: string | null;
      deletedAt: Date;
      deletedBy: { id: string; name: string } | null;
    }>;
    total: number;
  }> {
    const conditions: SQL[] = [isDeleted(galleryAlbums)];
    if (query.keyword) {
      conditions.push(sql`${galleryAlbums.name} ILIKE ${containsPattern(query.keyword)}`);
    }
    const where = and(...conditions);
    const [rows, [counted]] = await Promise.all([
      this.db
        .select({
          id: galleryAlbums.id,
          name: galleryAlbums.name,
          description: galleryAlbums.description,
          deletedAt: galleryAlbums.deletedAt,
          deleterId: deleter.id,
          deleterName: deleter.displayName,
        })
        .from(galleryAlbums)
        .leftJoin(deleter, eq(deleter.id, galleryAlbums.updatedBy))
        .where(where)
        .orderBy(desc(galleryAlbums.deletedAt), desc(galleryAlbums.id))
        .limit(query.limit)
        .offset(query.offset),
      this.db
        .select({ total: sql<number>`count(*)::int` })
        .from(galleryAlbums)
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

  async findExpired(
    cutoff: Date,
    afterId: string | null,
    limit: number,
  ): Promise<Array<{ id: string; name: string; deletedAt: Date }>> {
    const rows = await this.db
      .select({
        id: galleryAlbums.id,
        name: galleryAlbums.name,
        deletedAt: galleryAlbums.deletedAt,
      })
      .from(galleryAlbums)
      .where(
        and(
          isDeleted(galleryAlbums),
          lt(galleryAlbums.deletedAt, cutoff),
          afterId ? gt(galleryAlbums.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(galleryAlbums.id))
      .limit(limit);
    return rows.flatMap(({ deletedAt, ...row }) => (deletedAt ? [{ ...row, deletedAt }] : []));
  }

  /** 永久刪除；與圖片的關聯隨外鍵 CASCADE 刪除（圖片本身不動）。 */
  async hardDelete(id: string, tx: DbOrTx): Promise<boolean> {
    const [row] = await tx
      .delete(galleryAlbums)
      .where(and(eq(galleryAlbums.id, id), isDeleted(galleryAlbums)))
      .returning({ id: galleryAlbums.id });
    return Boolean(row);
  }

  async countActive(): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(galleryAlbums)
      .where(notDeleted(galleryAlbums));
    return row?.count ?? 0;
  }
}
