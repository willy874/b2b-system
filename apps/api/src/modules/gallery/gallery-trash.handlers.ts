import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import { PERMISSION } from '@/common/types';
import type { Transaction } from '@/core/database';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { RESOURCE_TYPE } from '@/core/resource';
import { CdnPurger, ObjectStorage } from '@/core/storage';
import { CommentService } from '@/modules/comment/comment.service';
import { TagService } from '@/modules/tag/tag.service';
import { TrashService } from '@/modules/trash/trash.service';
import type {
  ExpiredTrashItem,
  TrashHandler,
  TrashItem,
  TrashListQuery,
} from '@/modules/trash/trash.types';

import { GalleryAlbumRepository } from './gallery-album.repository';
import { GalleryItemRepository } from './gallery-item.repository';
import { cdnKeysOf, GALLERY_KEY_PREFIX } from './gallery.constants';

/** 永久刪除後同時刪物件的圖片數。 */
const OBJECT_DELETE_CONCURRENCY = 16;

/**
 * 圖片庫的圖片的回收桶（docs/architecture/backend/13-trash.md、docs/architecture/backend/26-gallery.md §11）。
 * 還原是 `POST /gallery/items/:id/restore`；這裡只負責列出與到期永久刪除。物件保留到永久刪除才刪。
 */
@Injectable()
export class GalleryItemTrashHandler implements TrashHandler, OnModuleInit {
  readonly type = RESOURCE_TYPE.GALLERY_ITEM;
  readonly permission = PERMISSION.GALLERY_DELETE;
  readonly feature = 'gallery' as const;
  /** 先刪圖片：相簿的封面隨 SET NULL、關聯隨 CASCADE，不依賴相簿。 */
  readonly purgeOrder = 12;
  private readonly logger = new Logger(GalleryItemTrashHandler.name);

  constructor(
    private readonly trash: TrashService,
    private readonly repo: GalleryItemRepository,
    private readonly storage: ObjectStorage,
    private readonly events: DomainEventBus,
    private readonly tags: TagService,
    private readonly comments: CommentService,
    private readonly cdn: CdnPurger,
  ) {}

  onModuleInit(): void {
    this.trash.registerHandler(this);
  }

  /** `description` 是加入時的來源名稱（自行上傳是原本的檔名）。 */
  listDeleted(query: TrashListQuery): Promise<{ items: TrashItem[]; total: number }> {
    return this.repo.listDeleted(query);
  }

  findExpired(cutoff: Date, afterId: string | null, limit: number): Promise<ExpiredTrashItem[]> {
    return this.repo.findExpired(cutoff, afterId, limit);
  }

  async purge(item: ExpiredTrashItem, tx: Transaction): Promise<boolean> {
    if (!(await this.repo.hardDelete(item.id, tx))) return false;
    // 標籤、留言與關注是多型關聯、沒有外鍵：一起清掉
    await this.tags.removeAllFor(RESOURCE_TYPE.GALLERY_ITEM, [item.id], tx);
    await this.comments.removeAllFor(RESOURCE_TYPE.GALLERY_ITEM, [item.id], tx);
    return true;
  }

  /** 紀錄刪掉之後才刪物件；刪除失敗只記 warn，由 `gallery.maintenance` 的殘留對帳清掉。 */
  async afterPurge(ids: readonly string[]): Promise<void> {
    for (let start = 0; start < ids.length; start += OBJECT_DELETE_CONCURRENCY) {
      // oxlint-disable-next-line no-await-in-loop -- 一批刪完再刪下一批，限制同時的請求數
      await Promise.all(
        ids.slice(start, start + OBJECT_DELETE_CONCURRENCY).map((id) => this.deleteObjects(id)),
      );
    }
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: ids.map((id) => ({
        resource: ChangeSource.GALLERY_ITEM,
        kind: ChangeKind.DELETE,
        id,
      })),
    });
  }

  private async deleteObjects(id: string): Promise<void> {
    try {
      const keys: string[] = [];
      for await (const object of this.storage.listObjects(`${GALLERY_KEY_PREFIX}${id}/`)) {
        keys.push(object.key);
      }
      await Promise.all(keys.map((key) => this.storage.delete(key)));
      // 刪除成功之後才清理邊緣快取（docs/architecture/backend/09-file.md §16）；不會拋錯
      await this.cdn.schedule(cdnKeysOf(keys));
    } catch (error) {
      this.logger.warn({ err: error, itemId: id }, '刪除圖片庫的物件失敗，留給清理排程');
    }
  }
}

/** 相簿的回收桶。還原是 `POST /gallery/albums/:id/restore`；永久刪除只刪相簿與關聯，圖片不動。 */
@Injectable()
export class GalleryAlbumTrashHandler implements TrashHandler, OnModuleInit {
  readonly type = RESOURCE_TYPE.GALLERY_ALBUM;
  readonly permission = PERMISSION.GALLERY_DELETE;
  readonly feature = 'gallery' as const;
  readonly purgeOrder = 13;

  constructor(
    private readonly trash: TrashService,
    private readonly repo: GalleryAlbumRepository,
    private readonly events: DomainEventBus,
  ) {}

  onModuleInit(): void {
    this.trash.registerHandler(this);
  }

  listDeleted(query: TrashListQuery): Promise<{ items: TrashItem[]; total: number }> {
    return this.repo.listDeleted(query);
  }

  findExpired(cutoff: Date, afterId: string | null, limit: number): Promise<ExpiredTrashItem[]> {
    return this.repo.findExpired(cutoff, afterId, limit);
  }

  purge(item: ExpiredTrashItem, tx: Transaction): Promise<boolean> {
    return this.repo.hardDelete(item.id, tx);
  }

  async afterPurge(ids: readonly string[]): Promise<void> {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: ids.map((id) => ({
        resource: ChangeSource.GALLERY_ALBUM,
        kind: ChangeKind.DELETE,
        id,
      })),
    });
  }
}
