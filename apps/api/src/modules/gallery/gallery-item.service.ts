import { randomUUID } from 'node:crypto';

import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import type { ResourceChangeWire } from '@b2b-system/realtime';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AuthUser } from '@/common/types';
import type { Env } from '@/core/config';
import type { Database, MissedUpdateCodes, Transaction } from '@/core/database';
import { missedUpdate, TENANT_DB, withTransaction } from '@/core/database';
import { AppException, statusOf } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { JobQueue } from '@/core/jobs';
import { RESOURCE_TYPE } from '@/core/resource';
import { DEFAULT_TIMEZONE_SETTING, SettingService } from '@/core/settings';
import { ObjectStorage } from '@/core/storage';
import { GALLERY_MAX_ITEM_SIZE_MB_PARAM, tenantFeatureParam } from '@/core/tenant';
import { StorageCapacity, storageQuotaExceeded, tenantStorageQuotaBytes } from '@/core/usage';
import type { GalleryItemRow } from '@/db/schema';
import { diff } from '@/modules/audit-log/audit.diff';
import { AuditService } from '@/modules/audit-log/audit.service';
import { ImageAssetService } from '@/modules/image/image-asset.service';
import { ImageSourceRegistry } from '@/modules/image/image-source.registry';
import { TagService } from '@/modules/tag/tag.service';

import type {
  CreateGalleryFromSourceDto,
  CreateGalleryUploadDto,
  GalleryFilterDto,
  GalleryFromSourceResultDto,
  GalleryItemDetailDto,
  GalleryItemDto,
  GalleryItemListDto,
  GalleryNeighborsDto,
  GalleryNeighborsQueryDto,
  GalleryTimelineDto,
  GalleryTimelineQueryDto,
  GalleryUploadDto,
  GalleryUploadItemDto,
  GalleryUploadStatusDto,
  ListGalleryItemsDto,
  UpdateGalleryItemDto,
} from './dto/gallery-item.dto';
import { GalleryAlbumRepository } from './gallery-album.repository';
import { GalleryImageUrls } from './gallery-image-urls';
import type { GalleryItemFilter, GallerySort } from './gallery-item.repository';
import { GalleryItemRepository } from './gallery-item.repository';
import { GALLERY_PROCESS_JOB } from './gallery-process.job';
import {
  GALLERY_CONTENT_TYPES,
  GALLERY_FAILURE_REASONS,
  GALLERY_IMAGE_SOURCE,
  GALLERY_ITEM_AUDIT_FIELDS,
  GALLERY_PENDING_PER_USER,
  GALLERY_UPLOAD_SOURCE,
  uploadKeyOf,
} from './gallery.constants';
import type { GalleryFailureReason } from './gallery.constants';
import { decodeGalleryCursor, encodeGalleryCursor } from './gallery.cursor';

const MIB = 1024 * 1024;
/** 資訊面板最多列幾張「內容相同」的圖。 */
const DUPLICATES_LIMIT = 5;

const GALLERY_ITEM_LOCK_CODES = {
  notFound: 'GALLERY_ITEM_NOT_FOUND',
  conflict: 'GALLERY_ITEM_VERSION_CONFLICT',
} as const satisfies MissedUpdateCodes;

/** 去掉副檔名的檔名當標題（`IMG_0001.JPG` → `IMG_0001`）；只有副檔名時保留原樣。 */
export function titleFromFileName(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() ?? fileName;
  const dot = base.lastIndexOf('.');
  const title = (dot > 0 ? base.slice(0, dot) : base)
    // oxlint-disable-next-line no-control-regex -- 去掉控制字元（標題的規則）
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 255);
  return title.length > 0 ? title : 'image';
}

function isGalleryType(contentType: string): boolean {
  return (GALLERY_CONTENT_TYPES as readonly string[]).includes(contentType);
}

function toFailureReason(value: string | null): GalleryFailureReason | null {
  return (GALLERY_FAILURE_REASONS as readonly string[]).includes(value ?? '')
    ? (value as GalleryFailureReason)
    : null;
}

function toUploadItem(row: GalleryItemRow): GalleryUploadItemDto {
  return {
    id: row.id,
    title: row.title,
    status: row.status,
    failureReason: toFailureReason(row.failureReason),
    createdAt: row.createdAt.toISOString(),
  };
}

/** 顯示的寬高（套用 `display_rotation`）：變體已經轉好了，以變體的尺寸為準。 */
function displaySize(row: GalleryItemRow): { width: number; height: number } {
  if (row.variants) return { width: row.variants.width, height: row.variants.height };
  const turned = row.displayRotation === 90 || row.displayRotation === 270;
  const width = row.width ?? 0;
  const height = row.height ?? 0;
  return turned ? { width: height, height: width } : { width, height };
}

function toFilter(query: GalleryFilterDto, usage?: GalleryItemFilter['usage']): GalleryItemFilter {
  return {
    keyword: query.keyword || undefined,
    albumId: query.albumId,
    tagIds: query.tagId,
    takenFrom: query.takenFrom ? new Date(query.takenFrom) : undefined,
    takenTo: query.takenTo ? new Date(query.takenTo) : undefined,
    orientation: query.orientation,
    uploaderId: query.uploaderId,
    origin: query.origin,
    usage,
  };
}

/**
 * 圖片庫的圖片（docs/architecture/backend/26-gallery.md）。
 *
 * - 上傳：`createUpload`（登記、佔用容量、發直傳網址）→ 瀏覽器 PUT → `completeUpload`（排入 `gallery.process`）；
 * - 從其他來源加入：`createFromSource`，經 `ImageSourceRegistry` 解析後在物件儲存內 **複製**（D0、D2）；
 * - 只有 ready 的圖出現在圖片庫；`galleryItem.create` 的稽核與推播在處理完成時（`GalleryProcessService`）。
 * - 授權只有 RBAC（D4）：路由的 `gallery:*` 就是全部的判斷。
 */
@Injectable()
export class GalleryItemService {
  private readonly logger = new Logger(GalleryItemService.name);
  private readonly uploadUrlTtl: number;

  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: GalleryItemRepository,
    private readonly albums: GalleryAlbumRepository,
    private readonly urls: GalleryImageUrls,
    private readonly tags: TagService,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
    private readonly jobs: JobQueue,
    private readonly storage: ObjectStorage,
    private readonly capacity: StorageCapacity,
    private readonly sources: ImageSourceRegistry,
    private readonly images: ImageAssetService,
    private readonly settings: SettingService,
    config: ConfigService<Env, true>,
  ) {
    this.uploadUrlTtl = config.get('FILE_URL_TTL', { infer: true });
  }

  // ── 閱覽 ──

  async list(query: ListGalleryItemsDto): Promise<GalleryItemListDto> {
    const sort = this.sortOf(query.sort);
    const cursor = query.cursor ? decodeGalleryCursor(query.cursor) : undefined;
    if (query.cursor && (!cursor || cursor.sort !== sort.field || cursor.order !== sort.order)) {
      throw new AppException('VALIDATION_FAILED', { fields: { cursor: 'invalid' } });
    }
    const rows = await this.repo.list(
      toFilter(query, this.usageFilter(query.imageUsage)),
      sort,
      { cursor, startAt: query.startAt ? new Date(query.startAt) : undefined },
      query.limit + 1,
    );
    const backward = cursor?.direction === 'before';
    const more = rows.length > query.limit;
    // 往前取的列是反向排序：倒回原本的順序
    const page = backward ? rows.slice(0, query.limit).toReversed() : rows.slice(0, query.limit);
    const cursorAt = (row: (typeof rows)[number] | undefined, direction: 'after' | 'before') =>
      row
        ? encodeGalleryCursor({
            sort: sort.field,
            order: sort.order,
            value: row.sortValue,
            id: row.id,
            direction,
          })
        : null;
    return {
      items: await this.toSummaries(page),
      // 往前取的頁：後面一定還有（游標那一筆）
      nextCursor: more || backward ? cursorAt(page.at(-1), 'after') : null,
      // 往後取的頁：帶游標或從日期捲軸的起點開始時前面可能還有；往前取的頁：多取到一筆才是還有
      prevCursor: (backward ? more : Boolean(cursor) || Boolean(query.startAt))
        ? cursorAt(page[0], 'before')
        : null,
    };
  }

  /** 每個月的張數（日期捲軸）：以租戶的預設時區分月。 */
  async timeline(query: GalleryTimelineQueryDto): Promise<GalleryTimelineDto> {
    const timeZone = await this.settings.get(DEFAULT_TIMEZONE_SETTING);
    return {
      timeZone,
      months: await this.repo.timeline(
        toFilter(query, this.usageFilter(query.imageUsage)),
        query.field,
        timeZone,
      ),
    };
  }

  async neighbors(id: string, query: GalleryNeighborsQueryDto): Promise<GalleryNeighborsDto> {
    const item = await this.getVisible(id);
    return this.repo.neighbors(
      item,
      toFilter(query, this.usageFilter(query.imageUsage)),
      this.sortOf(query.sort),
    );
  }

  async findOne(id: string): Promise<GalleryItemDetailDto> {
    const item = await this.getVisible(id);
    const [[summary], albums, duplicates, uploader, original, download] = await Promise.all([
      this.toSummaries([item]),
      this.repo.albumsOf(id),
      this.repo.duplicatesOf(item, DUPLICATES_LIMIT),
      this.repo.uploaderOf(item.createdBy),
      this.urls.originalOf(item),
      this.urls.downloadsOf(item),
    ]);
    if (!summary) throw new AppException('GALLERY_ITEM_NOT_FOUND');
    return {
      ...summary,
      exif: item.exif ?? null,
      locationStripped: item.locationStripped,
      source: item.source,
      sourceName: item.sourceName,
      uploader,
      albums,
      duplicates,
      original,
      download,
    };
  }

  /** 自己上傳中與處理失敗的（頁首的「處理中 N 張」）。 */
  async uploads(actor: AuthUser): Promise<GalleryUploadStatusDto> {
    const { processing, failed } = await this.repo.uploadsOf(actor.id);
    return { processing, failed: failed.map(toUploadItem), maxItemSize: this.maxItemSize() };
  }

  /** 清掉自己處理失敗的紀錄（物件由清理排程的殘留對帳刪除）。 */
  async clearFailed(actor: AuthUser): Promise<void> {
    await withTransaction(this.db, async (tx) => {
      const ids = await this.repo.findFailedOf(actor.id, tx);
      await this.repo.deleteUnready(ids, tx);
    });
  }

  // ── 上傳 ──

  async createUpload(dto: CreateGalleryUploadDto, actor: AuthUser): Promise<GalleryUploadDto> {
    this.assertAcceptable(dto.contentType, dto.size);
    if (dto.albumId) await this.requireAlbum(dto.albumId);
    if ((await this.repo.countPending(actor.id)) >= GALLERY_PENDING_PER_USER) {
      throw new AppException('GALLERY_PENDING_LIMIT_REACHED', { limit: GALLERY_PENDING_PER_USER });
    }
    await this.capacity.assertCanStore(dto.size);
    await this.storage.ensureBucket();

    const id = randomUUID();
    const row = await withTransaction(this.db, async (tx) => {
      const created = await this.insert(
        {
          id,
          title: dto.title ?? titleFromFileName(dto.fileName),
          contentType: dto.contentType,
          size: dto.size,
          width: dto.width ?? null,
          height: dto.height ?? null,
          source: GALLERY_UPLOAD_SOURCE,
          sourceName: dto.fileName,
          createdBy: actor.id,
          updatedBy: actor.id,
        },
        tx,
      );
      if (dto.albumId) await this.albums.addItems(dto.albumId, [id], actor.id, tx);
      return created;
    });
    const upload = await this.storage.presignUpload(uploadKeyOf(id), {
      contentType: dto.contentType,
      contentLength: dto.size,
      expiresIn: this.uploadUrlTtl,
    });
    return {
      item: toUploadItem(row),
      upload: {
        url: upload.url,
        method: 'PUT',
        headers: upload.headers,
        expiresAt: upload.expiresAt.toISOString(),
      },
    };
  }

  /** 確認直傳完成：向物件儲存確認內容，排入處理（outbox，與狀態同一個交易）。 */
  async completeUpload(id: string, actor: AuthUser): Promise<GalleryUploadItemDto> {
    const row = await this.repo.findById(id);
    // 別人的上傳一律當作不存在
    if (!row || row.createdBy !== actor.id || row.deletedAt) {
      throw new AppException('GALLERY_ITEM_NOT_FOUND');
    }
    if (row.status !== 'pending') throw new AppException('GALLERY_ALREADY_UPLOADED');
    const key = uploadKeyOf(id);
    const stored = await this.storage.head(key);
    if (!stored) throw new AppException('GALLERY_UPLOAD_INCOMPLETE');
    // api 從不要求瀏覽器帶 Content-Encoding；大小不符的內容刪掉，同一個網址（未過期時）可以重傳
    if (stored.contentEncoding || stored.size !== row.size) {
      await this.storage.delete(key);
      throw new AppException('GALLERY_UPLOAD_INCOMPLETE');
    }
    await withTransaction(this.db, async (tx) => {
      if (!(await this.repo.markProcessing(id, tx))) {
        throw new AppException('GALLERY_ALREADY_UPLOADED');
      }
      await this.jobs.enqueue(GALLERY_PROCESS_JOB, { itemId: id }, { tx });
    });
    const updated = await this.repo.findById(id);
    return toUploadItem(updated ?? row);
  }

  /**
   * 從其他來源加入（§8）：逐筆以來源的 `resolve` 讀取（讀取權限由來源判斷）→ 型別、大小、是否已經加入 →
   * 在物件儲存內複製到 `gallery/<id>/upload` → 登記並排入處理。之後原本那一筆被改名、移動、刪除都與圖片庫無關。
   * 來源的 feature 沒啟用時整批 `404 FEATURE_DISABLED`（`ImageSourceRegistry.get`）。
   */
  async createFromSource(
    dto: CreateGalleryFromSourceDto,
    actor: AuthUser,
  ): Promise<GalleryFromSourceResultDto> {
    if (dto.source === GALLERY_IMAGE_SOURCE || dto.source === GALLERY_UPLOAD_SOURCE) {
      throw new AppException('IMAGE_SOURCE_NOT_FOUND', { source: dto.source });
    }
    const source = this.sources.get(dto.source);
    if (dto.albumId) await this.requireAlbum(dto.albumId);
    const refIds = [...new Set(dto.refIds)];
    const existing = await this.repo.findBySource(dto.source, refIds);
    const maxSize = this.maxItemSize();
    await this.storage.ensureBucket();

    const results: GalleryFromSourceResultDto['results'] = [];
    const skip = (
      refId: string,
      reason: (typeof results)[number]['reason'],
      extra: { existingItemId?: string; name?: string } = {},
    ) =>
      results.push({
        refId,
        status: 'skipped',
        itemId: null,
        reason,
        existingItemId: extra.existingItemId ?? null,
        name: extra.name ?? null,
      });

    for (const refId of refIds) {
      const already = existing.get(refId);
      if (already) {
        skip(refId, 'alreadyAdded', { existingItemId: already });
        continue;
      }
      let resolved;
      try {
        // oxlint-disable-next-line no-await-in-loop -- 依序：來源各自寫稽核（`<resource>.copy`），也不同時對物件儲存發出上百個複製
        resolved = await source.resolve(refId, actor, 'gallery');
      } catch (error) {
        // 看不到、不存在、不是圖片：這一筆略過；其他錯誤（儲存服務不可用等）整批失敗
        if (error instanceof AppException && [403, 404].includes(statusOf(error.code))) {
          skip(refId, 'notFound');
          continue;
        }
        throw error;
      }
      if (!isGalleryType(resolved.contentType)) {
        skip(refId, 'typeNotAllowed', { name: resolved.name });
        continue;
      }
      if (resolved.size > maxSize) {
        skip(refId, 'tooLarge', { name: resolved.name });
        continue;
      }
      // oxlint-disable-next-line no-await-in-loop -- 同上
      const itemId = await this.copyIn(dto, refId, resolved, actor);
      if (itemId) {
        results.push({
          refId,
          status: 'added',
          itemId,
          reason: null,
          existingItemId: null,
          name: resolved.name,
        });
      } else {
        skip(refId, 'notFound', { name: resolved.name });
      }
    }
    return { results };
  }

  // ── 編輯、刪除、還原 ──

  /** 標題、說明、顯示方向（樂觀鎖）。顯示方向改了就把變體產生到新的版本（D14）。 */
  async update(
    id: string,
    dto: UpdateGalleryItemDto,
    actor: AuthUser,
  ): Promise<GalleryItemDetailDto> {
    const { version, ...fields } = dto;
    const item = await this.getVisible(id);
    if (version !== item.version) {
      throw new AppException('GALLERY_ITEM_VERSION_CONFLICT', { current: item.version });
    }
    const rotationChanged =
      fields.displayRotation !== undefined && fields.displayRotation !== item.displayRotation;
    const changes = diff(item, fields, [...GALLERY_ITEM_AUDIT_FIELDS]);
    await withTransaction(this.db, async (tx) => {
      const updated = await this.repo.update(id, fields, rotationChanged, version, actor.id, tx);
      if (!updated) {
        throw await missedUpdate(() => this.repo.findVersion(id, tx), GALLERY_ITEM_LOCK_CODES);
      }
      if (changes) {
        await this.audit.record(
          {
            action: 'galleryItem.update',
            resourceType: RESOURCE_TYPE.GALLERY_ITEM,
            resourceId: id,
            resourceName: updated.title,
            changes,
          },
          tx,
        );
      }
      if (rotationChanged) await this.jobs.enqueue(GALLERY_PROCESS_JOB, { itemId: id }, { tx });
    });
    this.publish([{ resource: ChangeSource.GALLERY_ITEM, kind: ChangeKind.UPDATE, id }]);
    return this.findOne(id);
  }

  async remove(id: string, actor: AuthUser): Promise<void> {
    const albums = await this.repo.albumsOf(id);
    await withTransaction(this.db, async (tx) => {
      const row = await this.repo.softDelete(id, actor.id, tx);
      if (!row) throw new AppException('GALLERY_ITEM_NOT_FOUND');
      await this.audit.record(
        {
          action: 'galleryItem.delete',
          resourceType: RESOURCE_TYPE.GALLERY_ITEM,
          resourceId: id,
          resourceName: row.title,
          changes: { before: { title: row.title, albums: albums.map((album) => album.id) } },
        },
        tx,
      );
    });
    this.publish([
      this.itemChange(
        ChangeKind.DELETE,
        id,
        albums.map((album) => album.id),
      ),
    ]);
  }

  /** 還原（回收桶）：相簿的關聯沒有刪過，一起回來。 */
  async restore(id: string, actor: AuthUser): Promise<GalleryItemDetailDto> {
    const deleted = await this.repo.findDeletedById(id);
    if (!deleted) {
      if (await this.repo.findVisible(id)) throw new AppException('GALLERY_ITEM_NOT_DELETED');
      throw new AppException('GALLERY_ITEM_NOT_FOUND');
    }
    await withTransaction(this.db, async (tx) => {
      const row = await this.repo.restore(id, actor.id, tx);
      // 檢查之後被別人搶先還原
      if (!row) throw new AppException('GALLERY_ITEM_NOT_DELETED');
      await this.audit.record(
        {
          action: 'galleryItem.restore',
          resourceType: RESOURCE_TYPE.GALLERY_ITEM,
          resourceId: id,
          resourceName: row.title,
          changes: { after: { title: row.title } },
          metadata: { deletedAt: deleted.deletedAt?.toISOString() },
        },
        tx,
      );
    });
    const albums = await this.repo.albumsOf(id);
    // 重新出現在列表：以 create 宣告（與其他資源的還原相同）
    this.publish([
      this.itemChange(
        ChangeKind.CREATE,
        id,
        albums.map((album) => album.id),
      ),
    ]);
    return this.findOne(id);
  }

  // ── 給其他元件（標籤、留言、圖片來源） ──

  /** 看得到的一張（ready、沒刪除）；不存在拋 `GALLERY_ITEM_NOT_FOUND`。 */
  async getVisible(id: string): Promise<GalleryItemRow> {
    const item = await this.repo.findVisible(id);
    if (!item) throw new AppException('GALLERY_ITEM_NOT_FOUND');
    return item;
  }

  findVisible(id: string): Promise<GalleryItemRow | undefined> {
    return this.repo.findVisible(id);
  }

  /** 標籤或留言改了（交易提交後）：推一筆圖片的更新，看得到它的人重抓。 */
  publishChanged(id: string): void {
    this.publish([{ resource: ChangeSource.GALLERY_ITEM, kind: ChangeKind.UPDATE, id }]);
  }

  async toSummaries(rows: readonly GalleryItemRow[]): Promise<GalleryItemDto[]> {
    const tags = await this.tags.tagsOf(
      RESOURCE_TYPE.GALLERY_ITEM,
      rows.map((row) => row.id),
    );
    const summaries = await Promise.all(
      rows.map(async (row): Promise<GalleryItemDto | undefined> => {
        const image = await this.urls.sourcesOf(row);
        if (!image) return undefined;
        const size = displaySize(row);
        return {
          id: row.id,
          title: row.title,
          description: row.description,
          contentType: row.contentType,
          size: row.size,
          width: size.width,
          height: size.height,
          displayRotation: row.displayRotation as 0 | 90 | 180 | 270,
          dominantColor: row.dominantColor,
          placeholder: row.placeholder,
          takenAt: row.takenAt?.toISOString() ?? null,
          sortAt: row.sortAt.toISOString(),
          createdAt: row.createdAt.toISOString(),
          image,
          tags: tags.get(row.id) ?? [],
          version: row.version,
        };
      }),
    );
    return summaries.filter((summary): summary is GalleryItemDto => summary !== undefined);
  }

  // ── 內部 ──

  private sortOf(entries: ListGalleryItemsDto['sort']): GallerySort {
    const [first] = entries;
    return { field: first?.sort ?? 'sortAt', order: first?.order ?? 'desc' };
  }

  private usageFilter(usageId: string | undefined): GalleryItemFilter['usage'] {
    if (!usageId) return undefined;
    const usage = this.images.findUsage(usageId);
    if (!usage) throw new AppException('VALIDATION_FAILED', { fields: { imageUsage: 'unknown' } });
    return { contentTypes: usage.contentTypes, maxSize: usage.maxSize };
  }

  private maxItemSize(): number {
    return tenantFeatureParam(GALLERY_MAX_ITEM_SIZE_MB_PARAM) * MIB;
  }

  /** 型別與大小（以宣告或來源回報的值；處理時再以檔頭與實際內容檢查一次）。HEIC 在這裡擋下（D6）。 */
  private assertAcceptable(contentType: string, size: number): void {
    if (!isGalleryType(contentType)) {
      throw new AppException('GALLERY_TYPE_NOT_ALLOWED', {
        contentTypes: [...GALLERY_CONTENT_TYPES],
      });
    }
    const maxSize = this.maxItemSize();
    if (size > maxSize) throw new AppException('GALLERY_ITEM_TOO_LARGE', { maxSize });
  }

  private async requireAlbum(albumId: string): Promise<void> {
    if (!(await this.albums.findActive(albumId))) throw new AppException('GALLERY_ALBUM_NOT_FOUND');
  }

  private async insert(
    values: Parameters<GalleryItemRepository['create']>[0],
    tx: Transaction,
  ): Promise<GalleryItemRow> {
    const row = await this.repo.create(values, tenantStorageQuotaBytes(), tx);
    // 同時的登記先用掉了容量
    if (!row) throw storageQuotaExceeded(await this.repo.storageUsed(tx), values.size);
    return row;
  }

  /** 複製一筆來源的圖並登記；來源的物件已經不在（剛被刪除）回 undefined。 */
  private async copyIn(
    dto: CreateGalleryFromSourceDto,
    refId: string,
    resolved: { storageKey: string; contentType: string; size: number; name: string },
    actor: AuthUser,
  ): Promise<string | undefined> {
    await this.capacity.assertCanStore(resolved.size);
    const id = randomUUID();
    const target = uploadKeyOf(id);
    if (!(await this.storage.copyObject(resolved.storageKey, target))) return undefined;
    try {
      await withTransaction(this.db, async (tx) => {
        await this.insert(
          {
            id,
            title: titleFromFileName(resolved.name),
            status: 'processing',
            contentType: resolved.contentType,
            size: resolved.size,
            source: dto.source,
            sourceRefId: refId,
            sourceName: resolved.name,
            queuedAt: new Date(),
            createdBy: actor.id,
            updatedBy: actor.id,
          },
          tx,
        );
        if (dto.albumId) await this.albums.addItems(dto.albumId, [id], actor.id, tx);
        await this.jobs.enqueue(GALLERY_PROCESS_JOB, { itemId: id }, { tx });
      });
    } catch (error) {
      // 登記失敗（容量）：剛複製的物件沒有紀錄，盡力刪掉（漏掉的由清理排程的殘留對帳處理）
      await this.storage.delete(target).catch((deleteError: unknown) => {
        this.logger.warn({ err: deleteError, itemId: id }, '刪除複製的物件失敗，留下殘留物件');
      });
      throw error;
    }
    return id;
  }

  private itemChange(
    kind: ChangeKind,
    id: string,
    albumIds: readonly string[],
  ): ResourceChangeWire {
    return albumIds.length > 0
      ? {
          resource: ChangeSource.GALLERY_ITEM,
          kind,
          id,
          refs: { [ChangeSource.GALLERY_ALBUM]: [...albumIds] },
        }
      : { resource: ChangeSource.GALLERY_ITEM, kind, id };
  }

  private publish(changes: ResourceChangeWire[]): void {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, { changes });
  }
}
