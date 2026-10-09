import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import type { ResourceChangeWire } from '@b2b-system/realtime';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import type { Database } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import { DomainEvent, DomainEventBus } from '@/core/events';
import {
  deliveryFormatsOf,
  encodeBlurHash,
  ImageDecodeError,
  ImageProcessor,
  parseExif,
  primaryFormatOf,
  renditionKey,
  stripGpsFromOriginal,
  toHexColor,
} from '@/core/image';
import type { DecodedImage, ImageRotation } from '@/core/image';
import { JobQueue } from '@/core/jobs';
import { galleryProcessDuration, galleryProcessFailures } from '@/core/metrics/instruments';
import { RESOURCE_TYPE } from '@/core/resource';
import { DEFAULT_TIMEZONE_SETTING, SettingService } from '@/core/settings';
import { ObjectStorage } from '@/core/storage';
import { GALLERY_MAX_ITEM_SIZE_MB_PARAM, tenantFeatureParam } from '@/core/tenant';
import type { GalleryItemRow, GalleryItemVariants } from '@/db/schema';
import { AuditService } from '@/modules/audit-log/audit.service';
import { SNIFF_BYTES, sniffImageType } from '@/modules/image/image-sniff';

import { takenAtOf, toGalleryExif } from './gallery-exif';
import { GalleryItemRepository } from './gallery-item.repository';
import { GALLERY_PROCESS_JOB } from './gallery-process.job';
import {
  GALLERY_CONTENT_TYPES,
  GALLERY_PLACEHOLDER_EDGE,
  GALLERY_READ_MAX_BYTES,
  GALLERY_RENDITIONS,
  GALLERY_URL_TTL,
  originalKeyOf,
  revPrefixOf,
  uploadKeyOf,
} from './gallery.constants';
import type { GalleryFailureReason } from './gallery.constants';
import { GALLERY_STRIP_ORIGINAL_LOCATION_SETTING } from './gallery.settings';

const MIB = 1024 * 1024;

type ReadResult = { data: Buffer } | { missing: true } | { tooLarge: true };

/** 原檔寫好之後交給第二步的內容（同一個工作內不必再讀一次）。 */
interface OriginalBuffer {
  data: Buffer;
}

function rotatedSize(size: { width: number; height: number }, rotate: number) {
  return rotate === 90 || rotate === 270 ? { width: size.height, height: size.width } : size;
}

/** 長邊縮到 `edge`、不放大之後的尺寸（只用來判斷兩個尺寸是不是同一個物件）。 */
function expectedSize(size: { width: number; height: number }, edge: number) {
  const scale = Math.min(1, edge / Math.max(size.width, size.height));
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/**
 * `gallery.process` 的本體（docs/architecture/backend/26-gallery.md §5）：
 *
 * 1. 還沒有原檔：讀上傳（或複製來）的檔案 → 以檔頭判斷型別（不信任宣告的型別，也不讓 SVG、HEIC 進到解碼器）→
 *    解碼、讀 EXIF（拍攝時間、相機…，不存 GPS）→ 依系統設定以 **不重新編碼像素** 的方式移除 GPS（D5）→
 *    寫 `original` 一次、SHA-256、主色 → 計入容量的大小改成原檔的 → 刪除上傳的檔案；
 * 2. 要求的版本（`rev`）還沒寫好：依顯示方向產生 thumb／medium／large × 主格式與 WebP 與 BlurHash，寫到 `r<rev>/` →
 *    ready。第一次 ready 時寫 `galleryItem.create` 的稽核、推 `create`；之後（調整方向）推 `update`。
 *
 * 失敗（不是圖片、型別不收、太大、原檔不見）不會因為重試而成功：還沒有任何版本的標成 `failed`；
 * 已經有版本的（調整方向）保留原本的版本。儲存服務暫時不可用則拋出，交給背景工作重試。
 */
@Injectable()
export class GalleryProcessService implements OnModuleInit {
  private readonly logger = new Logger(GalleryProcessService.name);

  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: GalleryItemRepository,
    private readonly storage: ObjectStorage,
    private readonly images: ImageProcessor,
    private readonly settings: SettingService,
    private readonly audit: AuditService,
    private readonly events: DomainEventBus,
    private readonly jobs: JobQueue,
  ) {}

  onModuleInit(): void {
    this.jobs.register(GALLERY_PROCESS_JOB, ({ itemId }) => this.process(itemId));
  }

  async process(itemId: string): Promise<void> {
    let row = await this.repo.findById(itemId);
    if (!row || row.status === 'pending' || row.status === 'failed') return;

    let original: OriginalBuffer | undefined;
    if (!row.hasOriginal) {
      original = await this.measure('original', () => this.writeOriginal(row as GalleryItemRow));
      if (!original) return;
      row = (await this.repo.findById(itemId)) ?? row;
    }
    if (row.variantRev === row.rev) return;
    const current = row;
    await this.measure('variants', () => this.renderRevision(current, original));
  }

  private async measure<T>(step: 'original' | 'variants', work: () => Promise<T | undefined>) {
    const end = galleryProcessDuration.startTimer({ step });
    try {
      const result = await work();
      end({ result: result === undefined ? 'failed' : 'ok' });
      return result;
    } catch (error) {
      end({ result: 'failed' });
      throw error;
    }
  }

  /** 步驟 1：寫原檔與它的描述。失敗（已標成 failed）回 undefined。 */
  private async writeOriginal(row: GalleryItemRow): Promise<OriginalBuffer | undefined> {
    const uploadKey = uploadKeyOf(row.id);
    const maxBytes = Math.min(
      tenantFeatureParam(GALLERY_MAX_ITEM_SIZE_MB_PARAM) * MIB,
      GALLERY_READ_MAX_BYTES,
    );
    const read = await this.read(uploadKey, maxBytes);
    if ('missing' in read) return this.fail(row, 'missing');
    if ('tooLarge' in read) {
      await this.storage.delete(uploadKey);
      return this.fail(row, 'tooLarge');
    }
    const type = sniffImageType(read.data.subarray(0, SNIFF_BYTES));
    if (!type) return this.fail(row, 'notImage');
    if (!(GALLERY_CONTENT_TYPES as readonly string[]).includes(type)) {
      return this.fail(row, 'typeNotAllowed');
    }

    let decoded: DecodedImage;
    try {
      decoded = await this.images.decode(read.data, { maxBytes });
    } catch (error) {
      if (!(error instanceof ImageDecodeError)) throw error;
      this.logger.warn({ err: error, itemId: row.id }, '無法解碼圖片庫的圖片');
      return this.fail(row, 'notImage');
    }
    let stored: { data: Buffer; contentType: string; locationStripped: boolean };
    let dominant: { r: number; g: number; b: number };
    const fields = parseExif(decoded.exif);
    try {
      stored = await this.withoutLocation(read.data, type, decoded, fields.hasGps);
      ({ dominant } = await decoded.analyze({ maxEdge: GALLERY_PLACEHOLDER_EDGE }));
    } catch (error) {
      if (!(error instanceof ImageDecodeError)) throw error;
      return this.fail(row, 'notImage');
    } finally {
      await decoded.dispose();
    }

    await this.storage.putObject(originalKeyOf(row.id), stored.data, {
      contentType: stored.contentType,
    });
    const timeZone = await this.settings.get(DEFAULT_TIMEZONE_SETTING);
    await withTransaction(this.db, (tx) =>
      this.repo.setOriginal(
        row.id,
        {
          contentType: stored.contentType,
          size: stored.data.length,
          width: decoded.info.width,
          height: decoded.info.height,
          contentHash: createHash('sha256').update(stored.data).digest('hex'),
          exif: toGalleryExif(fields),
          takenAt: takenAtOf(fields, timeZone),
          locationStripped: stored.locationStripped,
          dominantColor: toHexColor(dominant),
          variantFormat: primaryFormatOf(decoded.info),
        },
        tx,
      ),
    );
    // 上傳的檔案不保留；刪不掉由清理排程對帳
    await this.storage.delete(uploadKey).catch((error: unknown) => {
      this.logger.warn({ err: error, itemId: row.id }, '刪除圖片庫上傳的檔案失敗');
    });
    return { data: stored.data };
  }

  /**
   * 依系統設定移除原檔的 GPS（D5）：就地清掉 EXIF 裡的 GPS（不重新編碼像素）；在檔案裡找不到 EXIF 的位置時，
   * 退回重新輸出一份沒有中繼資料的檔案（主格式），寧可多一次編碼也不讓位置外洩。
   */
  private async withoutLocation(
    data: Buffer,
    contentType: string,
    decoded: DecodedImage,
    hasGps: boolean,
  ): Promise<{ data: Buffer; contentType: string; locationStripped: boolean }> {
    if (!hasGps || !(await this.settings.get(GALLERY_STRIP_ORIGINAL_LOCATION_SETTING))) {
      return { data, contentType, locationStripped: false };
    }
    const result = stripGpsFromOriginal(data, contentType, decoded.exif);
    if (result.located) {
      return { data: result.data, contentType, locationStripped: result.stripped };
    }
    this.logger.warn({ contentType }, '找不到 EXIF 在原檔裡的位置，改為重新輸出移除中繼資料的原檔');
    const rendered = await decoded.render({ format: primaryFormatOf(decoded.info), quality: 95 });
    return { data: rendered.data, contentType: rendered.contentType, locationStripped: true };
  }

  /** 步驟 2：以原檔產生要求的版本。 */
  private async renderRevision(
    row: GalleryItemRow,
    cached: OriginalBuffer | undefined,
  ): Promise<true | undefined> {
    let data = cached?.data;
    if (!data) {
      const read = await this.read(originalKeyOf(row.id), GALLERY_READ_MAX_BYTES);
      if (!('data' in read)) {
        this.logger.warn({ itemId: row.id }, '圖片庫的原檔不存在');
        if (row.variantRev === null) await this.fail(row, 'missing');
        return undefined;
      }
      data = read.data;
    }

    const rev = row.rev;
    const rotate = row.displayRotation as ImageRotation;
    const prefix = revPrefixOf(row.id, rev);
    let decoded: DecodedImage;
    try {
      decoded = await this.images.decode(data, { maxBytes: GALLERY_READ_MAX_BYTES });
    } catch (error) {
      if (!(error instanceof ImageDecodeError)) throw error;
      if (row.variantRev === null) await this.fail(row, 'notImage');
      return undefined;
    }
    const size = rotatedSize(decoded.info, rotate);
    const formats = deliveryFormatsOf(decoded.info);
    const renditions: GalleryItemVariants['renditions'] = {};
    let placeholder: string | null = null;
    try {
      // 原圖比某個尺寸小時，那個尺寸與更小的那一個是同一個物件（`sameAs`），不重複寫
      const seen = new Map<string, string>();
      for (const [name, edge] of Object.entries(GALLERY_RENDITIONS)) {
        const expected = expectedSize(size, edge);
        const key = `${expected.width}x${expected.height}`;
        const same = seen.get(key);
        const target = same ? renditions[same] : undefined;
        if (same && target) {
          renditions[name] = { width: target.width, height: target.height, sameAs: same };
          continue;
        }
        seen.set(key, name);
        for (const format of formats) {
          // oxlint-disable-next-line no-await-in-loop -- 依序輸出，同時只有一份解碼緩衝（docs/architecture/backend/25-image.md §11）
          const rendered = await decoded.render({ format, maxEdge: edge, rotate });
          // oxlint-disable-next-line no-await-in-loop -- 同上
          await this.storage.putObject(renditionKey(prefix, name, format), rendered.data, {
            contentType: rendered.contentType,
          });
          renditions[name] ??= { width: rendered.width, height: rendered.height };
        }
      }
      const { preview } = await decoded.analyze({ maxEdge: GALLERY_PLACEHOLDER_EDGE, rotate });
      placeholder = encodeBlurHash(preview);
    } catch (error) {
      if (!(error instanceof ImageDecodeError)) throw error;
      this.logger.warn({ err: error, itemId: row.id }, '無法產生圖片庫的變體');
      if (row.variantRev === null) await this.fail(row, 'notImage');
      return undefined;
    } finally {
      await decoded.dispose();
    }

    const variants: GalleryItemVariants = {
      width: size.width,
      height: size.height,
      formats,
      renditions,
    };
    // 舊版本的網址最多還能用一個效期：過了之後再刪（D14）
    const purgeAfter = new Date(Date.now() + GALLERY_URL_TTL * 1000);
    const actor = await this.repo.actorOf(row.createdBy);
    const result = await withTransaction(this.db, async (tx) => {
      const updated = await this.repo.setVariants(
        row.id,
        rev,
        variants,
        placeholder,
        purgeAfter,
        tx,
      );
      if (updated && !updated.wasReady) {
        // 處理完成才算建立（只有 ready 的圖出現在圖片庫）：操作者是上傳（或加入）的人
        await this.audit.record(
          {
            action: 'galleryItem.create',
            resourceType: RESOURCE_TYPE.GALLERY_ITEM,
            resourceId: row.id,
            resourceName: updated.row.title,
            actorId: actor?.id,
            actorEmail: actor?.email ?? 'system',
            changes: {
              after: {
                title: updated.row.title,
                contentType: updated.row.contentType,
                size: updated.row.size,
                source: updated.row.source,
                sourceRefId: updated.row.sourceRefId,
                sourceName: updated.row.sourceName,
                locationStripped: updated.row.locationStripped,
              },
            },
          },
          tx,
        );
      }
      return updated;
    });
    if (!result) {
      // 處理途中又調整了方向：剛寫好的版本沒人用，交給清理；新的版本由它自己的工作產生
      await this.repo.scheduleStaleRevsPurge(row.id, purgeAfter);
      return true;
    }
    const albumIds = (await this.repo.albumsOf(row.id)).map((album) => album.id);
    const change: ResourceChangeWire = {
      resource: ChangeSource.GALLERY_ITEM,
      kind: result.wasReady ? ChangeKind.UPDATE : ChangeKind.CREATE,
      id: row.id,
      ...(albumIds.length > 0 ? { refs: { [ChangeSource.GALLERY_ALBUM]: albumIds } } : {}),
    };
    this.events.publish(DomainEvent.RESOURCE_CHANGED, { changes: [change] });
    return true;
  }

  private async fail(row: GalleryItemRow, reason: GalleryFailureReason): Promise<undefined> {
    galleryProcessFailures.inc({ reason });
    const failed = await this.repo.markFailed(row.id, reason);
    // 失敗的圖不在圖片庫：只推給上傳的人（頁首的失敗清單）
    if (failed?.createdBy) {
      this.events.publish(DomainEvent.RESOURCE_CHANGED, {
        changes: [],
        perRecipient: [
          {
            userId: failed.createdBy,
            changes: [{ resource: ChangeSource.GALLERY_ITEM, kind: ChangeKind.UPDATE, id: row.id }],
          },
        ],
      });
    }
    return undefined;
  }

  /** 讀整個物件；超過上限就停止讀取。 */
  private async read(key: string, maxBytes: number): Promise<ReadResult> {
    // 儲存服務不可用（`FILE_STORAGE_UNAVAILABLE`）照原樣拋出，交給背景工作重試
    const stream: Readable | undefined = await this.storage.getObject(key);
    if (!stream) return { missing: true };
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of stream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
      total += buffer.length;
      if (total > maxBytes) {
        stream.destroy();
        return { tooLarge: true };
      }
      chunks.push(buffer);
    }
    return { data: Buffer.concat(chunks) };
  }
}
