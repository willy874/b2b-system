import { ChangeKind } from '@b2b-system/realtime';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Env } from '@/core/config';
import { AppException } from '@/core/errors';
import { DomainEvent, DomainEventBus } from '@/core/events';
import { IMAGE_FORMAT_CONTENT_TYPE, ImageDecodeError, ImageProcessor } from '@/core/image';
import type { ImageFormat } from '@/core/image';
import { ObjectStorage, stableSigningDate } from '@/core/storage';
import type { FileRow } from '@/db/schema';

import type { FileImageDto } from './dto/file.dto';
import type { GetFileImageDto } from './dto/get-file-image.dto';
import { deriveImageUrlKey, signImageUrl, verifyImageUrl } from './file-image-url';
import {
  fileChange,
  IMAGE_VARIANT_ANNOUNCE_WAIT_MS,
  IMAGE_VARIANT_CONCURRENCY,
  IMAGE_VARIANT_MAX_EDGE,
  IMAGE_VARIANT_MAX_INPUT_SIZE,
  IMAGE_VARIANTS,
  variantKeyOf,
  variantPrefixOf,
} from './file.constants';
import type { ImageVariant } from './file.constants';
import { FileRepository } from './file.repository';

/** 影像 API 的轉址目標。 */
export interface ImageRedirect {
  url: string;
  /** 轉址本身可以快取的秒數（不超過網址與轉址目標中較早的失效時間）。 */
  maxAge: number;
}

/** 瀏覽器顯示不了的原圖型別：協商出來的格式還沒轉出時不能退回原圖，只能等轉完。 */
const UNDISPLAYABLE_SOURCE_TYPES: ReadonlySet<string> = new Set(['image/tiff']);

/** 格式還在背景轉出時，退回主格式的轉址只快取這麼久（秒），之後再問就拿到新格式。 */
const PENDING_CONVERSION_MAX_AGE = 30;

/** 副檔名：JPEG 慣用 `.jpg`。 */
const FORMAT_EXTENSION: Record<ImageFormat, string> = {
  jpeg: 'jpg',
  webp: 'webp',
  avif: 'avif',
  png: 'png',
};

/**
 * 圖片的三個版本與影像 API（docs/architecture/backend/09-file.md §5.4）。
 *
 * - 上傳完成時排入 `schedule()`：讀原圖、產生全螢幕預覽與圖示預覽兩個縮小版本並寫回物件儲存（實體化），
 *   連同原圖共三個版本。主格式是 progressive JPEG（有透明度的圖改用 WebP）；
 * - 影像 API（`resolve()`）依請求的格式回應：主格式直接轉址；其他格式第一次被要求時才轉出並存起來，
 *   之後同樣直接轉址。內容一律由物件儲存送出，不經過 api。
 */
@Injectable()
export class FileImageService {
  private readonly logger = new Logger(FileImageService.name);
  private readonly urlKey: Buffer;
  private readonly urlTtl: number;
  private readonly baseUrl: string;
  private readonly limit = createLimiter(IMAGE_VARIANT_CONCURRENCY);
  /** 排入或執行中的變體產生（檔案 id → 工作）：同一個檔案不重複產生。 */
  private readonly generating = new Map<string, Promise<void>>();
  /** 依請求轉出其他格式（物件 key → 工作）：同時多個請求只轉一次。 */
  private readonly converting = new Map<string, Promise<void>>();

  constructor(
    private readonly repo: FileRepository,
    private readonly storage: ObjectStorage,
    private readonly images: ImageProcessor,
    private readonly events: DomainEventBus,
    config: ConfigService<Env, true>,
  ) {
    this.urlKey = deriveImageUrlKey(config.get('JWT_SECRET', { infer: true }));
    this.urlTtl = config.get('FILE_URL_TTL', { infer: true });
    this.baseUrl = config.get('API_PUBLIC_BASE_URL', { infer: true });
  }

  /**
   * 排入產生影像變體；同一個檔案已在佇列中就不重複排入。不等待完成——
   * 完成後發佈 `file` 的 UPDATE，前端重抓就拿到影像網址。
   *
   * `announce`：剛完成上傳、還沒推過 `file create` 的檔案。變體在
   * `IMAGE_VARIANT_ANNOUNCE_WAIT_MS` 內處理完（不論成敗）就只推一次 create；超過才先推 create，好了再推 update。
   */
  schedule(fileId: string, options: { announce?: { folderId: string | null } } = {}): void {
    const announce = options.announce
      ? this.announcement(fileId, options.announce.folderId)
      : undefined;
    if (this.generating.has(fileId)) {
      announce?.now();
      return;
    }
    const task = this.limit(() => this.generate(fileId))
      .then((ready) => {
        // 還沒推過 create：這一次就涵蓋了變體（前端重抓時已經是 ready）
        if (announce && !announce.isDone()) announce.now();
        else if (ready) this.publish(ChangeKind.UPDATE, ready);
      })
      .catch((error: unknown) => {
        this.logger.error({ err: error, fileId }, '產生影像變體時發生未預期的錯誤');
      })
      .finally(() => {
        // 失敗也要讓其他人看得到這個檔案
        announce?.now();
        this.generating.delete(fileId);
      });
    this.generating.set(fileId, task);
  }

  /** 等排入的變體與背景轉檔全部處理完（測試與關機用）。 */
  async whenIdle(): Promise<void> {
    while (this.generating.size > 0 || this.converting.size > 0) {
      // oxlint-disable-next-line no-await-in-loop -- 等待途中可能又排入新的
      await Promise.allSettled([...this.generating.values(), ...this.converting.values()]);
    }
  }

  /** 變體已產生時，三個版本的影像 API 網址；同一個時間窗內網址不變（瀏覽器快取可以命中）。 */
  signedUrls(file: FileRow): FileImageDto | null {
    if (
      file.status !== 'ready' ||
      file.variantStatus !== 'ready' ||
      file.imageWidth === null ||
      file.imageHeight === null
    ) {
      return null;
    }
    const signedAt = stableSigningDate(Date.now(), this.urlTtl).getTime();
    const expiresAt = Math.floor(signedAt / 1000) + this.urlTtl;
    const [originalUrl, previewUrl, thumbnailUrl] = IMAGE_VARIANTS.map((variant) => {
      const sig = signImageUrl(this.urlKey, { fileId: file.id, variant, expiresAt });
      return `${this.baseUrl}/files/${file.id}/image/${variant}?exp=${expiresAt}&sig=${sig}`;
    }) as [string, string, string];
    return {
      width: file.imageWidth,
      height: file.imageHeight,
      originalUrl,
      previewUrl,
      thumbnailUrl,
      expiresAt: new Date(expiresAt * 1000).toISOString(),
    };
  }

  /**
   * 影像 API：驗證網址簽章後，回傳物件儲存上對應版本與格式的 presigned 網址（由 controller 轉址）。
   * 格式：不指定 → 主格式（原圖則原封不動）；`jpeg` 一律是 progressive；
   * `auto` → 依 `Accept` 挑 AVIF／WebP，都不支援時同不指定。
   */
  async resolve(
    id: string,
    variant: ImageVariant,
    query: GetFileImageDto,
    accept: string | undefined,
  ): Promise<ImageRedirect> {
    const now = Date.now();
    const claims = { fileId: id, variant, expiresAt: query.exp };
    if (query.exp * 1000 <= now || !verifyImageUrl(this.urlKey, claims, query.sig)) {
      throw new AppException('FILE_IMAGE_URL_INVALID');
    }
    const file = await this.repo.findById(id);
    const master = file?.variantFormat as ImageFormat | null | undefined;
    if (!file || file.status !== 'ready' || file.variantStatus !== 'ready' || !master) {
      throw new AppException('FILE_NOT_FOUND');
    }

    let format = negotiateFormat(query.format, accept, variant, master, file.contentType);
    let key = format === undefined ? file.storageKey : variantKeyOf(id, variant, format);
    let maxAgeCap = Number.POSITIVE_INFINITY;
    const isMaster = variant !== 'original' && format === master;
    if (format !== undefined && !isMaster) {
      const fallback = variant === 'original' ? undefined : master;
      const canFallback =
        fallback !== undefined || !UNDISPLAYABLE_SOURCE_TYPES.has(file.contentType);
      if (query.format === 'auto' && canFallback && !(await this.storage.head(key))) {
        // 協商出來的格式還沒轉出：請求不等轉檔（AVIF 大圖要好幾秒、吃記憶體），
        // 先轉址到主格式（原圖則原封不動），轉檔在背景做；轉址只快取一下，之後再來就拿到新格式
        this.convertInBackground(file, variant, format, key);
        format = fallback;
        key = fallback === undefined ? file.storageKey : variantKeyOf(id, variant, fallback);
        maxAgeCap = PENDING_CONVERSION_MAX_AGE;
      } else {
        // 明確指定的格式（下載某種格式）照舊等它轉完
        await this.ensureConverted(file, variant, format, key);
      }
    }

    const signed = await this.storage.presignDownload(key, {
      expiresIn: this.urlTtl,
      fileName: format === undefined ? file.name : withExtension(file.name, format),
      disposition: 'inline',
    });
    const until = Math.min(query.exp * 1000, signed.expiresAt.getTime());
    const maxAge = Math.max(0, Math.floor((until - now) / 1000));
    return { url: signed.url, maxAge: Math.min(maxAge, maxAgeCap) };
  }

  /** 刪除這個檔案的所有變體與轉出的格式。 */
  async deleteVariants(fileId: string): Promise<void> {
    const keys: string[] = [];
    for await (const object of this.storage.listObjects(variantPrefixOf(fileId))) {
      keys.push(object.key);
    }
    await Promise.all(keys.map((key) => this.storage.delete(key)));
  }

  /** 產生變體；變體因此變成 ready 時回傳更新後的紀錄（要推 update），其他情況 undefined。 */
  private async generate(fileId: string): Promise<FileRow | undefined> {
    const file = await this.repo.findById(fileId);
    if (!file || file.status !== 'ready' || file.variantStatus !== 'pending') return undefined;

    let described: { imageWidth: number; imageHeight: number; variantFormat: ImageFormat };
    try {
      const source = await this.storage.getObject(file.storageKey);
      if (!source) throw new ImageDecodeError('原圖不存在');
      const decoded = await this.images.decode(source, { maxBytes: IMAGE_VARIANT_MAX_INPUT_SIZE });
      // JPEG 沒有透明度：透明的圖改用 WebP，免得鋪上底色
      const format: ImageFormat = decoded.info.hasAlpha ? 'webp' : 'jpeg';
      let preview;
      let thumbnail;
      try {
        // 依序而不是同時 render：兩個版本各自需要一份解碼緩衝，同時做會讓尖峰記憶體加倍
        preview = await decoded.render({ format, maxEdge: IMAGE_VARIANT_MAX_EDGE.preview });
        thumbnail = await decoded.render({ format, maxEdge: IMAGE_VARIANT_MAX_EDGE.thumbnail });
      } finally {
        await decoded.dispose();
      }
      await Promise.all([
        this.storage.putObject(variantKeyOf(fileId, 'preview', format), preview.data, {
          contentType: preview.contentType,
        }),
        this.storage.putObject(variantKeyOf(fileId, 'thumbnail', format), thumbnail.data, {
          contentType: thumbnail.contentType,
        }),
      ]);
      described = {
        imageWidth: decoded.info.width,
        imageHeight: decoded.info.height,
        variantFormat: format,
      };
    } catch (error) {
      // 儲存服務暫時不可用：維持 pending，由維護排程稍後重試
      if (error instanceof AppException && error.code === 'FILE_STORAGE_UNAVAILABLE') {
        this.logger.warn({ fileId }, '儲存服務不可用，影像變體稍後重試');
        return undefined;
      }
      // 解碼失敗（損毀、超過上限）不會因為重試而成功：標為 failed，前端退回瀏覽器縮圖或類型圖示
      this.logger.warn({ err: error, fileId }, '無法產生影像變體');
      await this.repo.markVariantsFailed(fileId);
      return undefined;
    }

    const updated = await this.repo.markVariantsReady(fileId, described);
    if (!updated) {
      // 產生途中檔案被刪除：剛寫入的變體沒有人會用到
      await this.deleteVariants(fileId).catch((error: unknown) => {
        this.logger.warn({ err: error, fileId }, '清除已刪除檔案的影像變體失敗，留下孤兒物件');
      });
      return undefined;
    }
    return updated;
  }

  /** 至多推一次 `file create`：到期、或呼叫 `now()` 時（先到者）。 */
  private announcement(fileId: string, folderId: string | null) {
    let isDone = false;
    const now = () => {
      if (isDone) return;
      isDone = true;
      clearTimeout(timer);
      this.publish(ChangeKind.CREATE, { id: fileId, folderId });
    };
    const timer = setTimeout(now, IMAGE_VARIANT_ANNOUNCE_WAIT_MS);
    // 關機時不必等它
    timer.unref();
    return { now, isDone: () => isDone };
  }

  private publish(kind: ChangeKind, file: Pick<FileRow, 'id' | 'folderId'>): void {
    this.events.publish(DomainEvent.RESOURCE_CHANGED, {
      changes: [fileChange(kind, file.id, file.folderId)],
    });
  }

  /** 背景轉出其他格式；失敗只記錄（下一次請求會再試）。 */
  private convertInBackground(
    file: FileRow,
    variant: ImageVariant,
    format: ImageFormat,
    key: string,
  ): void {
    this.ensureConverted(file, variant, format, key).catch((error: unknown) => {
      this.logger.warn({ err: error, fileId: file.id, format }, '背景轉出影像格式失敗');
    });
  }

  /** 其他格式第一次被要求時才轉出（從原圖轉，畫質比從主格式再轉一次好），之後直接用存下來的。 */
  private async ensureConverted(
    file: FileRow,
    variant: ImageVariant,
    format: ImageFormat,
    key: string,
  ): Promise<void> {
    if (await this.storage.head(key)) return;
    let task = this.converting.get(key);
    if (!task) {
      task = this.limit(async () => {
        const source = await this.storage.getObject(file.storageKey);
        if (!source) throw new AppException('FILE_NOT_FOUND');
        const decoded = await this.images.decode(source, {
          maxBytes: IMAGE_VARIANT_MAX_INPUT_SIZE,
        });
        let rendered;
        try {
          rendered = await decoded.render({
            format,
            maxEdge: variant === 'original' ? undefined : IMAGE_VARIANT_MAX_EDGE[variant],
          });
        } finally {
          await decoded.dispose();
        }
        await this.storage.putObject(key, rendered.data, { contentType: rendered.contentType });
      }).finally(() => this.converting.delete(key));
      this.converting.set(key, task);
    }
    await task;
  }
}

/**
 * 決定回應的格式；`undefined` 代表原圖原封不動。
 * `auto` 時原圖本身已是瀏覽器接受的格式就不重新編碼。
 */
export function negotiateFormat(
  requested: GetFileImageDto['format'],
  accept: string | undefined,
  variant: ImageVariant,
  master: ImageFormat,
  originalContentType: string,
): ImageFormat | undefined {
  const fallback = variant === 'original' ? undefined : master;
  if (requested === undefined) return fallback;
  if (requested !== 'auto') return requested;
  const accepted = (accept ?? '').toLowerCase();
  if (variant === 'original' && accepted.includes(originalContentType)) return undefined;
  if (accepted.includes(IMAGE_FORMAT_CONTENT_TYPE.avif)) return 'avif';
  if (accepted.includes(IMAGE_FORMAT_CONTENT_TYPE.webp)) return 'webp';
  return fallback;
}

/** 下載檔名換成實際格式的副檔名（`hero.png` 轉成 JPEG → `hero.jpg`）。 */
function withExtension(name: string, format: ImageFormat): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  return `${base}.${FORMAT_EXTENSION[format]}`;
}

/** 最多同時執行 `concurrency` 個工作；其餘依序等待。 */
function createLimiter(concurrency: number) {
  let active = 0;
  const waiting: (() => void)[] = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (active < concurrency) active += 1;
    else await new Promise<void>((resolve) => waiting.push(resolve));
    try {
      return await task();
    } finally {
      // 名額直接交給下一個等待者，不讓新來的插隊
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}
