import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import type { ResourceChangeWire } from '@b2b-system/realtime';
import { Inject, Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import type { Database, MissedUpdateCodes } from '@/core/database';
import { missedUpdate, TENANT_DB, withTransaction } from '@/core/database';
import { AppException, isUniqueViolation } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { RESOURCE_TYPE } from '@/core/resource';
import { diff } from '@/modules/audit-log/audit.diff';
import { AuditService } from '@/modules/audit-log/audit.service';

import type {
  CreateGalleryAlbumDto,
  GalleryAlbumDto,
  GalleryAlbumItemsDto,
  UpdateGalleryAlbumDto,
} from './dto/gallery-album.dto';
import type { GalleryAlbumWithCover } from './gallery-album.repository';
import { GalleryAlbumRepository } from './gallery-album.repository';
import { GalleryImageUrls } from './gallery-image-urls';
import { GALLERY_ALBUM_AUDIT_FIELDS } from './gallery.constants';

const GALLERY_ALBUM_LOCK_CODES = {
  notFound: 'GALLERY_ALBUM_NOT_FOUND',
  conflict: 'GALLERY_ALBUM_VERSION_CONFLICT',
} as const satisfies MissedUpdateCodes;

/** 推播的 `refs` 一則最多帶幾個 id：超過就以相簿本身宣告（列表整個重抓）。 */
const MAX_ITEM_CHANGES = 100;

/**
 * 相簿（docs/architecture/backend/26-gallery.md §7）：一張圖可以在多個相簿，相簿不巢狀。
 * 刪除相簿不刪圖片，只是關聯不再顯示（相簿進回收桶，還原時關聯一起回來）。
 * 加入與移出圖片記在 `galleryAlbum.update` 的 `changes`（一次批次一筆）。
 */
@Injectable()
export class GalleryAlbumService {
  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: GalleryAlbumRepository,
    private readonly urls: GalleryImageUrls,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
  ) {}

  async list(): Promise<{ items: GalleryAlbumDto[] }> {
    const rows = await this.repo.listWithCovers();
    return { items: await Promise.all(rows.map((row) => this.toDto(row))) };
  }

  async findOne(id: string): Promise<GalleryAlbumDto> {
    const [row] = await this.repo.listWithCovers([id]);
    if (!row) throw new AppException('GALLERY_ALBUM_NOT_FOUND');
    return this.toDto(row);
  }

  async create(dto: CreateGalleryAlbumDto, actor: AuthUser): Promise<GalleryAlbumDto> {
    await this.assertNameAvailable(dto.name);
    const album = await this.uniqueName(dto.name, () =>
      withTransaction(this.db, async (tx) => {
        const created = await this.repo.create(
          {
            name: dto.name,
            description: dto.description ?? null,
            createdBy: actor.id,
            updatedBy: actor.id,
          },
          tx,
        );
        await this.audit.record(
          {
            action: 'galleryAlbum.create',
            resourceType: RESOURCE_TYPE.GALLERY_ALBUM,
            resourceId: created.id,
            resourceName: created.name,
            changes: { after: { name: created.name, description: created.description } },
          },
          tx,
        );
        return created;
      }),
    );
    this.publish([{ resource: ChangeSource.GALLERY_ALBUM, kind: ChangeKind.CREATE, id: album.id }]);
    return this.findOne(album.id);
  }

  async update(id: string, dto: UpdateGalleryAlbumDto, actor: AuthUser): Promise<GalleryAlbumDto> {
    const { version, ...fields } = dto;
    const album = await this.repo.findActive(id);
    if (!album) throw new AppException('GALLERY_ALBUM_NOT_FOUND');
    if (version !== album.version) {
      throw new AppException('GALLERY_ALBUM_VERSION_CONFLICT', { current: album.version });
    }
    if (fields.name) await this.assertNameAvailable(fields.name, id);
    if (fields.coverItemId && !(await this.repo.contains(id, fields.coverItemId))) {
      throw new AppException('GALLERY_ALBUM_COVER_INVALID');
    }
    const changes = diff(album, fields, [...GALLERY_ALBUM_AUDIT_FIELDS]);
    await this.uniqueName(fields.name ?? album.name, () =>
      withTransaction(this.db, async (tx) => {
        const updated = await this.repo.update(id, fields, version, actor.id, tx);
        if (!updated) {
          throw await missedUpdate(() => this.repo.findVersion(id, tx), GALLERY_ALBUM_LOCK_CODES);
        }
        if (changes) {
          await this.audit.record(
            {
              action: 'galleryAlbum.update',
              resourceType: RESOURCE_TYPE.GALLERY_ALBUM,
              resourceId: id,
              resourceName: updated.name,
              changes,
            },
            tx,
          );
        }
      }),
    );
    this.publish([{ resource: ChangeSource.GALLERY_ALBUM, kind: ChangeKind.UPDATE, id }]);
    return this.findOne(id);
  }

  async remove(id: string, actor: AuthUser): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      const row = await this.repo.softDelete(id, actor.id, tx);
      if (!row) throw new AppException('GALLERY_ALBUM_NOT_FOUND');
      await this.audit.record(
        {
          action: 'galleryAlbum.delete',
          resourceType: RESOURCE_TYPE.GALLERY_ALBUM,
          resourceId: id,
          resourceName: row.name,
          changes: { before: { name: row.name } },
        },
        tx,
      );
    });
    this.publish([{ resource: ChangeSource.GALLERY_ALBUM, kind: ChangeKind.DELETE, id }]);
  }

  /** 還原：名稱被新的相簿用掉時擋下（同名稱不分大小寫唯一）。 */
  async restore(id: string, actor: AuthUser): Promise<GalleryAlbumDto> {
    const deleted = await this.repo.findDeletedById(id);
    if (!deleted) {
      if (await this.repo.findActive(id)) throw new AppException('GALLERY_ALBUM_NOT_DELETED');
      throw new AppException('GALLERY_ALBUM_NOT_FOUND');
    }
    await this.assertNameAvailable(deleted.name, id);
    await this.uniqueName(deleted.name, () =>
      withTransaction(this.db, async (tx) => {
        const row = await this.repo.restore(id, actor.id, tx);
        if (!row) throw new AppException('GALLERY_ALBUM_NOT_DELETED');
        await this.audit.record(
          {
            action: 'galleryAlbum.restore',
            resourceType: RESOURCE_TYPE.GALLERY_ALBUM,
            resourceId: id,
            resourceName: row.name,
            changes: { after: { name: row.name } },
            metadata: { deletedAt: deleted.deletedAt?.toISOString() },
          },
          tx,
        );
      }),
    );
    this.publish([{ resource: ChangeSource.GALLERY_ALBUM, kind: ChangeKind.CREATE, id }]);
    return this.findOne(id);
  }

  /** 加入圖片（已經在的略過）；一次批次一筆 `galleryAlbum.update`。 */
  async addItems(
    id: string,
    dto: GalleryAlbumItemsDto,
    actor: AuthUser,
  ): Promise<{ changed: number }> {
    return this.changeItems(id, dto.itemIds, actor, 'add');
  }

  async removeItems(
    id: string,
    dto: GalleryAlbumItemsDto,
    actor: AuthUser,
  ): Promise<{ changed: number }> {
    return this.changeItems(id, dto.itemIds, actor, 'remove');
  }

  // ── 內部 ──

  private async changeItems(
    id: string,
    itemIds: readonly string[],
    actor: AuthUser,
    mode: 'add' | 'remove',
  ): Promise<{ changed: number }> {
    const changed = await withTransaction(this.db, async (tx) => {
      const album = await this.repo.lockActive(id, tx);
      if (!album) throw new AppException('GALLERY_ALBUM_NOT_FOUND');
      const ids =
        mode === 'add'
          ? await this.repo.addItems(id, itemIds, actor.id, tx)
          : await this.repo.removeItems(id, itemIds, tx);
      if (ids.length > 0) {
        await this.audit.record(
          {
            action: 'galleryAlbum.update',
            resourceType: RESOURCE_TYPE.GALLERY_ALBUM,
            resourceId: id,
            resourceName: album.name,
            changes:
              mode === 'add' ? { after: { addedItems: ids } } : { before: { removedItems: ids } },
          },
          tx,
        );
      }
      return ids;
    });
    if (changed.length > 0) {
      const changes: ResourceChangeWire[] = [
        { resource: ChangeSource.GALLERY_ALBUM, kind: ChangeKind.UPDATE, id },
      ];
      // 圖片所在的相簿變了（詳情的「所在的相簿」）；太多時只宣告相簿，列表照樣重抓
      if (changed.length < MAX_ITEM_CHANGES) {
        changes.push(
          ...changed.map((itemId) => ({
            resource: ChangeSource.GALLERY_ITEM,
            kind: ChangeKind.UPDATE,
            id: itemId,
          })),
        );
      }
      this.publish(changes);
    }
    return { changed: changed.length };
  }

  private async assertNameAvailable(name: string, excludeId?: string): Promise<void> {
    const conflicting = await this.repo.findNameConflict(name, excludeId);
    if (conflicting) {
      throw new AppException('GALLERY_ALBUM_NAME_DUPLICATE', { conflictingAlbumId: conflicting });
    }
  }

  /** 同時建立同名的相簿：檢查之後被搶先，唯一索引擋下。 */
  private async uniqueName<T>(name: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const conflicting = await this.repo.findNameConflict(name);
      throw new AppException('GALLERY_ALBUM_NAME_DUPLICATE', { conflictingAlbumId: conflicting });
    }
  }

  private async toDto(row: GalleryAlbumWithCover): Promise<GalleryAlbumDto> {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      itemCount: row.itemCount,
      coverItemId: row.coverItemId,
      cover: row.cover ? await this.urls.sourcesOf(row.cover) : null,
      coverColor: row.cover?.dominantColor ?? null,
      version: row.version,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private publish(changes: ResourceChangeWire[]): void {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, { changes });
  }
}
