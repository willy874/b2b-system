import type { ImageCrop } from '@b2b-system/ui/ImageCropper';
import type { QueryClient } from '@tanstack/react-query';
import type { ComponentType } from 'react';

import type { ImageSources } from '../image';
import type { PermissionKey } from '../permission';

export type { ImageCrop };

/**
 * 一個使用圖片的地方的限制（api 的 `GET /images/usages`，docs/architecture/backend/25-image.md §15.3）。
 * web-core 不依賴 `@b2b-system/api-sdk`，這裡以結構寫一份；app 拿到的 SDK 型別可以直接傳進來。
 */
export interface ImageUsage {
  id: string;
  maxSize: number;
  contentTypes: readonly string[];
  minWidth: number;
  minHeight: number;
  /** 寬 ÷ 高；有值時一定要裁切成這個比例。 */
  aspectRatio: number | null;
  presets: Readonly<Record<string, number>>;
  /** 只允許這些來源；`null` 是全部。 */
  sources: readonly string[] | null;
}

/** 建立好的圖片資產（還在處理時 `image` 是 `null`）。 */
export interface PickedImageAsset {
  id: string;
  status: 'pending' | 'ready' | 'failed';
  failureReason: string | null;
  image: ImageSources | null;
  /** 主檔（未裁切）：重新裁切時顯示整張圖。只有建立者拿得到。 */
  original: { url: string; width: number; height: number } | null;
  crop: ImageCrop | null;
}

/**
 * 來源交回的選擇：上傳的是檔案；其他來源（檔案管理、圖片庫、最近使用）是 `source` ＋ `refId`，
 * 帶一張預覽給裁切用（`width`／`height` 是原圖的尺寸，預覽可能是縮小版）。
 */
export type ImageSelection =
  | { kind: 'file'; file: File; name: string }
  | {
      kind: 'source';
      source: string;
      refId: string;
      name: string;
      preview: { src: string; width: number; height: number } | null;
    };

/**
 * 選圖要打的 api（docs/architecture/frontend/23-image-picker.md §3）：web-core 不呼叫 app 的 API，
 * 由 app 以 `registerImagePickerApi()` 注入（backstage 的實作在 `app/image-picker/api.ts`，用 `apis/image/*`）。
 */
export interface ImagePickerApi {
  getUsages: () => Promise<readonly ImageUsage[]>;
  upload: (input: {
    usage: string;
    file: Blob;
    name: string;
    contentType: string;
    crop?: ImageCrop;
    signal?: AbortSignal;
    /** 0～1。 */
    onProgress?: (ratio: number) => void;
  }) => Promise<PickedImageAsset>;
  fromSource: (input: {
    usage: string;
    source: string;
    refId: string;
    crop?: ImageCrop;
  }) => Promise<PickedImageAsset>;
  /** 自己建立的一張（重新裁切要主檔的網址）；別人建立的會失敗。 */
  getAsset: (id: string) => Promise<PickedImageAsset>;
}

/** 判斷來源可不可以用的依據。 */
export interface ImageSourceContext {
  usage: ImageUsage;
  can: (key: PermissionKey) => boolean;
  queryClient: QueryClient;
}

export interface ImageSourceProps {
  usage: ImageUsage;
  onSelect: (selection: ImageSelection) => void;
}

/**
 * 一個圖片來源的前端（docs/architecture/frontend/23-image-picker.md §2）：在 plugin 的 **同步** 階段以
 * `registerImageSource()` 登記；feature 被卸載時跟著消失。`id` 與 api 的來源 id 相同（`file`、`recent`…）。
 */
export interface ImageSourceDefinition {
  id: string;
  /** 分頁的順序（小的在前）；「上傳」固定是第一個，不在註冊表裡。 */
  order: number;
  /** 分頁的標題：要在任何頁面都已載入的語系包裡（例：app 的全域字串），對話框一打開就顯示。 */
  labelKey: string;
  /** 來源元件用到的語系 scope：選圖的頁面不一定載入了它，對話框打開時載入。 */
  localeScope?: string;
  /**
   * 權限（同步）或有沒有內容（非同步）。非同步的判斷最多等 1 秒，逾時或失敗就當作不可用，不讓查詢卡住上傳。
   * 省略時一律可用。
   */
  isAvailable?: (context: ImageSourceContext) => boolean | Promise<boolean>;
  component: ComponentType<ImageSourceProps>;
}
