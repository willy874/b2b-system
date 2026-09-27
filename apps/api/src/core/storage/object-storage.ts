/**
 * 物件儲存的抽象層（docs/architecture/backend/09-file.md §2）。
 *
 * 業務模組只認識這個介面，不直接碰 `@aws-sdk/client-s3`：
 * - 換儲存後端（S3 / MinIO / R2 / 本機 apps/file-storage）只換實作；
 * - service 的單元測試注入假物件即可，不用起儲存服務。
 *
 * 用 abstract class 而不是 interface，是因為它同時當作 Nest 的 DI token。
 */

export interface StoredObjectHead {
  size: number;
  /** 不含雙引號。 */
  etag: string;
  contentType: string | undefined;
}

/** 交給瀏覽器直接對儲存服務發出的請求。 */
export interface PresignedRequest {
  url: string;
  method: 'GET' | 'PUT';
  /** 發請求時必須原樣帶上的標頭（已納入簽章，改了就會被拒）。 */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface PresignUploadOptions {
  contentType: string;
  /** 秒。 */
  expiresIn: number;
}

export interface PresignDownloadOptions {
  /** 秒。 */
  expiresIn: number;
  /** 下載時的檔名（寫進 `Content-Disposition`）。 */
  fileName: string;
  /** `inline`：瀏覽器直接顯示（`<img src>`）；`attachment`：觸發下載。 */
  disposition: 'inline' | 'attachment';
}

export abstract class ObjectStorage {
  /** 確認 bucket 存在，不存在就建立。重複呼叫只會真的檢查一次（失敗後會重試）。 */
  abstract ensureBucket(): Promise<void>;

  /** 健康檢查：儲存服務連得上且 bucket 存在。 */
  abstract ping(): Promise<boolean>;

  /** 物件不存在時回 `undefined`；其他失敗拋 `FILE_STORAGE_UNAVAILABLE`。 */
  abstract head(key: string): Promise<StoredObjectHead | undefined>;

  /** 物件不存在也視為成功（與 S3 的 DeleteObject 相同）。 */
  abstract delete(key: string): Promise<void>;

  abstract presignUpload(key: string, options: PresignUploadOptions): Promise<PresignedRequest>;

  abstract presignDownload(key: string, options: PresignDownloadOptions): Promise<PresignedRequest>;
}
