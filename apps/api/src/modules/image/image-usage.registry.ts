import { Injectable } from '@nestjs/common';

import { IMAGE_URL_TTL_MAX, IMAGE_URL_TTL_MIN } from '@/core/image';

/**
 * 一個使用圖片的地方（docs/architecture/backend/25-image.md §15.3）：由擁有者模組在 `onModuleInit` 以
 * `ImageUsageRegistry.register()` 登記。後端是唯一的事實來源，前端以 `GET /images/usages` 取得同一份限制（§16.2 D8）。
 */
export interface ImageUsageDefinition {
  /** `<模組>.<名稱>`（例：`user.avatar`）；同時存在 `image_assets.usage`，上線後不改名。 */
  id: string;
  /** 來源原檔的大小上限（位元組）。 */
  maxSize: number;
  /** 收的型別；不收 SVG（不讓 api 解析使用者給的 XML）。以檔頭判斷，不信任宣告的型別。 */
  contentTypes: readonly string[];
  /** 裁切之後的最小尺寸（px）。 */
  minWidth: number;
  minHeight: number;
  /** 寬 ÷ 高：有值時一定裁切成這個比例（沒給裁切就取中央）；省略時不限比例。 */
  aspectRatio?: number;
  /** 具名的尺寸：長邊 px，套用裁切之後再縮；每個另產生 `@2x`（docs/architecture/backend/25-image.md §6）。 */
  presets: Readonly<Record<string, number>>;
  /** 網址的效期（秒；docs/architecture/backend/25-image.md §4）。 */
  urlTtl: number;
  /** 這一版只有 `signed`；`public` 保留給第二批的租戶 Logo（docs/architecture/backend/25-image.md §16.2 D6）。 */
  visibility: 'signed';
  /** 只允許這些來源；省略時是全部。 */
  sources?: readonly string[];
}

/** 頭像等常見圖片收的型別（第一格；GIF 動畫只取第一格，docs/architecture/backend/25-image.md §16.2 D9）。 */
export const RASTER_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
  'image/gif',
] as const;

const USAGE_ID_PATTERN = /^[a-z][A-Za-z0-9]*\.[a-z][A-Za-z0-9]*$/;
const PRESET_NAME_PATTERN = /^[a-z][a-z0-9]*$/;

/** 用途的登記表；登記錯誤（名稱、效期、尺寸）在啟動時就失敗。 */
@Injectable()
export class ImageUsageRegistry {
  private readonly usages = new Map<string, ImageUsageDefinition>();

  register(definition: ImageUsageDefinition): void {
    const { id } = definition;
    if (!USAGE_ID_PATTERN.test(id))
      throw new Error(`圖片用途 ${id} 必須是 <模組>.<名稱>（camelCase）`);
    if (this.usages.has(id)) throw new Error(`圖片用途 ${id} 重複登記`);
    if (definition.urlTtl < IMAGE_URL_TTL_MIN || definition.urlTtl > IMAGE_URL_TTL_MAX) {
      throw new Error(
        `圖片用途 ${id} 的 urlTtl 超出範圍（${IMAGE_URL_TTL_MIN}～${IMAGE_URL_TTL_MAX}）`,
      );
    }
    const presets = Object.entries(definition.presets);
    if (presets.length === 0) throw new Error(`圖片用途 ${id} 沒有任何尺寸`);
    for (const [name, edge] of presets) {
      if (!PRESET_NAME_PATTERN.test(name) || !Number.isInteger(edge) || edge <= 0) {
        throw new Error(`圖片用途 ${id} 的尺寸 ${name}=${edge} 不合法`);
      }
    }
    if (definition.contentTypes.includes('image/svg+xml')) {
      throw new Error(`圖片用途 ${id} 不能收 SVG`);
    }
    this.usages.set(id, definition);
  }

  /** 沒有登記回 undefined（請求帶了不存在的用途：交給呼叫端回 400）。 */
  find(id: string): ImageUsageDefinition | undefined {
    return this.usages.get(id);
  }

  /** 程式內部用：資料表裡的用途一定登記過；找不到代表登記被移除了，是部署的錯誤。 */
  get(id: string): ImageUsageDefinition {
    const usage = this.usages.get(id);
    if (!usage) throw new Error(`圖片用途 ${id} 沒有登記`);
    return usage;
  }

  list(): ImageUsageDefinition[] {
    return [...this.usages.values()];
  }

  /** 用途允許這個來源。 */
  allowsSource(usage: ImageUsageDefinition, source: string): boolean {
    return !usage.sources || usage.sources.includes(source);
  }
}
