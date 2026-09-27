# 後端 09 — 檔案（物件儲存 ＋ 轉介表）

`apps/api` 透過 **`@aws-sdk/client-s3`** 使用物件儲存。本機與自架部署連
[`apps/file-storage`](../03-file-storage.md)（S3 相容），正式環境可直接換成 S3 / MinIO / R2——**只改環境變數**。

設計目標是「前端用起來不原始」：前端只認識 **檔案 id** 與 **可以直接放進 `<img src>` 的網址**，
不知道 bucket、key、簽章，也不需要自己編排上傳步驟。

---

## 1. 三層

```
 features/*  ──uploadFile()──▶  apis/file/*                      前端：只有 StoredFile（id、name、url…）
                                    │ POST /files、PUT（直傳）、POST /files/:id/complete
 ───────────────────────────────────┼─────────────────────────────────────────────
 modules/file   FileService         │                            後端：業務規則、files 轉介表
                    │ 注入
 core/storage   ObjectStorage（抽象類別） ← S3ObjectStorage（@aws-sdk/client-s3）
                    │ S3 API
 apps/file-storage（或 S3 / MinIO / R2）
```

| 層 | 認識什麼 | 不認識什麼 |
| --- | --- | --- |
| 前端 `apis/file/` | 檔案 id、`url` / `downloadUrl`、`uploadFile()` | bucket、key、SigV4 |
| `modules/file` | `files` 資料表、`ObjectStorage` 介面 | `@aws-sdk/*` |
| `core/storage` | S3 協定、bucket、presign | `files` 資料表、權限、任何 module |

---

## 2. 抽象層：`core/storage`

```ts
export abstract class ObjectStorage {
  ensureBucket(): Promise<void>;            // 不存在就建立；記住結果，失敗後可重試
  ping(): Promise<boolean>;                 // /health/ready 用
  head(key): Promise<StoredObjectHead | undefined>;
  delete(key): Promise<void>;               // 不存在也算成功
  presignUpload(key, { contentType, expiresIn }): Promise<PresignedRequest>;
  presignDownload(key, { expiresIn, fileName, disposition }): Promise<PresignedRequest>;
}
```

- **abstract class 而不是 interface**：它同時是 Nest 的 DI token（`{ provide: ObjectStorage, useClass: S3ObjectStorage }`）。
  業務模組只 `constructor(private readonly storage: ObjectStorage)`，不 import SDK。
- 換後端：寫另一個實作、改 `StorageModule` 的 `useClass`。測試：`overrideProvider(ObjectStorage)` 換成記憶體版
  （`apps/api/test/file-lifecycle.spec.ts`）。
- SDK 錯誤在這一層轉成 `AppException('FILE_STORAGE_UNAVAILABLE')`（503）並記錄；「物件不存在」轉成 `undefined`，
  不當成錯誤。
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
| `created_*` / `updated_*` / `deleted_at` | | 慣例欄位；`updated_at` 由 trigger 維護；刪除是軟刪除 |

約束（migration `0006_files.sql`，整合測試證明擋得住）：

- `files_size_non_negative`：`size >= 0`
- `files_ready_confirmed`：`status = 'pending'` 或（`etag` 與 `uploaded_at` 都有值）——沒經過物件儲存確認的 `ready` 不可能存在
- `files_storage_key_key`：`storage_key` 唯一

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
  │ POST /files {name, contentType, size}
  │──────────────────────────────▶│ 檢查大小上限、ensureBucket
  │                               │ INSERT files (pending, storage_key=files/<id>)
  │ 201 {file, upload:{url, method:'PUT', headers, expiresAt}}
  │◀──────────────────────────────│
  │ PUT upload.url（帶 upload.headers）──────────────────────────────────▶│
  │◀─────────────────────────────────────────────────────────────── 200 ETag
  │ POST /files/:id/complete
  │──────────────────────────────▶│ HeadObject：不存在 → 409 FILE_UPLOAD_INCOMPLETE
  │                               │ 大小不符 → 刪物件、422 FILE_SIZE_MISMATCH
  │                               │ 交易：UPDATE … SET status='ready' WHERE status='pending' ＋ 稽核 file.upload
  │                               │ 交易後：推播 file create
  │ 200 StoredFile（ready，帶 url / downloadUrl）
  │◀──────────────────────────────│
```

- 檔案內容 **不經過 api**：大檔不佔 api 的頻寬與記憶體，也不受 api 的 body 上限限制。
- presigned PUT 無法限制大小，所以大小在 `complete` 時比對；不符就刪掉物件，使用者可用同一個網址（未過期時）重傳。
- 並行的兩個 `complete`：`UPDATE … WHERE status='pending'` 只有一個成功，另一個 `409 FILE_ALREADY_UPLOADED`。

前端不自己編排這三步，呼叫 `apps/web/src/apis/file/upload-file/` 的 `uploadFile()`：

```ts
const file = await uploadFile({ file: input.files[0], onProgress: ({ loaded, total }) => … }, signal);
// file.status === 'ready'；<img src={file.url}>
```

登記與完成兩個 fetcher 放在 `upload-file/steps.ts`，**不** 拆成獨立的 `apis/file/<operation>/`：單獨呼叫任一步都沒有意義。
直傳用 XHR（`putToStorage.ts`）而不是 fetch——fetch 拿不到上傳進度。

---

## 6. API

| Method | Path | 權限 | 回應 |
| --- | --- | --- | --- |
| GET | `/files` | `file:read` | `{ items: StoredFile[], pagination }` |
| POST | `/files` | `file:create` | `201 FileUpload`：`{ file: StoredFile, upload: FileUploadTarget }` |
| POST | `/files/:id/complete` | `file:create` | `200 StoredFile` |
| GET | `/files/:id` | `file:read` | `200 StoredFile` |
| PATCH | `/files/:id` | `file:update` | `200 StoredFile`（`{ name }`） |
| DELETE | `/files/:id` | `file:delete` | `204` |

`GET /files` 的 query：`offset` / `limit`、`keyword`（檔名部分比對）、`contentType`（`image/png` 或 `image/*`）、
`sort`（`createdAt` / `name` / `size`，預設 `-createdAt`）。

`StoredFile`（OpenAPI 名稱；避開瀏覽器內建的 `File`）：

```jsonc
{
  "id": "uuid",
  "name": "角色 立繪.png",
  "contentType": "image/png",
  "size": 12345,
  "status": "ready",
  "url": "https://…/storage/game-editor/files/<id>?X-Amz-…",          // inline：直接顯示
  "downloadUrl": "https://…/storage/game-editor/files/<id>?X-Amz-…",  // attachment：以 name 下載
  "urlExpiresAt": "2026-09-27T00:15:00.000Z",                          // FILE_URL_TTL 之後失效，重新查詢即可
  "uploader": { "id": "uuid", "displayName": "Alice" },
  "uploadedAt": "…", "createdAt": "…", "updatedAt": "…"
}
```

- 網址每次查詢時現簽（本地 HMAC，不打儲存服務），列表 200 筆也只是幾毫秒。
- `downloadUrl` 的 `Content-Disposition` 同時帶 ASCII 退路與 `filename*=UTF-8''…`，中文檔名下載不會亂碼。

錯誤碼：

| 碼 | 狀態 | 時機 |
| --- | --- | --- |
| `FILE_NOT_FOUND` | 404 | 不存在、已刪除、別人的 `pending`、對 `pending` 改名／刪除 |
| `FILE_TOO_LARGE` | 413 | 登記的大小超過 `FILE_UPLOAD_MAX_SIZE`（`details.maxSize`） |
| `FILE_ALREADY_UPLOADED` | 409 | 對 `ready` 再 `complete`；並行完成的較晚者 |
| `FILE_UPLOAD_INCOMPLETE` | 409 | `complete` 時物件儲存裡還沒有內容；前端直傳被拒時也用它 |
| `FILE_SIZE_MISMATCH` | 422 | 實際大小與登記不符（`details.expected` / `details.actual`） |
| `FILE_STORAGE_UNAVAILABLE` | 503 | 物件儲存連不上或回非預期錯誤 |

---

## 7. 刪除、稽核、推播

- 刪除：交易內軟刪除 ＋ 稽核 `file.delete`；**交易後** 才刪物件（交易 rollback 時紀錄還在，內容也要在）。
  物件刪除失敗只留下孤兒物件並記 warn，不讓使用者的刪除失敗。
- 稽核：`file.upload`（完成時，不是登記時）、`file.update`（只記有變的欄位）、`file.delete`；`resourceType = 'file'`。
- 推播：`ChangeSource.FILE`，受眾 `file:read`（[`08-realtime.md`](./08-realtime.md) §6.1）；前端 `Resource.FILE`
  失效 `FILE_LIST_QUERY_KEY` / `FILE_DETAIL_QUERY_KEY`。

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
| `FILE_URL_TTL` | `900` | presigned 上傳／下載網址的有效秒數（60–604800） |

---

## 9. 尚未處理

- **放棄的上傳**：登記後沒完成的 `pending` 紀錄與（可能已上傳的）物件不會自動清除。
  之後以排程腳本清理「建立超過 `FILE_URL_TTL` 仍是 `pending`」的紀錄與物件（同 `db:archive-audit-logs` 的模式）。
- **孤兒物件**：刪除時物件刪除失敗留下的內容，需要以 `files.storage_key` 對帳清除。
- 超過 5 GiB 的檔案需要 multipart upload；目前單次 PUT 的上限就是 `FILE_UPLOAD_MAX_SIZE`。

---

## 10. 測試

| 檔案 | 內容 |
| --- | --- |
| `src/modules/file/__tests__/file.service.spec.ts` | 業務規則：每個 `AppException` 分支、可見性、交易後才刪物件 |
| `test/file-lifecycle.spec.ts` | 真 Postgres ＋ 記憶體版 `ObjectStorage`：完整流程、權限（admin / auditor / member）、篩選、三個資料表約束 |
| `src/core/storage/__tests__/content-disposition.spec.ts` | 中文檔名的 `Content-Disposition` |
| `apps/web/src/apis/file/upload-file/__tests__/uploadFile.test.ts` | 三步編排、進度、直傳失敗、取消 |

與真實 S3 協定的相容性由 apps/file-storage 的測試（官方 SDK）負責；api 端的 `S3ObjectStorage` 另以 Docker 整套
（`docker-compose.prod.yml`）手動驗證過 presigned 直傳、Content-Type 綁定、中文檔名下載與刪除。
