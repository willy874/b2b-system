import { Injectable } from '@nestjs/common';
import { z } from 'zod';

import { ObjectUrlSigner } from '../storage';
import type { CdnResource } from '../storage';
import { defineSchema } from '../validation';
import { renditionKey } from './image-format-policy';
import { IMAGE_FORMAT_CONTENT_TYPE } from './image-processor';
import type { ImageFormat } from './image-processor';

/** 網址效期的範圍（秒）：由用途宣告，5 分鐘到 24 小時（docs/architecture/backend/25-image.md §4 D3）。 */
export const IMAGE_URL_TTL_MIN = 300;
export const IMAGE_URL_TTL_MAX = 86_400;

/** 一個版本（`<picture>` 的一組來源）：`srcSet` 依密度（`1x`、`2x`）或寬度（`480w`）描述。 */
export const ImageSourceVariantSchema = defineSchema(
  'ImageSourceVariant',
  z.object({
    /** 主格式、預設尺寸：不支援 `srcset` 時的退路。 */
    src: z.string(),
    srcSet: z.string(),
    /** 其他格式（例：WebP），依序放在 `<img>` 前面的 `<source>`。 */
    sources: z.array(z.object({ type: z.string(), srcSet: z.string() })),
    width: z.number().int(),
    height: z.number().int(),
  }),
);

/**
 * 回應裡的一張圖（docs/architecture/backend/25-image.md §3）：同一組網址在同一個時間窗內簽出，`expiresAt` 是最早到期的那個。
 * 網址直接指向物件儲存（或 CDN），讀圖不經過 api。沒有圖片或還在處理時，欄位是 `null`。
 */
export const ImageSourcesSchema = defineSchema(
  'ImageSources',
  z.object({
    /** 圖片本身的尺寸（裁切之後），給版面算比例。 */
    width: z.number().int(),
    height: z.number().int(),
    expiresAt: z.string(),
    /** 具名的版本（例：頭像的 `sm`、`md`、`lg`）；前端以名稱挑選，不寫死像素。 */
    variants: z.record(z.string(), ImageSourceVariantSchema),
  }),
);

export type ImageSourceVariant = z.infer<typeof ImageSourceVariantSchema>;
export type ImageSources = z.infer<typeof ImageSourcesSchema>;

/** 處理時寫好的一個尺寸。`sameAs`：與另一個尺寸是同一個物件（例：`sm@2x` 與 `md` 一樣大）。 */
export interface ImageRenditionInfo {
  width: number;
  height: number;
  sameAs?: string;
}

/** 一張圖在物件儲存上的全部版本；組回應時由 DB 的欄位組出，不必查物件儲存。 */
export interface ImageObjectSet {
  /** 例：`images/<id>/r3`；物件是 `<keyPrefix>/<尺寸>.<副檔名>`（`renditionKey`）。 */
  keyPrefix: string;
  width: number;
  height: number;
  /** 主格式在前（`deliveryFormatsOf`）。 */
  formats: readonly ImageFormat[];
  renditions: Readonly<Record<string, ImageRenditionInfo>>;
  /** 由用途決定（`IMAGE_URL_TTL_MIN`～`IMAGE_URL_TTL_MAX`）。 */
  ttlSeconds: number;
  /** 可以走 CDN 時的資源類型（`ObjectUrlSigner` 的 `cdn`）。 */
  cdn?: CdnResource;
}

/**
 * 一個版本由哪些尺寸組成：
 * - `density`：固定顯示大小的圖（頭像），`1x` ＋ 選用的 `2x`；
 * - `widths`：依版面寬度挑選（圖片庫），搭配前端的 `sizes`。
 */
export type ImageVariantLayout =
  | { density: { '1x': string; '2x'?: string } }
  | { widths: readonly [string, ...string[]] };

/** 依慣例 `<名稱>` ＋ `<名稱>@2x` 組出密度版本：每個 preset 一個版本，有 `@2x` 的尺寸才帶 2x。 */
export function densityLayouts(
  set: Pick<ImageObjectSet, 'renditions'>,
  presets: readonly string[],
): Record<string, ImageVariantLayout> {
  return Object.fromEntries(
    presets.map((preset) => {
      const retina = `${preset}@2x`;
      const layout: ImageVariantLayout = {
        density: retina in set.renditions ? { '1x': preset, '2x': retina } : { '1x': preset },
      };
      return [preset, layout];
    }),
  );
}

/**
 * 圖片的網址只由這裡產生（docs/architecture/backend/25-image.md R3）：效期、時間窗、簽章方式（presigned 或 CDN，docs/architecture/backend/09-file.md §16）集中在一處。
 * 回應帶的是簽好的物件網址，讀圖的熱路徑不打 api、不查 DB（R5，D1）。檔案管理器的影像 API 不經過這裡（D5）。
 */
@Injectable()
export class ImageUrlService {
  constructor(private readonly signer: ObjectUrlSigner) {}

  async sources(
    set: ImageObjectSet,
    layouts: Readonly<Record<string, ImageVariantLayout>>,
  ): Promise<ImageSources> {
    if (set.ttlSeconds < IMAGE_URL_TTL_MIN || set.ttlSeconds > IMAGE_URL_TTL_MAX) {
      throw new Error(
        `圖片網址的效期 ${set.ttlSeconds} 秒超出範圍（${IMAGE_URL_TTL_MIN}～${IMAGE_URL_TTL_MAX}）`,
      );
    }
    const [primary] = set.formats;
    if (!primary) throw new Error(`${set.keyPrefix} 沒有任何格式`);
    if (Object.keys(layouts).length === 0) throw new Error(`${set.keyPrefix} 沒有要輸出的版本`);

    // 同一個物件只簽一次（2x 可能與另一個尺寸共用）；簽章是純 CPU 運算，一頁幾十張圖的成本可以忽略
    const signed = new Map<string, Promise<{ url: string; expiresAt: Date }>>();
    const urlOf = (name: string, format: ImageFormat) => {
      const rendition = this.rendition(set, name);
      const key = renditionKey(set.keyPrefix, rendition.sameAs ?? name, format);
      let pending = signed.get(key);
      if (!pending) {
        pending = this.signer.sign(key, { expiresIn: set.ttlSeconds, cdn: set.cdn });
        signed.set(key, pending);
      }
      return pending;
    };
    const srcSetOf = async (layout: ImageVariantLayout, format: ImageFormat) => {
      if ('density' in layout) {
        const { '1x': x1, '2x': x2 } = layout.density;
        const entries = [`${(await urlOf(x1, format)).url} 1x`];
        if (x2) entries.push(`${(await urlOf(x2, format)).url} 2x`);
        return entries.join(', ');
      }
      const entries = await Promise.all(
        layout.widths.map(
          async (name) => `${(await urlOf(name, format)).url} ${this.rendition(set, name).width}w`,
        ),
      );
      return entries.join(', ');
    };

    const variants: Record<string, ImageSourceVariant> = {};
    for (const [name, layout] of Object.entries(layouts)) {
      const base = 'density' in layout ? layout.density['1x'] : layout.widths[0];
      const size = this.rendition(set, base);
      // oxlint-disable-next-line no-await-in-loop -- 同一組的簽章已在 Map 裡並行，這裡只是依序組字串
      const [src, srcSet, sources] = await Promise.all([
        urlOf(base, primary).then((signedUrl) => signedUrl.url),
        srcSetOf(layout, primary),
        Promise.all(
          set.formats.slice(1).map(async (format) => ({
            type: IMAGE_FORMAT_CONTENT_TYPE[format],
            srcSet: await srcSetOf(layout, format),
          })),
        ),
      ]);
      variants[name] = { src, srcSet, sources, width: size.width, height: size.height };
    }

    const expiries = await Promise.all([...signed.values()].map(async (s) => (await s).expiresAt));
    const expiresAt = new Date(Math.min(...expiries.map((date) => date.getTime())));
    return { width: set.width, height: set.height, expiresAt: expiresAt.toISOString(), variants };
  }

  private rendition(set: ImageObjectSet, name: string): ImageRenditionInfo {
    const rendition = set.renditions[name];
    if (!rendition) throw new Error(`${set.keyPrefix} 沒有尺寸 ${name}`);
    return rendition;
  }
}
