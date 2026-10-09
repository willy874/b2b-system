import { Injectable } from '@nestjs/common';

import { IMAGE_FORMAT_EXTENSION, ImageUrlService, renditionKey } from '@/core/image';
import type { ImageFormat, ImageObjectSet, ImageSources, ImageVariantLayout } from '@/core/image';
import { ObjectUrlSigner } from '@/core/storage';
import type { GalleryItemRow } from '@/db/schema';

import {
  GALLERY_TYPE_EXTENSION,
  GALLERY_URL_TTL,
  originalKeyOf,
  revPrefixOf,
} from './gallery.constants';

/**
 * 回應裡的 `image.variants`（docs/architecture/backend/26-gallery.md §5）：
 * - `grid`：寬度描述的 `thumb 480w, medium 1280w`，前端以 `sizes` 依列高選；
 * - `medium`、`large`：檢視器的漸進載入（先 medium、再 large）。
 */
const LAYOUTS: Readonly<Record<string, ImageVariantLayout>> = {
  grid: { widths: ['thumb', 'medium'] },
  medium: { widths: ['medium'] },
  large: { widths: ['large'] },
};

/** 瀏覽器的 `<img>` 顯示得了的原檔型別（TIFF 不行）。 */
const DISPLAYABLE_ORIGINAL: ReadonlySet<string> = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

export interface GalleryOriginalUrl {
  url: string;
  width: number;
  height: number;
  expiresAt: string;
}

/**
 * 圖片庫的網址只由這裡產生：變體經 `ImageUrlService`（同一個時間窗內不變、可以快取）、原檔與下載經 `ObjectUrlSigner`。
 * 讀圖不經過 api、不查物件儲存（docs/architecture/backend/25-image.md R5）。
 * 之後的 CDN 會在這裡帶上資源類型（另一個 branch：docs/features/image-cdn.md）。
 */
@Injectable()
export class GalleryImageUrls {
  constructor(
    private readonly urls: ImageUrlService,
    private readonly signer: ObjectUrlSigner,
  ) {}

  /** 目前版本的各尺寸；還沒有版本時是 null（列表只有 ready 的圖，實際上不會是 null）。 */
  async sourcesOf(row: GalleryItemRow): Promise<ImageSources | null> {
    if (row.variantRev === null || !row.variants) return null;
    const set: ImageObjectSet = {
      keyPrefix: revPrefixOf(row.id, row.variantRev),
      width: row.variants.width,
      height: row.variants.height,
      formats: row.variants.formats as ImageFormat[],
      renditions: row.variants.renditions,
      ttlSeconds: GALLERY_URL_TTL,
    };
    return this.urls.sources(set, LAYOUTS);
  }

  /**
   * 原檔（inline）：檢視器放大超過 `large` 時用。瀏覽器顯示不了、或調整過顯示方向（原檔沒有轉）時是 null。
   * 尺寸是 EXIF 轉正之後的（瀏覽器依 EXIF 方向顯示原檔）。
   */
  async originalOf(row: GalleryItemRow): Promise<GalleryOriginalUrl | null> {
    if (!row.hasOriginal || !row.width || !row.height) return null;
    if (row.displayRotation !== 0 || !DISPLAYABLE_ORIGINAL.has(row.contentType)) return null;
    const signed = await this.signer.sign(originalKeyOf(row.id), { expiresIn: GALLERY_URL_TTL });
    return {
      url: signed.url,
      width: row.width,
      height: row.height,
      expiresAt: signed.expiresAt.toISOString(),
    };
  }

  /** 下載：帶 `Content-Disposition: attachment` 與檔名（標題 ＋ 副檔名）。 */
  async downloadsOf(row: GalleryItemRow): Promise<{ original: string; large: string }> {
    const extension = GALLERY_TYPE_EXTENSION[row.contentType] ?? 'bin';
    const variants = row.variants;
    const primary = (variants?.formats[0] ?? 'jpeg') as ImageFormat;
    const largeName = variants?.renditions.large?.sameAs ?? 'large';
    const largeExtension = IMAGE_FORMAT_EXTENSION[primary];
    const [original, large] = await Promise.all([
      this.signer.sign(originalKeyOf(row.id), {
        expiresIn: GALLERY_URL_TTL,
        disposition: 'attachment',
        fileName: `${row.title}.${extension}`,
      }),
      this.signer.sign(
        renditionKey(revPrefixOf(row.id, row.variantRev ?? row.rev), largeName, primary),
        {
          expiresIn: GALLERY_URL_TTL,
          disposition: 'attachment',
          fileName: `${row.title}.${largeExtension}`,
        },
      ),
    ]);
    return { original: original.url, large: large.url };
  }
}
