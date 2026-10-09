import { Injectable } from '@nestjs/common';

import { ObjectStorage } from './object-storage';

export interface SignObjectUrlOptions {
  /** 秒。網址在同一個時間窗（`expiresIn / 2`）內不變，剩餘效期介於 `expiresIn / 2` 與 `expiresIn` 之間。 */
  expiresIn: number;
  /** 預設 `inline`（`<img src>` 直接顯示）。 */
  disposition?: 'inline' | 'attachment';
  /** 寫進 `Content-Disposition` 的檔名；省略時取 key 的最後一段。 */
  fileName?: string;
  /** 覆寫回應的 `Content-Type`；省略時沿用物件的型別。 */
  contentType?: string;
  /**
   * 這個物件可以由 CDN 送出時的資源類型（例：`imageAsset`、`fileVariant`）。前提是物件寫入後永不覆寫；
   * 實作依部署的設定決定是否真的改用 CDN（docs/features/image-cdn.md）。presigned 的實作忽略它。
   */
  cdn?: string;
}

export interface SignedObjectUrl {
  url: string;
  expiresAt: Date;
}

/**
 * 把物件 key 簽成瀏覽器可以直接讀的網址（docs/architecture/backend/25-image.md §3 D6）。
 *
 * 讀圖的熱路徑（`ImageUrlService`、檔案的影像 API）只認這個抽象：這一版只有 presigned 的實作，
 * 之後的 CDN 是另一個實作，呼叫端不必改。上傳、分塊上傳的網址仍直接用 `ObjectStorage`（不會走 CDN）。
 *
 * 用 abstract class 而不是 interface，是因為它同時當作 Nest 的 DI token。
 */
export abstract class ObjectUrlSigner {
  abstract sign(key: string, options: SignObjectUrlOptions): Promise<SignedObjectUrl>;
}

/** 物件儲存的 presigned GET（含 `stableSigningDate` 的時間窗）。 */
@Injectable()
export class PresignedUrlSigner extends ObjectUrlSigner {
  constructor(private readonly storage: ObjectStorage) {
    super();
  }

  async sign(key: string, options: SignObjectUrlOptions): Promise<SignedObjectUrl> {
    const signed = await this.storage.presignDownload(key, {
      expiresIn: options.expiresIn,
      fileName: options.fileName ?? key.slice(key.lastIndexOf('/') + 1),
      disposition: options.disposition ?? 'inline',
      contentType: options.contentType,
    });
    return { url: signed.url, expiresAt: signed.expiresAt };
  }
}
