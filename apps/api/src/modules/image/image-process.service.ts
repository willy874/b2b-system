import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';

import { ChangeKind, ChangeSource } from '@b2b-system/realtime';
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { OnModuleInit } from '@nestjs/common';

import type { Database } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import { DomainEvent, DomainEventBus } from '@/core/events';
import {
  deliveryFormatsOf,
  ImageDecodeError,
  ImageProcessor,
  primaryFormatOf,
  renditionKey,
} from '@/core/image';
import type { DecodedImage, ImageFormat, ImageInfo } from '@/core/image';
import { JobQueue } from '@/core/jobs';
import { ObjectStorage } from '@/core/storage';
import type { ImageAssetRow, ImageAssetVariants } from '@/db/schema';

import { ImageAssetRepository } from './image-asset.repository';
import { toPixelRegion } from './image-crop';
import { ImageOwnerRegistry } from './image-owner.registry';
import { IMAGE_PROCESS_JOB } from './image-process.job';
import { SNIFF_BYTES, sniffImageType } from './image-sniff';
import { ImageUsageRegistry } from './image-usage.registry';
import type { ImageUsageDefinition } from './image-usage.registry';
import { IMAGE_MASTER_MAX_EDGE, masterKeyOf, revPrefixOf, uploadKeyOf } from './image.constants';
import type { ImageFailureReason } from './image.constants';

/** 讀主檔的位元組上限：主檔長邊不超過 4096，正規化之後遠小於這個數字。 */
const MASTER_MAX_BYTES = 64 * 1024 * 1024;

/** 讀不到（不存在）或超過上限。 */
type ReadResult = { data: Buffer } | { missing: true } | { tooLarge: true };

/**
 * `image.process` 的本體（docs/architecture/backend/25-image.md §15.5）：
 *
 * 1. 還沒有主檔：讀原檔 → 以檔頭判斷型別（不信任宣告的型別，也不讓 SVG 進到解碼器）→ 解碼、轉正、長邊縮到 4096、
 *    移除中繼資料 → 寫主檔（未裁切）→ 計入容量的大小改成主檔的 → 刪原檔；
 * 2. 要求的版本（`rev`）還沒寫好：以主檔套用裁切 → 每個 preset 的 1x、2x × 主格式與 WebP，寫到 `r<rev>/` → 狀態 ready；
 * 3. 推給建立者本人；資產已被某個資源使用時，通知擁有者推它自己的變更。
 *
 * 失敗（不是圖片、太小、型別不符）不會因為重試而成功：還沒有任何版本的資產標成 `failed`；已經有版本的（重新裁切）保留原本的版本。
 * 儲存服務暫時不可用則拋出，交給背景工作重試。
 */
@Injectable()
export class ImageProcessService implements OnModuleInit {
  private readonly logger = new Logger(ImageProcessService.name);

  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: ImageAssetRepository,
    private readonly usages: ImageUsageRegistry,
    private readonly owners: ImageOwnerRegistry,
    private readonly storage: ObjectStorage,
    private readonly images: ImageProcessor,
    private readonly events: DomainEventBus,
    private readonly jobs: JobQueue,
  ) {}

  onModuleInit(): void {
    this.jobs.register(IMAGE_PROCESS_JOB, ({ assetId }) => this.process(assetId));
  }

  async process(assetId: string): Promise<void> {
    let row = await this.repo.findById(assetId);
    if (!row || row.status === 'failed') return;
    const usage = this.usages.find(row.usage);
    if (!usage) {
      this.logger.warn({ assetId, usage: row.usage }, '圖片用途沒有登記，略過處理');
      return;
    }

    let master: { data: Buffer; info: ImageInfo; format: ImageFormat } | undefined;
    if (!row.masterFormat) {
      const normalized = await this.normalize(row, usage);
      if (!normalized) return;
      master = normalized;
      row = (await this.repo.findById(assetId)) ?? row;
    }
    if (row.variantRev === row.rev) return;
    await this.renderRevision(row, usage, master);
  }

  /** 步驟 1：寫主檔。失敗（已標成 failed）回 undefined。 */
  private async normalize(
    row: ImageAssetRow,
    usage: ImageUsageDefinition,
  ): Promise<{ data: Buffer; info: ImageInfo; format: ImageFormat } | undefined> {
    const uploadKey = uploadKeyOf(row.id);
    const read = await this.read(uploadKey, usage.maxSize);
    if ('missing' in read) return this.fail(row, 'missing');
    if ('tooLarge' in read) {
      await this.storage.delete(uploadKey);
      return this.fail(row, 'tooLarge');
    }
    const type = sniffImageType(read.data.subarray(0, SNIFF_BYTES));
    if (!type) return this.fail(row, 'notImage');
    if (!usage.contentTypes.includes(type)) return this.fail(row, 'typeNotAllowed');

    let decoded: DecodedImage;
    try {
      decoded = await this.images.decode(read.data, { maxBytes: usage.maxSize });
    } catch (error) {
      if (!(error instanceof ImageDecodeError)) throw error;
      this.logger.warn({ err: error, assetId: row.id }, '無法解碼圖片');
      return this.fail(row, 'notImage');
    }
    let rendered;
    const format = primaryFormatOf(decoded.info);
    try {
      rendered = await decoded.render({ format, maxEdge: IMAGE_MASTER_MAX_EDGE });
    } catch (error) {
      if (!(error instanceof ImageDecodeError)) throw error;
      return this.fail(row, 'notImage');
    } finally {
      await decoded.dispose();
    }

    await this.storage.putObject(masterKeyOf(row.id, format), rendered.data, {
      contentType: rendered.contentType,
    });
    const info = {
      width: rendered.width,
      height: rendered.height,
      hasAlpha: decoded.info.hasAlpha,
    };
    await withTransaction(this.db, (tx) =>
      this.repo.setMaster(
        row.id,
        {
          width: info.width,
          height: info.height,
          hasAlpha: info.hasAlpha,
          masterFormat: format,
          contentType: rendered.contentType,
          size: rendered.data.length,
          contentHash: createHash('sha256').update(rendered.data).digest('hex'),
        },
        tx,
      ),
    );
    // 原檔不保留（手機照片的 GPS 等中繼資料不會跟著頭像被所有人下載）；刪不掉由清理排程對帳
    await this.storage.delete(uploadKey).catch((error: unknown) => {
      this.logger.warn({ err: error, assetId: row.id }, '刪除圖片的原檔失敗');
    });
    return { data: rendered.data, info, format };
  }

  /** 步驟 2：以主檔產生要求的版本。 */
  private async renderRevision(
    row: ImageAssetRow,
    usage: ImageUsageDefinition,
    cached: { data: Buffer; info: ImageInfo } | undefined,
  ): Promise<void> {
    const { masterFormat, width, height } = row;
    if (!masterFormat || !width || !height) return;
    let data = cached?.data;
    if (!data) {
      const read = await this.read(
        masterKeyOf(row.id, masterFormat as ImageFormat),
        MASTER_MAX_BYTES,
      );
      if (!('data' in read)) {
        this.logger.warn({ assetId: row.id }, '圖片的主檔不存在');
        if (row.variantRev === null) await this.fail(row, 'missing');
        return;
      }
      data = read.data;
    }

    const size = { width, height };
    const region = toPixelRegion(row.crop, size, usage.aspectRatio);
    const cropped = region ? { width: region.width, height: region.height } : size;
    if (cropped.width < usage.minWidth || cropped.height < usage.minHeight) {
      // 建立與重新裁切時已經擋過；走到這裡是主檔比預期的小（例：來源回報的尺寸不準）
      if (row.variantRev === null) await this.fail(row, 'tooSmall');
      return;
    }

    const rev = row.rev;
    const prefix = revPrefixOf(row.id, rev);
    let decoded: DecodedImage;
    try {
      decoded = await this.images.decode(data, { maxBytes: MASTER_MAX_BYTES });
    } catch (error) {
      if (!(error instanceof ImageDecodeError)) throw error;
      if (row.variantRev === null) await this.fail(row, 'notImage');
      return;
    }
    const formats = deliveryFormatsOf(decoded.info);
    const renditions: ImageAssetVariants['renditions'] = {};
    try {
      // 2x 與另一個尺寸一樣大（主檔不夠大、或 sm@2x 剛好等於 md）時共用物件（`sameAs`），不重複寫
      const seen = new Map<string, string>();
      for (const [name, edge] of presetRenditions(usage)) {
        const expected = expectedSize(cropped, edge);
        const key = `${expected.width}x${expected.height}`;
        const same = seen.get(key);
        if (same) {
          const target = renditions[same];
          if (target)
            renditions[name] = { width: target.width, height: target.height, sameAs: same };
          continue;
        }
        seen.set(key, name);
        for (const format of formats) {
          // oxlint-disable-next-line no-await-in-loop -- 依序輸出，同時只有一份解碼緩衝（docs/architecture/backend/25-image.md §11）
          const rendered = await decoded.render({ format, maxEdge: edge, extract: region });
          // oxlint-disable-next-line no-await-in-loop -- 同上
          await this.storage.putObject(renditionKey(prefix, name, format), rendered.data, {
            contentType: rendered.contentType,
          });
          renditions[name] ??= { width: rendered.width, height: rendered.height };
        }
      }
    } catch (error) {
      if (!(error instanceof ImageDecodeError)) throw error;
      this.logger.warn({ err: error, assetId: row.id }, '無法產生圖片的變體');
      if (row.variantRev === null) await this.fail(row, 'notImage');
      return;
    } finally {
      await decoded.dispose();
    }

    const variants: ImageAssetVariants = { ...cropped, formats, renditions };
    // 舊版本的網址最多還能用一個效期：過了之後再刪
    const purgeAfter = new Date(Date.now() + usage.urlTtl * 1000);
    const updated = await this.repo.setVariants(row.id, rev, variants, purgeAfter);
    if (!updated) {
      // 處理途中又重新裁切了：剛寫好的版本沒人會用，交給清理；新的版本由它自己的工作產生
      await this.repo.scheduleStaleRevsPurge(row.id, purgeAfter);
      return;
    }
    this.publish(updated);
    if (updated.ownerType && updated.ownerId && !updated.detachedAt) {
      await this.owners.notifyReady(updated.ownerType, updated.ownerId);
    }
  }

  private async fail(row: ImageAssetRow, reason: ImageFailureReason): Promise<undefined> {
    const failed = await this.repo.markFailed(row.id, reason);
    if (failed) this.publish(failed);
    return undefined;
  }

  /** 處理結果只推給建立者本人（上傳的對話框等著它；§15.9）。 */
  private publish(row: ImageAssetRow): void {
    if (!row.createdBy) return;
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [],
      perRecipient: [
        {
          userId: row.createdBy,
          changes: [{ resource: ChangeSource.IMAGE, kind: ChangeKind.UPDATE, id: row.id }],
        },
      ],
    });
  }

  /** 讀整個物件（圖片資產的上限是用途的 `maxSize`，十幾 MiB 以內）；超過上限就停止讀取。 */
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

/** 每個 preset 的 1x 與 2x（長邊 px），依宣告的順序。 */
function presetRenditions(usage: ImageUsageDefinition): Array<[string, number]> {
  return Object.entries(usage.presets).flatMap(([name, edge]): Array<[string, number]> => [
    [name, edge],
    [`${name}@2x`, edge * 2],
  ]);
}

/** 長邊縮到 `edge`、不放大之後的尺寸（只用來判斷兩個尺寸是不是同一個物件；實際尺寸以輸出為準）。 */
function expectedSize(
  size: { width: number; height: number },
  edge: number,
): { width: number; height: number } {
  const scale = Math.min(1, edge / Math.max(size.width, size.height));
  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}
