# File Storage（S3 相容的本機檔案儲存）

`apps/file-storage`（`@b2b-system/file-storage`）是一個 **模擬 Amazon S3** 的獨立 HTTP 服務，
把 bucket / object 存在本機磁碟。它 **完全照 S3 REST API 的設計**：路徑、HTTP method、子資源、
標頭、XML 格式、錯誤碼、SigV4 簽章都與 S3 相同，所以

- 程式端直接用官方 `@aws-sdk/client-s3`（或任何 S3 客戶端）連線；
- 換成真正的 S3（或 MinIO、R2）時 **只改 endpoint 與金鑰**，不改程式碼。

> 定位：本機開發與測試用。沒有多租戶、IAM policy、版本控制，也不追求 S3 的耐久性保證。

---

## 1. 啟動

```bash
pnpm dev             # 與 postgres、api、backstage 一起啟動
pnpm dev:storage     # 單獨啟動（tsx watch），預設 http://127.0.0.1:9000
```

環境變數讀根目錄 `.env`（與 `apps/api` 共用），缺少或格式錯誤時 **啟動即失敗**：

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `FILE_STORAGE_HOST` | `127.0.0.1` | 綁定的位址 |
| `FILE_STORAGE_PORT` | `9000` | 埠號 |
| `FILE_STORAGE_BASE_PATH` | 空 | 掛在反向代理子路徑下時的前綴（本機與 Docker 都是 `/storage`），見 §3.1 |
| `FILE_STORAGE_DATA_DIR` | `.data` | 資料目錄；相對路徑以 `apps/file-storage/` 為基準（已被 `.gitignore`） |
| `FILE_STORAGE_REGION` | `us-east-1` | 只影響 `HeadBucket` / `GetBucketLocation` 回報的 region |
| `FILE_STORAGE_ACCESS_KEY_ID` | —（必填） | 唯一一組存取金鑰 |
| `FILE_STORAGE_SECRET_ACCESS_KEY` | —（必填） | 同上 |
| `FILE_STORAGE_ALLOWED_ORIGINS` | 空 | CORS 白名單（逗號分隔，`*` 為全部）；瀏覽器用 presigned URL 直傳 / 下載時需要 |
| `FILE_STORAGE_MAX_OBJECT_SIZE` | `5368709120` | 單次 PutObject / 單一 part 的上限（位元組），最大 5 GiB（與 S3 相同）。`.env.example` 與 `docker-compose.prod.yml` 設 128 MiB，與 api 的影像轉出上限相同（[`backend/09-file.md`](./backend/09-file.md) §8） |

---

## 2. 客戶端設定

```ts
import { S3Client } from '@aws-sdk/client-s3';

const s3 = new S3Client({
  endpoint: 'http://127.0.0.1:9000',
  region: 'us-east-1', // 任何 region 都接受
  forcePathStyle: true, // 必要：只支援 path-style
  credentials: {
    accessKeyId: process.env.FILE_STORAGE_ACCESS_KEY_ID!,
    secretAccessKey: process.env.FILE_STORAGE_SECRET_ACCESS_KEY!,
  },
});
```

Presigned URL 用 `@aws-sdk/s3-request-presigner` 的 `getSignedUrl()`，與 S3 完全相同。

---

## 3. 定址方式

只支援 **path-style**：

```
http://<host>:<port>/                    service（ListBuckets）
http://<host>:<port>/<bucket>            bucket
http://<host>:<port>/<bucket>/<key>      object（key 可含 /，URL 編碼）
```

不支援 virtual-hosted style（`<bucket>.<host>`）——本機沒有萬用 DNS，SDK 設 `forcePathStyle: true` 即可。

### 3.1 子路徑（`FILE_STORAGE_BASE_PATH`）

瀏覽器經由同源的 `/storage/` 直傳與下載（Vite proxy / nginx），此時路徑變成
`/<base path>/<bucket>/<key>`。SigV4 簽的是 **瀏覽器看到的完整路徑**，所以：

- 代理 **不可** 去掉前綴、要原樣轉發 `Host`；
- 服務設 `FILE_STORAGE_BASE_PATH=/storage`，解析 bucket / key 前先去掉它，但簽章仍以含前綴的原始路徑計算；
- SDK 的 endpoint 帶上前綴：`endpoint: 'http://127.0.0.1:9000/storage'`。

不在前綴底下的路徑回 `400 InvalidURI`。

物件內容與應用程式同源，一律當成不受信任的使用者內容送出：`GetObject` / `HeadObject` 的回應固定帶
`X-Content-Type-Options: nosniff` 與 `Content-Security-Policy: default-src 'none'; …; sandbox; frame-ancestors 'none'`
（`OBJECT_CONTENT_SECURITY_POLICY`，`src/s3/object-headers.ts`）。這是真正的 S3 沒有的強化；
為什麼需要見 [`backend/09-file.md`](./backend/09-file.md) §7.2。

### 3.2 健康檢查

`GET /_health`（或 `/<base path>/_health`）不需要簽章，回 `200 ok`，給容器的 healthcheck 用。
`_` 不可能出現在 bucket 名稱裡，不會與 `ListObjects` 衝突。

---

## 4. 支援的操作

操作名稱與 AWS SDK 的 Command 同名；路由規則見 `src/router.ts`。

### 4.1 Service / Bucket

| 操作 | 請求 | 備註 |
| --- | --- | --- |
| `ListBuckets` | `GET /` | |
| `CreateBucket` | `PUT /<bucket>` | 名稱照 S3 規則驗證（`InvalidBucketName`）；已存在回 `BucketAlreadyOwnedByYou` |
| `HeadBucket` | `HEAD /<bucket>` | 回 `x-amz-bucket-region` |
| `GetBucketLocation` | `GET /<bucket>?location` | |
| `DeleteBucket` | `DELETE /<bucket>` | 非空回 `BucketNotEmpty`；未完成的 multipart upload 一併清除 |
| `ListObjectsV2` | `GET /<bucket>?list-type=2` | `prefix`、`delimiter`、`max-keys`（≤ 1000）、`continuation-token`、`start-after`、`fetch-owner`、`encoding-type=url` |
| `ListObjects`（V1） | `GET /<bucket>` | `marker`、`prefix`、`delimiter`、`max-keys`、`encoding-type=url` |
| `DeleteObjects` | `POST /<bucket>?delete` | 最多 1000 個 key；支援 `<Quiet>` |

列表依 key 的 **UTF-8 位元組序** 排列；common prefix 與 key 一起計入 `max-keys`；
分頁停在 common prefix 時，下一頁會跳過整個 prefix（與 S3 行為相同）。

### 4.2 Object

| 操作 | 請求 | 備註 |
| --- | --- | --- |
| `PutObject` | `PUT /<bucket>/<key>` | 必須有 `Content-Length`（或 aws-chunked 的 `x-amz-decoded-content-length`）；驗 `Content-MD5`；支援 `If-None-Match: *`、`If-Match` 條件寫入 |
| `GetObject` | `GET /<bucket>/<key>` | 單段 `Range`（206 / `InvalidRange`）；`If-Match` / `If-None-Match` / `If-Modified-Since` / `If-Unmodified-Since`；`response-*` 覆寫回應標頭 |
| `HeadObject` | `HEAD /<bucket>/<key>` | 同 GetObject 的條件判斷 |
| `DeleteObject` | `DELETE /<bucket>/<key>` | key 不存在也回 204 |
| `CopyObject` | `PUT /<bucket>/<key>` ＋ `x-amz-copy-source` | `x-amz-metadata-directive: COPY / REPLACE`；`x-amz-copy-source-if-*`；複製到自己且 COPY 回 `InvalidRequest` |

物件會保存並原樣回傳：`Content-Type`（預設 `binary/octet-stream`）、`Cache-Control`、
`Content-Disposition`、`Content-Encoding`、`Content-Language`、`Expires`、`x-amz-meta-*`（合計 ≤ 2 KB）。
ETag 為內容的 MD5（含雙引號）。key 上限 1024 位元組（`KeyTooLongError`）。

### 4.3 Multipart upload

| 操作 | 請求 | 備註 |
| --- | --- | --- |
| `CreateMultipartUpload` | `POST /<bucket>/<key>?uploads` | 標頭與中繼資料在這一步決定 |
| `UploadPart` | `PUT /<bucket>/<key>?partNumber=N&uploadId=…` | `partNumber` 1–10000；單段 ≤ 5 GiB |
| `CompleteMultipartUpload` | `POST /<bucket>/<key>?uploadId=…` | 檢查順序（`InvalidPartOrder`）、ETag（`InvalidPart`）、非最後一段 ≥ 5 MiB（`EntityTooSmall`）；ETag 為 `"<md5 of md5s>-<段數>"` |
| `AbortMultipartUpload` | `DELETE /<bucket>/<key>?uploadId=…` | |
| `ListMultipartUploads` | `GET /<bucket>?uploads` | `prefix`、`max-uploads`（≤ 1000）、`key-marker` / `upload-id-marker` 分頁、`encoding-type=url`；依 key、再依開始時間排序；不支援 `delimiter`（回 `NotImplemented`）。api 的維護排程用它找出沒有紀錄的分塊上傳（[`backend/09-file.md`](./backend/09-file.md) §9） |

`@aws-sdk/lib-storage` 的 `Upload` 只用到前四個操作，可以直接使用。

### 4.4 不支援

版本控制、ACL / policy、tagging、lifecycle、bucket 層級 CORS 設定、加密、object lock、
`ListParts`、`UploadPartCopy`、POST policy 表單上傳。
請求帶到這些子資源（`?acl`、`?tagging`、`?versionId`…）時一律回 **`501 NotImplemented`**，
不會被當成一般的 Get / PutObject 靜默處理。

---

## 5. 驗證（SigV4）

- 所有請求都要 **AWS Signature Version 4**：`Authorization` 標頭或 presigned URL 的查詢參數。
  **沒有匿名存取**；要讓瀏覽器直接讀檔，發 presigned GET URL。
- 只有一組金鑰（環境變數）；access key 不符回 `InvalidAccessKeyId`、簽章不符回 `SignatureDoesNotMatch`
  （錯誤 XML 附 `CanonicalRequest` / `StringToSign`，方便除錯，與 S3 相同）。
- `x-amz-date` 與伺服器時間差 > 15 分鐘回 `RequestTimeTooSkewed`；presigned URL 的 `X-Amz-Expires` 為 1–604800 秒，
  過期回 `AccessDenied`（`Request has expired`）。
- credential scope 裡的 **region 不驗**：客戶端設哪個 region 都能連（模擬器只有一個 region）。
- `x-amz-content-sha256`：
  - 64 位 hex → 邊收邊算 SHA-256，不符回 `XAmzContentSHA256Mismatch`；
  - `UNSIGNED-PAYLOAD` → 不驗內容；
  - `STREAMING-*` → body 是 aws-chunked 編碼，解碼後存檔。**逐塊的 chunk-signature 與尾端的
    `x-amz-checksum-*` trailer 不驗證**（整個請求的簽章仍然驗）。

---

## 6. CORS

- `OPTIONS` preflight 不需要簽章；`Origin` 在 `FILE_STORAGE_ALLOWED_ORIGINS` 內回 200，否則 403。
- 一般回應對白名單內的 `Origin` 加上 `Access-Control-Allow-Origin` 與
  `Access-Control-Expose-Headers: ETag, Content-Length, Content-Type, Content-Range, Last-Modified, x-amz-request-id, x-amz-id-2`
  （瀏覽器端的 multipart 上傳需要讀到 `ETag`）。
- S3 的 bucket 層級 CORS 設定（`PutBucketCors`）不支援，白名單是整個服務共用。

---

## 7. 儲存格式

```
<FILE_STORAGE_DATA_DIR>/
├── buckets/<bucket>/
│   ├── bucket.json
│   ├── objects/<sha256(key)>.json    中繼資料：key、size、ETag、標頭、x-amz-meta-*、內容檔名
│   └── blobs/<uuid>                  物件內容
├── uploads/<uploadId>/
│   ├── upload.json
│   └── <partNumber>.part / .json
└── tmp/                              接收中的內容；啟動時清空
```

- 中繼資料在啟動時全部載入記憶體；列表與 HEAD 不碰磁碟。每個 bucket 另有一份依 UTF-8 位元組序排好的清單，
  寫入與刪除時以二分搜尋就地插入／移除；`ListObjects` 以二分搜尋跳到 `prefix`（與 `start-after`）的起點、離開 `prefix` 的範圍就停，
  不必每次寫入後整桶重新排序、從頭掃描。插入仍是 O(n) 的陣列搬移，物件數到數十萬以上時正式環境應換成真正的 S3／MinIO。
- 寫入順序：body 串流進 `tmp/`（同時算 MD5 與長度）→ `rename` 成 `blobs/<新 uuid>` →
  中繼資料以 tmp＋`rename` 原子寫入 → 更新記憶體索引 → 刪除舊內容檔。
  同一個 key 的這一段依序執行（`KeyedLock`），並行覆寫不會讓中繼資料與內容對不上。
- 讀取先開檔再回應：物件在下載途中被覆寫，已開始的下載仍會讀完舊內容。
- 內容檔已落地、中繼資料還沒寫入就當機時會留下孤兒內容檔；下次啟動時清掉。

---

## 8. 程式結構

```
apps/file-storage/src/
├── main.ts               讀 .env → loadConfig → DiskStore.open → listen
├── config.ts             環境變數（Zod）
├── server.ts             node:http 伺服器：CORS、簽章驗證、路由、S3 錯誤 XML、存取日誌
├── router.ts             method × 路徑層級 × 子資源 → S3 操作
├── handlers/             各 S3 操作（bucket / object / multipart）
├── auth/sigv4.ts         SigV4 驗證（標頭與 presigned）
├── http/                 請求解析（target）、body 解碼（aws-chunked、SHA-256 驗證）、RequestContext
├── s3/                   協定層：錯誤碼、XML、列表分頁、條件式請求、物件標頭
└── storage/              DiskStore（磁碟格式、記憶體索引、KeyedLock）
```

依賴方向：`handlers → storage / s3 / http`；`storage` 只依賴 `s3/errors`、`s3/conditions`；
`s3/`、`http/` 不依賴 `handlers/` 與 `storage/`（`http/context.ts` 只用 `DiskStore` 的型別）。

不用 NestJS：S3 的回應是 XML、body 是需要自行解碼的串流、SigV4 要拿原始路徑計算，
Nest 的 JSON 回應包裝、全域 guard / pipe 都用不上，反而要一一繞開；純 `node:http` 更小更直接。

### 8.1 與 `apps/api` 的關係

- `apps/api` **不 import** `apps/file-storage` 的任何程式碼，只透過 S3 HTTP API 溝通
  （與 `apps/*` 之間永不互相 import 的規則一致，見 [`coding-standards/07-layer-dependencies.md`](../coding-standards/07-layer-dependencies.md) §1）。
- `apps/api` 以 `@aws-sdk/client-s3` 連線，並用 `files` 資料表把物件包成對前端友善的檔案，
  見 [`backend/09-file.md`](./backend/09-file.md)。正式環境可直接指向真正的 S3。

---

## 9. 建置與 Docker

```bash
pnpm --filter @b2b-system/file-storage build   # esbuild → dist/main.js（程式＋zod 打成單一檔案）
docker build -f apps/file-storage/Dockerfile -t b2b-system-file-storage .
```

- runtime 映像只有 `node:24-alpine` ＋ `dist/`，不需要 `node_modules`；以非 root 使用者執行。
- 資料在 `/data`（`VOLUME`）；`HEALTHCHECK` 打 `/_health`。
- `docker-compose.prod.yml` 的 `file-storage` 服務：`FILE_STORAGE_BASE_PATH=/storage`，接在 `edge`（nginx 轉發瀏覽器請求）
  與 `storage`（api 的伺服器端呼叫）兩個網路；碰不到 postgres。拓撲見 [`01-system.md`](./01-system.md) §4.2。

---

## 10. 測試

```bash
pnpm --filter @b2b-system/file-storage test
```

| 檔案 | 內容 |
| --- | --- |
| `test/s3-client.spec.ts` | 以 **官方 `@aws-sdk/client-s3`** 對起在隨機埠的伺服器跑完整流程：bucket、object、Range、條件式請求、Copy、DeleteObjects、ListObjects V1/V2 分頁、multipart、SigV4 失敗案例、presigned URL（含 api 的直傳網址：簽了 `content-length` 時大小不同回 403、簽了 `if-none-match: *` 時第二次 PUT 回 412）、CORS、重啟後持久化 |
| `src/auth/__tests__/sigv4.spec.ts` | AWS 文件中的 SigV4 範例向量（標頭與 presigned） |
| `src/s3/__tests__/list.spec.ts` | 分頁與 delimiter 折疊（table-driven） |
| `src/http/__tests__/aws-chunked.spec.ts` | aws-chunked 解碼（含逐位元組送入） |
| `src/handlers/__tests__/object.spec.ts` | `Range` 標頭解析 |

`test/s3-client.spec.ts` 另外起一個 `FILE_STORAGE_BASE_PATH=/storage` 的伺服器，驗證 SDK endpoint 帶前綴、presigned URL 與 `/_health`。

整合測試用 SDK 而不是手寫 HTTP 請求：相容性的定義就是「官方 SDK 能用」。
