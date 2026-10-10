# 上傳的重試與被擋清單

- 優先度：P1
- 狀態：提案
- 依賴：全域批次佇列（[`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §13：`BatchOperation`、`BatchResultDialog`，D8、D10、§13.4）；
  上傳暫存區（[`frontend/12-file-manager.md`](../architecture/frontend/12-file-manager.md) §8、§14.2 D5，`core/upload` 的 `createUploadSources`）；
  圖片庫的上傳（[`frontend/24-gallery.md`](../architecture/frontend/24-gallery.md) §4）。要改寫 `12-file-manager.md` §8「不論成敗都清掉暫存的檔案」（流程描述，不是 Dn 決策）
- 相關：檔案的上傳流程與放棄上傳 [`backend/09-file.md`](../architecture/backend/09-file.md) §5、§5.3；圖片庫的重複圖片 [`backend/26-gallery.md`](../architecture/backend/26-gallery.md) §14 D7

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

檔案管理與圖片庫的上傳都走全域批次佇列，每個檔案是一筆（`12-file-manager.md` §14.2 D1）。佇列只會自動重送被限流（429）的那一筆（`07-ui-system.md` §13.4），其他失敗就停在結果對話框：

| 情境 | 現在的做法 | 問題 |
| --- | --- | --- |
| 上傳 300 個檔案，其中 12 個因網路中斷、物件儲存暫時不可用（`FILE_STORAGE_UNAVAILABLE`）失敗 | `BatchResultDialog`（`packages/web-core/src/batch/BatchResultDialog.tsx`）列出名稱與原因，只有「關閉」 | 暫存檔已刪（`features/file/batch.ts:92-101` 的 `finally`：只有 `RATE_LIMITED` 保留）；使用者要回到檔案總管把那 12 個挑出來重選，資料夾上傳時還得記得各自的子資料夾 |
| 同上，圖片庫 | 同上（`features/gallery/batch.ts:77-84`） | 同上 |
| 同一筆連續被限流超過 5 次（`BatchQueueHost.ts` 的 `MAX_RATE_LIMIT_RETRIES`） | 佇列改記為失敗 | 但 `runUpload` 已把 `willRetry` 設為 true、暫存檔沒刪：檔案留在 IndexedDB 直到 24 小時後的 `prune()` 或 session 結束，卻沒有任何入口能用到它 |
| `complete` 在伺服器成功、回應遺失，而補查狀態也失敗（`apis/file/upload-file/fetcher.ts:101-111`） | 放棄上傳（對 `ready` 的檔案回 `FILE_ALREADY_UPLOADED`，被吞掉）、這一筆記為失敗 | 檔案其實已在資料夾裡；使用者照結果重傳就多一個同名檔。後端檔名沒有唯一性（`apps/api/src/modules/file/file.service.ts:491`），id 由伺服器產生（同檔 `:215`），沒有冪等鍵 |
| 執行中的分頁關掉，佇列把同一筆交給其他分頁重送（`07-ui-system.md` §13.4） | 接手的分頁重新登記一次 | 前一個分頁若已送到 `complete`，同樣多一份；圖片庫的 `uploadGalleryItem` 連狀態補查都沒有 |
| 拖進 80 個檔案，其中 15 個超過大小上限或檔頭對不上 | toast 只列第一個與總數（`features/file/hooks/useFileUpload.ts:82-92`；圖片庫 `features/gallery/hooks/useGalleryUpload.ts:51-60`） | 看不到另外 14 個是誰、為什麼；資料夾上傳時更無從找起 |

`core/upload`（`apps/backstage/src/core/upload/`）已經有兩個 feature 共用的 `collectEntries.ts`、`imageSignature.ts`、`uploadSources.ts`（2026-10-09 從 `features/file` 抽出，`12-file-manager.md` §14.5），但「一筆上傳怎麼跑、失敗時暫存檔留不留」仍各寫一份，被擋下的提示也各寫一份。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 結果對話框加「重試失敗項目」：只重送可以重試的失敗，沿用原本的目的地（§2） | 後端的批次上傳端點（`07-ui-system.md` §13.2 D1：批次一律逐筆呼叫單筆 API） |
| 可重試的失敗保留暫存檔，對話框關閉或重試後才清（§1、§3） | 斷點續傳（從上次傳到的那一塊接著傳）：分塊已各自重試（`backend/09-file.md` §5.2），整筆重試從頭來 |
| 重試前先確認上一次是否其實已完成，不重複建立（§4） | 檔名唯一或同名覆蓋：檔名本來就沒有唯一性（`backend/09-file.md` §4、`file.service.ts:491`） |
| 被擋下的檔案有完整清單（toast 的「查看全部」），檔案管理與圖片庫共用（§5） | 上傳前在瀏覽器算雜湊去重（`backend/26-gallery.md` §14 D7 已評估不採用） |
| 擴充既有的 `core/upload`，兩個 feature 的上傳操作改用它 | 圖片庫「處理失敗」（`gallery.process`）的重試：那是伺服器端的狀態，頁首的 `GalleryUploadStatus` 另有清單 |
| | apps/platform：沒有上傳 |

## 使用者故事

**作為上傳大量素材的使用者，我希望一鍵重試失敗的檔案，以便不必回到檔案總管把它們一個個挑出來。**

- **Given** 我把一個 300 個檔案的資料夾拖進「專案文件」，其中 12 個因網路中斷失敗、1 個因容量已滿失敗
- **When** 結果對話框彈出，我按「重試 12 個失敗項目」
- **Then** 這 12 個以新的工作排進佇列、上傳到原本的子資料夾；容量已滿的那一個不在重試之列，標示「無法重試」

**作為使用者，我希望重試不會讓同一個檔案出現兩次。**

- **Given** 「年度報告.pdf」的完成請求在伺服器成功，但回應遺失、這一筆記為失敗
- **When** 我按「重試失敗項目」
- **Then** 重試先確認上一次登記的檔案已經是完成狀態，直接算成功，資料夾裡只有一份

**作為使用者，我希望知道哪些檔案被擋下、為什麼，以便修正後再上傳。**

- **Given** 我拖進 80 個檔案，其中 15 個超過大小上限、2 個檔頭與副檔名不符
- **When** 提示出現
- **Then** toast 顯示「17 個檔案未上傳」與「查看全部」；打開後依原因分組列出每個檔案的相對路徑

## 初步構想

### 1. 擴充 `core/upload`：一筆上傳的共用執行器

不新建資料夾，在既有的 `apps/backstage/src/core/upload/` 加 `runUploadItem.ts`（放 app 的 `core/`：只有 backstage 會上傳，`17-shared-packages.md` §2 #1）：

- `createUploadOperation({ sources, upload, isRetryable })`：從暫存區取檔 → 呼叫 feature 傳入的 `upload(file, target, ctx)` → 成功就刪暫存；失敗時 **可重試的保留**、其餘刪除。取代 `features/file/batch.ts` 與 `features/gallery/batch.ts` 各自的 `runUpload`。
- 可重試的判斷（預設，feature 可覆寫）：網路錯誤、5xx、`*_STORAGE_UNAVAILABLE`、`RATE_LIMITED`（含超過 5 次的那一筆）、`*_UPLOAD_INCOMPLETE` 但 `reason` 不是 `source-unavailable`。
  不可重試：`*_TOO_LARGE`、`FILE_STORAGE_QUOTA_EXCEEDED`、`STORAGE_TOTAL_LIMIT_REACHED`、403、目的地 `*_NOT_FOUND`、`GALLERY_TYPE_NOT_ALLOWED`。
- `UploadSources` 加 `discard(keys)`：給 §3 清掉不再需要的暫存。

### 2. `web-core/batch`：結果對話框的「重試失敗項目」

結果對話框在 `packages/web-core`（兩個 app 共用），不能知道上傳；以操作自己宣告的方式接上：

- `BatchOperation` 加選用的 `isRetryable?(error: BatchItemError): boolean`。沒有宣告的操作（使用者、角色、審批…）對話框不變——列表的失敗已保留勾選供重試（`RichTable/BatchBar.tsx`）。
- `BatchResultDialog` 把失敗分成「可重試」「無法重試」兩組；按鈕 `重試 N 個失敗項目` 以 `queue.enqueue({ operation, scope, items, concurrency })` 送出 **新的工作**（同一個 `scope`，主區塊的進度條照常顯示），原工作的那些失敗標記為已重送（開放問題 1）。
- 結束通知（`BatchQueueNotifier`）與 AppHeader 面板的「查看失敗」（`BatchQueueIndicator`）都用同一個對話框，兩處都能重試。
- 被拿走檔案（IndexedDB 不可用、接手的分頁讀不到）的項目一律不可重試，說明「請重新選檔」。

### 3. 暫存檔什麼時候清

可重試的失敗留著檔案，要有確定的清除點：重試送出時（由新工作接手）、對話框關閉而沒有重試、從面板移除或清除已結束的工作。`BatchOperation` 加選用的 `onDiscard?(itemIds)`，佇列在上述時點呼叫，上傳操作以 `sources.discard()` 清掉；`prune()`（24 小時）與 session 結束的 `clear()` 仍是兜底（開放問題 2）。

### 4. 不重複建立

- 上傳操作把「這一筆最後一次登記到的 id」（檔案的 `fileId`、圖片庫的 item id）記在暫存區旁（`UploadSources` 的 `setAttempt(key, id)`，同一個 IndexedDB）。
- 重試或跨分頁接手時，先查上一次的 id：`ready`／已完成 → 直接算成功並失效快取；仍是 `pending` → 先放棄（`DELETE /files/:id/upload`）再重新登記；查不到 → 照常重傳。
- 圖片庫要補上同樣的狀態查詢（現在沒有，`apis/gallery/upload-gallery-item/fetcher.ts`），與檔案管理的 `complete` 回應遺失補查一致。
- 這是前端的保護；後端的冪等鍵是另一個選項（開放問題 3）。

### 5. 被擋下的清單

- `core/upload` 加 `UploadRejectedDialog` 與 `useUploadRejections()`：輸入 `{ label, reason }[]`（`label` 是相對路徑），toast 顯示總數與「查看全部」（`useToast` 的 `action`），對話框依原因分組、可複製清單。
- `useFileUpload` 與 `useGalleryUpload` 改呼叫它；兩邊的 `rejected` 型別統一成 `{ file, label, reasonKey, params }`，語系 key 照舊各自的 `file.validation.*`／`gallery.upload.*`。

### 6. 會動到的既有檔案

| 位置 | 改動 |
| --- | --- |
| `apps/backstage/src/core/upload/`（`index.ts`、`uploadSources.ts`，新增 `runUploadItem.ts`、`UploadRejectedDialog.tsx`） | §1、§3、§4、§5 |
| `apps/backstage/src/features/file/batch.ts`、`features/gallery/batch.ts` | `runUpload` 改用 `createUploadOperation`，註冊時帶 `isRetryable`、`onDiscard` |
| `features/file/hooks/useFileUpload.ts`、`features/gallery/hooks/useGalleryUpload.ts` | 被擋清單改用 `useUploadRejections` |
| `apps/backstage/src/apis/file/upload-file/fetcher.ts`、`apis/gallery/upload-gallery-item/fetcher.ts` | 回報登記到的 id（`onRegistered`）；圖片庫補狀態查詢 |
| `packages/web-core/src/batch/`（`types.ts`、`BatchResultDialog.tsx`、`BatchQueueHost.ts`、`protocol.ts`） | `isRetryable`、`onDiscard`、重試按鈕與「已重送」標記 |
| `packages/web-core` 共用語系 | `common.batch.retryFailed`、`common.batch.notRetryable` |
| `packages/web-shared/src/storage/blobStore.ts` | 若 §4 的 id 與檔案放同一個 store，加旁註欄位 |

## 開放問題

1. **重試是新工作還是回到原工作？** (a) 新工作（同 `scope`），原工作保留但標記已重送；(b) 原工作的失敗移回待處理、狀態改回 `running`。傾向 (a)：工作的結果清單不會被改寫，佇列協定只多一個標記；(b) 要讓已結束的工作重新開始，`finished` 通知會發兩次。
2. **暫存檔的清除時機**：(a) 佇列呼叫 `onDiscard`（§3）；(b) 只靠 24 小時的 `prune()` 與 session 結束；(c) 結束後固定保留 1 小時。傾向 (a)：大檔不該在 IndexedDB 多放一天；但對話框只在一個分頁彈出，其他分頁關掉面板時也要能觸發。
3. **防重複放前端還是後端？** (a) 前端記下登記的 id、重試前查狀態（§4）；(b) `POST /files`、`POST /gallery/items` 收 `clientUploadId`，同一個上傳者在 24 小時內重送就回原本的紀錄（新欄位與部分唯一索引）；(c) 兩者都做。
   傾向 (a) 先做：不動 API 與資料表，涵蓋重試與跨分頁接手；(b) 能連「暫存區讀不到 id」的情況也擋住，但要 migration 與兩個模組的改動。圖片庫因為 `26-gallery.md` §14 D7 允許重複圖片，只需要 (a)。
4. **佇列要不要自動重試網路錯誤？** 現在只有 429 會自動重送。(a) 上傳操作宣告 `autoRetry: 2`，網路錯誤與 5xx 在工作內退避重送；(b) 只給手動重試。傾向 (b) 這一版：自動重試會拉長「整批卡住」的時間，也與 §13.4 的限流退避互相疊加。
5. **其他批次操作要不要也宣告 `isRetryable`？** 例：批次刪除遇到網路錯誤。傾向這一版只有上傳：列表的批次已有「失敗的保留勾選」可以再按一次。
6. **被擋清單要不要能「略過這些、其餘照傳」以外的選擇**（例：超過大小的檔案改成壓縮後再傳）？傾向不要，只列出與複製。

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

完成後預計寫成：

- `docs/architecture/frontend/12-file-manager.md`：§8 的上傳流程（暫存的保留與清除、重試、不重複建立、被擋清單），設計決策併入 §14 之後的新章
- `docs/architecture/frontend/07-ui-system.md` §13：`BatchOperation.isRetryable`、`onDiscard`、結果對話框的重試
- `docs/architecture/frontend/24-gallery.md` §4：改用 `core/upload` 的執行器與被擋清單、補上的狀態查詢
