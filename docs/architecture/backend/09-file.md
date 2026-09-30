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
| `core/storage` | S3 協定、bucket（目前租戶的）、presign | `files` 資料表、權限、任何 module |
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
| `presigner` | `FILE_STORAGE_PUBLIC_ENDPOINT`（瀏覽器看到的，例：`{tenantOrigin}/storage` → `https://acme.example.com/storage`） | 只簽 presigned URL，不發請求；每個 endpoint 一個 client |

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
| 本機 | `http://localhost:5173/storage/…` | Vite proxy → `localhost:9000` | 不 `changeOrigin`、不 `rewrite`（`apps/backstage/vite.config.ts`） |
| Docker | `${PUBLIC_ORIGIN}/storage/…` | nginx → `file-storage:9000` | `proxy_set_header Host $http_host`、`proxy_pass` 不帶 URI（`deploy/nginx.conf`） |

兩者都 **保留 `/storage` 前綴**，由 file-storage 的 `FILE_STORAGE_BASE_PATH=/storage` 去掉後再解析 bucket / key
（[`../03-file-storage.md`](../03-file-storage.md) §3.1）。同源的好處：不需要 CORS，CSP 的 `img-src 'self'`、`connect-src 'self'` 不必放寬。

換成真正的 S3 時，`FILE_STORAGE_PUBLIC_ENDPOINT` 設成 S3 的 endpoint，並在 bucket 上設定 CORS 與放寬 CSP。

每個租戶的 backstage 在自己的網域（[ADR-0020](../../adr/0020-physical-tenant-isolation.md) D2），CSP 的 `connect-src 'self'` 只允許同源，
所以預設值 `{tenantOrigin}/storage` 的佔位符會換成 **目前租戶主要網域** 的 origin（協定沿用 `APP_PUBLIC_URL`）：
acme 的使用者拿到 `https://acme.example.com/storage/…`，由那個網域的反向代理轉給 file-storage（Host 原樣轉發，SigV4 的簽章才對得上）。

### 3.1 每個租戶一個 bucket（[ADR-0020](../../adr/0020-physical-tenant-isolation.md) D16）

- bucket 記在平台 DB 的 `tenants.storage_bucket`（唯一，刪除的租戶也算），隨租戶脈絡帶著走；`S3ObjectStorage` 的每個操作都用
  **目前租戶** 的 bucket，沒有租戶脈絡時拋 `TENANT_NOT_FOUND`，不會退回任何共用的 bucket。業務模組的 key 不帶租戶。
- 檔案維護（§9）在每個租戶裡各跑一次，「沒有紀錄的物件」只在自己的 bucket 對帳，不會刪到別的租戶的檔案。
- 啟動時確認每個 `active` 租戶的 bucket，不存在就建立；上傳前再確認一次（`ensureBucket`）。健康檢查只看儲存服務連不連得上（`ListBuckets`）。
- 預設租戶沿用租戶化之前共用的 bucket（`DEFAULT_TENANT_STORAGE_BUCKET`，預設 `b2b-system`），既有檔案不必搬；
  之後的租戶由佈建（交付順序第 4 步）指定，命名規則由 `isValidBucketName` 檢查。

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
| `folder_id` | uuid（FK → `file_folders`） | 所在的資料夾；null 是根目錄（§4.2） |
| `version` | integer | 樂觀鎖，每次改名遞增（§6.2）。不用 `updated_at` 比對：它是微秒精度，經過 JSON（毫秒）來回就對不上 |
| `deletion_id` | uuid | 一次刪除操作的識別：遞迴刪除資料夾時與資料夾同一個值，還原資料夾時只還原同一批（[ADR-0025](../../adr/0025-entity-revisions.md) D5、[`13-trash.md`](./13-trash.md) §7.0）；未刪除時是 null |
| `created_*` / `updated_*` / `deleted_at` | | 慣例欄位；`updated_at` 由 trigger 維護；刪除是軟刪除（移到回收桶，[`13-trash.md`](./13-trash.md) §7） |

約束（schema 的 `check()`，在 migration `0000_baseline.sql`；整合測試證明擋得住）：

- `files_size_non_negative`：`size >= 0`
- `files_ready_confirmed`：`status = 'pending'` 或（`etag` 與 `uploaded_at` 都有值）——沒經過物件儲存確認的 `ready` 不可能存在
- `files_storage_key_key`：`storage_key` 唯一
- `files_variant_ready_described`：`variant_status <> 'ready'` 或（尺寸與主格式都有值）

索引（都只涵蓋 `deleted_at IS NULL`）：

| 索引 | 用途 |
| --- | --- |
| `files_status_created_at_idx`（status, created_at） | 預設排序與 keyset 分頁 |
| `files_status_name_idx`（status, name, id）、`files_status_size_idx`（status, size, id） | 依檔名／大小排序與 keyset 分頁：索引直接給出順序，不必排序整張表 |
| `files_created_by_created_at_idx`（created_by, created_at） | 依上傳者篩選（`uploaderId`，`0004`） |
| `files_status_content_type_idx`（status, content_type） | 分類篩選（`content_type LIKE 'image/%'` 等前綴比對） |
| `files_name_trgm_idx`（GIN, `gin_trgm_ops`） | 檔名的部分比對 `ILIKE '%…%'`：btree 用不上。需要 `pg_trgm`（PG 13 起為 trusted extension） |
| `files_variant_pending_idx`（uploaded_at，只涵蓋 `variant_status = 'pending'`） | 維護排程找卡住的影像變體（`0008`）；絕大多數列不是 pending，索引很小 |
| `files_folder_created_at_idx`（folder_id, created_at, id） | 檔案管理器一次只列一個資料夾（`GET /files?folderId=`），先以資料夾縮小範圍（`0009`） |
| `files_deletion_id_idx`（deletion_id，只涵蓋 `deleted_at IS NOT NULL`） | 還原資料夾時找同一批刪除的檔案（`0013`） |

### 4.1 可見性

| 狀態 | 誰看得到 | 可以做什麼 |
| --- | --- | --- |
| `pending` | 只有上傳者本人（`GET /files/:id`、`complete`） | 完成上傳 |
| `ready` | 能讀取所在資料夾的人：全域 `file:read`，或資料夾授權 `viewer` 以上（§11） | 讀；改名、刪除看 `capabilities` |

`pending` 不出現在列表、不發推播；別人查詢一律 `404 FILE_NOT_FOUND`。看不到所在資料夾的 `ready` 檔案同樣回 `404`。

其他模組要引用檔案（例：角色頭像、關卡素材）時 **存 `files.id` 外鍵**，需要網址時注入 `FileService`。

### 4.2 資料夾：`file_folders`

檔案管理器的分類。資料夾只是分類：與物件儲存的 key 無關，移動、改名都不必搬物件。

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | uuid | |
| `name` | text | 規則同檔名（不可含 `/`、`\`、控制字元，≤ 255），另外不可是 `.`、`..` |
| `parent_id` | uuid（FK → 自己，`ON DELETE RESTRICT`） | 上層；null 是根目錄 |
| `inherit_grants` | boolean | false = 中斷繼承（私人資料夾，rbac/07 §3.3） |
| `kind` | `file_folder_kind` | `normal` / `shared` / `privateRoot` / `personal`：系統資料夾（rbac/07 §12） |
| `owner_id` | uuid（FK → users） | `personal` 的擁有者；其他為 null |
| `deletion_id` | uuid | 一次刪除操作的識別（同 `files.deletion_id`）；索引 `file_folders_deletion_id_idx`（只涵蓋已刪除的列，`0013`） |
| `created_*` / `updated_*` / `deleted_at` | | 慣例欄位；刪除是軟刪除（移到回收桶） |

約束與索引（都只涵蓋 `deleted_at IS NULL`）：

- `file_folders_parent_name_key`：同一層不可同名、**不分大小寫**——`(coalesce(parent_id, 全零 uuid), lower(name))` 的唯一索引；
  根目錄的 `parent_id` 是 null，不代入常數的話 null 彼此不相等，根目錄就能同名
- `file_folders_not_own_parent`：`parent_id <> id`
- `file_folders_parent_idx`：列出某一層的子資料夾、遞迴 CTE

規則（`FileFolderService`）：

| 規則 | 做法 |
| --- | --- |
| 不可移到自己或自己的子孫底下 | 交易內以遞迴 CTE 取目的地往上的鏈（`findAncestorIds`），鏈上出現任何一個要移動的資料夾 → `422 FILE_FOLDER_CYCLE` |
| 結構的寫入不互相穿插 | 建立、改名、移動、刪除在交易開頭取 `pg_advisory_xact_lock(hashtext('file_folders_tree'))`：兩個人同時把 A 移進 B、把 B 移進 A，各自檢查時都看不到循環，排隊之後第二個就看得到。資料夾的寫入不頻繁，整棵樹共用一把鎖就夠了 |
| 同名 | 預檢查回 `409 FILE_FOLDER_NAME_CONFLICT`；競態下撞到唯一索引也轉成同一個錯誤。一起移進同一個目的地的資料夾彼此同名也算 |
| 深度上限 32 層（`MAX_FOLDER_DEPTH`） | 建立、上傳資料夾時檢查；移動時以「目的地的深度 ＋ 被移動子樹的高度」（遞迴 CTE，`findMaxSubtreeHeight`）檢查。超過回 `400 VALIDATION_FAILED`（`details.field = 'depth'`） |
| 刪除是遞迴的 | 取出所有子孫（遞迴 CTE），同一個交易內軟刪除這些資料夾與其中的檔案（含上傳中的），全部帶同一個 `deletion_id` 與刪除時間；物件儲存的內容保留到回收桶的永久刪除（`trash.purge`，[`13-trash.md`](./13-trash.md) §7.3），還原資料夾時整批回來（§7.1） |
| 上傳到資料夾 | 登記上傳（`POST /files` 帶 `folderId`）時，資料夾存在的檢查與 INSERT 在同一個排隊的交易內：不會把檔案放進剛被遞迴刪除的資料夾 |

**上傳資料夾**（`POST /file-folders/paths`）：前端把整個資料夾的相對路徑送上來（`[["素材"], ["素材","ui"], …]`，從 `parentId` 起算），
後端一層一層處理——每層一次查出既有的子資料夾、一次建立缺少的——同名（不分大小寫）的資料夾直接沿用，回傳每條路徑最後一層的 id。
所以重傳同一個資料夾是合併而不是失敗；深度 32 也只有幾十個查詢。一次最多 1000 條路徑（`MAX_FOLDER_PATHS`），前端超過就分批送。

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
- presigned PUT 無法限制大小，所以大小在 `complete` 時比對；不符就刪掉物件，單次 PUT 可用同一個網址（未過期時）重傳
  （分塊上傳的 uploadId 在組合後就失效了，只能放棄、重新登記）。
- 並行的兩個 `complete`：`UPDATE … WHERE status='pending'` 只有一個成功，另一個 `409 FILE_ALREADY_UPLOADED`。
- `complete` 的重送與中斷：分塊上傳的 `CompleteMultipartUpload` 回「塊不對」（含 `NoSuchUpload`）時先 HeadObject，
  物件已在而且大小相符（並行的另一個 `complete` 先組好、或上次組好之後在 `markReady` 前中斷）就照常完成。
  前端的 `uploadFile()` 在 `complete` 失敗（回應遺失、逾時）時先 `GET /files/:id`，已經 `ready` 就當作成功，不放棄上傳。

前端不自己編排這些步驟，呼叫 `apps/backstage/src/apis/file/upload-file/` 的 `uploadFile()`：

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
- **何時產生**：`complete` 的交易之後排入 `FileImageService.schedule()`（同一個 api 執行個體同時最多 2 張，
  同一個檔案不重複排入），**不等它完成**。完成後 `variant_status = 'ready'` 並推播，前端重抓就拿到網址
  （剛上傳的圖片與 `create` 合併成一次推播，§7）。
  在那之前 `thumbnailUrl` 是瀏覽器縮圖（有的話），LightBox 用原圖。
- **失敗**：解碼失敗（損毀、超過 128 MiB 或 1 億像素）→ `failed`，不再重試，前端退回瀏覽器縮圖或類型圖示；
  儲存服務暫時不可用 → 維持 `pending`，由維護排程（§9）在 5 分鐘後重新排入。執行個體在產生途中重啟同理。
- **補產生**：`variant_status = 'pending'` 的圖片由維護排程逐批補產生。
- **影像處理在 api 內**（`core/image` 的 `ImageProcessor`，實作是 sharp）：sharp 是預編譯的原生套件，
  平台二進位檔隨 `@img/sharp-*` 安裝（macOS、Linux glibc / musl 都有），不需要編譯環境。取捨見 [ADR-0014](../../adr/0014-server-image-variants.md)。
- **記憶體**（與服務 WebSocket 的是同一個程序）：
  - 原圖串流先寫到暫存檔（`os.tmpdir()`，超過 128 MiB 就中斷），libvips 再從檔案逐列解碼（`sequentialRead`），不整份讀成 Buffer；
    用完 `DecodedImage.dispose()` 刪掉暫存檔；
  - 全螢幕預覽與圖示預覽 **依序** render，尖峰只有一份解碼緩衝；
  - libvips 每張圖最多 2 條執行緒、操作快取 16 MB（`sharp.concurrency` / `sharp.cache`）；
  - 還是在同一個程序：移到獨立 worker 容器要等背景工作能分開部署（見 [`10-jobs.md`](./10-jobs.md) §5），目前以上面的限制壓住尖峰。

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

`format=auto` 協商出來的格式還沒轉出時，請求 **不等** 轉檔（AVIF 大圖要好幾秒）：先轉址到主格式（`original` 則原封不動），
轉址只快取 30 秒，轉檔在背景做，之後再來就拿到新格式。原圖是瀏覽器顯示不了的格式（TIFF）時沒有東西可以退回，照舊等轉完。
明確指定的格式（`jpeg` / `webp` / `avif` / `png`）一律等轉完。

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
| DELETE | `/files/:id` | `file:delete` | `204`；移到回收桶 |
| POST | `/files/:id/restore` | `file:delete` | `200 StoredFile`；還原（[`13-trash.md`](./13-trash.md) §7.2） |
| POST | `/files/move` | `file:update` | `200 MoveFileItemsResult`：`{ movedFiles, movedFolders }`（`{ fileIds, folderIds, targetFolderId }`，§4.2） |
| GET | `/file-folders` | `file:read` | `FileFolderList`：全部資料夾的扁平清單（`{ id, name, parentId, createdAt, updatedAt }`），前端自行組成樹 |
| POST | `/file-folders` | `file:create` | `201 FileFolder`（`{ name, parentId }`） |
| POST | `/file-folders/paths` | `file:create` | `200 FileFolderPaths`：上傳資料夾時確保各路徑存在（§4.2） |
| PATCH | `/file-folders/:id` | `file:update` | `200 FileFolder`（`{ name }`） |
| DELETE | `/file-folders/:id` | `file:delete` | `204`；遞迴刪除子資料夾與其中的檔案（移到回收桶） |
| POST | `/file-folders/:id/restore` | `file:delete` | `200 RestoredFileFolder`：還原同一次刪除的子資料夾與檔案（[`13-trash.md`](./13-trash.md) §7.1） |

`GET /files` 的 query：`offset` / `limit`、`keyword`（檔名部分比對）、`contentType`（`image/png` 或 `image/*`）、
`category`（`image` / `video` / `audio` / `text` / `document` / `archive` / `other`，對照表在 `file.constants.ts` 的
`FILE_CATEGORY_RULES`；`other` 是不屬於其他任何一類）、`uploaderId`、`sort`（`createdAt` / `name` / `size`，預設 `-createdAt`）、
`cursor`（§6.1）、`folderId`（只列這個資料夾「直接」包含的檔案；`root` 是根目錄，不帶則不分資料夾）。

`POST /files` 另外可帶 `folderId`（null 或不帶是根目錄；不存在或看不到回 `404 FILE_FOLDER_NOT_FOUND`）。

各端點的權限宣告是閘門 `file:access` 或對應的全域 `file:*`；資料夾範圍的判斷與能力旗標見 §11。
`POST /files/move` 的資料夾不存在回 `FILE_FOLDER_NOT_FOUND`；檔案已刪除、還在上傳中、或本來就在目的地的略過（不讓整批失敗），
回應的數量只算實際移動的。

`StoredFile`（OpenAPI 名稱；避開瀏覽器內建的 `File`。列表的 `FileListPage` 同理避開 `FileList`）：

```jsonc
{
  "id": "uuid",
  "name": "角色 立繪.png",
  "contentType": "image/png",
  "size": 12345,
  "status": "ready",
  "folderId": null,                                                    // 所在的資料夾；null 是根目錄
  "url": "https://…/storage/b2b-system/files/<id>?X-Amz-…",          // inline：直接顯示（白名單以外的型別也是 attachment，§7.2）
  "downloadUrl": "https://…/storage/b2b-system/files/<id>?X-Amz-…",  // attachment：以 name 下載
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
  "capabilities": { "canUpdate": true, "canDelete": false },          // 操作者對這個檔案的能力（§11）
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
- 帶游標時只依 `sort` 的第一個條件（＋ id）排序、忽略 `offset`；`pagination.total` 為 `null`——每捲一頁都重算 `count(*)` 太貴，
  篩選後的總數只在第一頁（不帶游標）回傳，前端也只讀第一頁的 total。
- 以 (排序欄位, id) 為鍵的索引（§4）讓每一頁都是索引範圍掃描，捲到第 100 頁也不會變慢（offset 要先掃過前面所有列）。

### 6.2 改名的樂觀鎖

`PATCH /files/:id` 帶 `version`（畫面上看到的版本）時，比對與寫入在同一個 `UPDATE … WHERE version = $v`：

| 情況 | 結果 |
| --- | --- |
| 版本相符 | 改名、`version + 1`，回新的 `StoredFile` |
| 讀到之前就不同（別人已改過） | `409 FILE_VERSION_CONFLICT`（`details.current`） |
| 讀到之後、寫入之前被搶先 | UPDATE 沒命中 → 同一個交易內重讀：還在 → `409 FILE_VERSION_CONFLICT`（`details.current` 是重讀到的版本）；已刪除 → `404 FILE_NOT_FOUND` |
| 不帶 `version` | 後寫者勝（腳本、批次）；下一次部署改必填（[ADR-0025](../../adr/0025-entity-revisions.md) D4 的 R1b） |

通用的樂觀鎖慣例（其他實體同一個形狀）見 [`03-api-conventions.md`](./03-api-conventions.md) §11。

錯誤碼：

| 碼 | 狀態 | 時機 |
| --- | --- | --- |
| `FILE_NOT_FOUND` | 404 | 不存在、已刪除、別人的 `pending`、對 `pending` 改名／刪除 |
| `FILE_TOO_LARGE` | 413 | 登記的大小超過租戶的上限 `file.uploadMaxSize`（`details.maxSize`） |
| `FILE_ALREADY_UPLOADED` | 409 | 對 `ready` 再 `complete` 或放棄；並行完成的較晚者 |
| `FILE_UPLOAD_INCOMPLETE` | 409 | `complete` 時物件儲存裡還沒有內容、分塊不對；前端直傳被拒時也用它 |
| `FILE_SIZE_MISMATCH` | 422 | 實際大小與登記不符（`details.expected` / `details.actual`） |
| `FILE_UPLOAD_PART_INVALID` | 422 | 對單次 PUT 的上傳要分塊網址、塊號超出 `partCount`、分塊上傳 `complete` 沒帶 `parts` |
| `FILE_VERSION_CONFLICT` | 409 | 改名時版本不符（§6.2） |
| `FILE_IMAGE_URL_INVALID` | 403 | 影像 API 的網址簽章不符、版本不符或已過期（§5.4） |
| `FILE_STORAGE_UNAVAILABLE` | 503 | 物件儲存連不上或回非預期錯誤 |
| `FILE_FOLDER_NOT_FOUND` | 404 | 資料夾不存在或已刪除（上傳、建立、改名、移動的目的地或來源） |
| `FILE_FOLDER_NAME_CONFLICT` | 409 | 同一層已有同名（不分大小寫）的資料夾 |
| `FILE_FOLDER_CYCLE` | 422 | 把資料夾移到自己或自己的子孫底下（`details.folderIds`） |
| `FILE_FOLDER_SYSTEM_PROTECTED` | 403 | 改名、移動、刪除系統資料夾（共用、私人、個人資料夾，rbac/07 §12） |
| `AUTHZ_FORBIDDEN` | 403 | 看得到但沒有該動作的資料夾授權（`details: { action, resourceType, resourceId }`，§11）；遞迴刪除時子樹有別人的東西（`details.reason = 'not-owner'`）或有權限不足的私人資料夾（`details.reason = 'protected-subfolder'`） |
| `AUTHZ_ESCALATION` | 403 | 授予超過自己在該資料夾能力的等級（`details.missing`） |
| `FILE_GRANT_SUBJECT_NOT_FOUND` | 404 | 授權對象（角色／使用者）不存在或已刪除 |
| `FILE_ACCESS_ALREADY_GRANTED` | 409 | 申請的等級已經有了（§11、rbac/07 §6.5） |
| `FILE_ACCESS_REQUEST_NOT_FOUND` | 404 | 存取申請不存在、不是這個資料夾的、或已審核 |
| `FILE_GRANT_NOT_FOUND` | 404 | 要移除的直接授權不存在（繼承來的要到來源資料夾移除） |
| `FILE_NOT_DELETED`／`FILE_FOLDER_NOT_DELETED` | 409 | 還原一個沒有被刪除的檔案／資料夾（[`13-trash.md`](./13-trash.md) §7） |
| `FILE_RESTORE_CONFLICT` | 409 | 還原檔案時所在的資料夾已刪除（`reason: 'parentDeleted'`）或原檔已不在（`'objectMissing'`） |
| `FILE_FOLDER_RESTORE_CONFLICT` | 409 | 還原資料夾時上層已刪除（`reason: 'parentDeleted'`）；同名沿用 `FILE_FOLDER_NAME_CONFLICT`（`details.conflictingId`） |

---

## 7. 刪除、稽核、推播

- 刪除＝移到回收桶（[`13-trash.md`](./13-trash.md) §7）：交易內軟刪除（帶新的 `deletion_id`）＋ 稽核 `file.delete`。
  **R4a（這一版）仍在交易後立刻刪物件**（原檔、瀏覽器縮圖、`variants/<id>/` 底下的所有變體與轉出的格式；`FileObjectsService.deleteAll`），
  所以個別刪除的檔案還原會得到 `objectMissing`；R4b 起物件保留到 `trash.purge` 永久刪除之後（ADR-0025 的 R4 兩次部署，13-trash §7.5）。
  物件一律在交易 **之後** 刪：交易 rollback 時紀錄還在，內容也要在。刪除失敗只記 warn，不讓使用者的刪除失敗。
- 還原：`POST /files/:id/restore`、`POST /file-folders/:id/restore`（13-trash §7.1、§7.2）；稽核 `file.restore`、`fileFolder.restore`，推播以 `create` 宣告。
- 變體產生途中檔案被刪除：`markVariantsReady` 的 `WHERE deleted_at IS NULL` 不命中，剛寫入的變體立即刪除。
- 稽核：`file.upload`（完成時，不是登記時）、`file.update`（只記有變的欄位）、`file.delete`；`resourceType = 'file'`。
  資料夾：`fileFolder.create`（上傳資料夾時每個新建的資料夾一筆）、`fileFolder.update`、`fileFolder.delete`（`before` 記下遞迴刪除的資料夾數與檔案數）、
  `file.move`（一次移動一筆，`resourceId` 是目的地，`changes.after` 列出移動的檔案與資料夾）；`resourceType = 'fileFolder'`。
- 推播：`ChangeSource.FILE`，受眾 `file:read` 與 `file:access`（[`08-realtime.md`](./08-realtime.md) §6.1）；前端 `Resource.FILE`
  失效 `FILE_LIST_QUERY_KEY`、`FILE_INFINITE_LIST_QUERY_KEY` / `FILE_DETAIL_QUERY_KEY`。
  - 每筆帶 `refs.fileFolder` = 所在的資料夾（根目錄是 `root`，`fileChange()`）：前端只重抓 **正在看那個資料夾** 與不分資料夾的列表，
    開著其他資料夾的人不動。
  - 圖片的 `create` 交給變體產生（`FileImageService.schedule(id, { announce })`）：變體在 3 秒內處理完（不論成敗）就只推一次 `create`；
    超過才先推 `create`，變體好了再推 `update`。一般情況下「上傳完成」與「變體好了」只推一次。
  資料夾：`ChangeSource.FILE_FOLDER`（受眾相同）。遞迴刪除與批次移動無法逐筆列出受影響的檔案，
  另推一筆 `file` 的 `delete` / `update`、`id = '*'`：前端退回以前綴失效所有檔案的詳情。

### 7.1 下載網址的快取

presigned URL 帶簽章時間，每次查詢都重簽就會得到不同的網址——列表每次重抓，瀏覽器都當成新圖片重新下載。
所以 `presignDownload` 把簽章時間 **取整到 `FILE_URL_TTL / 2` 的倍數**（`stableSigningDate`）：

- 同一個時間窗內對同一個物件簽出一模一樣的網址，`<img>` 與 HTTP 快取直接命中；
- 回應帶 `Cache-Control: private, max-age=<TTL/2>, immutable`（`response-cache-control`）：物件以 id 為 key、從不覆寫；
- 代價：網址的剩餘效期介於 `TTL / 2` 與 `TTL` 之間。`urlExpiresAt` 反映真正的失效時間，前端在失效前 60 秒重抓列表。

### 7.2 下載網址的型別政策（使用者上傳的內容與 backstage 同源）

`/storage` 與 backstage 在同一個租戶網域（§3）：上傳的 HTML、SVG、JS 若 inline 提供，直接開啟就能在租戶網域上執行腳本，
帶著 refresh cookie 呼叫 `/api/auth/refresh`。所以 `contentType` 雖然可以是任何 MIME（檔案管理器要能存任何檔案），
**提供** 時一律依型別決定（`downloadPolicyOf`，`file.constants.ts`）：

| 型別 | `url` | `downloadUrl` | 回應的 `Content-Type` |
| --- | --- | --- | --- |
| `image/png`、`jpeg`、`gif`、`webp`、`avif`、`bmp`、`text/plain`、`audio/*`、`video/*` | inline | attachment | 原型別 |
| `image/svg+xml` | attachment | attachment | 原型別（`<img>` 才畫得出來；直接開啟是下載） |
| 其他（含 `text/html`、`application/javascript`、`application/pdf`） | attachment | attachment | `application/octet-stream`（`response-content-type` 覆寫） |

- PDF 不 inline：下方的 `sandbox` CSP 會擋掉瀏覽器的 PDF 檢視器，乾脆下載。
- 文字預覽以 `fetch(url)` 讀內容，不受 `Content-Disposition` 與型別影響。
- 物件儲存的回應另外帶 `X-Content-Type-Options: nosniff` 與
  `Content-Security-Policy: default-src 'none'; …; sandbox; frame-ancestors 'none'`：apps/file-storage 自己送，
  `deploy/nginx.conf` 的 `/storage/` 也統一加（換成 S3／MinIO 時那是唯一的防線）。`sandbox` 讓被直接開啟的文件落在不透明的 origin，
  即使型別被繞過，腳本也碰不到 cookie 與 API；圖片、影音在 `<img>`／`<video>` 裡不受影響。影像 API 的 302 也帶 `nosniff`。
- 長期：物件儲存放到獨立、不帶 cookie 的網域，就不必依賴型別政策。

---

## 8. 環境變數

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `FILE_STORAGE_ENDPOINT` | `http://127.0.0.1:9000/storage` | api 連線用 |
| `FILE_STORAGE_PUBLIC_ENDPOINT` | `{tenantOrigin}/storage` | 瀏覽器看到的位址；presigned URL 以它簽章。`{tenantOrigin}` 換成目前租戶的 origin |
| `FILE_STORAGE_REGION` | `us-east-1` | |
| `FILE_STORAGE_ACCESS_KEY_ID` / `FILE_STORAGE_SECRET_ACCESS_KEY` | 必填 | 與 apps/file-storage 共用同名變數 |
| `FILE_UPLOAD_MAX_SIZE` | `104857600`（100 MiB） | 單一檔案上限的 **部署上限**；每個租戶的生效值是系統設定 `file.uploadMaxSize`（預設等於這個值，只能調小；[`12-settings.md`](./12-settings.md) §2）。分塊大小依這個上限計算 |
| `FILE_URL_TTL` | `900` | presigned 上傳／下載網址與影像網址的有效秒數（60–3600）；下載網址在 `TTL / 2` 的時間窗內不變（§7.1）。網址發出後收不回來，這也是撤銷授權的延遲上限，所以最多 1 小時 |
| `FILE_MULTIPART_THRESHOLD` | `16777216`（16 MiB） | 超過這個大小改用分塊上傳（§5.2） |
| `FILE_MULTIPART_PART_SIZE` | `8388608`（8 MiB） | 每塊大小（5 MiB–5 GiB）；檔案上限 / 10000 更大時自動放大 |
| `FILE_PENDING_TTL` | `86400` | 登記後超過這個秒數仍未完成的上傳視為放棄（§9）；大檔會邊傳邊要新的分塊網址，所以遠長於 `FILE_URL_TTL` |
| `FILE_MAINTENANCE_CRON` | `0 * * * *` | 維護排程（背景工作 `file.maintenance`，UTC）；空字串停用。同時段只跑一個，多個 api 執行個體也不重複（[`10-jobs.md`](./10-jobs.md)） |
| `FILE_MAINTENANCE_DRY_RUN` | `false` | `true`：只偵測並記錄殘留，不刪除任何東西 |
| `API_PUBLIC_BASE_URL` | `/api` | 瀏覽器看到的 api 位址；影像 API 的網址以它開頭（§5.4） |

---

## 9. 維護排程：上傳失敗的殘留

前端失敗或取消時會呼叫 `DELETE /files/:id/upload`（§5.3），但有些情況沒機會呼叫、或清理本身失敗，殘留不會自己消失。
`FileMaintenanceService` 依 `FILE_MAINTENANCE_CRON` 由背景工作 `file.maintenance` 執行（[`10-jobs.md`](./10-jobs.md)），
偵測並清除；每一輪的報告存成工作的結果，在背景工作頁看得到：

| # | 殘留 | 來源 | 偵測 | 處理 |
| --- | --- | --- | --- | --- |
| 1 | 逾時的 `pending` 紀錄 | 分頁當掉、網路中斷，沒呼叫放棄上傳 | `status='pending' AND created_at < now - FILE_PENDING_TTL`（依 id 分頁） | 軟刪除紀錄（`WHERE status='pending'` 決勝，並行完成的不刪）→ AbortMultipartUpload、刪原檔與縮圖 |
| 2 | 沒有紀錄的分塊上傳 | `CreateMultipartUpload` 成功而 INSERT 失敗；放棄時 abort 失敗 | `ListMultipartUploads(files/)` 中 uploadId 不屬於任何未刪除紀錄 | AbortMultipartUpload |
| 3 | 孤兒物件 | 放棄上傳、永久刪除之後的物件刪除失敗；紀錄已不存在 | `ListObjectsV2` 列出 `files/`、`thumbnails/`、`variants/`，由 key 取出 id，查不到 **任何** 紀錄（含已軟刪除的） | 刪除 |
| 4 | 卡住的影像變體 | 產生途中重啟、儲存服務暫時不可用；migration 補產生 | `variant_status='pending' AND uploaded_at < now - 5 分鐘` | 重新排入（§5.4） |

- **已刪除紀錄的物件不是孤兒**（R4a 起，[ADR-0025](../../adr/0025-entity-revisions.md) D11）：紀錄還在回收桶裡，保留期限內可以還原；
  物件由 `trash.purge` 在永久刪除之後刪（[`13-trash.md`](./13-trash.md) §7.3）。R4a 之前這一類是「查不到 **未刪除** 紀錄」，遞迴刪除資料夾的物件靠它清除。
- **不誤判**：2、3 只看建立早於 `now - FILE_PENDING_TTL` 的東西——剛登記、INSERT 還沒提交的上傳不會被當成孤兒；
  不是這個模組產生的 key（前綴不對、id 不是 uuid）一律不碰。
- **偵測**：每一輪回傳 `FileMaintenanceReport`（四類各偵測到幾筆、處理失敗幾筆），有發現時記 info log；
  `FILE_MAINTENANCE_DRY_RUN=true` 時 **只偵測、不處理**，可以先觀察再開啟。
- **冪等**：刪除不存在的東西視為成功、軟刪除以條件 UPDATE 決勝；工作中途中斷、被收回重試時重做也不會出錯。
  佇列同時段只放一筆（`exclusive`），上一輪沒結束時下一輪不會開始。處理失敗的項目下一輪會再偵測到；
  整輪失敗（例：資料庫斷線）才由佇列重試。
- **步驟互不依賴**：某一步整個失敗（例：換成不支援 `ListMultipartUploads` 的儲存服務）只記一筆 failure 並記 warn，其他步驟照常執行。
- **成本**：3 每一輪列出受管理前綴下的所有物件（每頁 1000 個、每 500 個查一次資料庫）；物件數量大到列表變慢時，
  改成把排程間隔拉長，或把 worker 拆到另一個容器（[`10-jobs.md`](./10-jobs.md) §5）。
- 為什麼是 api 內的工作而不是 `db:archive-audit-logs` 那樣的腳本：清理需要 `ObjectStorage` 與補產生變體的 `ImageProcessor`，
  腳本只能 import 不依賴 DI 的純函式（[`../../conventions/07-layer-dependencies.md`](../../conventions/07-layer-dependencies.md) §3.2）。

---

## 10. 測試

| 檔案 | 內容 |
| --- | --- |
| `src/modules/file/__tests__/file.service.spec.ts` | 業務規則：每個 `AppException` 分支、可見性、交易後才刪物件；分塊上傳、放棄上傳、縮圖、樂觀鎖、游標 |
| `src/modules/file/__tests__/file-folder.service.spec.ts` | 資料夾規則（以記憶體裡的樹模擬 repository）：同名（不分大小寫、只限同一層）、循環、目的地同名、遞迴刪除、上傳資料夾的沿用與深度上限 |
| `src/modules/file/__tests__/file.authz.spec.ts` | 關係模型：繼承、取最高、中斷繼承、everyone、規則 A、依賴樹閉包、等級蘊含的動作 |
| `src/modules/file/__tests__/file-grant.levels.spec.ts` | 等級規則（`file-grant.levels.ts`）：反提權比對（`missingActions`、`assignableLevels`）、繼承鏈（含壞資料的循環）、`maxLevel` |
| `src/modules/file/__tests__/file-folder-tree.spec.ts` | 資料夾結構的快取：共用、交易內直接查、寫入提交後失效（含 rollback 與進行中的讀取）、失敗不快取、依租戶區分 |
| `src/modules/file/__tests__/file-access.service.spec.ts` | 能力規則：全域 × 等級 × 擁有者的組合、根目錄、鎖住的資料夾、反提權 |
| `src/modules/file/__tests__/file-folder-access.approval.spec.ts` | 申請存取的審批 handler：已有權限不能申請、核准者要能 share 且授予得起、套用寫入授權與稽核 |
| `src/modules/file/__tests__/file-folder.service.spec.ts`（授權段落） | 鎖住的資料夾（canRead=false）、根目錄不能建立、鎖住的回 403、擁有者改名、遞迴刪除的 not-owner 與 protected-subfolder、移動的目的地 |
| `test/file-access.spec.ts` | 真 Postgres：只有 `file:access` 的成員經角色／個人授權看到的資料夾與檔案、擁有者規則、中斷繼承與複製、授權過期、遞迴刪除的附加條件、同一對象只有一個等級（再次授予是覆寫）；存取申請；系統資料夾（啟動時建立、別人的個人資料夾鎖住、不能改名刪除移動、指派角色後自動建立、刪除使用者時空的個人資料夾跟著刪除） |
| `test/file-trash.spec.ts` | 真 Postgres ＋ 記憶體版 `ObjectStorage`：刪除的 `deletion_id`、檔案與資料夾的還原與衝突、回收桶列表、維護排程不刪已刪除紀錄的物件、`trash.purge`（[`13-trash.md`](./13-trash.md) §9） |
| `test/file-lifecycle.spec.ts` | 真 Postgres ＋ 記憶體版 `ObjectStorage`：完整流程（單次與分塊）、放棄上傳、縮圖、影像變體與影像 API（不帶 token、302、轉出 WebP、簽章綁定版本、刪除時清變體）、維護排程（dry run 與清除）、樂觀鎖、keyset 游標在插入後不重複、分類篩選、權限（admin / auditor / member）、四個資料表約束；資料夾：上傳到資料夾與依 `folderId` 列出、移動、循環與同名（真的唯一索引）、上傳資料夾重送得到同樣的 id、遞迴刪除後可再建同名、`file_folders_not_own_parent` |
| `src/core/storage/__tests__/content-disposition.spec.ts` | 中文檔名的 `Content-Disposition` |
| `src/core/storage/__tests__/stable-signing-date.spec.ts` | 下載網址在時間窗內不變、剩餘效期範圍 |
| `src/core/image/__tests__/sharp-image-processor.spec.ts` | progressive JPEG、等比縮放不放大、透明圖鋪白底、EXIF 轉正、串流讀入（經暫存檔、dispose 後刪除）、位元組上限、libvips 資源上限 |
| `src/modules/file/__tests__/file-image.service.spec.ts` | 真的 sharp ＋ 記憶體儲存：實體化兩個變體、WebP 主格式、失敗與重試的分界、途中刪除、影像 API 的簽章／格式協商／依請求轉出並快取、`auto` 背景轉出前先回主格式 |
| `src/modules/file/__tests__/file-maintenance.service.spec.ts` | 四類殘留的偵測與清除、dry run、與 complete 並行、失敗不中斷、不重疊執行 |
| `apps/backstage/src/apis/file/upload-file/__tests__/uploadFile.test.ts` | 編排、進度、直傳失敗、取消與放棄上傳、縮圖、`complete` 回應遺失時查狀態；分塊：並行、ETag 排序、單塊重試、4xx 不重試 |

與真實 S3 協定的相容性由 apps/file-storage 的測試（官方 SDK）負責；api 端的 `S3ObjectStorage` 另以 Docker 整套
（`docker-compose.prod.yml`）手動驗證過 presigned 直傳、Content-Type 綁定、中文檔名下載與刪除。

---

## 11. 存取控制（資料夾層級授權）

規格：[`../../rbac/07-resource-grants.md`](../../rbac/07-resource-grants.md)；決策：[ADR-0015](../../adr/0015-file-folder-access.md)。
這一節只講實作落點。

```
controller   @RequireAnyPermission('file:access', 'file:<動作>')    ← 閘門
    │
service      FileService / FileFolderService / FileFolderGrantService
    │  ctx = await access.contextFor(actor)                       ← 每個請求一次
    │  access.assertCan(ctx, action, location, resource?)          ← 不能就 404 / 403 ＋ authz.denied
    ▼
FileAccessService（modules/file）
    ├─ PermissionService.getPermissionSet(actor)                   全域 file:*（含依賴樹閉包）＋ 主體閉包（有快取）
    ├─ FileFolderTree.nodes()                                     整棵樹：id / parent_id / inherit_grants / created_by（程序內快取）
    └─ AuthzService.checkerFor(subjects, ['fileFolder'], [folderEdgeProvider])
            │                                                    主體在 tenant 與資料夾上的未過期邊（relation_tuples）
            └─ FileAccessContext：以 file.authz.ts 的模型判斷 can_* ／ can_rename ／ can_remove（core/authz 的判斷器）
```

模型與規則見 [`../../rbac/07-resource-grants.md`](../../rbac/07-resource-grants.md) §2.1。結構邊（上層、繼承、建立者）由
`folderEdgeProvider` 從同一份 `FileFolderTree` 節點供應，不存進 `relation_tuples`；檔案項目本身的邊以 `withEdges` 臨時補上。

| 檔案（`modules/file/`） | 內容 |
| --- | --- |
| `file-folder-grant.repository.ts` | 資料夾授權的讀寫：`fileFolder:<id>#<level>@(role:<r>#holder \| user:<u> \| user:*)`（原 `modules/resource-grant`，G3a 刪除） |
| `file-grant.levels.ts` | 等級規則：`levelRank`、`maxLevel`、`missingActions`、`assignableLevels`、`inheritanceChain`、`HierarchyNode`、`LevelActions` |
| `file-folder-grant.service.ts` | 授權 API 的業務規則、反提權、稽核 |

| 項目 | 做法 |
| --- | --- |
| 解析範圍 | 每個請求取一次整棵資料夾結構（四個欄位）與操作者的邊，在記憶體判斷（記憶化，同一個 `物件#關係` 只算一次）。結構以租戶為 key 快取在程序內（§11.1），邊每次查（只有操作者主體閉包裡的主體） |
| 列表過濾 | `GET /files` 不帶 `folderId` 且沒有全域 `file:read`：以看得到的資料夾 id 限制 `folder_id = ANY(…)`，根目錄的檔案不列 |
| 能力旗標 | `toDto` 時由 context 算出 `capabilities`；列表一次算完，不逐筆查詢 |
| 移動、遞迴刪除 | 在 `writeTree` 的交易（取得樹鎖）**之內** 建立 context：檢查與寫入之間結構不會變 |
| 授權寫入 | `relation_tuples` 的寫入與稽核在同一個交易，經 `FileFolderTree.write` 序列化；「一個對象在一個資料夾只有一個等級」由 `FileFolderGrantRepository.set` 先刪後插維持（不是 DB 唯一索引）。交易後推 `fileFolder update`；不呼叫 `permissionsChanged`（資料夾授權不在權限快取裡），`authz_revision` 仍 +1 |
| 中斷繼承 | `file_folders.inherit_grants`；設成 `false` 時在同一個交易內把目前繼承到的授權複製成直接授權 |
| 授權對象 | 解析與清單都 join 未刪除的 `roles` / `users`：刪除角色或使用者不必清授權列 |

### 11.1 資料夾結構的快取（`FileFolderTree`）

每位使用者一個個人資料夾，1000 人的租戶至少有上千個節點；每個檔案請求都讀一次整棵樹太貴，而結構只在建立、移動、刪除、
中斷繼承時改變，所以以 **租戶** 為 key 快取在程序內：

| 規則 | 理由 |
| --- | --- |
| 結構的寫入一律經過 `FileFolderTree.write()`：交易內先取樹鎖（§4.2），**提交後** 才失效（rollback 也失效） | 失效早於提交的話，並行的讀取會把舊結構重新放回快取；三個寫入者（資料夾、授權、系統資料夾）都走同一個入口 |
| 失效時連同進行中的讀取一起丟掉 | 它可能讀到提交前的結構 |
| 交易內（`contextFor(actor, tx)`）一律直接查資料庫 | 移動、遞迴刪除的檢查與寫入之間結構不能變 |
| 60 秒存活時間 | 只是防漏網（例：直接改資料庫）；正常的寫入都會主動失效 |
| 單一執行個體的前提 | 失效只在本程序；api 目前固定單一執行個體（[`../01-system.md`](../01-system.md)），水平擴展時要改成跨程序的失效通知 |

資料表：`relation_tuples`（資料夾授權的邊）、`file_folders.inherit_grants`、
系統資料夾 `file_folders.kind` / `owner_id` 與授權對象 `everyone`（schema 在 `db/schema/`，migration 見 [`02-database.md`](./02-database.md) §5.2）。

系統資料夾由 `FileSystemFolderService` 維護：`onApplicationBootstrap` 確保共用／私人資料夾存在並補建個人資料夾；
訂閱 `permissions.changed`，為事件帶的 `userIds`（只在發起寫入的程序上有）中取得檔案管理器權限的人建立個人資料夾；訂閱 `resource.changed` 的 `user delete`，
擁有者被刪除時把空的個人資料夾軟刪除（rbac/07 §12）。

