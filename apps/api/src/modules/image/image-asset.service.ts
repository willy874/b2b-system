import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { AuthUser } from '@/common/types';
import type { Env } from '@/core/config';
import type { Database, DbOrTx, Transaction } from '@/core/database';
import { TENANT_DB, withTransaction } from '@/core/database';
import { AppException } from '@/core/errors';
import { densityLayouts, ImageUrlService } from '@/core/image';
import type { ImageFormat, ImageObjectSet, ImageSources } from '@/core/image';
import { JobQueue } from '@/core/jobs';
import { ObjectStorage, ObjectUrlSigner } from '@/core/storage';
import type { CdnResource } from '@/core/storage';
import type { PresignedRequest } from '@/core/storage';
import { StorageCapacity, storageQuotaExceeded, tenantStorageQuotaBytes } from '@/core/usage';
import type { ImageAssetRow, ImageCrop } from '@/db/schema';

import type {
  CompleteImageUploadDto,
  CreateImageFromSourceDto,
  CreateImageUploadDto,
  ImageAssetDto,
  ImageUploadDto,
  ImageUsageDto,
} from './dto/image.dto';
import { ImageAssetRepository } from './image-asset.repository';
import { croppedSize, isValidCrop } from './image-crop';
import type { ImageOwnerDefinition } from './image-owner.registry';
import { ImageOwnerRegistry } from './image-owner.registry';
import { IMAGE_PROCESS_JOB } from './image-process.job';
import { ImageSourceRegistry } from './image-source.registry';
import { ImageUsageRegistry } from './image-usage.registry';
import type { ImageUsageDefinition } from './image-usage.registry';
import {
  IMAGE_FAILURE_REASONS,
  IMAGE_PENDING_PER_USER,
  IMAGE_RECENT_LIMIT,
  IMAGE_SOURCE,
  masterKeyOf,
  revPrefixOf,
  uploadKeyOf,
} from './image.constants';
import type { ImageFailureReason } from './image.constants';

/** consumer 把資產交給自己的資源（例：使用者的頭像）。 */
export interface ImageOwnerRef {
  ownerType: string;
  ownerId: string;
}

/** 資產可以由 CDN 送出時的資源類型（`ObjectUrlSigner` 的 `cdn`；物件只寫一次，docs/architecture/backend/09-file.md §16.2）。 */
const IMAGE_ASSET_CDN: CdnResource = 'imageAsset';

/**
 * 圖片資產（docs/architecture/backend/25-image.md §15）。
 *
 * - 建立：上傳（`createUpload` → 瀏覽器直傳 → `completeUpload`）或從其他來源複製（`createFromSource`）；
 *   兩者的結果都是一筆 `pending` 的資產，交給背景工作 `image.process` 正規化並產生變體。
 * - 上傳與「最近使用」只要登入（`@Authenticated()`）：能不能「用」由 consumer 儲存時的權限決定。
 * - consumer（頭像等）只存 `id`，在自己的寫入交易內 `claim` / `detach` / `recrop`，組回應時以 `sourcesOf` 帶網址。
 */
@Injectable()
export class ImageAssetService {
  private readonly logger = new Logger(ImageAssetService.name);
  private readonly uploadUrlTtl: number;

  constructor(
    @Inject(TENANT_DB) private readonly db: Database,
    private readonly repo: ImageAssetRepository,
    private readonly usages: ImageUsageRegistry,
    private readonly sources: ImageSourceRegistry,
    private readonly owners: ImageOwnerRegistry,
    private readonly storage: ObjectStorage,
    private readonly signer: ObjectUrlSigner,
    private readonly urls: ImageUrlService,
    private readonly jobs: JobQueue,
    private readonly capacity: StorageCapacity,
    config: ConfigService<Env, true>,
  ) {
    this.uploadUrlTtl = config.get('FILE_URL_TTL', { infer: true });
  }

  // ── 登記（consumer 在 onModuleInit 呼叫） ──

  registerUsage(definition: ImageUsageDefinition): void {
    this.usages.register(definition);
  }

  registerOwner(definition: ImageOwnerDefinition): void {
    this.owners.register(definition);
  }

  /** 用途的限制（例：檔案的選圖過濾）；沒有登記回 undefined。 */
  findUsage(usageId: string): ImageUsageDefinition | undefined {
    return this.usages.find(usageId);
  }

  // ── 端點 ──

  listUsages(): { items: ImageUsageDto[] } {
    return {
      items: this.usages.list().map((usage) => ({
        id: usage.id,
        maxSize: usage.maxSize,
        contentTypes: [...usage.contentTypes],
        minWidth: usage.minWidth,
        minHeight: usage.minHeight,
        aspectRatio: usage.aspectRatio ?? null,
        presets: { ...usage.presets },
        sources: usage.sources ? [...usage.sources] : null,
      })),
    };
  }

  /** 登記一次上傳並發直傳網址（大小、型別與「只能寫一次」簽進網址）。 */
  async createUpload(dto: CreateImageUploadDto, actor: AuthUser): Promise<ImageUploadDto> {
    const usage = this.requireUsage(dto.usage, IMAGE_SOURCE.UPLOAD);
    assertAcceptable(usage, dto.contentType, dto.size);
    await this.assertCanCreate(actor, dto.size);
    await this.storage.ensureBucket();

    const id = randomUUID();
    const row = await withTransaction(this.db, (tx) =>
      this.insert(
        {
          id,
          usage: usage.id,
          source: IMAGE_SOURCE.UPLOAD,
          sourceRefId: null,
          sourceName: dto.name,
          contentType: dto.contentType,
          size: dto.size,
          createdBy: actor.id,
        },
        tx,
      ),
    );
    const upload = await this.storage.presignUpload(uploadKeyOf(id), {
      contentType: dto.contentType,
      contentLength: dto.size,
      expiresIn: this.uploadUrlTtl,
    });
    return { asset: await this.toDto(row), upload: toUploadTarget(upload) };
  }

  /** 確認直傳完成：向物件儲存確認內容，排入處理。可以一併帶裁切（選好、裁好才上傳）。 */
  async completeUpload(
    id: string,
    dto: CompleteImageUploadDto,
    actor: AuthUser,
  ): Promise<ImageAssetDto> {
    const row = await this.getOwn(id, actor);
    if (row.queuedAt) throw new AppException('IMAGE_ALREADY_UPLOADED');
    const usage = this.usages.get(row.usage);
    if (dto.crop) assertCrop(dto.crop, usage, undefined);

    const key = uploadKeyOf(id);
    const stored = await this.storage.head(key);
    if (!stored) throw new AppException('IMAGE_UPLOAD_INCOMPLETE');
    // api 從不要求瀏覽器帶 Content-Encoding；大小不符的內容刪掉，同一個網址（未過期時）可以重傳
    if (stored.contentEncoding || stored.size !== row.size) {
      await this.storage.delete(key);
      throw new AppException('IMAGE_UPLOAD_INCOMPLETE');
    }

    await withTransaction(this.db, async (tx) => {
      await this.repo.markQueued(id, tx);
      // 還沒有任何版本：直接改要求的裁切，不必遞增版本
      if (dto.crop) await this.repo.setCrop(id, dto.crop, tx);
      await this.jobs.enqueue(IMAGE_PROCESS_JOB, { assetId: id }, { tx });
    });
    return this.toDto(await this.getOwn(id, actor));
  }

  /**
   * 從其他來源（檔案管理、圖片庫、最近使用）複製成一筆新的資產（§15.2）。來源的 `resolve` 是唯一的讀取權限檢查；
   * 複製在物件儲存內完成（CopyObject），之後原本那筆的命運與這張圖無關。
   */
  async createFromSource(dto: CreateImageFromSourceDto, actor: AuthUser): Promise<ImageAssetDto> {
    const usage = this.requireUsage(dto.usage, dto.source);
    const source = this.sources.get(dto.source);
    const resolved = await source.resolve(dto.refId, actor, `imageAsset:${usage.id}`);
    assertAcceptable(usage, resolved.contentType, resolved.size);
    const known =
      resolved.normalized ??
      (resolved.width && resolved.height
        ? { width: resolved.width, height: resolved.height }
        : undefined);
    if (dto.crop) assertCrop(dto.crop, usage, known);
    else if (known) assertLargeEnough(croppedSize(null, known, usage.aspectRatio), usage);
    await this.assertCanCreate(actor, resolved.size);
    await this.storage.ensureBucket();

    const id = randomUUID();
    const { normalized } = resolved;
    // 已經是正規化過的主檔（例：另一筆資產的主檔）就直接當主檔，不再重新編碼
    const target = normalized ? masterKeyOf(id, normalized.format) : uploadKeyOf(id);
    if (!(await this.storage.copyObject(resolved.storageKey, target))) {
      throw new AppException('IMAGE_ASSET_NOT_USABLE', { reason: 'sourceMissing' });
    }
    try {
      await withTransaction(this.db, async (tx) => {
        await this.insert(
          {
            id,
            usage: usage.id,
            source: dto.source,
            sourceRefId: dto.refId,
            sourceName: resolved.name,
            contentType: resolved.contentType,
            size: resolved.size,
            crop: dto.crop ?? null,
            queuedAt: new Date(),
            createdBy: actor.id,
            ...(normalized
              ? {
                  width: normalized.width,
                  height: normalized.height,
                  hasAlpha: normalized.hasAlpha,
                  masterFormat: normalized.format,
                  contentHash: normalized.contentHash,
                }
              : {}),
          },
          tx,
        );
        await this.jobs.enqueue(IMAGE_PROCESS_JOB, { assetId: id }, { tx });
      });
    } catch (error) {
      // 登記失敗（容量）：剛複製的物件沒有紀錄，盡力刪掉（漏掉的由清理排程的殘留對帳處理）
      await this.storage.delete(target).catch((deleteError: unknown) => {
        this.logger.warn({ err: deleteError, assetId: id }, '刪除複製的物件失敗，留下殘留物件');
      });
      throw error;
    }
    return this.toDto(await this.getOwn(id, actor));
  }

  /** 自己的一筆（上傳後輪詢、收到推播後重抓）。 */
  async findOwn(id: string, actor: AuthUser): Promise<ImageAssetDto> {
    return this.toDto(await this.getOwn(id, actor));
  }

  /**
   * 「最近使用」（§15.7）：自己建立過、還沒被清除的圖片，同一個內容只列一次。以用途過濾型別與大小；
   * 尺寸太小的照樣列出（前端停用並說明原因）。
   */
  async recent(usageId: string, actor: AuthUser): Promise<{ items: ImageAssetDto[] }> {
    const usage = this.requireUsage(usageId, IMAGE_SOURCE.RECENT);
    const rows = await this.repo.recent(actor.id, IMAGE_RECENT_LIMIT);
    const usable = rows.filter(
      (row) => usage.contentTypes.includes(row.contentType) && row.size <= usage.maxSize,
    );
    return { items: await Promise.all(usable.map((row) => this.toDto(row))) };
  }

  /** 從「最近使用」移除：不影響正在使用它的資源。 */
  async hideFromRecent(id: string, actor: AuthUser): Promise<void> {
    if (!(await this.repo.hideFromRecent(id, actor.id))) {
      throw new AppException('IMAGE_ASSET_NOT_FOUND');
    }
  }

  // ── consumer 的 API（在 consumer 的寫入交易內） ──

  /**
   * 認領：把自己建立、還沒被使用、用途相同的資產交給 `owner`（例：使用者 A 的頭像）。
   * 別人的資產、已被使用的、用途不同的、處理失敗的都不行（`IMAGE_ASSET_NOT_USABLE`，§15.8）。帶 `crop` 時一併重新裁切。
   */
  async claim(
    id: string,
    owner: ImageOwnerRef,
    usageId: string,
    crop: ImageCrop | undefined,
    actor: AuthUser,
    tx: Transaction,
  ): Promise<ImageAssetRow> {
    const usage = this.usages.get(usageId);
    const current = await this.repo.findById(id, tx);
    if (!current || current.createdBy !== actor.id) throw new AppException('IMAGE_ASSET_NOT_FOUND');
    if (crop) assertCrop(crop, usage, describedSize(current));
    const claimed = await this.repo.claim(
      id,
      { ...owner, actorId: actor.id, usage: usage.id },
      crop,
      tx,
    );
    if (!claimed)
      throw new AppException('IMAGE_ASSET_NOT_USABLE', { reason: unusableReason(current, usage) });
    if (crop) await this.enqueue(id, tx);
    return claimed;
  }

  /** 換掉或拿掉某一張：保留到回收桶的保留期限後清除（§15.6）。 */
  async detach(id: string, owner: ImageOwnerRef, tx: DbOrTx): Promise<void> {
    await this.repo.detachOne(id, owner.ownerType, owner.ownerId, tx);
  }

  /** 擁有者被永久刪除：它的所有資產交給清理排程。 */
  async detachAll(owner: ImageOwnerRef, tx: DbOrTx): Promise<void> {
    await this.repo.detach(owner.ownerType, owner.ownerId, tx);
  }

  /** 重新裁切（不必重傳）：寫到新的版本，回應帶新的網址；舊版本在網址效期過後清除（docs/architecture/backend/25-image.md §16.2 D12）。 */
  async recrop(id: string, owner: ImageOwnerRef, crop: ImageCrop, tx: Transaction): Promise<void> {
    const current = await this.repo.findById(id, tx);
    if (!current || current.ownerId !== owner.ownerId || current.ownerType !== owner.ownerType) {
      throw new AppException('IMAGE_ASSET_NOT_FOUND');
    }
    assertCrop(crop, this.usages.get(current.usage), describedSize(current));
    if (!(await this.repo.recrop(id, owner, crop, tx)))
      throw new AppException('IMAGE_ASSET_NOT_FOUND');
    await this.enqueue(id, tx);
  }

  /** 組回應用：每個 id 的 `ImageSources`（還在處理、不存在的是 `null`）。不查物件儲存（R5）。 */
  async sourcesOf(ids: readonly (string | null)[]): Promise<Map<string, ImageSources | null>> {
    const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
    const rows = await this.repo.findByIds(wanted);
    const entries = await Promise.all(
      rows.map(async (row) => [row.id, await this.imageOf(row)] as const),
    );
    return new Map(entries);
  }

  /** 稽核用：資產從哪裡來（`user.update` 的 `changes` 記下 `source`、`sourceRefId`）。 */
  describeSource(row: Pick<ImageAssetRow, 'source' | 'sourceRefId'>): {
    source: string;
    sourceRefId: string | null;
  } {
    return { source: row.source, sourceRefId: row.sourceRefId };
  }

  // ── 內部 ──

  private requireUsage(usageId: string, source: string): ImageUsageDefinition {
    const usage = this.usages.find(usageId);
    // 只用來過濾的用途（docs/architecture/backend/26-gallery.md §8）不能建立圖片資產
    if (!usage || usage.filterOnly) {
      throw new AppException('VALIDATION_FAILED', { fields: { usage: 'unknown' } });
    }
    if (!this.usages.allowsSource(usage, source)) {
      throw new AppException('IMAGE_SOURCE_NOT_FOUND', { source });
    }
    return usage;
  }

  /** 處理中的上限、止水線、租戶容量（先不鎖地檢查；登記時在交易內以條件式 UPDATE 佔用）。 */
  private async assertCanCreate(actor: AuthUser, size: number): Promise<void> {
    if ((await this.repo.countPending(actor.id)) >= IMAGE_PENDING_PER_USER) {
      throw new AppException('IMAGE_PENDING_LIMIT_REACHED', { limit: IMAGE_PENDING_PER_USER });
    }
    await this.capacity.assertCanStore(size);
    const used = await this.repo.storageUsed();
    if (used + size > tenantStorageQuotaBytes()) throw storageQuotaExceeded(used, size);
  }

  private async insert(
    values: Parameters<ImageAssetRepository['create']>[0],
    tx: Transaction,
  ): Promise<ImageAssetRow> {
    const row = await this.repo.create(values, tenantStorageQuotaBytes(), tx);
    // 同時的登記先用掉了容量
    if (!row) throw storageQuotaExceeded(await this.repo.storageUsed(tx), values.size);
    return row;
  }

  private async enqueue(id: string, tx: Transaction): Promise<void> {
    await this.repo.markQueued(id, tx);
    await this.jobs.enqueue(IMAGE_PROCESS_JOB, { assetId: id }, { tx });
  }

  /** 別人的資產一律當作不存在。 */
  private async getOwn(id: string, actor: AuthUser): Promise<ImageAssetRow> {
    const row = await this.repo.findById(id);
    if (!row || row.createdBy !== actor.id) throw new AppException('IMAGE_ASSET_NOT_FOUND');
    return row;
  }

  private async toDto(row: ImageAssetRow): Promise<ImageAssetDto> {
    const usage = this.usages.find(row.usage);
    const [image, original] = await Promise.all([
      this.imageOf(row),
      row.masterFormat && row.width && row.height && usage
        ? this.signer
            .sign(masterKeyOf(row.id, row.masterFormat as ImageFormat), {
              expiresIn: usage.urlTtl,
              cdn: IMAGE_ASSET_CDN,
            })
            .then((signed) => ({
              url: signed.url,
              width: row.width ?? 0,
              height: row.height ?? 0,
              expiresAt: signed.expiresAt.toISOString(),
            }))
        : null,
    ]);
    return {
      id: row.id,
      usage: row.usage,
      status: row.status,
      failureReason: toFailureReason(row.failureReason),
      name: row.sourceName,
      source: row.source,
      width: row.width,
      height: row.height,
      crop: row.crop,
      image,
      original,
      isInUse: row.ownerId !== null && row.detachedAt === null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /** 目前版本的各尺寸；還沒有版本、或用途已不存在時是 `null`。 */
  private async imageOf(row: ImageAssetRow): Promise<ImageSources | null> {
    const usage = this.usages.find(row.usage);
    if (!usage || row.variantRev === null || !row.variants) return null;
    const set: ImageObjectSet = {
      keyPrefix: revPrefixOf(row.id, row.variantRev),
      width: row.variants.width,
      height: row.variants.height,
      formats: row.variants.formats as ImageFormat[],
      renditions: row.variants.renditions,
      ttlSeconds: usage.urlTtl,
      cdn: IMAGE_ASSET_CDN,
    };
    return this.urls.sources(set, densityLayouts(set, Object.keys(usage.presets)));
  }
}

/** 型別與大小（以宣告或來源回報的值；處理時再以檔頭與實際內容檢查一次）。 */
function assertAcceptable(usage: ImageUsageDefinition, contentType: string, size: number): void {
  if (!usage.contentTypes.includes(contentType)) {
    throw new AppException('IMAGE_TYPE_NOT_ALLOWED', { contentTypes: [...usage.contentTypes] });
  }
  if (size > usage.maxSize) throw new AppException('IMAGE_TOO_LARGE', { maxSize: usage.maxSize });
}

/** 裁切在圖片之內；知道尺寸時，裁切之後不小於用途的下限。 */
function assertCrop(
  crop: ImageCrop,
  usage: ImageUsageDefinition,
  size: { width: number; height: number } | undefined,
): void {
  if (!isValidCrop(crop)) throw new AppException('IMAGE_CROP_INVALID');
  if (size) assertLargeEnough(croppedSize(crop, size, usage.aspectRatio), usage);
}

function assertLargeEnough(
  size: { width: number; height: number },
  usage: ImageUsageDefinition,
): void {
  if (size.width < usage.minWidth || size.height < usage.minHeight) {
    throw new AppException('IMAGE_TOO_SMALL', {
      minWidth: usage.minWidth,
      minHeight: usage.minHeight,
    });
  }
}

function describedSize(
  row: Pick<ImageAssetRow, 'width' | 'height'>,
): { width: number; height: number } | undefined {
  return row.width && row.height ? { width: row.width, height: row.height } : undefined;
}

/** 認領不到的原因（給前端與排查；別人的資產已在前面當作不存在）。 */
function unusableReason(row: ImageAssetRow, usage: ImageUsageDefinition): string {
  if (row.status === 'failed') return 'failed';
  if (row.usage !== usage.id) return 'usageMismatch';
  return 'inUse';
}

function toFailureReason(value: string | null): ImageFailureReason | null {
  return (IMAGE_FAILURE_REASONS as readonly string[]).includes(value ?? '')
    ? (value as ImageFailureReason)
    : null;
}

function toUploadTarget(signed: PresignedRequest) {
  return {
    url: signed.url,
    method: 'PUT' as const,
    headers: signed.headers,
    expiresAt: signed.expiresAt.toISOString(),
  };
}
