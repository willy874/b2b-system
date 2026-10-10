# 平台總覽與系統狀態

- 優先度：P1
- 狀態：提案
- 依賴：租戶用量與儲存止水線（[`05-tenancy.md`](../architecture/05-tenancy.md) §5.4、§14；[`backend/25-image.md`](../architecture/backend/25-image.md) §12）；
  CDN 的檢查（[`backend/09-file.md`](../architecture/backend/09-file.md) §16.10）；平台的背景工作列表（`modules/job` 的 `PlatformJobService`）；
  租戶的 migration 與版本檢查（[`05-tenancy.md`](../architecture/05-tenancy.md) §4、[`backend/02-database.md`](../architecture/backend/02-database.md) §5.3）；
  程序角色（[`01-system.md`](../architecture/01-system.md) §4.3、§4.4）
- 相關：[`platform-job-management.md`](./platform-job-management.md)（失敗工作的取消、批次重試；本功能只連過去）、
  [`tenant-plans.md`](./tenant-plans.md)（配額來自方案時，配額警示跟著改）、[`tenant-lifecycle.md`](./tenant-lifecycle.md)（試用到期、排程清除也是「要處理的事」）、
  [`maintenance-broadcast.md`](./maintenance-broadcast.md)（「維護」一詞的區分，見開放問題 6）、[`platform-dual-approval.md`](./platform-dual-approval.md)（重跑 migration 是否要覆核）、
  [`08-monitoring.md`](../architecture/08-monitoring.md)（與 Grafana 的分工）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

apps/platform 的首頁（[`apps/platform/src/features/home/pages/Home/page.tsx`](../../apps/platform/src/features/home/pages/Home/page.tsx)）只有「目前登入的身分」與
`TenantOverview`（各狀態的租戶數，用租戶清單端點 `limit: 1` 取 `pagination.total`）。要處理的事散落在各處，而且有些根本看不到：

| 情境 | 現在的做法 | 問題 |
| --- | --- | --- |
| 有租戶佈建失敗 | 首頁的「失敗」數字變紅、平台通知 `tenant.provisionFailed` | 要點進租戶清單再篩選，才看得到是哪個、`provision_error` 寫什麼 |
| 部署後某個租戶的 migration 失敗，整個租戶回 `503 TENANT_UNAVAILABLE` | `db:migrate` 的輸出、api 啟動時的 error log、Grafana 告警 `TenantUnavailable` | 「落後」不是租戶狀態（`TenantUnavailableReason` 的 `maintenance`，`core/tenant/tenancy.service.ts`），只存在各程序的記憶體；畫面上的租戶仍是 `active`。修好後要有 shell 的人重跑 `pnpm db:migrate`（跑全部租戶） |
| 所有租戶的儲存量接近止水線 | 租戶清單上方的合計、平台通知 `storage.totalNearLimit` | 首頁看不到；通知已讀之後就沒有提醒 |
| 某個租戶的儲存接近配額 | 清單的用量欄標成警示、平台通知 `tenant.storageNearQuota` | 要依 `storageUsage` 排序才找得到 |
| 邊緣節點故障、kid 不一致 | CDN 頁面的「最近一次檢查」、告警 `CdnEdgeDown` | 不打開 CDN 頁面就不知道；沒有平台通知 |
| 背景工作失敗、佇列積壓 | 背景工作頁的佇列表、告警 `JobBacklog`／`JobFailures` | 同上 |
| 確認「現在跑的是哪一版、有幾個程序、各自是什麼角色、有沒有在排空」 | 看 k8s／compose、Grafana | 平台管理者不一定有那些權限；健康檢查（`modules/health`）不回版本與角色；api 容器沒有拿到 `APP_RELEASE`（見文末「研究備註」） |

[`08-monitoring.md`](../architecture/08-monitoring.md) §6.3 的告警都已經有了，但 **還沒有通知管道**，而且 Grafana 是看「系統」的工具：
指標刻意不帶租戶（§2.3），也不能在上面做動作。平台管理者缺的是 **一頁列出「我現在要處理什麼」，並直接連到能處理它的地方**。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 首頁改成總覽：「需要處理」清單（§1）、租戶數的趨勢、用量排行；每一項依權限顯示 | 重做 Grafana 的圖表（延遲、錯誤率、連線數、event loop）；頁面上只放連結（`GRAFANA_URL` 有設時） |
| 「需要處理」的來源：佈建失敗與佈建中過久、migration 落後、儲存止水線、租戶配額警示、CDN 檢查失敗、背景工作失敗與積壓 | 自訂告警規則、門檻設定畫面；門檻沿用各功能既有的常數 |
| 新頁面「系統狀態」：程序實例（角色、版本、啟動時間、readiness、排空中）、每個租戶的 schema 版本 | 從畫面重啟、擴縮程序（屬於部署） |
| 從畫面對 **單一租戶** 重跑租戶 migration（背景工作，與 `db:migrate`、佈建共用 `migrateTenantDatabase` 並加鎖） | 從畫面跑平台 DB 的 migration、一次重跑所有租戶（仍是部署流程的 `migrate`） |
| 程序實例的心跳（平台 DB） | 背景工作的取消、批次重試、暫停（[`platform-job-management.md`](./platform-job-management.md)） |
| 新的平台權限與稽核 | 給租戶管理者的系統狀態（backstage） |

## 使用者故事

**作為值班的平台管理者，我希望一登入就看到要處理的事，以便不必逐頁巡視。**

- **Given** 一個租戶佈建失敗、CDN 的一個節點 kid 不一致、`image.process` 有 12 筆失敗
- **When** 我打開 apps/platform 首頁
- **Then** 「需要處理」依嚴重度列出三項，每項有一句說明與「前往」：佈建失敗連到那個租戶（顯示 `provision_error` 的摘要）、CDN 連到 CDN 頁面、背景工作連到篩好 `failed` 的背景工作列表

**作為平台管理者，我希望部署後 migration 失敗的租戶修好之後，自己在畫面上重跑，以便不必找有主機權限的人。**

- **Given** 租戶 A 的 DB 在部署時連不上，`db:migrate` 略過它，api 對它回 503
- **When** 我在系統狀態頁看到它「落後 2 個 migration」，DB 恢復後按「重跑 migration」並確認
- **Then** 排入平台工作 `tenant.migrate`，完成後每個程序在 30 秒內（`schemaStateOf` 的重新檢查）恢復服務；平台稽核記下是誰、從哪一版到哪一版

**作為平台管理者，我希望滾動部署時看到新舊版本各有幾個程序，以便判斷部署是否卡住。**

- **Given** cluster 模式，`api`×3、`api-realtime`×2、`api-worker`×1，正在換版
- **When** 我打開系統狀態頁
- **Then** 每個程序一列：角色、版本、啟動時間、最後心跳、readiness（`ok`／`degraded`／排空中）；超過心跳逾時沒更新的列標成「失聯」，一天後消失

**作為 auditor，我希望總覽只出現我能看、能前往的東西，以便不會點進去才看到 403。**

- **Given** 我的角色只有各種 `:read`（[`iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md) §8.2），沒有 `tenant:migrate`
- **When** 我打開首頁與系統狀態頁
- **Then** 「需要處理」照常列出、「前往」照常；系統狀態頁的「重跑 migration」不出現。之後新增的角色缺某個 `:read` 時，對應的項目整個不出現（伺服器端也不算）

## 初步構想

### 1. 「需要處理」的來源

| 項目 | 資料從哪來（現有／新增） | 嚴重度 | 前往 | 需要的權限 |
| --- | --- | --- | --- | --- |
| 佈建失敗 | 現有：`tenants.status = 'failed'`、`provision_error` | 高 | 租戶詳情（重試在那裡） | `tenant:read` |
| 佈建中超過 15 分鐘 | 現有：`provisioning` 且 `created_at` 夠舊（`tenant.provisionSweep` 之前的空窗） | 中 | 同上 | `tenant:read` |
| migration 落後（`maintenance`） | **新增**：每個租戶的 schema 版本要能從平台查（§3） | 高 | 系統狀態頁的租戶 schema 區塊 | `system:read` |
| 儲存止水線 ≥ 80% | 現有：`StorageTotalService`（`GET /platform/tenants/storage-total`） | 80% 中、100% 高 | 租戶清單 | `tenant:read` |
| 租戶配額 ≥ 80% | 現有：`tenant_usage_daily` 最近一次快照（同清單的 `storageUsage` 排序） | 中 | 租戶清單，依 `storageUsage` 降冪 | `tenant:read` |
| CDN 檢查失敗 | 現有：`cdn_settings.last_check`（`cdn.healthCheck` 每 5 分鐘寫入） | 項目 5 最高、1–3 高、4 中 | CDN 頁面 | `cdn:read` |
| 背景工作失敗 | 現有：`JobStore.counts`（`failedCount`，保留期內）；**新增**「最近 24 小時」的界線 | 中 | 背景工作列表（`state=failed`、`name=`） | `platformJob:read` |
| 佇列積壓 | 現有：`readyCount`（同告警 `JobBacklog` 的 500 筆） | 中 | 背景工作頁的佇列表 | `platformJob:read` |
| 程序失聯、版本不一致超過 N 分鐘 | **新增**：心跳表（§2） | 中 | 系統狀態頁 | `system:read` |

- 端點 `GET /platform/overview`（`@Authenticated()`，每一節在 service 裡依權限決定要不要算）：回 `{ attention: AttentionItem[], tenants, trend, rankings }`。
  `AttentionItem` 只有 `kind`、`severity`、`count`、少量 `params`（租戶代碼、工作名稱）與前往的 route id；文案在前端。
- 總覽 **不新建狀態**：每一項都是即時查詢或讀既有的快照，不存「已處理」。處理完來源消失，項目就消失（開放問題 3）。
- 趨勢：`tenant_usage_daily` 每天有快照的租戶數就是「當天 `active` 的租戶數」（`tenant.usageRollup` 只走 `active`）；加上 `tenants.created_at`／`deleted_at` 算每天的新增與刪除。
  近 30／90 天，不另建表。排行：沿用 `GET /platform/tenants` 的 `sort`（`usersActive`、`storageUsage`、`recentRequests`）各取前 5，前端直接呼叫，不另開端點。
- 首頁保留「目前登入的身分」，移到頁面最下方或帳號選單（開放問題 7）。

### 2. 程序實例：心跳表（平台 DB）

`platform_process_instances`：

| 欄位 | 說明 |
| --- | --- |
| `id` | `BroadcastService.instanceId`（每個程序啟動時的 `randomUUID()`，已用來濾掉自己送的廣播） |
| `surface` | `internal`／`external`（`API_SURFACE`） |
| `roles` | `text[]`（`processRolesOf` 的結果；對外 API 固定 `http`） |
| `release` | `APP_RELEASE`（沒設是 `unknown`） |
| `hostname`、`pid` | 容器名稱或 Pod 名稱，給人辨識 |
| `tenant_migration` | 這個程序的 `EXPECTED_TENANT_MIGRATION`：滾動部署時看得出新舊程式各期待哪一版 |
| `started_at`、`last_seen_at` | |
| `ready` | 最近一次自我檢查的結果：`ok`／`degraded`／`draining`，與 `HealthService.ready()` 同一套檢查 |

- 每個程序每 30 秒 `INSERT … ON CONFLICT (id) DO UPDATE`；排空開始時立刻寫一次 `draining`，正常結束時刪除自己那一列。
- `last_seen_at` 超過 90 秒標「失聯」；超過一天的列由既有的平台清理工作（或新的 `system.instanceCleanup`）刪除。
- 為什麼不用 `BroadcastService`：它是 `LISTEN`／`NOTIFY`、fire-and-forget、沒有請求／回應（[`01-system.md`](../architecture/01-system.md) §4.4），
  收集「誰還活著」要另做一套回覆與等待；也看不到已經死掉的程序。比較見開放問題 1。

### 3. 每個租戶的 schema 版本

現在 `Tenancy.schemaStateOf` 的結果只在各程序的記憶體（`schemaChecks`），`appliedTenantMigration` 在每次需要時連進租戶 DB 查。系統狀態頁要列出所有租戶時有兩條路（開放問題 2）：

- **A. 即時查**：`GET /platform/system/tenant-schemas` 依序連進每個未刪除、非佈建中的租戶查 `drizzle.__drizzle_migrations`，限並行數；租戶多時慢，而且會打開所有租戶的連線池。
- **B. 平台 DB 記錄**（傾向）：`tenants` 加 `schema_version`（bigint，可為 null）與 `schema_checked_at`；`migrateTenantDatabase` 成功後、佈建成功後、
  以及每個程序的 `schemaStateOf` 實際查過 DB 之後寫回（只在值改變時寫）。頁面以它對照「最新的程序的 `tenant_migration`」顯示落後幾個（journal 的 `when` 換算成筆數）。

### 4. 從畫面重跑單一租戶的 migration

`POST /platform/tenants/:id/migrate`（新權限 `tenant:migrate`）→ `202 { jobId }`，排入平台工作 `tenant.migrate`（`scope: 'platform'`，以租戶 id 當 singleton key，不自動重試）。

| 風險 | 現況 | 對策 |
| --- | --- | --- |
| 與 `db:migrate`、佈建、另一個 `tenant.migrate` 同時跑 | drizzle 0.45 的 migrator 在交易 **外** 讀最後一筆紀錄、沒有鎖；兩邊同時跑可能重複套用（`IF NOT EXISTS` 的語句會靜靜成功、紀錄重複） | `migrateTenantDatabase`（`db/provision.ts`）先在租戶 DB 取 `pg_advisory_lock`（advisory lock 以 database 區分，各租戶互不影響），三條路徑一起受惠；取不到時等候有上限，逾時回「另一個 migration 正在進行」 |
| worker 的程式版本與 http 不同（滾動部署中） | 工作由某個 worker 執行，套用的是 **它的** journal | 工作記下執行者的 `release` 與 `EXPECTED_TENANT_MIGRATION`；比租戶 DB 舊時不做事（`{ skipped: 'olderCode' }`）。新版的 worker 先跑沒有問題：migration 本來就要對上一版相容（[`01-system.md`](../architecture/01-system.md) §4.3） |
| 長時間的鎖擋住租戶的請求 | 落後的租戶本來就回 503；但「DB 比程式新」的情況不該被觸發 | 只接受 `active`／`disabled` 且 schema 落後（或從沒跑過）的租戶，否則 `409 TENANT_SCHEMA_CURRENT`；佈建中、失敗的走「重試佈建」 |
| 連線與逾時 | api 的租戶連線池有 `statement_timeout`（預設 15 秒，[`backend/02-database.md`](../architecture/backend/02-database.md) §6.2）；同一節說上 PgBouncer 時改成 `ALTER ROLE … SET`，腳本連線也會繼承 | 照 `migrateTenantDatabase` 現在的做法另開一條腳本連線（`createScriptClient`），不用 api 的池，並在連線上 `SET statement_timeout = 0`；工作的逾時比照 `tenant.provision` |
| PgBouncer 的 transaction mode | session 層的 advisory lock 在 transaction mode 下會落到別的伺服器連線 | migration 一律直連租戶的 postgres（不經 PgBouncer）；或不用 drizzle 的 migrator，自己在單一交易內 `pg_advisory_xact_lock` 後再讀最後一筆紀錄（開放問題 9） |
| 失敗的影響 | migrator 整批在一個交易內，失敗全部回滾；`ensureExtensions` 在交易外但冪等 | 失敗時工作停在 `failed`、記錯誤摘要，平台通知（新類型 `tenant.migrationFailed`）給有 `tenant:migrate` 的人 |
| 誤操作 | — | 確認框列出目前版本 → 目標版本與待套用的 migration 數；稽核 `tenant.migrate`（`severity: high`）。是否要雙人覆核見開放問題 5 |

完成後呼叫 `Tenancy` 讓本機的 `schemaChecks` 失效；其他程序靠 30 秒的重新檢查（或加一個廣播，開放問題 4）。

### 5. 權限（平台的目錄）

| 權限鍵 | 顯示名稱 | 說明 | `super-admin` | `operator` | `auditor` |
| --- | --- | --- | :-: | :-: | :-: |
| `system:read` | 檢視系統狀態 | 系統狀態頁：程序實例、租戶的 schema 版本；總覽的對應項目 | ✅ | ✅ | ✅ |
| `tenant:migrate` | 重跑租戶 migration | 對單一租戶排入 `tenant.migrate`；寫平台稽核 | ✅ | 開放問題 5 | |

總覽本身不需要新權限（首頁的 page key 維持 `access: []`），各區塊沿用 `tenant:read`、`cdn:read`、`platformJob:read`、`system:read`。

### 6. 稽核、通知、推播

- 平台稽核：`tenant.migrate`（`tenantId`、`from`、`to`、`jobId`），在入列的同一個平台 DB 交易內。工作的結果不另寫稽核（看背景工作列表）。
- 平台通知：新增 `tenant.migrationFailed`；是否為 CDN 檢查失敗、程序失聯另加通知類型見開放問題 3。
- 總覽不推播，前端以 `refetchInterval`（例：60 秒）重抓；切到別的分頁時暫停。

### 7. 會動到的既有檔案

| 位置 | 改動 |
| --- | --- |
| `apps/platform/src/features/home` | 首頁改成總覽：`AttentionList`、`TenantTrend`、`UsageRankings`；`TenantOverview` 併入；測試補三種角色的區塊顯示 |
| `apps/platform/src/features/system`（新） | 系統狀態頁（route `/system`，側欄 `NavGroupKey.SYSTEM`，與稽核、背景工作、CDN 一起） |
| `apps/api/src/modules/platform-overview`（新） | `GET /platform/overview`、`GET /platform/system/instances`、`GET /platform/system/tenant-schemas`；讀 `PlatformTenantService`、`StorageTotalService`、`PlatformJobService`、`PlatformCdnSettingsService` 的 exports |
| `apps/api/src/modules/tenant` | `POST /platform/tenants/:id/migrate`、平台工作 `tenant.migrate`（與 `tenant-provisioner.ts` 同一層） |
| `apps/api/src/db/provision.ts` | `migrateTenantDatabase` 加 advisory lock；回傳套用前後的版本 |
| `apps/api/src/core/tenant/tenancy.service.ts`、`tenant-schema.ts` | 方案 B 時寫回 `tenants.schema_version`；提供單一租戶的檢查失效 |
| `apps/api/src/core/lifecycle` 或新的 `core/instance` | 心跳的寫入、排空時標記 |
| `apps/api/src/db/platform/schema` | `platform_process_instances`；`tenants.schema_version`、`schema_checked_at`（下一個平台 migration） |
| `apps/api/src/modules/platform-notification/platform-notification.constants.ts` | `tenant.migrationFailed`（apps/platform 的 `features/notification` 補文案） |
| `docker-compose.prod.yml`、`deploy/k8s`、`deploy/prod.env.example` | api、api-worker、api-realtime、external-api 都帶 `APP_RELEASE` |
| `apps/api/src/db/seeds/platform-permissions.ts`、[`iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md) §8、apps/platform 兩個語系檔 | `system:read`、`tenant:migrate` |

## 開放問題

進入「規劃中」之前，每一條都要有結論（寫在該條下方，不要刪掉問題）。

1. **程序實例怎麼收集？** A. 平台 DB 的心跳表（§2）：簡單、看得到失聯的程序，代價是每個程序每 30 秒一次寫入（10 個程序每天約 3 萬筆 upsert，量很小）。
   B. `BroadcastService` 的 ping／pong：不寫 DB，但要新做請求／回應與等待時間，失聯的程序就是「沒回」，分不出是死了還是 `NOTIFY` 掉了。
   C. 向 Prometheus 查 `up{job="api"}`：重用既有的抓取，但 `MONITORING_ENABLED=false` 的部署就沒有，也讓 api 依賴監控。傾向 A。
2. **租戶的 schema 版本即時查還是記在平台 DB？**（§3 的 A／B）傾向 B：總覽與狀態頁都只讀平台 DB，不必連進每個租戶；代價是 `tenants` 多兩欄、寫回的時機要寫清楚，而且只有被進入過的租戶會更新（`disabled` 的租戶要靠 `db:migrate` 或手動「重新檢查」）。
3. **「需要處理」要不要有已讀／略過，與平台通知怎麼分工？** A. 總覽完全即時，不存狀態；通知負責「越過門檻的那一刻」。B. 總覽的項目可以「略過到下次變化」，存在 `platform_admins` 的偏好。
   另外 CDN 檢查失敗、程序失聯、migration 落後要不要也發平台通知（現在只有 Grafana 告警，而 Grafana 還沒有通知管道）。傾向 A，並只為「要人動手」的 migration 落後與 migration 失敗加通知。
4. **重跑完成後其他程序怎麼恢復？** A. 靠既有的 30 秒重新檢查。B. 加廣播頻道（例：`tenant_schema`）讓各程序立刻清掉那個租戶的 `schemaChecks`。傾向 A：30 秒可接受，少一個頻道。
5. **`tenant:migrate` 給誰？要不要雙人覆核？** 給 `operator`：值班的人能自己恢復租戶；只給 `super-admin`：DDL 是全部操作中最難回復的。
   若 [`platform-dual-approval.md`](./platform-dual-approval.md) 先做，重跑 migration 是否列為要覆核的操作。傾向給 `operator`、不覆核：只套用程式本來就要求的 migration，落後的租戶本來就停擺。
6. **「維護」這個字怎麼用？** 程式裡 `maintenance` 指「migration 落後或 DB 連不上」（`TenantUnavailableReason`），[`maintenance-broadcast.md`](./maintenance-broadcast.md) 的「維護時段」是平台管理者排定的。
   畫面上是否把這裡改稱「schema 落後」／「暫時無法連線」，與排定的維護區分；要不要把 `TenantUnavailableReason` 拆成兩種（`schemaBehind`、`unreachable`）好在總覽分開顯示。
7. **首頁的取捨**：總覽取代首頁，還是另開 `/overview`、首頁保留「目前登入的身分」？沒有任何總覽權限的人（理論上不存在，三個角色都有 `tenant:read`）看什麼？傾向取代首頁，身分資訊移到最下方。
8. **Grafana 的連結**：加 `GRAFANA_URL`（apps/platform 的執行期設定）讓總覽與系統狀態頁連到對應儀表板？還是完全不提 Grafana，避免平台管理者以為那是他們該看的地方？
9. **鎖放在哪一層？** A. 包住 drizzle 的 migrator：在同一條直連的 session 先 `pg_advisory_lock`、跑完 `pg_advisory_unlock`；改動最小，但要求連線不經 PgBouncer。
   B. 自己實作 migrator（讀 journal、在一個交易內 `pg_advisory_xact_lock` → 讀最後一筆 → 套用）：經 PgBouncer 也安全，但要自己維護與 drizzle 相同的紀錄格式（`created_at` = journal 的 `when`），`tenant-schema.ts` 依賴它。
   傾向 A，並在 `db:migrate`、佈建、`tenant.migrate` 三處都只用租戶的直連位址。

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

完成後預計寫成：

- [`05-tenancy.md`](../architecture/05-tenancy.md)：§4 加「從畫面重跑單一租戶」與鎖；§5 的生命週期表加 `POST /platform/tenants/:id/migrate`；設計決策另開一章
- [`01-system.md`](../architecture/01-system.md) §4.3：程序實例的心跳；[`08-monitoring.md`](../architecture/08-monitoring.md)：與 Grafana 的分工、`APP_RELEASE`
- [`backend/02-database.md`](../architecture/backend/02-database.md) §5.3：schema 版本記到平台 DB、advisory lock
- [`iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md) §8：`system:read`、`tenant:migrate`
- [`apps/platform/README.md`](../../apps/platform/README.md) 的頁面清單：總覽與系統狀態頁

## 研究備註（寫提案時發現的現況）

- `maintenance` 不是租戶狀態：`tenant_status` 只有 `provisioning`／`active`／`disabled`／`failed`，落後只在各程序的記憶體與 log、指標 `api_tenant_unavailable_total{reason}`。
- `docker-compose.prod.yml` 只把 `APP_RELEASE` 給 backstage 與 platform；api 的 `instrumentation.ts` 讀它當 `service.version`，所以正式環境的 api trace 版本是 `unknown`。
- drizzle 的 migrator（`pg-core/dialect.js` 的 `migrate`）在交易外讀最後一筆紀錄、沒有鎖；現在 `db:migrate` 略過佈建中與失敗的租戶、佈建只處理新的 DB，所以實務上不會重疊，但從畫面重跑會讓它變成真的風險。
- 平台通知只有佈建、配額、止水線、角色變更五種；CDN、背景工作、migration 都只靠 Grafana 告警，而 [`08-monitoring.md`](../architecture/08-monitoring.md) §6.3 註明還沒有通知管道。
