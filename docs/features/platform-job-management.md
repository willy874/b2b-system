# 平台的背景工作管理強化

- 優先度：P2
- 狀態：提案
- 依賴：背景工作（[`backend/10-jobs.md`](../architecture/backend/10-jobs.md)：`JobQueue`、`JobStore`、`defineJob`、§6 的管理 API）；
  跨程序的快取同步（[`01-system.md`](../architecture/01-system.md) §4.4 的 `BroadcastService`）；租戶的同時執行上限 `job.maxConcurrency`
  （[`05-tenancy.md`](../architecture/05-tenancy.md) §5.3、§13.3 D9）；平台的權限目錄與稽核（[`iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md) §8、[`backend/06-audit-log.md`](../architecture/backend/06-audit-log.md) §8.1）
- 相關：[`platform-dashboard.md`](./platform-dashboard.md)（總覽的失敗工作與積壓連到這裡）、[`maintenance-broadcast.md`](./maintenance-broadcast.md)（維護期間暫停工作）、
  [`tenant-lifecycle.md`](./tenant-lifecycle.md)（排程清除是背景工作，要能看到、暫停、手動觸發）、[`platform-dual-approval.md`](./platform-dual-approval.md)（批次操作是否要雙人核准）；
  監控 [`08-monitoring.md`](../architecture/08-monitoring.md) §2.2、§6.3

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

apps/platform 的 `/job`（[`05-tenancy.md`](../architecture/05-tenancy.md) §10.2 D23）只能看（`platformJob:read`）與 **逐筆** 重試停在 `failed` 的工作（`platformJob:retry`，
`PlatformJobService.retry()`）。`JobQueue`（`apps/api/src/core/jobs/job-queue.ts`）對 pg-boss 只包了 `retry()`；pg-boss 12 另有 `cancel`、`resume`、`deleteJob`，沒有接上。實際維運時會卡在：

| 情境 | 現在的做法 | 問題 |
| --- | --- | --- |
| 某個租戶誤觸發大量匯出，或一則公告的對象選錯，`announcement.fanOut` 已經排了幾百筆 | 等它們跑完 | 沒有取消；連排隊中的都撤不回來 |
| 外部服務（郵件、Webhook 的接收端）停擺一小時，`auth.activationMail` 與 `webhook.deliver` 重試用完、停在 `failed` 上千筆 | 在列表逐筆按重試 | 列表沒有時間範圍的篩選，也沒有批次；只能寫 SQL 直接改 `pgboss.job` |
| 某種工作有 bug（例：每次都寫壞資料），修好之前要先停下 | 改環境變數讓排程停掉（`*_CRON=''`）並重新部署 | 只停得了排程，程式入列的照樣執行；要重新部署 |
| 某個租戶的工作把 worker 吃滿，或那個租戶正在搬資料 | 調低它的 `job.maxConcurrency`（最小 1） | 只能降速不能停；而且是租戶的「參數」，不是維運動作，沒有誰在何時為何暫停的紀錄 |
| 想確認排程工作（`trash.purge`、`tenant.usageRollup`…）上次何時跑、下次何時跑；修完資料後想立刻補跑一次 | 看佇列卡片上的 cron 字串；等下一次排程 | 沒有下次執行時間、沒有「立即執行」 |
| 佇列卡住（worker 全掛、某租戶的工作一直被放回） | `JobBacklog` 告警（積壓 > 500 筆 15 分鐘，[`08-monitoring.md`](../architecture/08-monitoring.md) §6.3） | 只有筆數，沒有「最老的一筆等了多久」：少量但卡住的佇列（例：驗證碼信）不會觸發 |

另外，**執行中的工作現在其實停不下來**：pg-boss 的 `cancel()` 會把 `active` 改成 `cancelled`，但 handler 繼續跑；
它給每筆工作的 `signal` 只在程序關閉、逾時，或 **心跳發現認領不見** 時中止，而心跳要佇列設了 `heartbeatSeconds` 才會跑——`ensureQueue()` 沒有設。
handler 裡也只有少數會看 `signal`（`jobs.outboxSweep`、`tenant.usageRollup`、`storage.totalRollup`、`cdn.purge`、`cdn.healthCheck`、匯入匯出）。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 取消排隊中（`created`、`retry`）的工作；執行中的工作「要求取消」，handler 以 `signal` 配合時真的停下（§1） | 強制中止不配合的 handler（Node 無法安全地殺掉單一個 async 呼叫） |
| 批次重試、批次取消：依篩選條件（工作、狀態、租戶、建立時間範圍），先預覽筆數再送出（§2） | 刪除工作（`deleteJob`）：保留期到了 pg-boss 自己清；刪掉會失去紀錄 |
| 暫停／恢復：一種工作、一個租戶、或某租戶的某種工作；入列照常，只是不執行（§3） | 依種類或優先序的配額（[`05-tenancy.md`](../architecture/05-tenancy.md) §13.4 不做） |
| 排程的檢視（cron、下次與上次執行、上次結果）與「立即執行」（§4） | 在畫面上改 cron（仍是環境變數，與部署一起管理） |
| 指標：最老的一筆等了多久、暫停中的筆數；告警（§5） | 依租戶的指標標籤（[`08-monitoring.md`](../architecture/08-monitoring.md) §2.3） |
| 平台權限、平台稽核、apps/platform 的頁面（§6～§8） | 租戶後台的批次與暫停（見開放問題 5） |

## 使用者故事

**作為值班的平台管理者，我希望外部郵件服務恢復後一次重試那段時間所有失敗的信，以便不必逐筆按或改資料庫。**

- **Given** 10:00–11:00 郵件服務停擺，`auth.activationMail`、`approval.resultMail` 共 1,200 筆停在 `failed`
- **When** 我在列表篩選「工作 = 兩種寄信、狀態 = 失敗、建立時間 10:00–11:00」，按「重試全部符合」
- **Then** 確認框顯示「將重試 1,200 筆（3 個租戶）」；送出後它們回到佇列，照各租戶的 `job.maxConcurrency` 慢慢消化；平台稽核記下一筆，含篩選條件與筆數

**作為平台管理者，我希望在修好某種工作的 bug 之前先暫停它，以便不必重新部署。**

- **Given** `gallery.process` 對某種格式會寫出壞的變體
- **When** 我在佇列概況對它按「暫停」並填寫原因
- **Then** 所有 worker 在幾秒內（最晚快取的 TTL）不再執行它；新的工作照常入列、留在佇列；卡片顯示「已暫停（誰、何時、原因）」與等待中的筆數；恢復後依序執行

**作為平台管理者，我希望取消一個租戶誤觸發的大量工作，以便它不佔用其他租戶的 worker。**

- **Given** 某租戶排了 800 筆 `dataTransfer.export`，其中 3 筆執行中
- **When** 我篩選「租戶 = 該租戶、工作 = 匯出、狀態 = 等待／執行中」，按「取消全部符合」
- **Then** 排隊中的變成 `cancelled`；執行中的 3 筆在下一批之間停下（匯出會看 `signal`），狀態也是 `cancelled`；租戶的匯出紀錄顯示「已取消」而不是「失敗」

**作為平台管理者，我希望修完資料後立刻補跑一次排程工作，以便不必等到明天 04:30。**

- **Given** `trash.purge` 昨晚因為某租戶的外鍵錯誤失敗，我已修正資料
- **When** 我在「排程」分頁對它按「立即執行」，選擇「只有這個租戶」
- **Then** 那個租戶入列一筆，結果在列表看得到；下一次的排程不受影響

## 初步構想

### 1. 取消

| 原本的狀態 | 動作 | 結果 |
| --- | --- | --- |
| `created`、`retry` | `JobQueue.cancel(name, ids)` → pg-boss `cancel()` | `cancelled`，不會再被取走 |
| `active` | 同上 | 表上立刻是 `cancelled`；handler 收到 `signal` 中止後停下，回傳的完成是空操作（pg-boss 的完成只更新 `active` 的列）。handler 不看 `signal` 時會跑完，副作用照樣發生 |
| `completed`、`failed`、`cancelled` | — | `409 JOB_NOT_CANCELLABLE` |

- **讓執行中的 handler 收到中止**：佇列設 `heartbeatSeconds`（pg-boss 下限 10 秒），worker 的心跳發現認領不見就中止那一筆的 `signal`。
  `defineJob` 加 `cancellable`（預設 `false`）：只有宣告的工作才設心跳、畫面上才對執行中的列顯示「取消」；排隊中的一律可取消。
- **擁有者的通知**：有自己狀態的工作（匯出、匯入、公告的發送）被取消後，業務紀錄不能一直停在「處理中」。
  `register()` 的選項加 `onCancelled(data, ctx)`：取消的請求在佇列改成 `cancelled` 之後，以 `Tenancy.runForMaintenance` 進入租戶呼叫它，擁有者把紀錄改成「已取消」。
- `exclusive` 的佇列：取消後 `stately` 的唯一限制就釋放了，下一次排程能正常入列。
- 恢復（`resume`）不做：取消後要再做，用重試或重新觸發（開放問題 2）。

### 2. 批次重試與批次取消

- `POST /platform/jobs/bulk-retry`、`POST /platform/jobs/bulk-cancel`，body 是列表的篩選條件（`name[]`、`state[]`、`tenant`、`createdFrom`、`createdTo`）＋ 預覽時拿到的 `expectedCount`。
  `GET /platform/jobs` 同時加上 `createdFrom`／`createdTo`。
- 先 `POST …/preview` 回 `{ count, byName, byTenant }`；送出時重新計算，與 `expectedCount` 差超過 10% 回 `409 JOB_BULK_CHANGED`，讓人重新確認。
- 上限 5,000 筆（超過回 `422 JOB_BULK_TOO_MANY`，請縮小範圍）；依工作名稱分組、每 500 筆一次 pg-boss 的 `retry(name, ids[])`／`cancel(name, ids[])`，同步完成並回 `{ affected }`。
- 重試只動 `failed`、取消只動 `created`／`retry`／`active`：篩選條件裡的其他狀態直接略過。重試後照常受租戶的 `job.maxConcurrency` 限制，不會一次擠爆 worker。
- **冪等性的要求**：重試本來就要求 handler 能安全地重做（[`backend/10-jobs.md`](../architecture/backend/10-jobs.md) §5）；批次只是放大了數量。
  寄信、Webhook 這類「做了就收不回」的工作，重做代表對方可能收到第二次——預覽的確認框依工作列出這個提醒（`defineJob` 的 `sideEffect: 'external'`）。

### 3. 暫停與恢復

**資料模型（平台 DB）**：`job_pauses`

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | uuid | |
| `job_name` | text，可為 null | null = 所有種類 |
| `tenant_id` | uuid，可為 null | null = 所有租戶（含平台工作）；`job_name` 與 `tenant_id` 不能同時為 null（全域暫停留給 [`maintenance-broadcast.md`](./maintenance-broadcast.md)，開放問題 9） |
| `reason` | text | 必填 |
| `resume_at` | timestamptz，可為 null | 到時間自動恢復；null = 手動恢復 |
| `created_by`、`created_at` | | |

- 唯一索引 `(COALESCE(job_name, ''), COALESCE(tenant_id, '00000000-…'))`：同一個範圍只有一列；恢復 = 刪除那一列（稽核留紀錄）。
- **worker 怎麼得知**：`JobPauses`（`core/jobs`）啟動時載入、記憶體同步判斷；寫入後本機重讀，以 `BroadcastService.channel('job_pauses')` 通知其他程序，`TENANT_CACHE_TTL` 兜底（廣播不保證送達）。
- **怎麼不執行**：`JobQueue.execute()` 在 `deferIfTenantBusy()` 之前判斷；命中時以 `JobStore.requeue()` 放回佇列（`start_after` 延後 60 秒，不動重試次數），
  與租戶的同時執行上限同一個機制。`exclusive` 佇列放不回去時以 `{ skipped: 'PAUSED' }` 結束（下一輪排程會再排）。指標的 `result` 多一個 `paused`。
- 排程觸發的展開（沒有租戶的那一筆）不受租戶暫停影響，只受「這種工作」的暫停影響；展開出來的每一筆再各自判斷。
- **不能暫停的工作**：`jobs.outboxSweep`、`rateLimit.cleanup` 這類基礎設施工作（`defineJob` 的 `pausable: false`）。驗證碼信（`ignoreTenantConcurrency`）是否可暫停見開放問題 4。
- `resume_at` 的自動恢復：`JobPauses` 讀取時把過期的列視為不存在；另由每 10 分鐘的 `jobs.outboxSweep` 順手刪除過期的列（不另開排程）。

### 4. 排程的檢視與立即執行

- `GET /platform/jobs/schedules`：每個有 cron 的工作一列——`cron`（UTC）、`scope`、下次執行（pg-boss `previewSchedule()`）、
  上次執行與結果（同名工作中最新一筆 **沒有租戶** 的觸發紀錄；租戶工作另附展開後的成功／失敗筆數）、是否暫停。
- `POST /platform/jobs/schedules/:name/run`，body `{ tenant? }`：
  平台工作直接入列一筆；租戶工作不帶 `tenant` 時入列一筆沒有租戶的觸發（照常展開成每個 `active` 租戶），帶 `tenant` 時只入列那個租戶一筆。
  `exclusive` 的佇列已有一筆排隊時回 `409 JOB_ALREADY_QUEUED`。
- 工作的資料是 `{}`（排程工作本來就沒有參數）；不開放自訂 payload。

### 5. 指標與告警

| 指標 | 型別 | 標籤 | 說明 |
| --- | --- | --- | --- |
| `api_job_oldest_ready_age_seconds` | gauge（`ObservedGauge`） | `job` | 可以執行（`created`／`retry` 且 `start_after <= now()`）的工作中最早的 `start_after` 距今幾秒；0 = 沒有積壓 |
| `api_job_paused` | gauge | `job` | 命中暫停的範圍數（`job_name` 為 null 的租戶暫停記在 `job="*"`） |
| `api_jobs_processed_total` | counter（既有） | `result` 多 `paused`、`cancelled` | |

- 只在執行工作的程序回報，快取 15 秒（同 `api_job_queue_depth`，[`08-monitoring.md`](../architecture/08-monitoring.md) §9.2 D9）。最老的一筆要直接查 `pgboss.job`（`getQueues()` 沒有這個值），
  查詢在 `JobStore`；pg-boss 內建的部分索引是 `job_i11 (name, priority DESC, created_on, start_after) WHERE state < 'active'`，
  以 `start_after` 取最小值不一定走得到，要實測（開放問題 8）。
- 告警 `JobStale`：任一工作的 `api_job_oldest_ready_age_seconds` > 600 持續 5 分鐘（暫停中的不算：以 `api_job_paused` 排除）；`JobBacklog` 保留。
- 「被放回」本身不算積壓：`JobStore.requeue()` 會把 `start_after` 往後推，所以租戶滿載時最老等待時間不會一直增加——這是要在設計時確認的盲點（開放問題 8）。

### 6. 權限（平台的目錄）

| 權限鍵 | 顯示名稱 | 說明 | `super-admin` | `operator` | `auditor` |
| --- | --- | --- | :-: | :-: | :-: |
| `platformJob:read`（既有） | 檢視背景工作 | 另含排程、暫停狀態、批次的預覽 | ✅ | ✅ | ✅ |
| `platformJob:retry`（既有） | 重試背景工作 | 另含批次重試 | ✅ | ✅ | |
| `platformJob:cancel` | 取消背景工作 | 單筆與批次取消 | ✅ | ✅ | |
| `platformJob:pause` | 暫停背景工作 | 暫停與恢復 | ✅ | ✅ | |
| `platformJob:trigger` | 立即執行排程 | 手動觸發排程工作 | ✅ | ✅ | |

### 7. 稽核（平台稽核）

| 動作 | `metadata` |
| --- | --- |
| `platformJob.cancel` | `name`、`tenantId`、原本的狀態 |
| `platformJob.bulkRetry`、`platformJob.bulkCancel` | 篩選條件、`affected`、`byName`（每種幾筆） |
| `platformJob.pause`、`platformJob.resume` | `jobName`、`tenantId`、`reason`、`resumeAt`；自動恢復時 `actorId` 為 null |
| `platformJob.trigger` | `name`、`tenantId`、新工作的 id |

- 順序同現在的重試：先動佇列、成功才寫稽核（佇列與稽核不在同一個交易，[`backend/10-jobs.md`](../architecture/backend/10-jobs.md) §6）。暫停寫在平台 DB，可以與稽核同一個交易。
- 推播：`DomainEvent.PLATFORM_CHANGED` 帶 `ChangeSource.PLATFORM_JOB`（既有），平台管理者的畫面重抓。

### 8. 前端

- `packages/web-core/src/job`：`JobRowActions` 加「取消」（`row.canCancel`）；`JobTable` 支援勾選與「全部符合」的批次列；`JobQueueSummary` 的卡片顯示暫停徽章與最老等待時間。
  兩個 app 共用，租戶後台是否開啟由 app 傳入（開放問題 5）。
- `apps/platform/src/features/job`：`JOB_VIEWS` 多「排程」「暫停」兩個分頁；暫停的對話框（範圍、原因、自動恢復時間）；批次的預覽確認框。
- `apps/platform/src/apis/platform-job/`：每個新端點一個 operation。

### 9. 會動到的既有檔案

| 位置 | 改動 |
| --- | --- |
| `apps/api/src/core/jobs/job-type.ts` | `cancellable`、`pausable`、`sideEffect` |
| `apps/api/src/core/jobs/job-queue.ts` | `cancel()`、`register()` 的 `onCancelled`、`execute()` 的暫停判斷、心跳、新指標 |
| `apps/api/src/core/jobs/job-store.ts` | 時間範圍篩選、批次的計數與 id 清單、最老等待時間 |
| `apps/api/src/core/jobs/job-pauses.ts`（新） | 載入、判斷、廣播 |
| `apps/api/src/modules/job/platform-job.*` | 新端點與 DTO |
| `apps/api/src/db/platform/schema` | `job_pauses`（下一個平台 migration） |
| `modules/data-transfer`、`modules/announcement` | `onCancelled`；長時間的 handler 檢查 `signal` |
| `apps/api/src/db/seeds/platform-permissions.ts`、`docs/architecture/iam/02-permission-catalog.md` §8 | 三個權限鍵；apps/platform 兩個語系檔的 `permission.platformJob.*` |
| `packages/error-codes` | `JOB_NOT_CANCELLABLE`、`JOB_BULK_CHANGED`、`JOB_BULK_TOO_MANY`、`JOB_ALREADY_QUEUED` |
| `apps/api/src/core/metrics/instruments.ts`、`deploy/monitoring/rules/b2b-alerts.yml` | §5 |
| `docs/architecture/01-system.md` §4.4 | 廣播頻道 `job_pauses` |

## 開放問題

1. **執行中的工作怎麼取消？** (a) 只取消排隊中的，執行中的不給取消；(b) 一律可以「要求取消」，表上立刻 `cancelled`，handler 不配合就跑完；
   (c) 只有 `cancellable` 的工作（設心跳、handler 檢查 `signal`）才能取消執行中的。傾向 (c)：(b) 會讓狀態顯示「已取消」但副作用照樣發生。代價是心跳每 `heartbeatSeconds / 2` 多一次 UPDATE。
2. **取消要不要能恢復（pg-boss 的 `resume`）？** 傾向不要：恢復與重試語意重疊；取消後保留期內的紀錄已足夠查證。
3. **暫停的狀態放哪？** (a) 平台 DB 新表 `job_pauses`；(b) 租戶的 feature 參數（例：`job.maxConcurrency = 0`）；(c) pg-boss 的佇列設定（無暫停 API，要自己改表）。
   傾向 (a)：可以同時表達「種類」「租戶」「兩者」，有原因與自動恢復；(b) 只能表達租戶，而且混淆了「配額」與「維運動作」。
4. **暫停的效果怎麼做？** (a) worker 取到後放回（與 `job.maxConcurrency` 同一個機制）；(b) 暫停一種工作時各程序 `offWork()`、恢復時重新 `work()`；(c) 把排隊中的 `start_after` 推到很遠。
   傾向 (a)，種類的暫停可以再加 (b) 省掉空轉。另外：驗證碼信（`ignoreTenantConcurrency` 的工作）能不能暫停？暫停會讓使用者登入不了，但它也可能就是出問題的那一個。
5. **租戶後台要不要也能取消？** 例：租戶管理者撤回自己誤觸發的匯出。傾向這一版只給「取消排隊中的單筆」並加 `job:cancel`，批次與暫停只在平台；或乾脆不給，由擁有者模組在自己的頁面提供「取消匯出」。
6. **批次的上限與執行方式**：5,000 筆同步完成可以嗎？還是超過某個數量改成背景工作（批次本身變成一筆平台工作）？批次要不要經 [`platform-dual-approval.md`](./platform-dual-approval.md) 的雙人核准？
7. **權限鍵怎麼切？** 三個新鍵（`cancel`、`pause`、`trigger`）或合成一個 `platformJob:manage`；批次重試要不要另外一個鍵（影響面比單筆大很多）。`operator` 是否全部都有。
8. **「積壓」怎麼量？** 最老的 `start_after` 會被「放回佇列」與重試退避往後推，看不到被反覆放回的工作；改用 `created_on` 又會把排定在未來的工作算進去。
   方案：(a) `start_after`（現在可執行的才算）；(b) `created_on` 但只算 `start_after <= now()`；(c) 兩個都報。也要確認查詢走得到索引，不掃保留期內的全部工作。
9. **與維護模式的關係**：[`maintenance-broadcast.md`](./maintenance-broadcast.md) 的維護期間要不要「暫停所有工作」？若要，全域暫停由那個功能寫入 `job_pauses`（`job_name`、`tenant_id` 都是 null），還是它有自己的開關、這裡只讀？
10. **排程的「立即執行」對租戶工作要怎麼展開？** 傾向可選「全部租戶」或「指定租戶」；另外是否要能「略過下一次排程」。

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

完成後預計寫成：

- `docs/architecture/backend/10-jobs.md`：§3 的暫停、§6 的取消／批次／排程端點，設計決策併入 §9 之後的新章
- `docs/architecture/iam/02-permission-catalog.md` §8：`platformJob:cancel`、`platformJob:pause`、`platformJob:trigger`
- `docs/architecture/01-system.md` §4.4：廣播頻道 `job_pauses`
- `docs/architecture/08-monitoring.md` §2.2、§6.3：新指標與 `JobStale` 告警
- `docs/architecture/backend/06-audit-log.md` §8.1：平台稽核的新動作
