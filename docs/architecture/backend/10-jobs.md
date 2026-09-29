# 10 — 背景工作

伺服器自己發起、要重試或定時執行的工作：稽核封存、檔案維護，以及之後的寄信、Webhook、匯出。
底層是 [pg-boss](https://github.com/timgit/pg-boss)（Postgres 當佇列），選型理由見
[ADR-0016](../../adr/0016-background-jobs.md)。

前端的批次佇列（[ADR-0012](../../adr/0012-batch-queue-worker.md)）是「使用者開著分頁時逐筆呼叫 API」，
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

- `core/jobs` 不認識任何業務工作；模組自己宣告、自己註冊（ADR-0016 D6，與審批 handler 同一個模式）。
- pg-boss 的表在 `pgboss` schema，由 pg-boss 自己在啟動時建立與升級，不進 Drizzle 的 migration。
- pg-boss 用自己的 `pg` 連線池（4 條）；業務交易內的入列走 pg-boss 內建的 `fromDrizzle` adapter，
  使用該交易的連線。

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
| `exclusive` | 同時最多一筆排隊、一筆執行（pg-boss 的 `stately`）。排程工作用它避免越積越多；寄信這類每筆都要做的不能開 |

- `exclusive` 在佇列建立時決定，之後不能改；要改就換工作名稱。其他選項每次啟動同步到佇列。
- 排程（`cron`，UTC）由註冊時的 `{ cron }` 決定；空字串代表不排程，啟動時會移除之前的排程。
- 排程與 pg-boss 的維護（逾時收回、清除過期工作）只在 `JOBS_WORKER_ENABLED=true` 的程序跑；
  pg-boss 以資料庫鎖保證多個程序同時開也只觸發一次。

| 工作 | 擁有者 | 排程（env） | 預設 |
| --- | --- | --- | --- |
| `auditLog.archive` | `modules/audit-log` | `AUDIT_LOG_ARCHIVE_CRON` | `30 3 * * *`（每天 03:30 UTC） |
| `file.maintenance` | `modules/file` | `FILE_MAINTENANCE_CRON` | `0 * * * *`（每小時整點） |

## 4. 入列

```ts
await withTransaction(this.db, async (tx) => {
  const user = await this.repo.create(input, tx);
  await this.audit.record({ … }, tx);
  await this.jobs.enqueue(SOME_JOB, { userId: user.id }, { tx });
});
```

- **業務寫入觸發的工作，入列一律傳 `tx`**（ADR-0016 D2）：資料提交了工作一定在，回滾則工作也不存在。
  與「稽核在交易內」同一條規則（[`01-architecture.md`](./01-architecture.md)）。
- `singletonKey`：同一個 key 同時只有一筆等待中的工作（重複入列回傳 `null`）。
- **工作資料不放機密**（token、密碼、完整的信件內容）：`job:read` 看得到 `data`。需要時放 id，
  handler 執行時再取。
- 沒註冊的工作不能入列（拋 `Error`）：代表擁有它的模組沒有載入，屬於程式錯誤。

## 5. Worker 的位置

| 部署 | 設定 |
| --- | --- |
| 單一容器（目前） | api 預設 `JOBS_WORKER_ENABLED=true`：同一個程序處理 HTTP 與工作 |
| 拆開 | 同一個映像多起一個容器當 worker；api 容器設 `JOBS_WORKER_ENABLED=false`（仍可入列） |

不另開 `apps/worker`：handler 需要 DI 裡的服務（`ObjectStorage`、之後的 `MailTransport`），
同一份程式碼、同一個映像最省事（ADR-0016 D4、D5）。關機時等執行中的工作結束（最多 30 秒），
沒結束的在 `expireInSeconds` 後由其他 worker 收回重試——handler 要能安全地重做。

## 6. 管理 API

| 端點 | 權限 | 說明 |
| --- | --- | --- |
| `GET /jobs/queues` | `job:read` | 已註冊的工作、排程、各狀態的 **即時** 筆數 |
| `GET /jobs` | `job:read` | 列表（`createdOn DESC`；`name`、`state` 篩選；不含 `data` / `output`） |
| `GET /jobs/:id` | `job:read` | 詳情（含 `data` 與 `output`；失敗時 `output` 是錯誤的 `message` / `stack`） |
| `POST /jobs/:id/retry` | `job:retry` | 只接受 `failed`；稽核 `job.retry` 與重試在同一個交易 |

- 只列出程式有註冊的工作；pg-boss 內部或已下線的佇列不出現。
- 計數直接查表：`getQueues()` 的數字是 pg-boss 監控迴圈寫入的快照，最多落後一分鐘，重試完看不到數字變。
- `JobStore` 是唯一直接讀 pg-boss 表結構的地方；升級 pg-boss 時對照它的 migration 檢查這個檔案。
- 重試以 `state = 'failed'` 為條件更新：兩個人同時按，後到的得到 `JOB_NOT_RETRYABLE`（409），
  稽核跟著回滾。

| 錯誤碼 | HTTP | 何時 |
| --- | --- | --- |
| `JOB_NOT_FOUND` | 404 | 沒有這筆工作、已超過保留期被清除，或不屬於已註冊的工作 |
| `JOB_NOT_RETRYABLE` | 409 | 不是 `failed`（等待、執行中、已完成），或被別人搶先重試 |

前端頁面 `/job`（`features/job`）：工作種類卡片（點卡片篩選）＋ 列表；展開列看資料與結果，
失敗的列有重試按鈕。工作在背景變化，頁面每 10 秒重新整理；展開中且還沒結束的工作詳情也跟著重取。

## 7. 設定

| 環境變數 | 預設 | 說明 |
| --- | --- | --- |
| `JOBS_WORKER_ENABLED` | `true` | 這個程序是否執行工作與排程；`false` 只入列 |
| `AUDIT_LOG_ARCHIVE_CRON` | `30 3 * * *` | 稽核封存的排程（UTC）；空字串停用 |
| `FILE_MAINTENANCE_CRON` | `0 * * * *` | 檔案維護的排程（UTC）；空字串停用 |

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

其他整合測試預設 `JOBS_WORKER_ENABLED=false`（`vitest.config.ts`）：排程與 worker 不在測試裡偷跑。
