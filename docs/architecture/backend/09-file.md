# 後端 09 — 檔案（物件儲存 ＋ 轉介表）

`apps/api` 透過 **`@aws-sdk/client-s3`** 使用物件儲存。本機與自架部署連
[`apps/file-storage`](../03-file-storage.md)（S3 相容），正式環境可直接換成 S3 / MinIO / R2——**只改環境變數**。

設計目標是「前端用起來不原始」：前端只認識 **檔案 id** 與 **可以直接放進 `<img src>` 的網址**，
不知道 bucket、key、簽章，也不需要自己編排上傳步驟。圖片另外由伺服器實體化成三個版本（原圖、全螢幕預覽、圖示預覽），
經專用的影像 API 取得（§5.4）；上傳失敗留下的殘留由維護排程偵測並清除（§9）。

---

## 1. 三層

```
 features/*  ──uploadFile()──▶  apis/file/*                      前端：只有 StoredFile（id、name、url…）
                                    │ POST /files、PUT（直傳）、POST /files/:id/complete
 ───────────────────────────────────┼─────────────────────────────────────────────
 modules/file   FileService / FileImageService / FileMaintenanceService   後端：業務規則、files 轉介表、影像變體、維護
                    │ 注入
 core/storage   ObjectStorage（抽象類別） ← S3ObjectStorage（@aws-sdk/client-s3）
 core/image     ImageProcessor（抽象類別） ← SharpImageProcessor（sharp / libvips）
                    │ S3 API
 apps/file-storage（或 S3 / MinIO / R2）
```

| 層 | 認識什麼 | 不認識什麼 |
| --- | --- | --- |
| 前端 `apis/file/` | 檔案 id、`url` / `downloadUrl`、`uploadFile()` | bucket、key、SigV4 |
| `modules/file` | `files` 資料表、`ObjectStorage` 介面 | `@aws-sdk/*` |
| `core/storage` | S3 協定、bucket、presign | `files` 資料表、權限、任何 module |
| `core/image` | 解碼、縮放、編碼（sharp） | 物件儲存、`files` 資料表、變體的尺寸與格式政策 |

---

## 2. 抽象層：`core/storage`

```ts
export abstract class ObjectStorage {
  ensureBucket(): Promise<void>;            // 不存在就建立；記住結果，失敗後可重試
  ping(): Promise<boolean>;                 // /health/ready 用
  head(key): Promise<StoredObjectHead | undefined>;
  delete(key): Promise<void>;               // 不存在也算成功
  presignUpload(key, { contentType, expiresIn }): Promise<PresignedRequest>;
  presignDownload(key, { expiresIn, fileName, disposition }): Promise<PresignedRequest>; // 時間窗內網址不變（§7.1）
  // 分塊上傳（§5.2）
  createMultipartUpload(key, { contentType }): Promise<string>;           // uploadId
  presignUploadPart(key, uploadId, partNumber, { expiresIn }): Promise<PresignedRequest>;
  completeMultipartUpload(key, uploadId, parts): Promise<void>;          // 塊不對 → FILE_UPLOAD_INCOMPLETE
  abortMultipartUpload(key, uploadId): Promise<void>;                    // 不存在也算成功
  // api 自己讀寫內容（影像變體，§5.4）與對帳（維護排程，§9）
  getObject(key): Promise<Readable | undefined>;
  putObject(key, body: Buffer, { contentType }): Promise<void>;
  listObjects(prefix): AsyncIterable<{ key, size, lastModified }>;       // 自動翻頁
  listMultipartUploads(prefix): AsyncIterable<{ key, uploadId, initiatedAt }>;
}
```

- **abstract class 而不是 interface**：它同時是 Nest 的 DI token（`{ provide: ObjectStorage, useClass: S3ObjectStorage }`）。
  業務模組只 `constructor(private readonly storage: ObjectStorage)`，不 import SDK。
- 換後端：寫另一個實作、改 `StorageModule` 的 `useClass`。測試：`overrideProvider(ObjectStorage)` 換成記憶體版
  （`apps/api/test/file-lifecycle.spec.ts`）。
- SDK 錯誤在這一層轉成 `AppException('FILE_STORAGE_UNAVAILABLE')`（503）並記錄；「物件不存在」轉成 `undefined`，
  不當成錯誤。`CompleteMultipartUpload` 因客戶端交來的塊不對而失敗（`InvalidPart`、`InvalidPartOrder`、`EntityTooSmall`、
  `NoSuchUpload`）轉成 `FILE_UPLOAD_INCOMPLETE`（409）：那是「請重新上傳」，不是儲存服務故障。
- 啟動時嘗試 `ensureBucket()`，**失敗不擋啟動**（RBAC 與檔案無關），第一次登記上傳時會再試。

### 2.1 兩個 S3 client

| client | endpoint | 用途 |
| --- | --- | --- |
| `client` | `FILE_STORAGE_ENDPOINT`（內網，例：`http://file-storage:9000/storage`） | api 自己發的請求：HeadObject、DeleteObject、建 bucket |
| `presigner` | `FILE_STORAGE_PUBLIC_ENDPOINT`（瀏覽器看到的，例：`https://example.com/storage`） | 只簽 presigned URL，不發請求 |

SigV4 的簽章包含 **host 與路徑**，所以不能用內網 client 簽完再把網址換成對外位址。

### 2.2 SDK 設定

- `forcePathStyle: true`：apps/file-storage 只支援 path-style；S3 也支援。
- `requestChecksumCalculation: 'WHEN_REQUIRED'`：SDK 預設會替 PutObject 加 CRC32，presigned PUT 會被簽進
  「空 body 的 checksum」，瀏覽器實際上傳的內容對不上就被 **真正的 S3** 拒絕（apps/file-storage 不驗 checksum，本機測不出來）。
- presigned PUT 把 `Content-Type` 簽進去（`signableHeaders`）：瀏覽器換了型別就被拒，存下來的型別一定是登記的那個。

---

## 3. 網址與反向代理

presigned URL 必須在瀏覽器端與儲存服務端算出相同的簽章，因此 **瀏覽器看到的 host 與完整路徑** 必須原封不動到達儲存服務：

| 環境 | 瀏覽器打 | 轉給 | 設定 |
| --- | --- | --- | --- |
| 本機 | `http://localhost:5173/storage/…` | Vite proxy → `localhost:9000` | 不 `changeOrigin`、不 `rewrite`（`apps/web/vite.config.ts`） |
| Docker | `${PUBLIC_ORIGIN}/storage/…` | nginx → `file-storage:9000` | `proxy_set_header Host $http_host`、`proxy_pass` 不帶 URI（`deploy/nginx.conf`） |

兩者都 **保留 `/storage` 前綴**，由 file-storage 的 `FILE_STORAGE_BASE_PATH=/storage` 去掉後再解析 bucket / key
（[`../03-file-storage.md`](../03-file-storage.md) §3.1）。同源的好處：不需要 CORS，CSP 的 `img-src 'self'`、`connect-src 'self'` 不必放寬。

換成真正的 S3 時，`FILE_STORAGE_PUBLIC_ENDPOINT` 設成 S3 的 endpoint，並在 bucket 上設定 CORS 與放寬 CSP。

---

## 4. 轉介表：`files`

對外只用 `files.id`；物件儲存的 key 只在後端出現。

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | uuid | 對外唯一識別 |
| `name` | text | 顯示用檔名（可改名；不可含 `/`、`\`、控制字元，≤ 255） |
| `content_type` | text | 登記時的 MIME，小寫、不含參數 |
| `size` | bigint | `pending`：登記的大小；`ready`：物件儲存實際大小（兩者必須相同） |
| `storage_key` | text（unique） | `files/<id>`——只由 id 決定，改名不搬物件，也沒有編碼、重名、路徑穿越問題 |
| `etag` | text | 物件儲存回報的 ETag；`ready` 才有 |
| `status` | `file_status` | `pending` / `ready` |
| `uploaded_at` | timestamptz | 確認完成的時間 |
| `upload_id` | text | 分塊上傳的 uploadId；單次 PUT 或已完成時為 null（§5.2） |
| `has_thumbnail` | boolean | 瀏覽器上傳的縮圖（`thumbnails/<id>`）在完成時確認存在且合規格（§5.1） |
| `variant_status` | `file_variant_status` | 影像變體：`none`（不是伺服器能處理的圖片）/ `pending` / `ready` / `failed`（§5.4） |
| `image_width` / `image_height` | integer | 套用 EXIF 方向後的原圖尺寸；變體 `ready` 才有 |
| `variant_format` | text | 變體的主格式：`jpeg`（progressive）或 `webp`（有透明度的圖） |
| `version` | integer | 樂觀鎖，每次改名遞增（§6.2）。不用 `updated_at` 比對：它是微秒精度，經過 JSON（毫秒）來回就對不上 |
| `created_*` / `updated_*` / `deleted_at` | | 慣例欄位；`updated_at` 由 trigger 維護；刪除是軟刪除 |

約束（migration `0006_files.sql`，整合測試證明擋得住）：

- `files_size_non_negative`：`size >= 0`
- `files_ready_confirmed`：`status = 'pending'` 或（`etag` 與 `uploaded_at` 都有值）——沒經過物件儲存確認的 `ready` 不可能存在
- `files_storage_key_key`：`storage_key` 唯一
- `files_variant_ready_described`：`variant_status <> 'ready'` 或（尺寸與主格式都有值）（migration `0008_file_image_variants.sql`）

索引（migration `0007_file_manager.sql`；都只涵蓋 `deleted_at IS NULL`）：

| 索引 | 用途 |
| --- | --- |
| `files_status_created_at_idx`（status, created_at） | 預設排序與 keyset 分頁 |
| `files_status_name_idx`（status, name, id）、`files_status_size_idx`（status, size, id） | 依檔名／大小排序與 keyset 分頁：索引直接給出順序，不必排序整張表 |
| `files_status_content_type_idx`（status, content_type） | 分類篩選（`content_type LIKE 'image/%'` 等前綴比對） |
| `files_name_trgm_idx`（GIN, `gin_trgm_ops`） | 檔名的部分比對 `ILIKE '%…%'`：btree 用不上。需要 `pg_trgm`（PG 13 起為 trusted extension） |
| `files_variant_pending_idx`（uploaded_at，只涵蓋 `variant_status = 'pending'`） | 維護排程找卡住的影像變體（`0008`）；絕大多數列不是 pending，索引很小 |

### 4.1 可見性

| 狀態 | 誰看得到 | 可以做什麼 |
| --- | --- | --- |
| `pending` | 只有上傳者本人（`GET /files/:id`、`complete`） | 完成上傳 |
| `ready` | 所有 `file:read`（平的範圍，ADR-0006） | 讀、改名、刪除 |

`pending` 不出現在列表、不發推播；別人查詢一律 `404 FILE_NOT_FOUND`。

其他模組要引用檔案（例：角色頭像、關卡素材）時 **存 `files.id` 外鍵**，需要網址時注入 `FileService`。

---

## 5. 上傳流程

```
瀏覽器                         api                                  物件儲存
  │ POST /files {name, contentType, size, thumbnail?}
  │──────────────────────────────▶│ 檢查大小上限、ensureBucket
  │                               │ 大於門檻 → CreateMultipartUpload（§5.2）
  │                               │ INSERT files (pending, storage_key=files/<id>)
  │ 201 {file, upload | multipart, thumbnailUpload}
  │◀──────────────────────────────│
  │ PUT upload.url（帶 upload.headers）──────────────────────────────────▶│
  │ PUT thumbnailUpload.url（有縮圖時，與本體並行）──────────────────────▶│
  │◀─────────────────────────────────────────────────────────────── 200 ETag
  │ POST /files/:id/complete
  │──────────────────────────────▶│ HeadObject：不存在 → 409 FILE_UPLOAD_INCOMPLETE
  │                               │ 大小不符 → 刪物件、422 FILE_SIZE_MISMATCH
  │                               │ HeadObject(thumbnails/<id>)：存在且合規格 → has_thumbnail
  │                               │ 交易：UPDATE … SET status='ready' WHERE status='pending' ＋ 稽核 file.upload
  │                               │ 交易後：推播 file create；圖片排入產生影像變體（§5.4，不等它完成）
  │ 200 StoredFile（ready，帶 url / downloadUrl / thumbnailUrl）
  │◀──────────────────────────────│
```

- 檔案內容 **不經過 api**：大檔不佔 api 的頻寬與記憶體，也不受 api 的 body 上限限制。
- presigned PUT 無法限制大小，所以大小在 `complete` 時比對；不符就刪掉物件，使用者可用同一個網址（未過期時）重傳。
- 並行的兩個 `complete`：`UPDATE … WHERE status='pending'` 只有一個成功，另一個 `409 FILE_ALREADY_UPLOADED`。

前端不自己編排這些步驟，呼叫 `apps/web/src/apis/file/upload-file/` 的 `uploadFile()`：

```ts
const file = await uploadFile({ file: input.files[0], thumbnail, onProgress: ({ loaded, total }) => … }, signal);
// file.status === 'ready'；<img src={file.url}>
```

後端步驟的 fetcher 放在 `upload-file/steps.ts`，**不** 拆成獨立的 `apis/file/<operation>/`：單獨呼叫任一步都沒有意義。
直傳用 XHR（`putToStorage.ts`）而不是 fetch——fetch 拿不到上傳進度。登記之後任何一步失敗或被中止，
`uploadFile()` 都會呼叫 `DELETE /files/:id/upload` 放棄這次上傳（§5.3）。

檔案管理器的完整上傳流程（驗證、全域佇列、跨分頁接手）見 [`../frontend/12-file-manager.md`](../frontend/12-file-manager.md) §8。

### 5.1 瀏覽器縮圖

列表的圖示預覽若直接用原圖，一頁 60 張 1–5 MB 的圖就是上百 MB。伺服器能處理的圖片由伺服器產生圖示預覽（§5.4）；
在那之前、以及伺服器處理不了的檔案，退回 **瀏覽器在上傳時產生** 的縮圖（`core/file` 的縮圖產生器，長邊 480 px 的 WebP），
與本體一起直傳到 `thumbnails/<id>`。它讓列表在變體產生完成前就有圖可看，也是之後其他類型（影片封面等）的擴充點。

- 登記時帶 `thumbnail: { contentType, size }`（型別限 `image/webp` / `image/jpeg` / `image/png`，≤ 512 KiB）才發縮圖的直傳網址。
- `complete` 時以 HeadObject 確認縮圖存在、大小與型別合規格才設 `has_thumbnail`；**不合規格不讓上傳失敗**，只是沒有縮圖。
- `StoredFile.thumbnailUrl`：伺服器的圖示預覽優先，其次是瀏覽器縮圖；都沒有時前端以類型圖示顯示，2 MiB 以下的圖片直接用原檔。
- 刪除時一併刪縮圖。

### 5.2 分塊上傳（大檔）

大於 `FILE_MULTIPART_THRESHOLD`（預設 16 MiB）的檔案改用 S3 multipart upload：

```
POST /files {size: 40 MiB}
  → api: CreateMultipartUpload → files.upload_id
  ← 201 {file, upload: null, multipart: {partSize: 8 MiB, partCount: 5}}
POST /files/:id/parts {partNumbers: [1..5]}         一次最多 100 塊，邊傳邊要
  ← 200 {parts: [{partNumber, url, method:'PUT', headers}], expiresAt}
PUT parts[i].url（file.slice 的一塊）× N              並行 4 塊；回應標頭 ETag
POST /files/:id/complete {parts: [{partNumber, etag}]}
  → api: CompleteMultipartUpload → HeadObject 比對大小 → ready（upload_id 清空）
```

| 規則 | 理由 |
| --- | --- |
| 切法（`partSize`、`partCount`）由後端決定 | S3 規定非最後一塊 ≥ 5 MiB、最多 10000 塊；檔案上限很大時自動放大每塊 |
| 每塊的網址另外要（`POST /files/:id/parts`） | 大檔可能傳很久，一次發齊的網址會在中途過期；前端在網址剩不到 60 秒時重新要 |
| 每塊各自重試（網路錯誤、5xx，指數退避 3 次） | 失敗只重傳那一塊，不必從頭來 |
| 進度 = 各塊已送出位元組的總和 | 重試的那一塊從 0 重算，進度條可能小幅倒退，但不會卡住 |
| `complete` 帶各塊的 ETag，後端依塊號排序後交給物件儲存 | 塊缺漏、ETag 不符由物件儲存判定（→ `FILE_UPLOAD_INCOMPLETE`） |

瀏覽器必須讀得到 PUT 回應的 `ETag` 標頭：同源代理（本機 Vite、Docker nginx）下天生可以；
換成跨源的 S3 時要在 bucket CORS 設定 `ExposeHeaders: ETag`。

### 5.3 放棄上傳

`DELETE /files/:id/upload`（`file:create`，只限上傳者本人、`pending`）：軟刪除紀錄，交易後 AbortMultipartUpload、
刪除已上傳的內容與縮圖（失敗只記 warn）。`pending` 從未對其他人可見，所以不寫稽核、不發推播。
與 `complete` 並行時以 `UPDATE … WHERE status='pending'` 決勝：`complete` 先完成就回 `409 FILE_ALREADY_UPLOADED`，不會刪掉已完成的檔案。

### 5.4 影像變體與影像 API

圖片上傳完成後，伺服器把它 **實體化成三個版本** 存進物件儲存，給前端不同的用途：

| 版本（`variant`） | 物件 key | 內容 | 用途 |
| --- | --- | --- | --- |
| `original` | `files/<id>` | 使用者上傳的原檔，原封不動 | 下載、「原始大小」檢視 |
| `preview` | `variants/<id>/preview.<格式>` | 長邊 ≤ 2560 px | LightBox 全螢幕預覽 |
| `thumbnail` | `variants/<id>/thumbnail.<格式>` | 長邊 ≤ 480 px | 列表／卡片的圖示預覽 |

- **哪些圖片**：`IMAGE_VARIANT_SOURCE_TYPES`（`file.constants.ts`）——JPEG、PNG、WebP、GIF（第一格）、AVIF、TIFF。
  SVG 不處理（向量圖由瀏覽器直接顯示，也不讓 api 解析使用者給的 XML）；其他檔案 `variant_status = 'none'`。
- **主格式**：**progressive JPEG**（mozjpeg，品質 82）——大圖在下載途中就由模糊到清楚逐步顯示；
  有透明度的圖改用 WebP（JPEG 沒有透明度）。一律依 EXIF 轉正、移除中繼資料（GPS 等）、等比縮小不放大。
- **何時產生**：`complete` 的交易與推播之後排入 `FileImageService.schedule()`（同一個 api 執行個體同時最多 2 張，
  同一個檔案不重複排入），**不等它完成**。完成後 `variant_status = 'ready'` 並推播 `file` 的 UPDATE，前端重抓就拿到網址。
  在那之前 `thumbnailUrl` 是瀏覽器縮圖（有的話），LightBox 用原圖。
- **失敗**：解碼失敗（損毀、超過 128 MiB 或 1 億像素）→ `failed`，不再重試，前端退回瀏覽器縮圖或類型圖示；
  儲存服務暫時不可用 → 維持 `pending`，由維護排程（§9）在 5 分鐘後重新排入。執行個體在產生途中重啟同理。
- **既有資料**：migration `0008` 把已完成的圖片標成 `pending`，由維護排程逐批補產生。
- **影像處理在 api 內**（`core/image` 的 `ImageProcessor`，實作是 sharp）：sharp 是預編譯的原生套件，
  平台二進位檔隨 `@img/sharp-*` 安裝（macOS、Linux glibc / musl 都有），不需要編譯環境。取捨見 [ADR-0014](../../adr/0014-server-image-variants.md)。

#### 影像 API：`GET /files/:id/image/:variant`

`StoredFile.image` 帶三個版本的網址（`originalUrl` / `previewUrl` / `thumbnailUrl`），可以直接放進 `<img src>`：

```
/api/files/<id>/image/preview?exp=1790000000&sig=<HMAC>[&format=webp|avif|png|jpeg|auto]
```

| 規則 | 理由 |
| --- | --- |
| `@Public()`，以網址上的 **HMAC 簽章**授權（`file-image-url.ts`：簽 `id`、`variant`、`exp`，金鑰由 `JWT_SECRET` 衍生） | `<img src>` 帶不了 access token（只在記憶體）。網址只從 `file:read` 的回應拿得到——與 presigned URL 相同的模型 |
| `format` 不在簽章內 | 它只決定編碼方式，不擴大能讀到的內容；前端可以自己在網址後面加 |
| `exp` 取整到 `FILE_URL_TTL / 2` 的時間窗（同 §7.1） | 同一個時間窗內網址不變，`<img>` 與 HTTP 快取直接命中 |
| 回 **302 轉址** 到物件儲存的 presigned 網址，帶 `Cache-Control: private, max-age=<剩餘秒數>`、`Vary: Accept` | 內容仍由物件儲存送出、不經過 api；轉址本身也被瀏覽器快取 |
| 不限流（`@SkipThrottle()`） | 一頁的圖示預覽就有數十個請求；轉址會被快取，格式轉換只發生一次 |
| 簽章不符、換了版本、過期 → `403 FILE_IMAGE_URL_INVALID`；檔案不存在、已刪除、變體不可用 → `404 FILE_NOT_FOUND` | |

**格式**（`format` 參數）：

| `format` | 回應 |
| --- | --- |
| 不指定 | 主格式：`preview` / `thumbnail` 是 progressive JPEG（透明圖是 WebP）；`original` 原封不動 |
| `jpeg` | progressive JPEG（透明的部分鋪白底）；`original` 也會重新編碼成 progressive JPEG（原尺寸） |
| `webp` / `avif` / `png` | 指定格式 |
| `auto` | 依 `Accept`：AVIF → WebP → 同不指定；`original` 本身已是瀏覽器接受的格式時原封不動 |

主格式以外的格式 **第一次被要求時才轉出**（從原圖轉，畫質比從主格式再轉一次好），存成 `variants/<id>/<variant>.<格式>`，
之後直接轉址。同時多個請求只轉一次；轉換與變體產生共用同一個並行上限。

---

## 6. API

| Method | Path | 權限 | 回應 |
| --- | --- | --- | --- |
| GET | `/files` | `file:read` | `FileListPage`：`{ items: StoredFile[], pagination, nextCursor }` |
| GET | `/files/upload-policy` | `file:create` | `FileUploadPolicy`：`{ maxSize, multipartThreshold, partSize, thumbnailMaxSize, thumbnailContentTypes }` |
| POST | `/files` | `file:create` | `201 FileUpload`：`{ file, upload \| null, multipart \| null, thumbnailUpload \| null }` |
| POST | `/files/:id/parts` | `file:create` | `200 FileUploadParts`：`{ parts, expiresAt }`（§5.2） |
| POST | `/files/:id/complete` | `file:create` | `200 StoredFile`；分塊上傳要帶 `{ parts }` |
| DELETE | `/files/:id/upload` | `file:create` | `204`（§5.3） |
| GET | `/files/:id/image/:variant` | `@Public`（網址簽章） | `302` 轉址（§5.4）；`variant` = `original` / `preview` / `thumbnail` |
| GET | `/files/:id` | `file:read` | `200 StoredFile` |
| PATCH | `/files/:id` | `file:update` | `200 StoredFile`（`{ name, version? }`，§6.2） |
| DELETE | `/files/:id` | `file:delete` | `204` |

`GET /files` 的 query：`offset` / `limit`、`keyword`（檔名部分比對）、`contentType`（`image/png` 或 `image/*`）、
`category`（`image` / `video` / `audio` / `text` / `document` / `archive` / `other`，對照表在 `file.constants.ts` 的
`FILE_CATEGORY_RULES`；`other` 是不屬於其他任何一類）、`uploaderId`、`sort`（`createdAt` / `name` / `size`，預設 `-createdAt`）、
`cursor`（§6.1）。

`StoredFile`（OpenAPI 名稱；避開瀏覽器內建的 `File`。列表的 `FileListPage` 同理避開 `FileList`）：

```jsonc
{
  "id": "uuid",
  "name": "角色 立繪.png",
  "contentType": "image/png",
  "size": 12345,
  "status": "ready",
  "url": "https://…/storage/game-editor/files/<id>?X-Amz-…",          // inline：直接顯示
  "downloadUrl": "https://…/storage/game-editor/files/<id>?X-Amz-…",  // attachment：以 name 下載
  "thumbnailUrl": "/api/files/<id>/image/thumbnail?exp=…&sig=…",       // 伺服器圖示預覽 → 瀏覽器縮圖 → null
  "image": {                                                           // 不是圖片、或變體還沒產生時為 null（§5.4）
    "width": 4000, "height": 3000,                                     // 套用 EXIF 方向後的原圖尺寸
    "originalUrl": "/api/files/<id>/image/original?exp=…&sig=…",
    "previewUrl": "/api/files/<id>/image/preview?exp=…&sig=…",
    "thumbnailUrl": "/api/files/<id>/image/thumbnail?exp=…&sig=…",
    "expiresAt": "2026-09-27T00:15:00.000Z"
  },
  "urlExpiresAt": "2026-09-27T00:15:00.000Z",                          // 所有網址中最早失效的時間
  "version": 3,                                                        // 樂觀鎖
  "uploader": { "id": "uuid", "displayName": "Alice" },
  "uploadedAt": "…", "createdAt": "…", "updatedAt": "…"
}
```

- 網址每次查詢時現簽（本地 HMAC，不打儲存服務），列表 200 筆也只是幾毫秒。
- `downloadUrl` 的 `Content-Disposition` 同時帶 ASCII 退路與 `filename*=UTF-8''…`，中文檔名下載不會亂碼。

### 6.1 keyset 分頁（`cursor`）

無限捲動用 offset 分頁時，捲動途中有人上傳（插在前面）會讓下一頁重複前一頁的最後幾筆，有人刪除則會漏掉。
`GET /files` 每一頁都回 `nextCursor`（滿頁時；否則 null）；帶 `cursor` 時取「排在游標那一筆之後」的一頁：

```sql
WHERE … AND (created_at < $v OR (created_at = $v AND id < $id))
ORDER BY created_at DESC, id DESC
LIMIT $limit
```

- 游標內容是 `[排序欄位, 方向, 值, id]` 的 base64url JSON；**排序條件寫進游標**，換了排序還拿舊游標回 `400 VALIDATION_FAILED`。
- `createdAt` 的值由資料庫以 **微秒** 格式化（`to_char(… 'US')`）：JS 的 Date 只有毫秒，截掉會漏掉同一毫秒內的其他檔案。
- 帶游標時只依 `sort` 的第一個條件（＋ id）排序、忽略 `offset`；`pagination.total` 照常回傳（篩選後的總數）。
- 以 (排序欄位, id) 為鍵的索引（§4）讓每一頁都是索引範圍掃描，捲到第 100 頁也不會變慢（offset 要先掃過前面所有列）。

### 6.2 改名的樂觀鎖

`PATCH /files/:id` 帶 `version`（畫面上看到的版本）時，比對與寫入在同一個 `UPDATE … WHERE version = $v`：

| 情況 | 結果 |
| --- | --- |
| 版本相符 | 改名、`version + 1`，回新的 `StoredFile` |
| 讀到之前就不同（別人已改過） | `409 FILE_VERSION_CONFLICT`（`details.current`） |
| 讀到之後、寫入之前被搶先 | UPDATE 沒命中 → `409 FILE_VERSION_CONFLICT` |
| 不帶 `version` | 後寫者勝（腳本、批次） |

錯誤碼：

| 碼 | 狀態 | 時機 |
| --- | --- | --- |
| `FILE_NOT_FOUND` | 404 | 不存在、已刪除、別人的 `pending`、對 `pending` 改名／刪除 |
| `FILE_TOO_LARGE` | 413 | 登記的大小超過 `FILE_UPLOAD_MAX_SIZE`（`details.maxSize`） |
| `FILE_ALREADY_UPLOADED` | 409 | 對 `ready` 再 `complete` 或放棄；並行完成的較晚者 |
| `FILE_UPLOAD_INCOMPLETE` | 409 | `complete` 時物件儲存裡還沒有內容、分塊不對；前端直傳被拒時也用它 |
| `FILE_SIZE_MISMATCH` | 422 | 實際大小與登記不符（`details.expected` / `details.actual`） |
| `FILE_UPLOAD_PART_INVALID` | 422 | 對單次 PUT 的上傳要分塊網址、塊號超出 `partCount`、分塊上傳 `complete` 沒帶 `parts` |
| `FILE_VERSION_CONFLICT` | 409 | 改名時版本不符（§6.2） |
| `FILE_IMAGE_URL_INVALID` | 403 | 影像 API 的網址簽章不符、版本不符或已過期（§5.4） |
| `FILE_STORAGE_UNAVAILABLE` | 503 | 物件儲存連不上或回非預期錯誤 |

---

## 7. 刪除、稽核、推播

- 刪除：交易內軟刪除 ＋ 稽核 `file.delete`；**交易後** 才刪物件（原檔、瀏覽器縮圖、`variants/<id>/` 底下的所有變體與轉出的格式；
  交易 rollback 時紀錄還在，內容也要在）。物件刪除失敗只留下孤兒物件並記 warn，不讓使用者的刪除失敗——維護排程會再清（§9）。
- 變體產生途中檔案被刪除：`markVariantsReady` 的 `WHERE deleted_at IS NULL` 不命中，剛寫入的變體立即刪除。
- 稽核：`file.upload`（完成時，不是登記時）、`file.update`（只記有變的欄位）、`file.delete`；`resourceType = 'file'`。
- 推播：`ChangeSource.FILE`，受眾 `file:read`（[`08-realtime.md`](./08-realtime.md) §6.1）；前端 `Resource.FILE`
  失效 `FILE_LIST_QUERY_KEY`、`FILE_INFINITE_LIST_QUERY_KEY` / `FILE_DETAIL_QUERY_KEY`。

### 7.1 下載網址的快取

presigned URL 帶簽章時間，每次查詢都重簽就會得到不同的網址——列表每次重抓，瀏覽器都當成新圖片重新下載。
所以 `presignDownload` 把簽章時間 **取整到 `FILE_URL_TTL / 2` 的倍數**（`stableSigningDate`）：

- 同一個時間窗內對同一個物件簽出一模一樣的網址，`<img>` 與 HTTP 快取直接命中；
- 回應帶 `Cache-Control: private, max-age=<TTL/2>, immutable`（`response-cache-control`）：物件以 id 為 key、從不覆寫；
- 代價：網址的剩餘效期介於 `TTL / 2` 與 `TTL` 之間。`urlExpiresAt` 反映真正的失效時間，前端在失效前 60 秒重抓列表。

---

## 8. 環境變數

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `FILE_STORAGE_ENDPOINT` | `http://127.0.0.1:9000/storage` | api 連線用 |
| `FILE_STORAGE_PUBLIC_ENDPOINT` | `http://localhost:5173/storage` | 瀏覽器看到的位址；presigned URL 以它簽章 |
| `FILE_STORAGE_REGION` | `us-east-1` | |
| `FILE_STORAGE_BUCKET` | `game-editor` | 不存在時自動建立 |
| `FILE_STORAGE_ACCESS_KEY_ID` / `FILE_STORAGE_SECRET_ACCESS_KEY` | 必填 | 與 apps/file-storage 共用同名變數 |
| `FILE_UPLOAD_MAX_SIZE` | `104857600`（100 MiB） | 單一檔案上限 |
| `FILE_URL_TTL` | `900` | presigned 上傳／下載網址的有效秒數（60–604800）；下載網址在 `TTL / 2` 的時間窗內不變（§7.1） |
| `FILE_MULTIPART_THRESHOLD` | `16777216`（16 MiB） | 超過這個大小改用分塊上傳（§5.2） |
| `FILE_MULTIPART_PART_SIZE` | `8388608`（8 MiB） | 每塊大小（5 MiB–5 GiB）；檔案上限 / 10000 更大時自動放大 |
| `FILE_PENDING_TTL` | `86400` | 登記後超過這個秒數仍未完成的上傳視為放棄（§9）；大檔會邊傳邊要新的分塊網址，所以遠長於 `FILE_URL_TTL` |
| `FILE_MAINTENANCE_INTERVAL` | `3600` | 維護排程的間隔秒數；`0` 停用（多個 api 執行個體時可只留一個開著）。啟動 60 秒後第一次執行 |
| `FILE_MAINTENANCE_DRY_RUN` | `false` | `true`：只偵測並記錄殘留，不刪除任何東西 |
| `API_PUBLIC_BASE_URL` | `/api` | 瀏覽器看到的 api 位址；影像 API 的網址以它開頭（§5.4） |

---

## 9. 維護排程：上傳失敗的殘留

前端失敗或取消時會呼叫 `DELETE /files/:id/upload`（§5.3），但有些情況沒機會呼叫、或清理本身失敗，殘留不會自己消失。
`FileMaintenanceService` 每 `FILE_MAINTENANCE_INTERVAL` 秒（在 api 內，`setInterval` ＋ `unref`）偵測並清除：

| # | 殘留 | 來源 | 偵測 | 處理 |
| --- | --- | --- | --- | --- |
| 1 | 逾時的 `pending` 紀錄 | 分頁當掉、網路中斷，沒呼叫放棄上傳 | `status='pending' AND created_at < now - FILE_PENDING_TTL`（依 id 分頁） | 軟刪除紀錄（`WHERE status='pending'` 決勝，並行完成的不刪）→ AbortMultipartUpload、刪原檔與縮圖 |
| 2 | 沒有紀錄的分塊上傳 | `CreateMultipartUpload` 成功而 INSERT 失敗；放棄時 abort 失敗 | `ListMultipartUploads(files/)` 中 uploadId 不屬於任何未刪除紀錄 | AbortMultipartUpload |
| 3 | 孤兒物件 | 刪除、放棄時物件刪除失敗；紀錄已刪除 | `ListObjectsV2` 列出 `files/`、`thumbnails/`、`variants/`，由 key 取出 id，查不到未刪除紀錄 | 刪除 |
| 4 | 卡住的影像變體 | 產生途中重啟、儲存服務暫時不可用；migration 補產生 | `variant_status='pending' AND uploaded_at < now - 5 分鐘` | 重新排入（§5.4） |

- **不誤判**：2、3 只看建立早於 `now - FILE_PENDING_TTL` 的東西——剛登記、INSERT 還沒提交的上傳不會被當成孤兒；
  不是這個模組產生的 key（前綴不對、id 不是 uuid）一律不碰。
- **偵測**：每一輪回傳 `FileMaintenanceReport`（四類各偵測到幾筆、處理失敗幾筆），有發現時記 info log；
  `FILE_MAINTENANCE_DRY_RUN=true` 時 **只偵測、不處理**，可以先觀察再開啟。
- **冪等**：刪除不存在的東西視為成功、軟刪除以條件 UPDATE 決勝，多個執行個體同時跑只是重複做白工；
  同一個執行個體內上一輪沒結束時不重疊執行。處理失敗的項目下一輪會再偵測到。
- **步驟互不依賴**：某一步整個失敗（例：換成不支援 `ListMultipartUploads` 的儲存服務）只記一筆 failure 並記 warn，其他步驟照常執行。
- **成本**：3 每一輪列出受管理前綴下的所有物件（每頁 1000 個、每 500 個查一次資料庫）；物件數量大到列表變慢時，
  改成把間隔拉長，或在另一個執行個體跑。
- 為什麼在 api 內而不是 `db:archive-audit-logs` 那樣的腳本：清理需要 `ObjectStorage` 與補產生變體的 `ImageProcessor`，
  腳本只能 import 不依賴 DI 的純函式（[`../../conventions/07-layer-dependencies.md`](../../conventions/07-layer-dependencies.md) §3.2）。

---

## 10. 測試

| 檔案 | 內容 |
| --- | --- |
| `src/modules/file/__tests__/file.service.spec.ts` | 業務規則：每個 `AppException` 分支、可見性、交易後才刪物件；分塊上傳、放棄上傳、縮圖、樂觀鎖、游標 |
| `test/file-lifecycle.spec.ts` | 真 Postgres ＋ 記憶體版 `ObjectStorage`：完整流程（單次與分塊）、放棄上傳、縮圖、影像變體與影像 API（不帶 token、302、轉出 WebP、簽章綁定版本、刪除時清變體）、維護排程（dry run 與清除）、樂觀鎖、keyset 游標在插入後不重複、分類篩選、權限（admin / auditor / member）、四個資料表約束 |
| `src/core/storage/__tests__/content-disposition.spec.ts` | 中文檔名的 `Content-Disposition` |
| `src/core/storage/__tests__/stable-signing-date.spec.ts` | 下載網址在時間窗內不變、剩餘效期範圍 |
| `src/core/image/__tests__/sharp-image-processor.spec.ts` | progressive JPEG、等比縮放不放大、透明圖鋪白底、EXIF 轉正、串流讀入、位元組上限 |
| `src/modules/file/__tests__/file-image.service.spec.ts` | 真的 sharp ＋ 記憶體儲存：實體化兩個變體、WebP 主格式、失敗與重試的分界、途中刪除、影像 API 的簽章／格式協商／依請求轉出並快取 |
| `src/modules/file/__tests__/file-maintenance.service.spec.ts` | 四類殘留的偵測與清除、dry run、與 complete 並行、失敗不中斷、不重疊執行 |
| `apps/web/src/apis/file/upload-file/__tests__/uploadFile.test.ts` | 編排、進度、直傳失敗、取消與放棄上傳、縮圖；分塊：並行、ETag 排序、單塊重試、4xx 不重試 |

與真實 S3 協定的相容性由 apps/file-storage 的測試（官方 SDK）負責；api 端的 `S3ObjectStorage` 另以 Docker 整套
（`docker-compose.prod.yml`）手動驗證過 presigned 直傳、Content-Type 綁定、中文檔名下載與刪除。
