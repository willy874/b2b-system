# 多實例部署與服務拆分

- 優先度：P2
- 狀態：實作中（branch：`feat/multi-instance`；M1～M3 完成）
- 依賴：—
- 相關：[`../architecture/01-system.md`](../architecture/01-system.md) §4.2–§4.4（部署拓撲、擴展前提、程序之間的一致性）、[`backend/08-realtime.md`](../architecture/backend/08-realtime.md) §7.6、§8、§10.3、
  [`backend/10-jobs.md`](../architecture/backend/10-jobs.md) §5、§9（背景工作的位置）、[`backend/02-database.md`](../architecture/backend/02-database.md) §6.2（連線預算、PgBouncer 的觸發條件）、
  [`backend/04-auth.md`](../architecture/backend/04-auth.md) §12（`RateLimitStore`）、[`architecture/06-external-api.md`](../architecture/06-external-api.md) §9（對外 API 是第二個程序；D16、D18 已做完失效廣播與事件轉送）、
  [`architecture/08-monitoring.md`](../architecture/08-monitoring.md)（每個程序的指標）、[`backend/09-file.md`](../architecture/backend/09-file.md) §5.4（影像變體）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

### 目標

1. **預設是單體**：負載低的時候只跑一個 api 程序，所有角色（HTTP、推播、背景工作）都在裡面，不為了「之後可能要擴展」多付資源。
2. **以環境變數切換成多實例**：同一個映像，靠環境變數決定一個程序扮演哪些角色、共享狀態放在哪裡。從單體換到多實例 **不改程式、不改資料**。
3. **能搬到 k8s**：每個角色是一個可以獨立水平擴展的 Deployment；不需要伺服器本機儲存的角色一律 stateless。
4. **工具經過分析才引入**：Redis、訊息佇列等元件先有「現有的 Postgres 撐不住」的量化依據才加，並且只換介面後面的實作。

### 現況

api 已經不完全是「一個程序」了：

| 已經具備 | 出處 |
| --- | --- |
| 兩個進入點、同一個映像：`main.ts`（內部 api）、`main.external.ts`（對外 API） | [`06-external-api.md`](../architecture/06-external-api.md) §9 D9 |
| 背景工作可以關：`JOBS_WORKER_ENABLED=false` 的程序只入列不執行；排程由 pg-boss 協調，多程序只觸發一次 | [`backend/10-jobs.md`](../architecture/backend/10-jobs.md) §9 D4、D5、D7 |
| 快取跨程序失效：`core/broadcast`（平台 DB 的 `LISTEN`／`NOTIFY`），權限、使用者、租戶登記、資料夾樹、系統設定、通知政策、API token、MFA 方式開關 | [`01-system.md`](../architecture/01-system.md) §4.4 |
| 推播類的領域事件跨程序轉送（`DomainEventRelay`），每個程序推給自己的連線；只用 websocket 傳輸，不需要 sticky session | [`backend/08-realtime.md`](../architecture/backend/08-realtime.md) §7.6、§10.3 |
| 長期狀態都在 Postgres 或物件儲存：refresh token、OIDC 的 session／grant／interaction（`oidc_payloads`）、MFA challenge、重設密碼 token、上傳的 multipart（`uploadId` 在 DB）、匯入的套用（背景工作）、匯出（S3 multipart） | 各模組 |
| 交易內入列（`job_outbox`）的搬移用 `FOR UPDATE SKIP LOCKED`，多個程序同時搬是安全的 | `core/jobs/job-queue.ts` |
| 用量計數、`last_used_at` 是每程序累計、以加法或單調更新寫入，多程序天然相加 | [`05-tenancy.md`](../architecture/05-tenancy.md) §14 D3 |
| production 強制所有程序共用同一組金鑰（`JWT_SIGNING_KEYS`、`OIDC_JWKS`、`OIDC_COOKIE_KEYS`…），不會各自產生隨機金鑰 | `core/config/env.schema.ts` 的 production 驗證 |
| 兩個 Nest app 共用一個 Postgres 的跨程序整合測試 | `apps/api/test/cross-process.spec.ts` |

但 **內部 api 的角色是寫死的**：HTTP、Socket.io gateway、OIDC Provider、背景工作都一定在同一個程序；compose 固定單一 `api`，nginx 的 upstream 與 Prometheus 的 target 都只有一台。

### 程序內狀態的盤點

2026-10-08 逐檔盤點 `apps/api/src` 的結果。分類決定處理方式（§設計決策 D4）：

| 狀態 | 位置 | 分類 | N 個實例時 | 處理 |
| --- | --- | --- | --- | --- |
| 各種快取（權限、使用者、租戶登記、設定、資料夾樹…） | `core/cache/`、`core/tenant/`、`core/settings/`… | 快取：廣播失效 ＋ TTL | 安全 | 不變 |
| **feature flag 的全平台快取** | `core/feature-flags/feature-flag.service.ts:24` | 快取：**只有 TTL** | A 改了，B 最多晚 `TENANT_CACHE_TTL`（30 秒） | 接上 `BroadcastService.channel()`（同 `MfaMethodOverrideService`） |
| **HTTP 速率限制、登入漸進延遲** | `core/rate-limit/rate-limit-store.ts:34`（`MemoryRateLimitStore`） | 共享計數 | 上限變 N 倍；登入延遲每台各算，暴力破解的防護弱 N 倍 | `RateLimitStore` 的共享實作（D6） |
| **對外 API 的限流與驗證失敗計數** | `external-rate-limit.guard.ts:47`、`api-token-auth.guard.ts:72`（`@nestjs/throttler` 的記憶體 storage） | 共享計數 | 同上；而且不經 `RateLimitStore` | 改走 `RateLimitStore`（D6） |
| **WebSocket 每 IP 的 handshake** | `modules/realtime/realtime.rate-limit.ts`、`realtime.gateway.ts:112` | 共享計數 | N 倍 | 改走 `RateLimitStore`（D6） |
| WebSocket 每人連線數 | `realtime.gateway.ts:319`（數本機 room 的大小） | 連線狀態 | N 倍 | 維持每節點的語意（D7） |
| WebSocket 每條連線的訊息限流、token 到期計時器、socket → 租戶 | `realtime.gateway.ts:89,91`、`realtime.expiry.ts:15` | 連線狀態 | 安全（連線不會換節點） | 不變 |
| **跨裝置中繼 `channel.relay`** | `realtime.gateway.ts:236`（`socket.to(ownRoom)`） | 連線狀態 | 同一人連在不同節點的裝置收不到 | 經 `core/broadcast` 轉送（D8） |
| **影像變體** | `modules/file/file-image.service.ts:69-78`（請求內、程序內 limiter 與去重 Map） | 程序內的工作 | 兩台可能重做同一張；當掉要等 5 分鐘後維護排程重排 | 改成背景工作（D9） |
| 匯入的分析（worker thread） | `modules/data-transfer/import/parse-pool.ts` | 請求內的 CPU 工作，請求之間無狀態 | 安全（容量是每台） | 不變 |
| argon2 並行上限 | `modules/credential/password-hasher.ts:34` | 每程序的 CPU 保護 | 安全（CPU 本來就是每台） | 不變 |
| 啟動時的租戶初始化（系統資料夾、個人資料夾） | `modules/file/file-system-folder.service.ts:73` | 開機工作 | N 台同時開機時同時進入每個租戶 DB | 只在 `worker` 角色做（D3） |
| 排程同步 `syncSchedules` | `core/jobs/job-queue.ts:609` | 開機工作 | 滾動部署時新舊設定互相覆寫排程 | 只在 `worker` 角色做；設定來自同一份 ConfigMap（D3） |
| 租戶連線池的 `evict()` | `core/tenant/tenancy.service.ts:118` | 連線資源 | 只有本機關池；其他台靠租戶登記的廣播拒絕、閒置逾時關連線 | 可接受，不改 |
| 影像處理的暫存檔 | `core/image/sharp-image-processor.ts:49`（`os.tmpdir()`） | 單次呼叫內的暫存 | 安全；當掉會留下暫存檔 | k8s 用 `emptyDir`（可設 `medium: Memory`）並設大小上限 |
| Prometheus registry | `core/metrics/registry.ts` | 每程序的指標 | 每台各自抓取、加總 | Prometheus 改成服務探索（D12） |

沒有 `@nestjs/schedule`、`setInterval` 的排程工作（週期性的只有快取重新載入、用量 flush、限流清理，每台各跑一份是預期的）；沒有 express-session、SSE、程序內的分散式鎖（鎖都是 `pg_advisory_xact_lock`）。

**結論**：除了上表粗體的幾項，api 已經是「資料 stateless」——程序掛掉不會丟資料，換一台處理下一個請求也不會出錯。剩下的工作是 **把角色變成可設定的**，以及 **把共享計數搬出程序**。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 程序角色：`APP_ROLES`（`http`、`realtime`、`worker`），預設全部（單體） | 拆成獨立的 codebase／獨立的資料庫（真正的微服務；D1） |
| 部署模式：`DEPLOYMENT_MODE`（`standalone`／`cluster`），`cluster` 時拒絕程序內的共享狀態 | Redis／Valkey（介面留好，量化觸發條件再加；D10） |
| feature flag 的全平台快取接上失效廣播 | 訊息佇列（RabbitMQ、Kafka、NATS；D11） |
| `RateLimitStore` 的 Postgres 實作；對外 API 與 WebSocket handshake 的限流改走它 | 跨區域部署 |
| `channel.relay` 跨節點 | 自動擴展的實際設定值（HPA／KEDA 的門檻，上線後依指標決定） |
| 影像變體改成背景工作 | `apps/file-storage` 的多實例（它是開發與小型部署用的替身；多實例時換成真正的 S3） |
| 優雅關閉：readiness 回 503、排空期、WebSocket 分批斷線 | `apps/apm-service` 的多實例（同上，單一實例） |
| compose 的多實例疊加檔（`docker-compose.cluster.yml`）與 nginx 的動態 upstream | |
| k8s 的參考部署：Kustomize（`deploy/k8s/`，D15） | Helm chart |
| migration 向後相容的 CI 檢查（D14） | |

## 使用者故事

**作為部署者，我希望小規模時只跑一個 api 容器，規模變大時只改環境變數就能拆成多個角色、各自擴展，以便不必為了擴展改程式或搬資料。**

- **Given** 預設的 `docker-compose.prod.yml`
- **When** `docker compose up`
- **Then** 只有一個 `api` 容器，同時處理 HTTP、WebSocket 與背景工作；資源用量與現在相同

- **Given** 疊上 `docker-compose.cluster.yml`（或 k8s 的三個 Deployment）
- **When** `api-http` ×3、`api-realtime` ×2、`api-worker` ×2
- **Then** 在任一台 `api-http` 改權限，連在任一台 `api-realtime` 的使用者即時收到；登入失敗的計數在每一台都相同；排程每個週期只跑一次

**作為部署者，我希望忘了設定共享儲存時程序拒絕啟動，以便不會在不知情的情況下讓速率限制變成 N 倍。**

- **Given** `DEPLOYMENT_MODE=cluster`、`RATE_LIMIT_STORE=memory`
- **When** 程序啟動
- **Then** 啟動失敗，訊息指出要設定的變數

## 初步構想

### 1. 角色與部署模式

```
                  同一個映像 b2b-system-api
                             │
     ┌───────────────┬───────┴────────┬────────────────┬──────────────────┐
     ▼               ▼                ▼                ▼                  ▼
  standalone      api-http        api-realtime      api-worker       external-api
  APP_ROLES=all   APP_ROLES=http  APP_ROLES=        APP_ROLES=       main.external.js
  (預設，單體)    REST、OIDC       realtime          worker           （已存在）
                  Provider         Socket.io         pg-boss worker、
                                                     排程、影像變體
     └────────── migrate（一次性：compose 的服務／k8s 的 Job）──────────┘
```

| 角色 | 做什麼 | 有沒有本機狀態 | 怎麼擴展 | 探針 |
| --- | --- | --- | --- | --- |
| `http` | 內部 api 的 REST、OIDC Provider、匯入的分析 | 無（只有可失效的快取） | 依 CPU／請求數水平擴展 | `PORT` 的 `/health`、`/health/ready` |
| `realtime` | Socket.io gateway、`channel.relay`、接收其他程序轉送的事件 | 只有 **連線本身**（不可搬移，但掉了客戶端會重連到別台） | 依連線數水平擴展 | 同上（同一個 HTTP server 帶 `/health`） |
| `worker` | pg-boss worker、排程同步、開機時的租戶初始化、影像變體 | 無（工作狀態在 pg-boss） | 依佇列深度水平擴展 | 只開健康檢查的路由 |
| `external`（既有的另一個進入點） | 對外 API | 無 | 依請求數 | 既有 |
| `migrate`（既有） | migration ＋ 冪等 seed | 一次性 | 不擴展；每次部署跑一次 | — |

- `APP_ROLES` 是逗號分隔的清單，`all` 等於 `http,realtime,worker`。**預設 `all`**。
- 角色只決定 **這個程序打開哪些入口**，不決定載入哪些業務模組：每個角色都 import 同樣的業務模組（service 都在），差別是
  1. `http`：開放內部 surface 的 controller。沒有 `http` 的程序只開 `@Surface('ops')`（健康檢查）——沿用 `SurfaceGuard` 的機制，與對外 API 程序擋內部路由的方式相同（[`06-external-api.md`](../architecture/06-external-api.md) §9 D11）。
  2. `realtime`：`RealtimeModule`（gateway 與 listener）只在這個角色 import。沒有它的程序發佈領域事件時，本機沒有推播的訂閱者，事件經 `DomainEventRelay` 送到有 `realtime` 的程序推播——轉送本來就是這樣運作的，發佈端不必改。
  3. `worker`：執行背景工作與「整個系統做一次」的開機工作。沒有 `worker` 的程序照樣可以入列。`JOBS_WORKER_ENABLED=false` 保留為 `worker` 角色內「只入列」的開關（實作紀錄）。
- **只有入口分角色、模組不分**，是為了守住兩件事：outbox 的搬移只處理本程序登記過的工作類型（`job-queue.ts:291`），每個程序都有完整的登記才不會漏；回收桶在啟動時要求每一種類型都有 handler（[`06-external-api.md`](../architecture/06-external-api.md) §9 T3 的教訓）。
- `DEPLOYMENT_MODE`：
  - `standalone`（預設）：允許程序內的共享狀態（`RATE_LIMIT_STORE=memory`）。這是「只有一個程序」的宣告；開了兩個 standalone 程序不會被偵測到，文件寫明。
  - `cluster`：啟動時檢查 D5 的清單，任一項還是程序內實作就拒絕啟動。
- 對外 API 維持獨立的進入點，不併進 `APP_ROLES`（D2）。

### 2. 共享狀態的驅動（driver）

每一種共享狀態都是 `core/` 裡的一個介面，實作由環境變數選擇：

| 介面 | 環境變數 | standalone 的預設 | cluster 的預設 | 之後可加 |
| --- | --- | --- | --- | --- |
| `RateLimitStore`（`core/rate-limit/`，已存在） | `RATE_LIMIT_STORE` | `memory` | `postgres` | `valkey` |
| `BroadcastService`（`core/broadcast/`，已存在） | —（只有 Postgres） | `postgres` | `postgres` | `valkey`（pub/sub） |
| `JobQueue`（`core/jobs/`，已存在） | — | pg-boss | pg-boss | 不規劃（D11） |
| `ObjectStorage`（`core/storage/`，已存在） | `FILE_STORAGE_*` | `apps/file-storage` | 真正的 S3 相容服務 | — |

### 3. 後端改動

- `core/config`：`APP_ROLES`、`DEPLOYMENT_MODE`、`RATE_LIMIT_STORE`、`SHUTDOWN_DRAIN_SECONDS`；移除 `JOBS_WORKER_ENABLED`（`external-process-env.ts` 改設 `APP_ROLES=`、vitest 預設改 `APP_ROLES=http,realtime`）。`cluster` 的啟動檢查放在 `validateEnv`。
- `core/process-role`（新）：`ProcessRoles` provider（`has('worker')`…），`AppModule.forRoles()` 依角色組出 imports。
- `common/guards/surface.guard.ts`：程序的 surface 從單一值改成集合（`internal`、`external`、`ops`）。
- `core/feature-flags`：`BroadcastService.channel('feature_flags')`。
- `core/rate-limit`：`PostgresRateLimitStore`（D6）；`modules/api-token/external/*` 改用 `RateLimitStore`，`external-api.module.ts` 拿掉 `ThrottlerModule`；`realtime.rate-limit.ts` 的 handshake 改用 `RateLimitStore`。
- `modules/realtime`：`channel.relay` 經廣播轉送（D8）；關閉時分批斷線（D13）。
- `modules/file`：影像變體改成工作類型 `file.imageVariants`（D9）。
- `modules/file/file-system-folder.service.ts`、`core/jobs` 的 `syncSchedules`：只在 `worker` 角色執行（D3）。
- `modules/health`：readiness 在排空中或平台 DB 連不上時回 503（D13）。
- `instrumentation.ts`、`core/metrics/metrics-server.ts`：服務名稱與指標標籤帶角色（`api-http`、`api-realtime`、`api-worker`）。

### 4. 部署

- `docker-compose.prod.yml`：維持單一 `api`（`APP_ROLES` 不設 = `all`）；`external-api` 與 `external-gateway` 改成 profile `external`（範本的 `COMPOSE_PROFILES` 預設打開）。不需要對外 API 的部署可以少跑兩個容器。
- `docker-compose.cluster.yml`（新，疊加）：把 `api` 換成 `api-http`、`api-realtime`、`api-worker`（`deploy.replicas` 由變數決定）、`DEPLOYMENT_MODE=cluster`；nginx 改成 `resolver 127.0.0.11` ＋ 變數化的 `proxy_pass`，`/api/socket.io/` 指向 `api-realtime`、其餘 `/api/` 指向 `api-http`。可選擇再疊 PgBouncer。
- Prometheus：compose 用 `dns_sd_configs`；k8s 用 Pod 的服務探索（或 `ServiceMonitor`）。
- k8s（D15）：`deploy/k8s/` 的 Kustomize。每個角色一個 Deployment ＋ Service，`migrate` 是 Job（Helm 的 pre-upgrade hook 或部署流程裡的一步），ConfigMap／Secret 共用；Ingress 對 `/api/socket.io/` 設長的 read timeout，**不設** session affinity。

### 5. 連線預算

角色拆開後每個程序的連線池可以依角色調小（compose 與 k8s 的範本分別設定）：

| 角色 | 平台池 | pg-boss | `LISTEN` | 每個租戶 |
| --- | --- | --- | --- | --- |
| `http` | 10 | 4（只入列；之後可降到 2） | 1 | `TENANT_POOL_MAX`（10） |
| `realtime` | 3 | 2 | 1 | 3（handshake 與權限集合的查詢） |
| `worker` | 5 | 4 | 1 | 依工作的並行度（預設 5） |

預算公式沿用 [`backend/02-database.md`](../architecture/backend/02-database.md) §6.2，「api 程序數」改成逐角色加總。`cluster` 模式下程序數 ≥ 2 且同時活躍的租戶超過 10 個，就達到該節的 PgBouncer 觸發條件。k8s 的參考部署 **預設附 PgBouncer**（只給租戶 DB，平台 DB 直連）。

## 開放問題

1. 共享速率限制用 Postgres 撐得住嗎？全域 guard 對每個請求都計數，尖峰時的寫入量要先估。
   **結論**（2026-10-08，待壓測確認）：先用 Postgres（D6）。估算：1000 人在線約 600 qps（[`backend/02-database.md`](../architecture/backend/02-database.md) §6.2 的估算），每個請求一次 upsert，共約 600 次／秒的單列 upsert；寫在 `UNLOGGED` 表上、key 分散（每人一列），Postgres 可以負擔，但會占平台 DB 的寫入與連線。M3 以 k6 壓測驗收：`hit` 的 p99 < 5 ms、平台 DB 的 CPU 增加 < 20%。不達標時依 D10 的順序升級。
   **壓測紀錄**（2026-10-08，開發機 Docker Desktop、機器另有其他工作，load average ≈ 20）：
   - 資料庫端（pgbench 在容器內跑同一條 upsert，1,000 個 key ＋ 一成落在 5 個熱門 key）：8 個連線 6,300 次／秒、平均 1.3 ms；32 個連線 17,000 次／秒、平均 1.9 ms。
     容量約是估算需求（600 次／秒）的 25 倍以上，熱門 key 的列鎖沒有成為瓶頸。
   - 從 Node 經 Docker 的埠轉發打（`bench:rate-limit`）：p50 3.7 ms（並行 8）、p99 數十到數百 ms——被開發機的負載與埠轉發主導，不能代表正式環境。
   - 結論：吞吐量足夠，採用 Postgres；p99 < 5 ms 的門檻要在接近正式的環境（api 與 postgres 在同一個網段、沒有其他負載）以 `bench:rate-limit` 重量一次，
     上線後看 `api_rate_limit_store_duration_seconds`，超過即依 D10 換 Valkey。
2. 稽核日誌分區要現在做，還是等熱表真的撐不住？
   **結論**（2026-10-07）：不把熱表與冷表併成一張分區表；只把冷表按月分區，保留期限以 DROP 整個月份執行（`backend/06-audit-log.md` §10 D1）。
3. 部署時要滾動更新，前提是 migration 一律對上一版相容（已是規則，[`backend/02-database.md`](../architecture/backend/02-database.md) §5.1「破壞性變更拆成兩次部署」）。要不要在 CI 加檢查？
   **建議**：要，而且做最便宜的版本——CI 掃描這個 PR 新增的 migration SQL，出現 `DROP COLUMN`、`DROP TABLE`、`RENAME`、`ALTER COLUMN … TYPE`、`SET NOT NULL`（不帶 `DEFAULT` 的 `ADD COLUMN … NOT NULL`）時失敗，除非該行上方有 `-- breaking-ok: <理由與第二次部署的計畫>`。不跑「舊版程式碼 ＋ 新 schema」的整合測試（成本高，訊號與掃描重疊）。
   **結論**（2026-10-08）：照建議。掃描腳本放 `scripts/`，CI 的 test job 跑；規則寫進 `backend/02-database.md` §5.1。
4. k8s 的參考部署做到哪裡？
   選項：(a) 這一版只寫文件（各角色的資源、探針、Ingress、HPA 的建議值），不放 manifest；(b) `deploy/k8s/` 放 Kustomize 的 base ＋ overlay；(c) Helm chart。
   **建議** (b)：Kustomize 不需要額外工具（`kubectl apply -k`），值的覆寫用 overlay 就夠；Helm 等到要發布給別人安裝再做。驗證用 kind 在 CI 跑一次 smoke（同 `deploy/smoke-test.sh` 的精神）。
   **結論**（2026-10-08）：照建議採 (b) Kustomize，`deploy/k8s/base` ＋ `overlays/`（`standalone`：單一 Deployment 跑 `all`；`cluster`：三個角色 ＋ PgBouncer）；kind smoke 放進 CI 的 deploy job。Helm 不做（D14）。
5. 預設的 standalone 是否也要把背景工作拆出去？
   影像變體改成背景工作之後（D9），單體裡的 worker 與 HTTP 共用一個 event loop：大量上傳圖片時，sharp 的 CPU 會拖慢 API。
   **建議**：預設仍是單體（`all`），符合「低負載不浪費資源」；`docker-compose.prod.yml` 提供只設 `APP_ROLES` 的兩容器範例（`api` = `http,realtime`、`api-worker` = `worker`），作為從單體到 cluster 的中間階段——這一步仍是 `standalone`（`http` 只有一台，記憶體的限流仍正確）。
   **結論**（2026-10-08）：照建議。預設維持單一 `api`（`all`）；`deploy/prod.env.example` 與 `01-system.md` §4.2 說明兩容器的設定（D15）。

## 設計決策

### D1. 「服務」是同一個映像的部署角色，不是獨立的 codebase

| 方案 | 結論 |
| --- | --- |
| **A. 模組化單體 ＋ 角色化部署**：同一個 codebase、同一個映像，以 `APP_ROLES` 決定入口 | **採用** |
| B. 依業務拆成獨立服務（各自的 repo 或 app、各自的資料庫、服務之間以 HTTP／訊息溝通） | 不採用（這一版） |

理由：

- 擴展的需求來自 **負載的形狀**（請求、長連線、背景工作的 CPU），不是業務邊界——角色化部署已經能讓三種負載各自擴展。
- 業務模組之間的呼叫是同一個交易內的 service 呼叫（稽核在交易內、outbox 在交易內），拆成服務就變成分散式交易；授權每次都要多一跳（[`01-system.md`](../architecture/01-system.md) §4.3 的理由仍然成立）。
- 每個租戶一個 database 已經是資料層的隔離；服務各自一個 DB 會變成「租戶數 × 服務數」個 database。
- 之後真的要把某個模組拆成獨立服務（例：身分服務要給本平台以外的系統用），角色化部署是前置步驟：它先讓程序之間只靠 Postgres（廣播、佇列、outbox）溝通。拆服務的條件沿用 [`01-system.md`](../architecture/01-system.md) §4.3 的表。

### D2. 對外 API 維持獨立的進入點

它的全域 guard 鏈（`ApiTokenAuthGuard`，不讀 cookie、不收 JWT）和內部 api 不同，是刻意的攻擊面分離（[`06-external-api.md`](../architecture/06-external-api.md) §9 D9、D10）。併進 `APP_ROLES` 等於同一個程序同時有兩條 guard 鏈。只把它在 compose 改成 profile，不用的部署可以不跑。

### D3. 「整個系統做一次」的工作只在 `worker` 角色

| 工作 | 現在 | 改成 |
| --- | --- | --- |
| pg-boss 的 worker、排程同步（`syncSchedules`）、佇列深度指標 | `JOBS_WORKER_ENABLED` 的程序 | `worker` 角色 |
| 開機時為每個租戶補系統資料夾與個人資料夾（`file-system-folder.service.ts:73`） | 每個程序開機都做 | `worker` 角色 |
| 租戶 schema 的檢查（`tenancy.service.ts:75`） | 每個程序 | 不變：它是每個程序自己要知道的狀態 |
| 建立 bucket（`s3-object-storage.ts:158`） | 每個程序 | 不變：冪等、很便宜 |

`syncSchedules` 會取消「本程序設定裡是空字串」的排程；只有 `worker` 做、所有 worker 的設定來自同一份 ConfigMap／env 檔，滾動部署時就不會互相覆寫。

### D4. stateless 的判準

一個程序是 stateless，當且僅當它掛掉、或下一個請求落到別台時：

1. 不丟任何已確認的資料（長期狀態在 Postgres 或物件儲存）；
2. 不給出錯誤的結果（快取有失效廣播，且 TTL 是最壞情況的上限）；
3. 共享的計數不因實例數改變語意（速率限制走共享的 `RateLimitStore`）。

**連線**（WebSocket）是唯一允許的例外：連線不可搬移，但客戶端重連到任何一台都能恢復（推播只是加速，重連後整批重新驗證，[`backend/08-realtime.md`](../architecture/backend/08-realtime.md) §15.4）。所以 `realtime` 角色是「有連線、沒有資料」，可以水平擴展、不需要 sticky session、不需要 StatefulSet。

真正有本機儲存的只有 `postgres`、`apps/file-storage`、`apps/apm-service`，在 k8s 是 StatefulSet ＋ PVC（或換成託管服務），不屬於這份提案要拆的範圍。

### D5. `cluster` 模式的啟動檢查

`DEPLOYMENT_MODE=cluster` 時，下列任一項不成立就拒絕啟動（`validateEnv`）：

- `RATE_LIMIT_STORE` 不是 `memory`
- `FILE_STORAGE_*` 不指向 `apps/file-storage` 的預設位址（警告，不擋：小型 cluster 仍可能用單一實例的 file-storage）
- 金鑰類變數都有設定（production 已強制；`cluster` 在非 production 也強制，否則各程序各自產生隨機的 OIDC 金鑰）

`standalone` 不檢查實例數（程序無從得知），文件寫明「開兩個 standalone 程序 = 速率限制 ×2」。

### D6. 共享速率限制：Postgres 的 `UNLOGGED` 表

- 平台 DB 一張 `rate_limit_counters (key text primary key, count int, window_start timestamptz, last_at timestamptz)`，`UNLOGGED`（不寫 WAL、當機後清空——計數本來就可以丟）。
- `hit(key, windowMs)`：一條 `INSERT … ON CONFLICT (key) DO UPDATE SET count = CASE WHEN window_start + window > now() THEN count + 1 ELSE 1 END, window_start = CASE … END RETURNING *`，一次往返、沒有讀後寫的競態。
- 清理：`worker` 的排程每分鐘刪掉 `window_start` 過期的列。
- 所有限流（api 的 `RateLimitGuard`、`LoginThrottle`、對外 API 的兩個 guard、WebSocket 的 handshake）都改走 `RateLimitStore`；規則與計數的 key 不變（[`backend/04-auth.md`](../architecture/backend/04-auth.md) §12 D1 的銜接點）。
- 平台 DB 連不上時：登入相關的政策（`auth`、`authMail`、`refresh`、`LoginThrottle`）**失敗即拒絕**（503），一般的 `DEFAULT`／`ANONYMOUS` **失敗即放行**並記指標。理由：平台 DB 掛了本來就無法登入；一般請求還能服務已登入的使用者（租戶 DB 是另一台時）。

評估過的方案：

| 方案 | 結論 |
| --- | --- |
| **Postgres `UNLOGGED` 表，每次精確計數** | **採用**：不加元件，量級（開放問題 1）在可負擔範圍 |
| Valkey／Redis 的 `INCR` ＋ `PEXPIRE` | 這一版不採用；是 D10 的升級目標 |
| 本機計數 ＋ 每秒同步到共享儲存（近似） | 不採用為預設：寫入量降一到兩個數量級，但登入延遲與鎖定需要精確計數。壓測不達標時，可以只對 `DEFAULT`／`ANONYMOUS` 這兩個寬鬆的政策啟用 |
| 每台的上限除以實例數 | 不採用：程序不知道實例數；自動擴展時上限會跟著變 |

### D7. WebSocket 每人連線數維持「每個節點」

跨節點計算即時連線數需要一張 presence 表（連線時 +1、斷線 -1、節點當掉要靠心跳清除），成本與錯誤模式都不成比例。這個上限是防濫用，前端每個瀏覽器只有 leader 分頁連線（[`frontend/11-realtime.md`](../architecture/frontend/11-realtime.md) §3.3），正常使用遠低於上限。`cluster` 時語意改成「每個 realtime 節點每人 `REALTIME_CONNECTIONS_PER_USER` 條」，文件寫明。

### D8. `channel.relay` 經 `core/broadcast` 轉送，不裝 Socket.io adapter

- 新頻道 `user_relay`：`{ tenant, userId, envelope, from: socketId }`。外框已限制 ≤ 4 KB（[`backend/08-realtime.md`](../architecture/backend/08-realtime.md) §8），放得進 `NOTIFY` 的 8000 位元組。
- 收到的節點 `to(userRoom).except(from)` 送出；本機照舊直接送，訊息帶程序 id，自己送的不收回（`channel()` 既有的語意）。
- 不裝 `@socket.io/postgres-adapter`：伺服器端推播已經由事件轉送跨節點，裝 adapter 會讓每則推播送兩次（[`06-external-api.md`](../architecture/06-external-api.md) §9 實作紀錄）。

### D9. 影像變體改成背景工作

- 上傳完成時在交易內入列 `file.imageVariants`（outbox），取代請求內的 `schedule()`；`exclusive`（以檔案 id 為 singleton key）取代程序內的去重 Map。
- 並行上限從程序內的 limiter 改成工作類型的 `concurrency`（每個 worker 程序 2，同現在的 `IMAGE_VARIANT_CONCURRENCY`）。
- 維護排程「重排卡住超過 5 分鐘的 pending」保留，作為 worker 當掉時的補救。
- 好處：`http` 角色不再有 sharp 的 CPU 尖峰；worker 可以給更多 CPU、依佇列深度擴展。

### D10. Memory Storage（Valkey／Redis）：介面先留，量化觸發再加

這一版不引入。需要「跨程序的記憶體儲存」的只有兩件事，都已經有 Postgres 的實作或介面：

| 用途 | 現在／這一版 | 什麼時候換 Valkey |
| --- | --- | --- |
| 速率限制的計數 | `PostgresRateLimitStore`（D6） | 壓測或線上任一：`hit` 的 p99 > 5 ms；限流的寫入讓平台 DB 的 CPU > 60%；平台 DB 的 `UNLOGGED` 表 autovacuum 跟不上 |
| 程序之間的訊息（快取失效、事件轉送、`channel.relay`） | `LISTEN`／`NOTIFY` | `NOTIFY` 的佇列使用率（`pg_notification_queue_usage()`）持續 > 10%；或廣播量 > 每秒數千則 |
| 資料快取（共享的權限集合等） | **不做**：本機快取 ＋ 失效廣播比遠端快取少一次網路往返；資料是每租戶、量小 | 不規劃 |
| session | **不需要**：JWT ＋ DB 的 refresh token ＋ DB 的 OIDC 狀態 | 不規劃 |

要加時選 **Valkey**（BSD 授權、與 Redis 協定相容）而不是 Redis：授權條款單純。只寫 `ValkeyRateLimitStore`、`ValkeyBroadcastTransport` 兩個實作，`RATE_LIMIT_STORE=valkey`、`BROADCAST_TRANSPORT=valkey` 切換；業務程式不變。

### D11. Queue：繼續用 pg-boss，不引入訊息佇列

- 入列必須與業務交易一致（outbox，[`backend/10-jobs.md`](../architecture/backend/10-jobs.md) §4.1）；外部佇列做不到，要自己再寫一套 outbox → broker 的搬運。
- 量級：工作量遠低於 pg-boss 的承載（每天數百到數萬筆）；多個 worker 程序以 `SKIP LOCKED` 分攤，排程有分散式鎖。
- 每個 worker 的並行度是每程序的（`localConcurrency`），總吞吐 = 實例數 × 並行度；每租戶的並行上限由 DB 強制，跨程序成立。
- 觸發重新評估：持續 > 每秒數百筆工作、需要跨語言的消費者、或需要事件重播（event sourcing）——那時再開設計決策評估 NATS JetStream／Kafka，`JobQueue` 的介面不變。

### D12. 服務探索與負載平衡

| 層 | standalone | compose cluster | k8s |
| --- | --- | --- | --- |
| 入口 → api | nginx 固定 upstream（現在） | nginx `resolver 127.0.0.11` ＋ 變數化 `proxy_pass`，Docker DNS 輪詢 | Ingress → Service |
| WebSocket | 同一個 upstream | `/api/socket.io/` → `api-realtime`，不黏著 | Ingress 的路徑規則 → `api-realtime` Service，不設 affinity |
| Prometheus | 固定 target | `dns_sd_configs` | Pod 服務探索／`ServiceMonitor` |
| 程序之間 | 不需要 | 只經 Postgres（廣播、佇列） | 同左：Pod 之間 **不互相呼叫**，不需要 service mesh |

nginx 變數化 `proxy_pass` 會失去 `upstream` 的 `keepalive`；compose cluster 改用 nginx 的 `upstream` ＋ `server api-http:3000 resolve`（nginx 1.27.3 起開源版支援 `resolve`），保留 keepalive。

### D13. 優雅關閉與探針

- `/health/ready` 改成：排空中或平台 DB 連不上 → **503**；物件儲存、背景工作、event loop 的異常維持 200 ＋ `status: 'degraded'`（不讓一個非必要依賴的抖動把所有 Pod 都移出服務）。
- 收到 `SIGTERM`：
  1. 標記排空，readiness 回 503；
  2. 等 `SHUTDOWN_DRAIN_SECONDS`（standalone 預設 0、k8s 範本 10），讓 Ingress／kube-proxy 把它移出；
  3. `realtime`：在 `SHUTDOWN_DRAIN_SECONDS` 內分批斷開連線（避免同一秒全部重連到其他節點）；
  4. 關 HTTP server，再依現有的 `onApplicationShutdown` 關 pg-boss（graceful 30 秒）、連線池。
- k8s 的 `terminationGracePeriodSeconds` ≥ 排空秒數 ＋ 35。
- `worker` 角色只開健康檢查的路由（D3 的 `ops` surface），讓探針有東西可打。

### D14. migration 向後相容的 CI 檢查：掃描破壞性語法

- 滾動部署時新舊兩版程式同時連到新 schema，migration 必須對上一版相容（[`backend/02-database.md`](../architecture/backend/02-database.md) §5.1）。
- CI 掃描這個 PR 新增的 migration（平台與租戶兩套），出現 `DROP COLUMN`、`DROP TABLE`、`RENAME`、`ALTER COLUMN … TYPE`、`SET NOT NULL`、不帶 `DEFAULT` 的 `ADD COLUMN … NOT NULL` 時失敗；
  該語句上方有 `-- breaking-ok: <理由與第二次部署的計畫>` 時放行。
- 評估過的方案：

| 方案 | 結論 |
| --- | --- |
| **掃描新增的 SQL** | **採用**：幾十行的腳本、秒級完成，擋下最常見的錯誤 |
| 以上一版的程式碼對新 schema 跑整合測試 | 不採用：要在 CI 建兩份程式碼與兩次 Testcontainers，時間翻倍；能抓到的大多與掃描重疊 |
| 不檢查，靠 review | 不採用：滾動部署之後，漏看一次就是線上錯誤 |

### D15. k8s 參考部署用 Kustomize；單體與 cluster 之間有「api ＋ api-worker」的中間階段

- `deploy/k8s/base`：每個角色的 Deployment、Service、探針、`migrate` Job、ConfigMap／Secret 的範本、Ingress。
- `deploy/k8s/overlays/standalone`：只有一個 Deployment（`APP_ROLES=all`、`replicas: 1`）；`overlays/cluster`：`api-http`、`api-realtime`、`api-worker` 各自的 Deployment ＋ HPA 範本、PgBouncer、`DEPLOYMENT_MODE=cluster`。
- CI 的 deploy job 以 kind 套用 `cluster` overlay，等每個 Pod ready 並經 Ingress 打到 `/api/health/ready`。
- Helm 不做：`kubectl apply -k` 不需要額外工具，覆寫值用 overlay 就夠；要發布給別人安裝時再評估。
- 中間階段（compose 與 k8s 都適用）：`api`（`APP_ROLES=http,realtime`）＋ `api-worker`（`APP_ROLES=worker`），仍是 `standalone`。背景工作的 CPU 不再影響 API，又不必先準備共享的速率限制。預設仍是單一程序。

## 實作分期

每一期合併後單體的行為都不變，可以各自上 main。

| 期 | 內容 | 驗收 |
| --- | --- | --- |
| M1 程序內的補強（**完成**） | feature flag 接上廣播；對外 API 與 WebSocket handshake 的限流改走 `RateLimitStore`（仍是記憶體）；readiness 的 503 與排空（D13） | `cross-process.spec.ts` 加 feature flag 的案例；既有限流測試全過 |
| M2 角色（**完成**） | `APP_ROLES`、`DEPLOYMENT_MODE`、`SurfaceGuard` 的集合、`RealtimeModule` 依角色載入、D3 的開機工作、服務名稱帶角色；移除 `JOBS_WORKER_ENABLED` | 整合測試：`http` 程序沒有 gateway、`realtime` 程序的業務路由 404、`worker` 只有 `/health`；三個角色分開時推播與入列照常 |
| M3 共享狀態（**完成**） | `PostgresRateLimitStore` ＋ 清理排程；`cluster` 的啟動檢查；`channel.relay` 跨節點（D8） | 兩個程序共用計數（登入失敗在 A、B 合計）；k6 壓測達開放問題 1 的門檻 |
| M4 影像變體 | 改成背景工作（D9） | 既有影像變體的測試改成跑 worker；`http` 程序不再載入 sharp 的 limiter |
| M5 部署 | `docker-compose.cluster.yml`、nginx 的動態 upstream、Prometheus 服務探索、`deploy/smoke-test.sh` 加 cluster 版本；k8s 參考部署（D15，含 kind smoke）；migration 相容檢查（D14） | E2E：`api-http` ×2、`api-realtime` ×2、`api-worker` ×1，在 A 改權限、連在 B 的使用者即時收到；滾動重啟期間 E2E 不失敗 |

M1 不依賴其他期，可以先做。

## 實作紀錄

實作時與上面的構想不同的地方；歸檔時搬進主要規格的「設計決策」章節。

| 期 | 項目 | 構想 | 實作 | 原因 |
| --- | --- | --- | --- | --- |
| M1 | 排空的位置 | 在 Nest 的關閉 hook 裡等 | `core/lifecycle` 的 `enableGracefulShutdown()` 取代 `enableShutdownHooks()`，在訊號處理裡先排空再 `app.close()` | Nest 的關閉順序從 `onModuleDestroy` 開始，沒有「關 HTTP 之前先等」的位置；排空期間各模組（推播、廣播）都還要正常運作 |
| M1 | WebSocket 的排空 | 分批斷線 | 分批關閉底層傳輸（`socket.conn.close()`），排空中拒絕新的 handshake（`SERVICE_NOT_READY`） | `socket.disconnect()` 在客戶端是「伺服器要你走」，Socket.io 不會自動重連；關閉傳輸才會照一般斷線的退避重連到其他節點 |
| M1 | readiness 的 503 | 回 503 | 新錯誤碼 `SERVICE_NOT_READY`（`details.draining`、`details.checks`） | Service 拋 `AppException`、controller 不寫判斷（coding-standards 03 §1） |
| M2 | `JOBS_WORKER_ENABLED` | 移除，改由 `APP_ROLES` 決定 | 保留：`worker` 角色裡是否真的執行工作（`false` 只入列）；角色決定的是開機工作與誰有資格執行 | 測試（預設不跑工作，但要有開機時補的系統資料夾）與共用 dev DB 的驗證流程都依賴「不執行工作、其他照舊」；拿掉它就要另外發明一個測試用的開關 |
| M2 | 角色的讀取時機 | `ProcessRoles` provider | `APP_ROLES` 以字串保存，`processRolesOf()` 解析；`app.module.ts` 在 import 時從 `process.env` 讀 | Nest 的模組清單是靜態的，推播的 gateway 只要被 import 就會掛上 Socket.io；`./core/config` 先被載入時已把 `.env` 寫進 `process.env` |
| M3 | 計數存不了時拒絕登入類請求的錯誤碼 | 503 | 沿用 `AUTH_BUSY`（`retryAfterSeconds`） | 前端遇到它已經會倒數並停用送出鈕（`backend/04-auth.md` §12 D7）；不必新增錯誤碼 |
| M3 | 壓測 | k6 對整個 api | `apps/api/scripts/bench-rate-limit-store.ts`（`pnpm --filter @b2b-system/api bench:rate-limit`）直接壓 `PostgresRateLimitStore.hit` | 門檻定在儲存的延遲（D10 的觸發條件）；整個 api 的壓測混了其他成本，量不出這一項 |
| M2 | `/oidc/*` | `SurfaceGuard` 擋 | OIDC 的 middleware 自己判斷：沒有 `http` 角色就交回 Nest（404） | `/oidc/*` 是 middleware，不經全域 guard |

## 歸檔去向

- `docs/architecture/01-system.md` §4（部署拓撲改成三種形態：standalone、compose cluster、k8s；§4.3 改寫成「角色與擴展」；設計決策章節收 D1～D5、D10～D13、D15）
- `docs/architecture/backend/08-realtime.md` §8、§10.3（`channel.relay` 跨節點、每節點的連線數）
- `docs/architecture/backend/04-auth.md` §12（`PostgresRateLimitStore`、失敗時的策略）
- `docs/architecture/backend/10-jobs.md` §5（worker 的位置改成角色）
- `docs/architecture/backend/09-file.md` §5.4（影像變體改成背景工作）
- `docs/architecture/backend/02-database.md` §5.1（migration 相容檢查，D14）、§6.2（逐角色的連線預算）
- `docs/architecture/02-repository-structure.md` §5（新的環境變數）
