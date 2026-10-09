import { Injectable } from '@nestjs/common';

import type { AuthUser } from '@/common/types';
import { AppException } from '@/core/errors';
import type { ImageFormat } from '@/core/image';
import { requireTenant } from '@/core/tenant';
import type { TenantFeature } from '@/core/tenant';

/** 來源解析出的一張圖：同一個租戶 bucket 內的物件，呼叫端以 CopyObject 複製，不經過 api 的記憶體。 */
export interface ResolvedImage {
  storageKey: string;
  contentType: string;
  size: number;
  /** 原本的名稱（例：檔名），給稽核與「最近使用」顯示。 */
  name: string;
  /** 已知時帶上，讓呼叫端先擋掉太小的圖。 */
  width?: number;
  height?: number;
  /**
   * 物件已經是正規化過的主檔（轉正、縮過、移除中繼資料；例：另一筆圖片資產的主檔）：
   * 呼叫端直接沿用，不必再解碼與重新編碼一次（畫質不會一代代變差，內容雜湊也不變）。
   */
  normalized?: {
    width: number;
    height: number;
    hasAlpha: boolean;
    format: ImageFormat;
    contentHash: string | null;
  };
}

/**
 * 「我能提供一張圖片」（docs/architecture/backend/25-image.md §15.2）：任何模組都能在 `onModuleInit` 登記；
 * 檔案、圖片庫彼此不認識，只認識這個介面。呼叫端一律 **複製**：解析出的物件只在複製的當下被讀一次。
 */
export interface ImageSource {
  /** `file`、`gallery`、`recent`；之後新增的來源用自己的 id。前端送來的是字串，呼叫端不知道它代表什麼。 */
  id: string;
  /** 所屬的可關閉 feature；租戶沒啟用時一律 `404 FEATURE_DISABLED`。 */
  feature?: TenantFeature;
  /**
   * 以呼叫者的身分讀取：看不到或不存在拋擁有者自己的 404，拒絕要寫 `authz.denied`。
   * `purpose` 是呼叫端的用途字串（例：`imageAsset:user.avatar`、`gallery`），來源寫進自己的稽核 `<resource>.copy`（docs/architecture/backend/25-image.md §16.2 D5）；
   * 來源不解讀它。
   */
  resolve(refId: string, actor: AuthUser, purpose: string): Promise<ResolvedImage>;
}

/** 來源的登記表。圖片資產（`POST /images/from-source`）與之後的圖片庫（從其他來源加入）共用。 */
@Injectable()
export class ImageSourceRegistry {
  private readonly sources = new Map<string, ImageSource>();

  register(source: ImageSource): void {
    if (this.sources.has(source.id)) throw new Error(`圖片來源 ${source.id} 重複登記`);
    this.sources.set(source.id, source);
  }

  /**
   * 找出來源並確認所屬的 feature 已啟用：沒有登記 → `404 IMAGE_SOURCE_NOT_FOUND`；
   * feature 沒啟用 → `404 FEATURE_DISABLED`（前端的判斷只是體驗，這裡才是把關）。
   */
  get(id: string): ImageSource {
    const source = this.sources.get(id);
    if (!source) throw new AppException('IMAGE_SOURCE_NOT_FOUND', { source: id });
    if (source.feature && !requireTenant().features.includes(source.feature)) {
      throw new AppException('FEATURE_DISABLED', { feature: source.feature });
    }
    return source;
  }
}
