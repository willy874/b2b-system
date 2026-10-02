import type { Readable } from 'node:stream';

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

export interface CreateMultipartUploadOptions {
  contentType: string;
}

/** 分塊上傳完成時交回的一塊：`etag` 是上傳那一塊時物件儲存回的 ETag（有無引號皆可）。 */
export interface UploadedPart {
  partNumber: number;
  etag: string;
}

/** 列表（`listObjects`）的一筆。 */
export interface ListedObject {
  key: string;
  size: number;
  lastModified: Date;
}

/** 尚未完成也未放棄的分塊上傳（`listMultipartUploads`）。 */
export interface PendingMultipartUpload {
  key: string;
  uploadId: string;
  initiatedAt: Date;
}

export interface PresignDownloadOptions {
  /** 秒。 */
  expiresIn: number;
  /** 下載時的檔名（寫進 `Content-Disposition`）。 */
  fileName: string;
  /** `inline`：瀏覽器直接顯示（`<img src>`）；`attachment`：觸發下載。 */
  disposition: 'inline' | 'attachment';
  /** 覆寫回應的 `Content-Type`（例：可執行的型別改成 `application/octet-stream`）；省略時沿用物件的型別。 */
  contentType?: string;
}

/** S3 的 bucket 命名規則（小寫英數、`.`、`-`，3–63 字）。租戶登記時檢查（docs/architecture/05-tenancy.md §10.2 D16）。 */
export function isValidBucketName(name: string): boolean {
  return /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(name) && !name.includes('..');
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

  /**
   * 讀取物件內容（串流）；不存在回 `undefined`。只給 api 自己處理內容用（例：產生影像變體），
   * 給瀏覽器的內容一律走 presigned URL。
   */
  abstract getObject(key: string): Promise<Readable | undefined>;

  /** api 自己寫入的小物件（例：影像變體）；同 key 直接覆寫。 */
  abstract putObject(key: string, body: Buffer, options: { contentType: string }): Promise<void>;

  /** 依 key 排序逐頁列出 `prefix` 開頭的物件（殘留檔案對帳用）。 */
  abstract listObjects(prefix: string): AsyncIterable<ListedObject>;

  abstract presignUpload(key: string, options: PresignUploadOptions): Promise<PresignedRequest>;

  /**
   * 下載網址在同一個時間窗內 **不變**（簽章時間取整），瀏覽器與 CDN 的快取才會命中；
   * 回傳的網址至少還有 `expiresIn / 2` 秒有效。
   */
  abstract presignDownload(key: string, options: PresignDownloadOptions): Promise<PresignedRequest>;

  // ── 分塊上傳（S3 multipart upload；docs/architecture/backend/09-file.md §5.2） ──

  /** 開始一個分塊上傳，回傳 uploadId。`Content-Type` 在這一步決定。 */
  abstract createMultipartUpload(
    key: string,
    options: CreateMultipartUploadOptions,
  ): Promise<string>;

  /** 讓瀏覽器直接上傳第 `partNumber` 塊（1 起算）的 presigned PUT。 */
  abstract presignUploadPart(
    key: string,
    uploadId: string,
    partNumber: number,
    options: { expiresIn: number },
  ): Promise<PresignedRequest>;

  /**
   * 組合各塊成為一個物件。塊不存在、ETag 不符、順序錯誤、非最後一塊太小、uploadId 不存在時
   * 拋 `FILE_UPLOAD_INCOMPLETE`（前端重新上傳）；其他失敗拋 `FILE_STORAGE_UNAVAILABLE`。
   */
  abstract completeMultipartUpload(
    key: string,
    uploadId: string,
    parts: readonly UploadedPart[],
  ): Promise<void>;

  /** 放棄分塊上傳並清掉已上傳的塊；uploadId 不存在也視為成功。 */
  abstract abortMultipartUpload(key: string, uploadId: string): Promise<void>;

  /** 逐頁列出 `prefix` 開頭、還沒完成也沒放棄的分塊上傳（殘留檔案對帳用）。 */
  abstract listMultipartUploads(prefix: string): AsyncIterable<PendingMultipartUpload>;
}

/**
 * 簽章時間取整到 `expiresIn / 2` 的倍數：同一個時間窗內對同一個物件簽出一模一樣的網址，
 * 列表每次重抓也不會讓 `<img>` 重新下載。代價是網址的剩餘效期介於 `expiresIn / 2` 與 `expiresIn` 之間。
 */
export function stableSigningDate(now: number, expiresIn: number): Date {
  const windowMs = Math.max(1, Math.floor(expiresIn / 2)) * 1000;
  return new Date(Math.floor(now / windowMs) * windowMs);
}
