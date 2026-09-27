/** 物件上會被原樣存下、讀取時原樣回傳的標準 HTTP 標頭。 */
export interface ObjectHeaders {
  contentType: string;
  cacheControl?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  contentLanguage?: string;
  expires?: string;
}

export interface BucketInfo {
  name: string;
  createdAt: Date;
}

export interface StoredObject {
  key: string;
  size: number;
  /** 含雙引號，例：`"d41d8cd98f00b204e9800998ecf8427e"`；multipart 物件為 `"<md5>-<段數>"`。 */
  etag: string;
  lastModified: Date;
  headers: ObjectHeaders;
  /** `x-amz-meta-*` 去掉前綴後的鍵值（鍵一律小寫）。 */
  metadata: Readonly<Record<string, string>>;
  /** 內容檔在 `blobs/` 下的檔名；覆寫物件時換新檔，舊檔在新的中繼資料落地後才刪除。 */
  blob: string;
}

export interface MultipartUpload {
  uploadId: string;
  bucket: string;
  key: string;
  initiatedAt: Date;
  headers: ObjectHeaders;
  metadata: Readonly<Record<string, string>>;
}

export interface UploadedPart {
  partNumber: number;
  etag: string;
  size: number;
}

export interface ObjectWriteOptions {
  headers: ObjectHeaders;
  metadata: Readonly<Record<string, string>>;
  /** `Content-Length`（或 aws-chunked 的 `x-amz-decoded-content-length`）；實收不符回 `IncompleteBody`。 */
  expectedSize: number | undefined;
  /** `Content-MD5`（base64）；不符回 `BadDigest`。 */
  contentMd5: string | undefined;
  maxSize: number;
  /** `If-None-Match: *`：物件已存在就回 `PreconditionFailed`。 */
  ifNoneMatch: string | undefined;
  /** `If-Match`：現有物件的 ETag 不符就回 `PreconditionFailed`。 */
  ifMatch: string | undefined;
}
