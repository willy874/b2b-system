# 直傳網址沒有綁定大小，完成上傳後仍可覆寫：檔案上限與容量都擋不住

## 現況

api 發給瀏覽器的 presigned PUT 只簽了 `Content-Type`：

- `apps/api/src/core/storage/s3-object-storage.ts` 的 `presignUpload()`（L276–289）：

  ```ts
  new PutObjectCommand({ Bucket: this.bucket(), Key: key, ContentType: options.contentType }),
  { expiresIn: options.expiresIn, signableHeaders: new Set(['content-type']) },
  ```

- 同一個檔案的 `presignUploadPart()`（L325–347）什麼標頭都沒簽。

`apps/api/src/modules/file/file.service.ts` 怎麼用這些網址：

- `createUpload()`（L222–235）替原檔與瀏覽器縮圖各發一個網址，有效 `FILE_URL_TTL` 秒（預設 900）。
- `createUploadParts()`（L264–271）替分塊上傳發網址。
- `completeUpload()` 只在 complete 當下比對大小（L307–313）。
- 縮圖不合規格時只把 `hasThumbnail` 設成 false（L314–319），不刪物件。
- 容量 `FileRepository.storageUsed()`（`file.repository.ts` L199–206）加總的是 `files.size`，也就是登記的大小，不含縮圖。

物件儲存端只擋超過部署上限的請求：

- apps/file-storage 只在超過 `FILE_STORAGE_MAX_OBJECT_SIZE` 時拒絕：
  - `apps/file-storage/src/handlers/request-fields.ts` 的 `requireBodySize()`（L22–27）；
  - `handlers/multipart.ts` 的 `uploadPart()`（L66）。
- `docker-compose.prod.yml` L223 把它預設成 `5368709120`（5 GiB）。api 的檔案上限 `FILE_UPLOAD_MAX_SIZE` 只有 100 MiB。
- `deploy/nginx.conf` 的 `/storage/`（L49–60）設 `client_max_body_size 0;`（L56）。註解寫「大小上限由 file-storage 與 api 決定」（L48），但 api 的網址並沒有限制大小。

未簽的標頭也會存下來：

- `apps/file-storage/src/s3/object-headers.ts` 的 `readObjectHeaders()`（L34–49）收下 `Content-Encoding`、`Expires` 等標頭。
- 下載時 `objectResponseHeaders()`（L94–105）原樣送出。
- api 的 `presignDownload()`（`s3-object-storage.ts` L291–307）只覆寫 disposition、type 與 cache-control。

文件與實測不符：

- [`backend/09-file.md`](../architecture/backend/09-file.md) §5（L232）寫「presigned PUT 無法限制大小，所以大小在 `complete` 時比對」。
- 實際上把 `content-length` 簽進網址，S3 與 apps/file-storage 都會拒絕大小不同的上傳。

實測方式：在 scratchpad 起一個 apps/file-storage，簽法與 api 相同。

- 同一個網址先 PUT 10 bytes、再 PUT 20 MiB：兩次都 200，存下的是 20 MiB。
- 多簽 `content-length: 10`：PUT 11 bytes 回 403 `SignatureDoesNotMatch`。
- 多簽 `if-none-match: *`：第二次 PUT 回 412 `PreconditionFailed`。
- PUT 時多帶 `Content-Encoding: gzip`：之後的下載回應也帶著 `Content-Encoding: gzip`。

攻擊步驟。任何能上傳的成員都做得到：`file:create`，或 `file:access` 加資料夾的 editor 授權。

1. 縮圖：
   - `POST /api/files`，body 除了 `name`、`contentType` 之外帶 `size: 1` 與 `thumbnail: { contentType: 'image/webp', size: 1 }`。
   - 原檔網址 PUT 1 byte，縮圖網址 PUT 5 GiB，再 `POST /api/files/:id/complete`，回 200。
   - 5 GiB 的 `thumbnails/<id>` 一直留著，容量只算 1 byte。
   - 紀錄還在，維護排程不把它當孤兒（`file-maintenance.service.ts` L60）。要等檔案被永久刪除才會清掉。
2. 完成後覆寫：
   - complete 之後、上傳網址到期之前（建立後預設 15 分鐘），用同一個網址 PUT 任意大小、任意內容，覆蓋 `files/<id>`。
   - 稽核 `file.upload` 記的大小、webhook `file.uploaded`、已經產生的影像變體都還是舊的內容。
3. 暫存：
   - 登記 `size: 0`，不佔容量。
   - 每個網址 PUT 5 GiB，不呼叫 complete。
   - 物件要到 `FILE_PENDING_TTL`（預設 24 小時）才被維護排程清掉。
   - 分塊上傳的每一塊同樣可以到 5 GiB。
4. 改內容編碼：
   - PUT 時帶 `Content-Encoding: gzip`。
   - 下載的人拿到的是解壓縮後的內容，可以做成解壓縮炸彈；大小也和 complete 時比對的不同。

## 影響

- `file.uploadMaxSize` 與 `file.storageQuotaMb` 都能繞過。超出的量不出現在用量裡，管理者看不到。
- `docker-compose.prod.yml` 的 apps/file-storage 是所有租戶共用的一顆磁碟。一個成員塞滿它，所有租戶都不能上傳。
- 換成 S3 時，這變成沒有上限的儲存費用。
- 檔案內容可以在稽核、webhook、影像變體產生之後被換掉：
  - 列表看到的縮圖與實際下載的內容不一致；
  - 接收 webhook 的系統回查時，拿到的也不是當時那個檔案。
- 分塊上傳的網址在 complete 之後就失效（uploadId 已經不在），所以第 2 步只適用單次 PUT 與縮圖。

## 修正方式

1. 綁定大小，並且只能寫一次。這是主要修正。
   - `ObjectStorage.presignUpload()` 加 `contentLength` 參數。
     - `PutObjectCommand` 帶 `ContentLength` 與 `IfNoneMatch: '*'`。
     - `signableHeaders` 改成 `['content-type', 'content-length', 'if-none-match']`。
     - 回傳的 `headers` 加上 `'If-None-Match': '*'`。
   - 前端不用改：
     - `apps/backstage/src/apis/file/upload-file/putToStorage.ts`（L39）本來就逐一帶上 `headers`。
     - `Content-Length` 由瀏覽器依 body 自動帶。
     - 單次 PUT 沒有重試（L55–59），收到 412 時照現在的失敗流程放棄上傳即可。
   - `createUpload()` 把 `dto.size` 與 `dto.thumbnail.size` 傳進去。
   - `presignUploadPart()` 帶 `ContentLength`：前面的塊是 `partSize`，最後一塊是 `file.size` 的餘數。
     - 分塊不加 `If-None-Match`，S3 的 UploadPart 不支援條件寫入。
   - complete 發現大小不符時會先刪物件，所以用同一個網址重傳仍然可以：物件已經不在，`If-None-Match` 會通過。
   - S3 從 2024 年起支援 `If-None-Match`，apps/file-storage 也支援（[`03-file-storage.md`](../architecture/03-file-storage.md) §4.2）。換用其他相容服務時要確認。
2. complete 時檢查得更完整。
   - 縮圖存在但不合規格：刪掉 `thumbnails/<id>`。
   - `ObjectStorage.head()` 多回 `contentEncoding`。原檔帶 `Content-Encoding` 時視為不合格：刪除物件，回 `FILE_UPLOAD_INCOMPLETE`。api 從來不要求瀏覽器帶這個標頭。
3. 部署面的縱深防禦。不能取代第 1 點。
   - `deploy/nginx.conf` 的 `/storage/` 把 `client_max_body_size` 降到瀏覽器實際會送的最大單次請求，例如 `32m`。
     - 這個值要大於單次上傳門檻 `FILE_MULTIPART_THRESHOLD`（16 MiB）與分塊大小（8 MiB）。
     - api 自己寫入影像變體時走內網的 `FILE_STORAGE_ENDPOINT`，不經過這一層。
   - `FILE_STORAGE_MAX_OBJECT_SIZE` 也降到 api 實際會發出的最大單次請求，例如 32 MiB。
     - 它同時限制 api 自己寫入的影像變體與轉出的格式。大圖的原圖轉成 PNG 可能超過，要一起評估。
   - `FILE_UPLOAD_MAX_SIZE` 調大到分塊大小自動放大時（`FILE_UPLOAD_MAX_SIZE / 10000` 超過 8 MiB），這兩個上限要跟著調。
   - 換成真正的 S3 時沒有 nginx 這一層，只能靠第 1 點。
4. 更新 [`backend/09-file.md`](../architecture/backend/09-file.md)：
   - §5（L232）改成「大小與只能寫一次都簽進網址」；
   - §5.1 寫明不合規格的縮圖會刪除；
   - §8 補上 `FILE_STORAGE_MAX_OBJECT_SIZE` 與 nginx 的建議上限。

## 驗證方式

- `apps/api/src/core/storage/__tests__/s3-object-storage.spec.ts`：
  - `presignUpload` 網址裡的 `X-Amz-SignedHeaders` 含 `content-length` 與 `if-none-match`；
  - 回傳的 `headers` 含 `If-None-Match: *`；
  - `presignUploadPart` 簽了 `content-length`。
- `apps/file-storage/test/s3-client.spec.ts`：
  - 簽了 `content-length` 的網址，送出不同大小回 403；
  - 簽了 `if-none-match: *` 的網址，第二次 PUT 回 412。
- `apps/api/src/modules/file/__tests__/file.service.spec.ts`：
  - 超過 `THUMBNAIL_MAX_SIZE` 的縮圖在 complete 後被刪；
  - HeadObject 帶 `contentEncoding` 時 complete 失敗並刪除物件；
  - `presignUpload` 收到的 `contentLength` 是登記的大小。
- `apps/e2e/tests/file.spec.ts`：上傳完成後用同一個上傳網址再 PUT 一次，預期 412。
