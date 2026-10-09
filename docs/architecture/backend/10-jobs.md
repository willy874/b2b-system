# 10 — 背景工作

伺服器自己發起、要重試或定時執行的工作：稽核封存、檔案維護，以及之後的寄信、Webhook、匯出。
底層是 [pg-boss](https://github.com/timgit/pg-boss)（Postgres 當佇列），選型理由見
§9。

前端的批次佇列（[`frontend/07-ui-system.md`](../frontend/07-ui-system.md) §13）是「使用者開著分頁時逐筆呼叫 API」，
與這裡無關。

---

## 1. 組成

```
core/jobs/
├── job-type.ts      defineJob()：工作名稱 ＋ 資料型別 ＋ 重試設定
├── job-queue.ts     JobQueue：register() / enqueue() / retry()；啟動 worker 與排程
├── job-store.ts     JobStore：管理頁的列表、詳情、即時計數（直接查 pg-boss 的表）
└── jobs.module.ts   @Global

modules/<擁有者>/    宣告工作（defineJob）並在 onModuleInit 註冊 handler
modules/job/         管理 API（GET /jobs/queues、GET /jobs、GET /jobs/:id、POST /jobs/:id/retry）
```

- `core/jobs` 不認識任何業務工作；模組自己宣告、自己註冊（§9.2 D6，與審批 handler 同一個模式）。
- pg-boss 的表在 **平台 DB** 的 `pgboss` schema（`PLATFORM_DATABASE_URL`），由 pg-boss 自己在啟動時建立與升級，
  不進 Drizzle 的 migration。一套佇列與 worker 服務所有租戶（[`architecture/05-tenancy.md`](../05-tenancy.md) §10.2 D15）。
- pg-boss 用自己的 `pg` 連線池（4 條）。業務交易在租戶 DB，不能和平台 DB 的佇列在同一個交易，
  所以交易內的入列先寫租戶 DB 的 `job_outbox`（§4.1）。

### 1.1 租戶

每筆工作的資料是一個信封 `{ tenantId, payload }`（`JobEnvelope`）：

| `defineJob` 的 `scope` | 入列 | 執行 |
| --- | --- | --- |
| `tenant`（預設） | 帶目前的租戶；沒有租戶脈絡時拋 `TENANT_NOT_FOUND` | handler 在 `tenantId` 的租戶脈絡裡執行（`Tenancy.run`），存取 `TENANT_DB` 就是那個租戶的 DB。租戶已停用或刪除時直接結束（`output = { skipped }`），不重試 |
| `platform` | `tenantId = null`；不能帶 `tx` | 沒有租戶脈絡，只能碰平台 DB（例：`oidc.cleanup`、`jobs.outboxSweep`） |

- **排程觸發的租戶工作沒有 `tenantId`**：worker 收到時展開成每個 `active` 租戶一筆（同一個佇列），
  原本那筆的 `output` 是 `{ tenants: n }`。
- `exclusive` 與 `throttle` 都以租戶區分（`singletonKey` 帶 `tenantId`），一個租戶的工作不會擋掉另一個租戶的。

## 2. 宣告與註冊

```ts
// modules/audit-log/audit-log-archive.job.ts
export const AUDIT_LOG_ARCHIVE_JOB = defineJob<Record<string, never>>('auditLog.archive', {
  exclusive: true,
  retryLimit: 3,
  retryDelaySeconds: 300,
  expireInSeconds: 60 * 60,
});

@Injectable()
export class AuditLogArchiveJob implements OnModuleInit {
  onModuleInit(): void {
    this.jobs.register(AUDIT_LOG_ARCHIVE_JOB, () => this.run(), {
      cron: this.config.get('AUDIT_LOG_ARCHIVE_CRON', { infer: true }),
    });
  }
}
```

| 規則 | 理由 |
| --- | --- |
| 名稱是 `<模組>.<動作>`（camelCase），`defineJob` 驗證格式 | 同時是 pg-boss 的佇列名稱；上線後 **不改名**，改名等於新佇列，舊佇列裡的工作沒人執行 |
| handler 在 `onModuleInit` 註冊；`onApplicationBootstrap` 統一建立佇列、啟動 worker 與排程 | 入列前佇列一定存在；啟動後才註冊直接拋錯 |
| 入列只能在啟動完成之後（HTTP 請求、其他工作裡） | 同上 |
| handler 回傳的物件存成工作的 `output` | 管理頁看得到「這一輪處理了幾筆」 |
| handler 拋錯 = 這次失敗，依設定重試 | 不要在 handler 裡吞例外；部分失敗記進回傳的報告即可（例：檔案維護的 `failures`） |

## 3. 重試與排程

`defineJob` 的預設：重試 5 次、第一次等 30 秒、指數退避、最多間隔 1 小時、一次最多執行 15 分鐘。

| 選項 | 意義 |
| --- | --- |
| `retryLimit` | 重試幾次；用完停在 `failed`，留在表內（直到超過 pg-boss 的保留期被清除）等管理頁手動重試 |
| `retryDelaySeconds` / `retryDelayMaxSeconds` | 退避的起點與上限 |
| `expireInSeconds` | 執行超過這個秒數視為失敗（worker 當掉也會被收回重試） |
| `deleteAfterSeconds` | 結束後在表裡保留幾秒（預設 7 天）；高流量的工作用 `HIGH_VOLUME_RETENTION_SECONDS`（1 天） |
| `exclusive` | 同時最多一筆排隊、一筆執行（pg-boss 的 `stately`）。排程工作用它避免越積越多；寄信這類每筆都要做的不能開 |
| `concurrency` | 這個程序同時執行幾筆（pg-boss 的 `localConcurrency`，預設 1）。寄信（`MAIL_JOB_OPTIONS`）是 5；吃 CPU／記憶體的工作維持 1，免得拖慢同一個程序上的 API |
| `ignoreTenantConcurrency` | 不受下面的「租戶的同時執行上限」限制、也不佔它的名額（預設 `false`）。只給使用者正在等、而且很快的工作：MFA 的驗證碼信（`mfa.emailCodeMail`，[`21-mfa.md`](./21-mfa.md) §9.2）與簡訊、Telegram、LINE 的驗證碼（`mfa.smsCode`、`mfa.telegramCode`、`mfa.lineCode`，§9.4、§9.5），公告大量寄信時不能被放回佇列 |

- **租戶的同時執行上限**：`concurrency` 是每個程序、每種工作的上限；另外每個租戶 **所有種類** 的工作同時執行的筆數不超過
  feature 參數 `job.maxConcurrency`（預設 10，平台管理者設定；[`architecture/05-tenancy.md`](../05-tenancy.md) §13.3 D9）。
  worker 取到租戶的工作後，`JobStore.activeAhead()` 在該租戶 `active` 的工作中依 `(started_on, id)` 排名（計數方式見下方「租戶的工作與 `group_id`」）；排在上限之後的
  以 `JobStore.requeue()` **放回佇列**（改回 `created`、`start_after` 延後 5～10 秒、不動重試次數、工作 id 不變），handler 不執行。
  pg-boss 完成工作時只更新 `active` 的列，handler 回傳後的完成是空操作。排程觸發的展開（沒有租戶）與平台工作不受限；
  `exclusive` 佇列已有一筆排隊時放不回去，這一筆以 `{ skipped: 'TENANT_CONCURRENCY' }` 結束。
- **租戶的工作與 `group_id`**：所有租戶的工作在同一張表（`pgboss.job`），送出時除了信封的 `tenantId`，也把租戶 id 寫進
  pg-boss 的 `group`（`group_id`）。`activeAhead()` 每一筆租戶工作開始前都要查，以主鍵 `(name, id)` 找到這一筆、以
  `name IN (已註冊的工作) AND group_id = 租戶 AND state = 'active'` 計數，走 pg-boss 內建的部分索引
  `job_i7 (name, group_id) WHERE state = 'active'`，成本與表的大小無關。管理頁的列表與計數也以 `group_id` 過濾（一般欄位，不必逐列解析 JSON）；
  `group_id` 是空的只有平台工作與開始帶 `group` 之前入列的舊工作，這些才看信封的 `tenantId`。worker 沒設 `groupConcurrency`，`group` 不影響取工作。
- `deleteAfterSeconds`：結束（完成、失敗、取消）後在表裡留幾秒，之後由 pg-boss 刪除，管理頁也就看不到了。預設 7 天；
  每個事件、每個人各一筆的高流量工作 `webhook.deliver`、`announcement.eventDispatch`、`announcement.fanOut` 是 1 天
  （`HIGH_VOLUME_RETENTION_SECONDS`），讓表維持在小的範圍。這三種失敗後也只留 1 天：webhook 另有投遞紀錄與重送，公告另有發送紀錄。
- `exclusive` 在佇列建立時決定，之後不能改；要改就換工作名稱。其他選項每次啟動同步到佇列（`deleteAfterSeconds` 只套用到之後入列的工作）。
- 排程（`cron`，UTC）由註冊時的 `{ cron }` 決定；空字串代表不排程，啟動時會移除之前的排程。
- 排程與 pg-boss 的維護（逾時收回、清除過期工作）只在執行工作的程序（`worker` 角色且 `JOBS_WORKER_ENABLED=true`）跑；
  pg-boss 以資料庫鎖保證多個程序同時開也只觸發一次。

| 工作 | 擁有者 | 排程（env） | 預設 |
| --- | --- | --- | --- |
| `auditLog.archive` | `modules/audit-log` | `AUDIT_LOG_ARCHIVE_CRON` | `30 3 * * *`（每天 03:30 UTC） |
| `file.maintenance` | `modules/file` | `FILE_MAINTENANCE_CRON` | `0 * * * *`（每小時整點） |
| `image.maintenance` | `modules/image` | `IMAGE_MAINTENANCE_CRON` | `30 * * * *`（每小時第 30 分；沒被使用的上傳、被換掉的圖、舊版本的變體、殘留物件，[`25-image.md`](./25-image.md) §15.6） |
| `gallery.maintenance` | `modules/gallery` | `GALLERY_MAINTENANCE_CRON` | `45 * * * *`（每小時第 45 分；逾時的上傳、過期的失敗紀錄、舊版本的變體、卡住的處理、殘留物件，[`26-gallery.md`](./26-gallery.md) §11.5） |
| `trash.purge` | `modules/trash` | `TRASH_PURGE_CRON` | `30 4 * * *`（每天 04:30 UTC；回收桶到期永久刪除，保留天數是系統設定 `trash.retentionDays`，[`13-trash.md`](./13-trash.md) §5） |
| `revision.prune` | `modules/revision` | `REVISION_PRUNE_CRON` | `45 4 * * *`（每天 04:45 UTC；版本歷史的保留清理，保留條件是系統設定 `revision.keepVersions`／`revision.keepDays`，[`14-revisions.md`](./14-revisions.md) §5） |
| `notification.cleanup` | `modules/notification` | `NOTIFICATION_CLEANUP_CRON` | `0 5 * * *`（每天 05:00 UTC；站內通知的保留清理：已讀超過 `notification.retentionDays` 天、每人超過 `notification.maxPerUser` 則的最舊通知，[`15-notification.md`](./15-notification.md) §8） |
| `webhook.cleanup` | `modules/webhook` | `WEBHOOK_CLEANUP_CRON` | `15 5 * * *`（每天 05:15 UTC；刪除超過 30 天的對外事件，投遞紀錄隨之刪除，[`17-webhook.md`](./17-webhook.md) §4） |
| `dataTransfer.cleanup` | `modules/data-transfer` | `DATA_TRANSFER_CLEANUP_CRON` | `25 5 * * *`（每天 05:25 UTC；到期的匯出檔與套用列、90 天前的傳輸紀錄，[`22-data-transfer.md`](./22-data-transfer.md) §10） |
| `dataTransfer.export`、`dataTransfer.applyImport` | `modules/data-transfer` | — | 由程式入列（建立匯出、送出套用時；[`22-data-transfer.md`](./22-data-transfer.md) §6.3、§7.6） |
| `file.imageVariants` | `modules/file` | — | 由程式入列：上傳完成的交易內、還原時變體遺失、維護排程補產生（[`09-file.md`](./09-file.md) §5.4）；每個 worker 程序並行 2 |
| `gallery.process` | `modules/gallery` | — | 由程式入列：完成上傳、從其他來源加入、調整顯示方向的交易內，清理排程重新排入卡住的；寫原檔、讀 EXIF、產生變體（[`26-gallery.md`](./26-gallery.md) §5）；每個 worker 程序並行 2 |
| `cdn.purge`（平台） | `core/storage` | — | 物件刪除 **之後** 由 `CdnPurger.schedule()` 入列（不在交易內：outbox 可能在刪除完成前就執行）；送到每一個邊緣節點，任一失敗整筆重試（5 次、30 秒起）。沒有 CDN 時不入列（[`09-file.md`](./09-file.md) §16.6） |
| `rateLimit.cleanup`（平台） | `core/rate-limit` | `RATE_LIMIT_CLEANUP_CRON` | `* * * * *`（每分鐘；共享的速率限制計數的過期列，記憶體實作時什麼都不做） |
| `auth.activationMail`、`auth.passwordResetMail` | `modules/credential` | — | 由程式入列（[`11-mail.md`](./11-mail.md) §4） |
| `platformAdmin.accountMail`（平台） | `modules/platform-admin` | — | 由程式入列：平台管理者的啟用信與重設密碼信（連結到 apps/platform、不帶 `?tenant=`；[`11-mail.md`](./11-mail.md) §4） |
| `approval.resultMail` | `modules/approval` | — | 由程式入列 |
| `announcement.dispatch` | `modules/announcement` | — | 送出、恢復、改時間的交易內入列，`startAfter` 是排定的時間；時間或狀態對不上就略過（[`19-announcement.md`](./19-announcement.md) §5） |
| `announcement.eventDispatch` | `modules/announcement` | — | 事件點：擁有者在業務交易內 `fire()` 時入列（`startAfter` = 現在＋延遲）；比對受眾後建立一個人的發送（[`19-announcement.md`](./19-announcement.md) §5.3） |
| `announcement.fanOut` | `modules/announcement` | — | 一次發送的分批寫入（每 500 人一個交易）；重做安全 |
| `announcement.maintenance` | `modules/announcement` | `ANNOUNCEMENT_MAINTENANCE_CRON` | `20 5 * * *`（每天 05:20 UTC；補排程與發送紀錄的保留清理，[`19-announcement.md`](./19-announcement.md) §5.2） |
| `webhook.deliver` | `modules/webhook` | — | 由 `WebhookService.emit()` 在業務交易內入列；重試 8 次、60 秒起退避、並行 10（[`17-webhook.md`](./17-webhook.md) §4） |
| `watch.notify` | `modules/comment` | — | 擁有者在業務交易內以 `WatchService.resourceChanged()` 入列（有人關注時；同一個資源 60 秒內一次）；通知關注者資源被修改（[`24-comment.md`](./24-comment.md) §4） |
| `oidc.cleanup`（平台） | `modules/oidc-provider` | `OIDC_CLEANUP_CRON` | `45 3 * * *`（每天 03:45 UTC；清除過期的 IdP 狀態） |
| `tenant.provisionSweep`（平台） | `modules/tenant` | — | `*/5 * * * *`（每 5 分鐘；佈建逾時仍在 `provisioning` 的租戶改成 `failed`，[`../05-tenancy.md`](../05-tenancy.md) §5） |
| `storage.totalRollup`（平台） | `modules/tenant` | `STORAGE_TOTAL_ROLLUP_CRON` | `*/5 * * * *`（每 5 分鐘；每個 `active` 租戶的已用量、止水線的通知，[`25-image.md`](./25-image.md) §12） |
| `tenant.usageRollup`（平台） | `modules/tenant` | `TENANT_USAGE_ROLLUP_CRON` | `5 * * * *`（每小時第 5 分；每個租戶的用量快照、儲存配額警示、刪除保留期限以前的日資料，[`../05-tenancy.md`](../05-tenancy.md) §5.4） |
| `auth.tokenCleanup`、`auth.platformTokenCleanup`（平台） | `modules/credential`、`modules/platform-admin`（平台） | `AUTH_TOKEN_CLEANUP_CRON` | `15 4 * * *`（每天 04:15 UTC；清除過期的 refresh token 與啟用／重設 token，[`04-auth.md`](./04-auth.md) §8） |
| `jobs.outboxSweep`（平台） | `core/jobs` | `JOBS_OUTBOX_SWEEP_CRON` | `*/10 * * * *`（每 10 分鐘；補搬各租戶 outbox 裡沒搬成的工作，§4.1） |

## 4. 入列

```ts
await withTransaction(this.db, async (tx) => {
  const user = await this.repo.create(input, tx);
  await this.audit.record({ … }, tx);
  await this.jobs.enqueue(SOME_JOB, { userId: user.id }, { tx });
});
```

- **業務寫入觸發的工作，入列一律傳 `tx`**（§9.2 D2）：資料提交了工作一定在，回滾則工作也不存在。
  與「稽核在交易內」同一條規則（[`01-architecture.md`](./01-architecture.md)）。
  例外是 `cdn.purge`：它要在物件 **真的刪掉之後** 才能執行，所以在刪除成功之後才入列，不傳 `tx`（[`09-file.md`](./09-file.md) §17 D3）。
- `throttle: { key, seconds }`：同一個 key 在同一個時間窗內只入列一筆，其餘回傳 `null`
  （例：忘記密碼同一帳號 60 秒一封）。對應 pg-boss 的 `singletonKey` ＋ `singletonSeconds`——
  單獨的 `singletonKey` 在 standard 佇列 **不起作用**，所以不開放單獨使用。
- **工作資料不放機密**（token、密碼、完整的信件內容）：`job:read` 看得到 `data`。需要時放 id，
  handler 執行時再取。
- 沒註冊的工作不能入列（拋 `Error`）：代表擁有它的模組沒有載入，屬於程式錯誤。

### 4.1 交易內入列：outbox

帶 `tx` 的入列寫進租戶 DB 的 `job_outbox`（同一個交易），回傳的 id 在提交後就是佇列裡的工作 id：

1. 交易提交後（`afterCommit`）立刻把目前租戶 outbox 裡的列搬進佇列並刪除（`SELECT … FOR UPDATE SKIP LOCKED`，一批 100 筆）。
   - **每個交易只登記一次搬移**：同一個交易入列幾筆都一樣，第一次搬移就把整個租戶的 outbox 搬完。
   - 一批依工作名稱分組，每組一次 pg-boss 的批次 `insert(name, jobs[])`，不是逐筆 `send`。
   - 同一種工作一次要入列很多筆時（例：公告的事件點，每則 × 每人一筆）用 `enqueueMany(type, items, { tx })`：一條多列 INSERT（每 1000 列一段）。
2. 搬移失敗或程序剛好在提交與搬移之間當掉：每 10 分鐘的 `jobs.outboxSweep` 走遍每個 `active` 租戶補搬。
   它會在每個租戶開一條連線，所以間隔要遠大於 `TENANT_POOL_IDLE_TIMEOUT`（30 秒），閒置租戶的連線池才會關掉
   （[`02-database.md`](./02-database.md) §6.2）。工作逾時或程序關閉時（`signal`）在兩批之間停下、不再進入下一個租戶。
   - 評估過「只進入有寫入的租戶」與「relay 移出交易」（2026-10-07），**都不做**：清掃要補救的正是「提交與搬移之間程序當掉」，
     這時程序記憶體裡的「有寫入的租戶」名單也一起消失；多實例時執行清掃的 worker 也看不到 api 程序記下的名單，要可靠就得另寫平台 DB，
     代價比每 10 分鐘進一次每個租戶大。relay 移出交易會失去 `SKIP LOCKED` 的互斥，尖峰時幾十個提交各自重送同一批到平台 DB。
3. 以 outbox 的 id 當 pg-boss 的工作 id：`send` 與批次 `insert` 用同一條 INSERT（`ON CONFLICT DO NOTHING`），
   送出後、刪除前當掉而重搬，也只會有一筆工作。
4. **沒有註冊 handler 的列**（工作已下線或改名；滾動部署時舊版程序清掃到只有新版認得的工作）：搬移只選已註冊的名稱，
   這些列不送、不刪、也不擋住後面的列。定期清掃每輪數一次，有的話每個租戶記一筆 warn（名稱與筆數）。
   要不要刪、或改名後搬回來由人決定：工作不能默默丟掉。

交易回滾時 outbox 的列跟著消失，工作不存在——與 §9.2 D2 的保證相同，只是多了「提交後最多一分鐘才入列」的極端情況。

## 5. Worker 的位置

| 部署 | 設定 |
| --- | --- |
| 單一容器（預設） | `APP_ROLES=all`：同一個程序處理 HTTP、推播與工作 |
| 拆開 | 同一個映像多起一個容器 `APP_ROLES=worker`；api 容器設 `APP_ROLES=http,realtime`（仍可入列）。角色見 [`../01-system.md`](../01-system.md) §7 |

`worker` 角色另外負責「整個系統做一次」的開機工作（為每個租戶補系統資料夾與個人資料夾）。
`JOBS_WORKER_ENABLED=false` 讓 `worker` 角色也只入列、不執行工作與排程（開機工作照做）：給測試與共用的 dev DB 用，不和別人的程序搶工作。

不另開 `apps/worker`：handler 需要 DI 裡的服務（`ObjectStorage`、之後的 `MailTransport`），
同一份程式碼、同一個映像最省事（§9.2 D4、D5）。關機時等執行中的工作結束（最多 30 秒），
沒結束的在 `expireInSeconds` 後由其他 worker 收回重試——handler 要能安全地重做。

## 6. 管理 API

| 端點 | 權限 | 說明 |
| --- | --- | --- |
| `GET /jobs/queues` | `job:read` | 已註冊的工作、排程、各狀態的 **即時** 筆數 |
| `GET /jobs` | `job:read` | 列表（`createdOn DESC`；`name`、`state` 篩選，都可以重複表示「其中任一個」：`?state=failed&state=retry`；不含 `data` / `output`） |
| `GET /jobs/:id` | `job:read` | 詳情（含 `data` 與 `output`；失敗時 `output` 是錯誤的 `message` / `stack`。資料庫的查詢錯誤在交給 pg-boss 之前換成只帶 SQL 本文與錯誤碼的版本，不含參數，[`03-api-conventions.md`](./03-api-conventions.md) §6） |
| `POST /jobs/:id/retry` | `job:retry` | 只接受 `failed`；重試成功後寫稽核 `job.retry` |

- 只列出程式有註冊的 **租戶** 工作，而且只看目前租戶的（信封的 `tenantId`）；平台工作、pg-boss 內部或已下線的佇列不出現。
- **平台的監控**（apps/platform 的 `/job`，[`architecture/05-tenancy.md`](../05-tenancy.md) §10.2 D23）是另一組端點
  `/platform/jobs/*`（`platformJob:read` / `platformJob:retry`，平台的權限目錄）：看得到所有租戶與平台自己的工作，
  列表多了 `tenantId` / `tenantCode`，`?tenant=<代碼>` 只看那個租戶、`?tenant=platform`（保留字）只看平台工作；
  佇列卡片的筆數是所有租戶合計，並標示 `scope`。重試寫平台稽核 `platformJob.retry`。
- 計數直接查表：`getQueues()` 的數字是 pg-boss 監控迴圈寫入的快照，最多落後一分鐘，重試完看不到數字變；而且只有整個佇列的合計，分不出租戶。
  租戶以 `group_id` 過濾（§3）。
- `JobStore` 是唯一直接讀 pg-boss 表結構的地方；升級 pg-boss 時對照它的 migration 檢查這個檔案。
- 重試以 `state = 'failed'` 為條件更新：兩個人同時按，後到的得到 `JOB_NOT_RETRYABLE`（409），不寫稽核。
  佇列在平台 DB、稽核在租戶 DB，兩者不在同一個交易：先重試、成功才寫稽核。

| 錯誤碼 | HTTP | 何時 |
| --- | --- | --- |
| `JOB_NOT_FOUND` | 404 | 沒有這筆工作、已超過保留期被清除，或不屬於已註冊的工作 |
| `JOB_NOT_RETRYABLE` | 409 | 不是 `failed`（等待、執行中、已完成），或被別人搶先重試 |

- 工作名稱在 OpenAPI 是 enum：`TenantJobName`（租戶的端點）與 `JobName`（平台的端點，全部的工作）。工作在執行期註冊，DTO 的 zod schema 只能寫 `string`，
  `buildOpenApiDocument()`（`src/swagger.ts`）產生文件時依已註冊的工作補上 `enum`。前端兩個 app 的 `JOB_NAME_LABEL_KEY`
  （`features/job/constants.ts`）以 `satisfies Record<TenantJobName | JobName, string>` 檢查：**新增工作要重產 openapi 與 SDK，並在兩個 app 補顯示名稱與兩個語系檔**，
  否則 typecheck 失敗（CI 也會擋 openapi 沒重產）。執行期遇到不認得的名稱（前端比後端舊）顯示名稱本身。

前端頁面 `/job`（`features/job`）：分成「工作列表」與「佇列概況」兩個分頁（網址的 `view`）；
「佇列概況」是每種工作一張卡片，只顯示各佇列的筆數，失敗總數掛在分頁上。依工作種類、狀態篩選走列表的篩選面板，兩者都是多選。展開列看資料與結果，
失敗的列有重試按鈕。工作在背景變化，頁面每 10 秒重新整理；展開中且還沒結束的工作詳情也跟著重取。

## 7. 設定

| 環境變數 | 預設 | 說明 |
| --- | --- | --- |
| `APP_ROLES` | `all` | 這個程序的角色；有 `worker` 才執行工作與排程（§5） |
| `JOBS_WORKER_ENABLED` | `true` | `worker` 角色裡是否真的執行工作與排程；`false` 只入列 |
| `JOBS_OUTBOX_SWEEP_CRON` | `*/10 * * * *` | 補搬 outbox 的排程（UTC）；空字串停用 |
| `AUDIT_LOG_ARCHIVE_CRON` | `30 3 * * *` | 稽核封存的排程（UTC）；空字串停用 |
| `FILE_MAINTENANCE_CRON` | `0 * * * *` | 檔案維護的排程（UTC）；空字串停用 |
| `TRASH_PURGE_CRON` | `30 4 * * *` | 回收桶到期永久刪除的排程（UTC）；空字串停用 |
| `REVISION_PRUNE_CRON` | `45 4 * * *` | 版本歷史保留清理的排程（UTC）；空字串停用 |
| `ANNOUNCEMENT_MAINTENANCE_CRON` | `20 5 * * *` | 公告的每日維護（補排程、發送紀錄保留清理）的排程（UTC）；空字串停用 |
| `DATA_TRANSFER_CLEANUP_CRON` | `25 5 * * *` | 匯入匯出的清理排程（UTC）；空字串停用 |
| `TENANT_USAGE_ROLLUP_CRON` | `5 * * * *` | 租戶用量快照的排程（UTC）；空字串停用 |
| `TENANT_USAGE_RETENTION_DAYS` | `400` | 租戶用量的日資料保留天數（最少 31） |

資料庫權限：pg-boss 啟動時要能在 `pgboss` schema 建表（第一次部署或升級 pg-boss 時）。
應用程式與維運拆成不同 role 的部署，先以有權限的 role 啟動一次，或用 `getConstructionPlans()`
產生的 SQL 預先建立。

## 8. 測試

| 測試 | 內容 |
| --- | --- |
| `test/jobs.spec.ts` | 真 Postgres ＋ worker：交易回滾時工作不存在、提交後被執行；失敗 → 管理 API 看得到原因 → 重試（寫稽核）→ 完成；非 failed 重試 409、查無 404；auditor 能看不能重試；`auditLog.archive` 實際執行 |
| `test/audit-log-tiering.spec.ts` | `archive_audit_logs()` 為 `SECURITY DEFINER`：沒有 DELETE 權限的 role 不能直接刪、但能透過函式搬移 |
| `test/route-audit.spec.ts` | 四個端點的權限宣告 |
| `src/modules/file/__tests__/file-maintenance.service.spec.ts` | 以 `FILE_MAINTENANCE_CRON` 註冊成排程工作 |
| `src/modules/trash/__tests__/trash.service.spec.ts`、`test/trash.spec.ts` | `trash.purge` 以 `TRASH_PURGE_CRON` 註冊、每批一個交易、外鍵略過、依設定的保留天數硬刪除 |
| `src/modules/revision/__tests__/revision.service.spec.ts`、`test/role-revisions.spec.ts` | `revision.prune` 以 `REVISION_PRUNE_CRON` 註冊、分批刪除、保留「最新 N 版」∪「N 天內」、依設定 |
| `src/modules/notification/__tests__/notification.service.spec.ts`、`test/notifications.spec.ts` | `notification.cleanup` 以 `NOTIFICATION_CLEANUP_CRON` 註冊、分批刪除、依設定刪除已讀過期與每人超過上限的通知 |

其他整合測試預設 `JOBS_WORKER_ENABLED=false`（`vitest.config.ts`）：排程與 worker 不在測試裡偷跑。

## 9. 設計決策：後端工作佇列 pg-boss，worker 先跑在 api 程序內

> 原 ADR-0016，2026-09-29 決定。D2、D3 的實作後來被 [`architecture/05-tenancy.md`](../05-tenancy.md) §10.2 D15 修改：
> 佇列在平台 DB，交易內入列改寫租戶 DB 的 outbox，提交後搬進佇列（§4.1）。

### 9.1 背景

決策當時後端沒有背景工作的機制：

- 稽核封存（`pnpm db:archive-audit-logs`）靠外部排程觸發，程式不知道它有沒有跑、跑成功沒
  （[`06-audit-log.md`](./06-audit-log.md) §6、§8）
- 上傳殘留清理（`FileMaintenanceService`，[`09-file.md`](./09-file.md) §9）是 api 內的 `setInterval`，失敗沒有紀錄可查
- 寄信（[`11-mail.md`](./11-mail.md)）、Webhook 投遞要重試，沒有地方放
- 大量匯出不能在 HTTP 請求內做完

[`frontend/07-ui-system.md`](../frontend/07-ui-system.md) §13 的前端批次佇列需要使用者開著分頁，不適合伺服器自己發起的工作。

### 9.2 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | 佇列用 **pg-boss** | 不增加元件；工作與業務資料在同一個資料庫，備份與還原一致 |
| D2 | 入列在業務交易 **內** | 與「稽核寫入在交易內」同一條規則：資料提交了，工作一定在；交易回滾，工作也不存在 |
| D3 | 用 pg-boss 內建的 `fromDrizzle` adapter 把 Drizzle（`postgres.js`）的交易交給 pg-boss 的 `db` 選項 | pg-boss 內部用 `pg`；不經 adapter 的話入列會走另一條連線，D2 不成立。提案時打算自己寫，實作時發現 pg-boss 12 已內建 |
| D4 | worker 先跑在 api 程序內，以 `JOBS_WORKER_ENABLED`（預設 `true`）開關 | 單一實例、compose 部署；handler 需要 DI 裡的服務（`ObjectStorage`、`MailTransport`），同一個程序最省事 |
| D5 | 要分開時用 **同一個映像** 多起一個容器，不另開 `apps/worker` | 程式碼只有一份；api 容器設 `JOBS_WORKER_ENABLED=false` 就只處理 HTTP |
| D6 | 模組各自註冊 handler，`core/jobs` 不 import `modules/` | 與審批 handler 同一個模式；守住 `core/` 不依賴 `modules/` |
| D7 | 排程（cron）也交給 pg-boss，稽核封存與上傳殘留清理搬進來 | pg-boss 的排程有分散式鎖，多實例下同一個排程只跑一次 |
| D8 | `archive_audit_logs()` 改成 `SECURITY DEFINER`（擁有者是擁有資料表的 role）；加 `SET search_path = public, pg_temp` | 應用程式 role 不需要 `audit_logs` 的 `DELETE`（[`06-audit-log.md`](./06-audit-log.md) §6 第 2 道防線不變），只能透過函式做熱 → 冷搬移；熱表的刪除 trigger 本來就要求冷表有相同副本 |
| D9 | `pnpm db:archive-audit-logs` 保留作為手動補跑入口 | 排程出問題時仍能手動處理；呼叫同一個函式，行為一致 |
| D10 | 權限 `job:read`、`job:retry`；手動重試寫稽核，工作本身的執行紀錄留在佇列表 | 執行紀錄量大且會清除，不適合放進不可變的稽核 |

### 9.3 取捨

| 代價 | 評估 |
| --- | --- |
| 佇列的讀寫壓力落在同一個 Postgres | 目前工作量（每天數百封信、每天一次封存）遠低於 pg-boss 的承載；量大時再評估 |
| handler 與 HTTP 共用 CPU（例：影像處理） | 會拖慢 API 時照 D5 拆成獨立容器，不必改程式 |
| `SECURITY DEFINER` 函式寫錯會變成提權的入口 | 函式只接受時間與批次大小、不組動態 SQL，並固定 `search_path`；整合測試證明沒有 DELETE 的 role 只能透過它搬移 |
| 管理頁直接讀 pg-boss 的表結構 | 只在 `core/jobs/job-store.ts` 一處；升級 pg-boss 時對照它的 migration |
| 引入 [`../01-system.md`](../01-system.md) §7 的 Redis 後，可能想改用 BullMQ | 那時再開新的設計決策；handler 介面在 `core/jobs`，換底層不影響模組 |

### 9.4 評估過的方案

| 方案 | 結論 |
| --- | --- |
| **A. pg-boss**（Postgres 當佇列） | **採用** |
| B. BullMQ（Redis） | 不採用：多一個 Redis 要部署、備份、監控；入列無法與 Postgres 的業務交易一致 |
| C. 自製 outbox 表 ＋ 輪詢 | 不採用：重試、退避、排程、分散式鎖都要自己寫，pg-boss 已經做好 |
| D. 繼續用外部 cron | 不採用：只解決排程，不解決重試；執行結果仍然看不到 |

### 9.5 實作紀錄

| 項目 | 提案 | 實作 | 原因 |
| --- | --- | --- | --- |
| D3 的 adapter | 自己寫 | pg-boss 內建的 `fromDrizzle` | 已有現成、維護在上游 |
| D8 的 `EXECUTE` | 只授給應用程式 role | 維持預設的 `PUBLIC` | role 名稱依部署而定，migration 無法指名；拆分 role 的部署自行 `REVOKE` 後再 `GRANT`。呼叫端只能決定 cutoff 與批次大小，搬過去的紀錄仍查得到 |
| 管理頁的計數 | pg-boss 的 `getQueues()` | 直接數 `pgboss.job` | `getQueues()` 是監控迴圈寫入的快照，最多落後一分鐘；重試完看不到數字變 |
| 檔案維護的間隔 | `FILE_MAINTENANCE_INTERVAL`（秒） | `FILE_MAINTENANCE_CRON` | pg-boss 的排程是 cron；舊變數移除 |
