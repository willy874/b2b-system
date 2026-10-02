# ADR-0033 — 可啟用 feature 的參數（配額與上限）、Webhook 的多個目標網址

- 狀態：**採用**（2026-10-02）
- 日期：2026-10-02
- 相關：延伸 [ADR-0021](./0021-runtime-feature-activation.md)／[ADR-0029](./0029-toggleable-platform-features.md)（平台層的 feature 開關）、
  [ADR-0030](./0030-webhooks.md)（D7 訂閱的資料表、D13 自動停用、D17 手動送出）、[ADR-0016](./0016-background-jobs.md)（背景工作）；
  規格 [`../architecture/05-tenancy.md`](../architecture/05-tenancy.md) §5.3、[`../architecture/backend/17-webhook.md`](../architecture/backend/17-webhook.md)

## 背景

平台管理者目前只能對每個租戶「開或關」一個 feature。開了之後，租戶能用多少全由程式碼的常數決定：

| 能力 | 現況 |
| --- | --- |
| 稽核日誌 | 熱表保留 90 天，常數 `AUDIT_LOG_HOT_RETENTION_DAYS` |
| 檔案 | 單檔上限有（系統設定 `file.uploadMaxSize`），總容量沒有上限 |
| 背景工作 | 只有每個程序、每種工作的並行數；一個租戶入列大量工作就能佔滿所有 worker |
| 外部 IdP | 連線數沒有上限 |
| Webhook | 一個租戶最多 50 個訂閱（常數），一個訂閱只能有一個網址 |

2026-10-02 確認的產品需求：

- feature 除了開關，還要有 **數字與字串的參數**，由 **平台管理者** 在租戶詳情設定（租戶管理者不能改，這是「租戶買了多少」）。
- 第一批參數：稽核熱資料保存天數（預設 90）、檔案總容量（預設 2 GB）、背景工作 **同時執行** 的上限、外部 IdP 連線數上限、
  Webhook 可通知的網址數（**整個租戶**，預設 1）。
- 一個 Webhook 訂閱可以有 **多個目標網址**。

## 決定

### Feature 參數

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **參數定義在程式碼**：`core/tenant/tenant-feature-params.ts` 的 `TENANT_FEATURE_PARAMS`，每個參數有 `key`（`<feature>.<名稱>`）、所屬的 `feature`、`type`（`integer` ｜ `string`）、`defaultValue`、`unit`（`days` ｜ `megabytes` ｜ `count`，字串沒有）、整數的 `min`／`max`、字串的 `maxLength`／`pattern`。目錄在 `core/`：`TenantContext` 與背景工作佇列（都在 `core/`）要讀它，`core/` 不 import `modules/` | 與 `TENANT_FEATURES`、feature flag 目錄同一個做法：清單由程式維護，DB 只存值 |
| D2 | **平台 DB `tenants.feature_params jsonb NOT NULL DEFAULT '{}'`，只存覆寫值**（平台 migration 0012）。讀取時只留目錄裡的 key 且值通過驗證的項目（程式移除參數或收緊範圍後，殘留值回到預設，不讓請求失敗） | 與 `flags` 欄位相同；沒有覆寫的租戶跟著程式的預設，之後調整預設時才跟得上 |
| D3 | **API**：`PlatformTenant` 多一個 `featureParams`：目錄上每個參數一項（`key`、`feature`、`type`、`value`、`defaultValue`、`overridden`、`unit`、範圍），已是生效值。`PATCH /platform/tenants/:id` 接受 `featureParams: { [key]: value \| null }`——**只列要改的**，`null` 回到預設；值等於預設時也不存。不認得的 key、型別或範圍不對回 `VALIDATION_FAILED`（`fields["featureParams.<key>"]`） | 管理頁一次拿到要畫的東西（不必另一支目錄端點）；參數之間互不相關，部分更新比 flags 的「整張表取代」不容易誤蓋 |
| D4 | **稽核**：沿用 `tenant.update`，`before`／`after` 多帶 `featureParams`（覆寫表）。變更後 `TenantDirectory.invalidate()`；**不推播**（參數不影響前端安裝哪些 feature） | 與 features、flags 同一個交易與失效路徑 |
| D5 | **參數與開關無關**：feature 關閉時參數照常保留、照常生效（例：關掉稽核頁，封存仍依保留天數執行）。管理頁把參數列在所屬 feature 的那一列下 | 「關掉只是看不到頁面、資料與背景工作照舊」（ADR-0029） |
| D6 | **讀取**：`TenantContext.featureParams`（覆寫表）＋ `tenantFeatureParam(PARAM)`：取目前租戶的生效值；沒有租戶脈絡時拋錯（與 `requireTenant()` 相同）。`TenantRecord` 也帶覆寫表，給以 id 找租戶的地方（背景工作佇列）用 | 業務模組不必知道覆寫怎麼存；同步取值（租戶登記本來就快取在每個請求的脈絡裡） |

### 第一批參數

| # | key | 預設 | 範圍 | 效果 |
| --- | --- | --- | --- | --- |
| D7 | `auditLog.hotRetentionDays` | 90 天 | 7–3650 | `auditLog.archive` 搬移早於「現在 − 天數」的紀錄（`pnpm db:archive-audit-logs` 同樣讀登記）。查詢是否要連冷表改看 **冷表最新一筆的時間**（索引的第一列），不再以保留天數推算：天數調大後，已在冷表的紀錄不會搬回熱表，以天數推算會漏查 |
| D8 | `file.storageQuotaMb` | 2048 MB | 1–10485760 | 租戶所有檔案的 `size` 合計（含上傳中的 `pending` 與回收桶裡的，不含縮圖與影像變體）。`createUpload` 在登記 `pending` 的同一個交易以 advisory lock 序列化後加總，超過回 `409 FILE_STORAGE_QUOTA_EXCEEDED`（`details`：`quota`、`used`、`size`，位元組）。調小到低於已用量時不刪任何檔案，只擋新的上傳。`GET /files/upload-policy` 多回 `storageQuota`、`storageUsed`，檔案頁顯示用量 |
| D9 | `job.maxConcurrency` | 10 | 1–100 | 一個租戶 **所有種類** 的背景工作同時執行的筆數（跨程序）。worker 取到租戶的工作後，在該租戶 `active` 的工作中依 `(started_on, id)` 排名，排在上限之後的 **放回佇列**（改回 `created`、`start_after` 延後 5～10 秒、不計入重試次數、工作 id 不變），由之後的輪詢再取。排程觸發的展開（沒有租戶）與平台工作不受限。每個程序的 `concurrency` 照舊 |
| D10 | `identityProvider.maxProviders` | 10 | 1–100 | 建立連線時以 advisory lock 序列化後數，已達上限回 `409 IDENTITY_PROVIDER_LIMIT_REACHED`（`details.max`） |
| D11 | `webhook.maxUrls` | 1 | 1–500 | 整個租戶的訂閱 **不重複** 的目標網址數（D13）。建立或修改訂閱時鎖表後計算；變更後的數量超過上限 **而且比變更前多** 才回 `409 WEBHOOK_URL_LIMIT_REACHED`（`details.max`）——升版前已經超過的租戶仍能修改、刪除、減少網址 |

- 背景工作的放回（D9）直接改 pg-boss 的工作表：pg-boss 的 API 只能更新還沒開始的工作，而 `fail` 會耗掉重試次數並觸發退避。
  pg-boss 完成工作時只更新 `active` 的列，handler 回傳後 pg-boss 的完成是空操作。表結構相依集中在 `core/jobs/job-store.ts`。
  `exclusive`（`stately`）佇列已有一筆排隊時放不回去（唯一索引），那一筆以 `{ skipped }` 結束——排隊中的那一筆會做同一件事。
- 配額與上限的檢查都在業務交易內，以 advisory lock 或表鎖序列化：同時送出不會一起超過上限。

### Webhook 的多個目標網址

| # | 決定 | 理由 |
| --- | --- | --- |
| D12 | **新表 `webhook_targets`**（租戶 migration 0033）：`id`、`subscription_id`（CASCADE）、`url`、`consecutive_failures`、`last_delivery_at`、`position`、`created_at`；`unique(subscription_id, url)`。既有訂閱的 `url` 搬成一筆。`webhook_subscriptions.url` 改成可為 null、繼續寫入第一個網址（雙寫），下一次部署再刪（`conventions/03-backend.md` §5 的破壞性變更拆兩次） | 失敗次數要跟著網址走：一個壞掉的網址不能被另一個正常的網址「歸零」而永遠不停用 |
| D13 | **API**：`url` 改成 `urls`（1–10 個、不重複、各自照 D15 檢查），回應的 `targets` 帶每個網址的連續失敗次數與最後投遞時間。修改網址時保留沒變的網址（id 與失敗次數不變），移除的網址刪除（投遞紀錄的 `target_id` 設為 null，保留 `url` 快照） | 一個訂閱 = 一組事件 ＋ 一個密鑰 ＋ 一組網址；要不同的事件或密鑰就建另一個訂閱 |
| D14 | **投遞**：`emit()` 為每個訂閱的每個網址入列一筆 `webhook.deliver`（`{ subscriptionId, eventId, targetId }`）；`webhook_deliveries` 加 `target_id`（SET NULL）與 `url`。網址已被移除的工作略過。升版前入列、沒有 `targetId` 的工作送到訂閱的第一個網址 | 每個網址獨立重試：一個慢的接收端不會擋住其他網址 |
| D15 | **自動停用**：失敗次數記在網址上；任何一個網址連續失敗到 50 次，整個訂閱停用（`failing`），通知與稽核帶那個網址。重新啟用時所有網址歸零 | 訂閱的狀態模型不變（只有訂閱能停用）；管理者看得到是哪個網址壞了，移除或修好它再啟用 |
| D16 | **手動送出**：送測試事件送到 **每個網址**，回傳 `{ items: 投遞紀錄[] }`；重送只送那一筆紀錄的網址，網址已被移除回 `404 WEBHOOK_DELIVERY_NOT_FOUND`。投遞紀錄可以依 `targetId` 篩選 | 測試是「這個訂閱通不通」；重送是「這一次再送一次」 |

### 不做

- 租戶管理者自行調整參數（D3 只在平台端點）；全平台一次改預設值（改程式的 `defaultValue`）。
- 參數的歷史版本、排程生效。
- 背景工作依種類分開的上限、優先序（D9 只有一個總上限）。
- 檔案配額計入縮圖與影像變體、配額快取（每次上傳前加總，`files` 有 `size` 欄位，一個租戶的列數加總的成本可接受）。
- 每個網址各自的事件或密鑰（D13）。

## 代價

| 代價 | 緩解 |
| --- | --- |
| 背景工作的放回依賴 pg-boss 的表結構與「完成只更新 active」的行為 | 集中在 `job-store.ts`；整合測試以真的 pg-boss 驗證放回與之後的執行 |
| 被放回的工作最多晚 10 秒才再被取到；租戶持續塞滿時後面的工作一直延後 | 上限是給「不讓一個租戶佔滿 worker」，不是排程保證；放回不耗重試次數 |
| 每次上傳前加總 `files.size` | 一個租戶的檔案列數有限；之後真的太慢再改成維護一個計數 |
| Webhook API 的 `url` 改成 `urls`（不相容） | 前端同一批修改；對外 API 沒有 webhook 端點 |
| 預設只能通知 1 個網址，升版前已有多個訂閱的租戶超過上限 | D11：只擋「變多」的變更；平台管理者可以調高 |

## 實作紀錄

| 項目 | 補充 |
| --- | --- |
| D3 | `UpdateTenantRequest.featureParams` 在 OpenAPI 上是 `Record<string, number \| string \| null>`（zod 的 `partialRecord`）；key 仍以 `TenantFeatureParamKey` 驗證 |
| D7 | `archiveAuditLogs()` 改成由呼叫端傳入保留天數；排程讀 `TenantContext`，`pnpm db:archive-audit-logs` 讀 `ScriptTenant.featureParams` |
| D8 | 不帶資料夾的上傳原本不在交易內；`FileFolderService.insideFolder()` 改成一律開交易，advisory lock 才有作用 |
| D9 | 排名與放回在 `JobStore.activeAhead()`／`requeue()`（`JOB_SCHEMA` 從 `job-queue.ts` 搬到 `job-store.ts`，避免循環 import）；放回時一併清掉 `started_on`、`heartbeat_on` |
| D12 | `webhook_deliveries.url` 以 migration 回填後設為 NOT NULL；升版期間舊程式碼寫入的投遞紀錄會失敗並由 pg-boss 重試。舊欄位的刪除登記在 [`../issues/webhook-legacy-columns.md`](../issues/webhook-legacy-columns.md) |
| 前端 | apps/auth 的參數列在「啟用的功能」每個 feature 那一列下，編輯是單一參數的對話框（只送那一個 key）；backstage 的檔案管理器側欄顯示容量用量（`FileStorageUsage`） |

