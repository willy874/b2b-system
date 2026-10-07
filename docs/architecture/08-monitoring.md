# 監控（後端指標、tracing、Grafana）

api 的指標與 tracing、健康檢查，以及把它們和前端的錯誤回報（[`07-apm-service.md`](./07-apm-service.md)）一起放進 Grafana 的部署。
前端怎麼收錯誤與 Web Vitals 見 [`frontend/19-observability.md`](./frontend/19-observability.md)；日誌見 [`01-system.md`](./01-system.md) §5。

上線後要能回答的問題，以及去哪裡看：

| 問題 | 去哪裡看 |
| --- | --- |
| 哪支 API 變慢、哪支在出錯？ | Grafana「api 概況」：依路由的 p95 與 5xx；再到 Explore 用 Tempo 找同時段的 trace |
| 某個租戶回報很慢 | Tempo：`{ span.b2b.tenant = "<代碼>" && duration > 1s }`；指標刻意不帶租戶（§2.3） |
| 連線池、Postgres 撐不撐得住？ | 「容量與資料庫」：連線預算、交易時間、最耗時的查詢（[`backend/02-database.md`](./backend/02-database.md) §6.2） |
| 背景工作有沒有積壓？ | 「背景工作」：各佇列可以執行卻沒人取走的筆數、失敗數 |
| 權限快取命中率多少？ | 「api 概況」的快取區 |
| 剛部署的前端有沒有變壞？ | 「前端」：依 release 的錯誤數、issues 表與還原過的堆疊、Web Vitals |

---

## 1. 組成

```
  api（:3000）──── /metrics（:9464）──┐
  external-api（:3001）─ /metrics（:9465）─┤
  apm-service（:9100）── /metrics ────────┼──▶ Prometheus ──┐
  postgres ◀─ postgres-exporter（:9187）──┘                 │
                                                          ├──▶ Grafana（:3300）
  api、external-api ── OTLP/HTTP（:4318）──▶ Tempo ────────┤
  apm-service 的查詢 API（issues、事件）──────────────────────┘（Infinity 外掛）
```

| 元件 | 位置 | 說明 |
| --- | --- | --- |
| 指標 | `apps/api/src/core/metrics/` | `prom-client`；指標清單只有 `instruments.ts` 一份 |
| tracing | `apps/api/src/instrumentation.ts`、`apps/api/src/core/tracing/` | OpenTelemetry，只做 trace；進入點第一個 import |
| 健康檢查 | `apps/api/src/modules/health/` | 存活與就緒（§4） |
| 前端的指標 | `apps/apm-service/src/metrics/` | Web Vitals、錯誤事件數（§5） |
| 部署 | `docker-compose.monitoring.yml`、`deploy/monitoring/` | 疊在正式的 compose 上；本機是 `docker-compose.yml` 的 `monitoring` profile（§7） |

### 1.1 整套關閉（`MONITORING_ENABLED`）

監控（api 的指標與 tracing ＋ Prometheus、Tempo、Grafana、postgres-exporter）可以整套關閉；前端的 APM 是另一個開關（[`07-apm-service.md`](./07-apm-service.md) §8.1）。

| 環境 | 開啟 | 關閉 |
| --- | --- | --- |
| 正式 | 疊上 `-f docker-compose.monitoring.yml`（api、external-api 的 `MONITORING_ENABLED` 預設改成 `true`） | 不疊（`docker-compose.prod.yml` 的預設是 `false`） |
| 本機 | `MONITORING_ENABLED=true`（`.env.example` 的預設）；要看圖表時 `pnpm monitoring:up` | `.env` 設 `MONITORING_ENABLED=false`；不跑 `pnpm monitoring:up` |

`MONITORING_ENABLED=false`（`core/config/env.schema.ts`）時 api 與 external-api：

- 不開 `/metrics` 的 server，不論 `METRICS_PORT`／`EXTERNAL_METRICS_PORT`（`metricsPortOf()`，`core/metrics/metrics-server.ts`）；
- 不量 HTTP 請求（`main.ts`、`main.external.ts` 不掛 `httpMetricsMiddleware`），也不登記 Node 的標準指標（`enableDefaultMetrics()` 只在真的開 `/metrics` 時呼叫）；
- 不載入 tracing，不論 `OTEL_EXPORTER_OTLP_ENDPOINT`（`instrumentation.ts` 以 `tracingEndpointOf()` 判斷，`core/tracing/tracing-endpoint.ts`）。

健康檢查（§4）與就緒檢查的 event loop 量測照常；`instruments.ts` 的計數器仍會累加（記憶體裡的幾個數字，沒有人讀），`ObservedGauge` 只在抓取時才問，不抓就沒有成本。
`deploy/prod.env` 可以明確設 `MONITORING_ENABLED`（例：沒疊監控、改由外部的 Prometheus 抓 api 時設 `true`）；疊著監控卻設成 `false` 時 `ApiDown` 告警會觸發。

---

## 2. 指標

### 2.1 `/metrics`

每個 api 程序另開一個 HTTP server 給 Prometheus 抓：

| 程序 | 環境變數 | 預設 |
| --- | --- | --- |
| 內部 api（`main.ts`） | `METRICS_PORT` | `9464` |
| 對外 API（`main.external.ts`） | `EXTERNAL_METRICS_PORT` | `9465` |

- 只有 `GET /metrics`（Prometheus 文字格式），其他路徑 404。不經過 Nest 的路由、租戶解析、驗證與限流；不需要 token（§9.2 D2）。
- 監聽位址同 api（`LISTEN_HOST`；開發只聽 `127.0.0.1`）。正式環境只在 compose 的網路裡連得到：port 不對主機發布，nginx 只轉發 api 的 3000（§6.2）。
- `0` 不開；監控整套關閉（`MONITORING_ENABLED=false`，§1.1）時一律不開。port 被占用時只記一筆錯誤、api 照常服務（指標不是 api 的必要功能）。`pnpm dev:e2e` 與測試都設成 `0`。

### 2.2 清單

Node 的標準指標（`nodejs_eventloop_lag_*`、`nodejs_heap_*`、`nodejs_gc_duration_seconds`、`process_cpu_seconds_total`、`process_resident_memory_bytes`…）
由 `prom-client` 的 `collectDefaultMetrics` 產生（`enableDefaultMetrics()`：真的開 `/metrics` 時才登記）。api 自己的：

| 指標 | 類型 | 標籤 | 量什麼 | 在哪裡記 |
| --- | --- | --- | --- | --- |
| `http_server_request_duration_seconds` | histogram | `method`、`route`、`status` | 每個 HTTP 請求的時間（`_count` 就是請求數） | `httpMetricsMiddleware`（進入點第一個 `app.use`） |
| `api_cache_lookups_total` | counter | `cache`、`result`（`hit`／`miss`） | 程序內快取的查詢 | 權限、使用者、API token、租戶登記（依網域／id／代碼）的快取 |
| `api_cache_entries` | gauge | `cache` | 快取目前的筆數 | 同上 |
| `api_tenant_pools_open` | gauge | — | 開著的租戶連線池數 | `Tenancy` |
| `api_tenant_unavailable_total` | counter | `reason`（`inactive`／`maintenance`） | 進入租戶被拒（停用、佈建中；migration 落後、DB 連不上） | `Tenancy` |
| `api_db_transaction_duration_seconds` | histogram | `outcome`（`commit`／`rollback`） | `withTransaction` 的交易佔住連線多久 | `core/database/transaction.ts` |
| `api_jobs_processed_total` | counter | `job`、`result`（`completed`／`failed`／`skipped`／`deferred`） | 背景工作的執行結果 | `JobQueue` 的 worker |
| `api_job_duration_seconds` | histogram | `job` | handler 的執行時間 | 同上 |
| `api_job_queue_depth` | gauge | `job`、`state`（`ready`／`deferred`／`active`／`failed`） | 佇列各狀態的筆數（§9.2 D9） | `JobQueue`（只在執行工作的程序） |
| `api_job_outbox_relay_failures_total` | counter | — | 交易提交後搬移 outbox 失敗（等定期清掃） | `JobQueue` |
| `api_realtime_connections` | gauge | — | 這個程序上的 WebSocket 連線數 | `RealtimeGateway` |
| `api_realtime_handshake_rejected_total` | counter | `code` | handshake 被拒（`RATE_LIMITED`、`ORIGIN_NOT_ALLOWED`、驗證失敗的錯誤碼） | `RealtimeGateway` |
| `api_rate_limited_total` | counter | `bucket` | 被速率限制擋下的 HTTP 請求（[`backend/03-api-conventions.md`](./backend/03-api-conventions.md) §8 的桶名稱） | `RateLimitGuard` |
| `api_limiter_active`、`api_limiter_waiting` | gauge | `limiter`（`argon2`／`image`） | 程序內並行上限的執行中、排隊中數量 | `createLimiter({ name })` |
| `api_limiter_rejected_total` | counter | `limiter`、`reason`（`queue-full`／`timeout`） | 等待名額已滿或等太久 | 同上 |
| `api_mfa_verifications_total` | counter | `method`、`purpose`（`login`／`enroll`）、`result`（`ok`／`invalid`／`expired`／`replayed`） | MFA 驗證碼與備用碼的驗證（[`backend/21-mfa.md`](./backend/21-mfa.md) §12） | `MfaService` |
| `api_mfa_challenges_sent_total` | counter | `method` | 寄出的驗證碼（Email） | `EmailMfaMethod` 的寄信工作 |
| `api_mfa_email_delivery_seconds` | histogram | — | Email 驗證碼從入列到寄出的秒數（告警 `MfaEmailCodeSlow`） | 同上 |

`route` 是 Express 對到的路由樣板（`/users/:id`），掛在前綴下的子應用程式（OIDC Provider）只取掛載點（`/oidc`）；沒有對到 controller 的請求是 `unmatched`
（`forRoutes('*')` 的中介軟體留下的 `{/*splat}` 也算），中介軟體直接回應的是 `other`。客戶端在回應前斷線記成 `499`。實作在 `core/metrics/route-label.ts`，
trace 的 `http.route` 也用它。

### 2.3 標籤的原則

- **不放租戶**（§9.2 D3）：租戶數 × 路由 × 狀態碼 × bucket 會讓時間序列爆量。依租戶看用 trace 的 `b2b.tenant` 屬性與日誌的 `tenant` 欄位。
- 只放值域有限、由程式決定的東西：路由樣板、快取名稱、工作名稱、錯誤碼、桶名稱。網址、id、使用者輸入一律不行。
- 同一個程序有兩個來源回報同一組標籤時（例：整合測試的兩個 app）數字相加。

### 2.4 加一個指標

1. 在 `core/metrics/instruments.ts` 定義（名稱 `api_<領域>_<量>_<單位>`，counter 加 `_total`），寫清楚 `help`。
2. 事件型的用 `Counter`／`Histogram`，在發生的地方 `inc()`／`observe()`；狀態型的用 `ObservedGauge`：擁有者在建構時 `observe(this, (report) => …)`，
   Prometheus 抓取時才去問，擁有者被回收就自動不再回報。
3. 更新上表、需要的話加到 Grafana 的儀表板（`deploy/monitoring/grafana/dashboards/`）與告警（`deploy/monitoring/rules/`）。
4. 單元測試以 `metricsRegistry.getSingleMetric(name).get()` 讀值（例：`core/concurrency/__tests__/limiter-metrics.spec.ts`）。

`modules/` 可以 import `@/core/metrics`；`core/metrics` 只依賴 `core/config/env.schema`，不會形成循環。

---

## 3. Tracing

### 3.1 啟用

`OTEL_EXPORTER_OTLP_ENDPOINT`（例 `http://tempo:4318`）有值、且監控沒有整套關閉（§1.1）時才載入 OpenTelemetry；沒載入時 `@opentelemetry/api` 是空操作，程式裡的手動 span 幾乎沒有成本。

| 環境變數 | 預設 | 說明 |
| --- | --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | （空） | OTLP/HTTP 的位址；送到 `<位址>/v1/traces` |
| `OTEL_TRACES_SAMPLER_ARG` | `1`（正式的 compose 預設 `0.2`） | 根 span 的取樣率；請求帶了取樣決定（`traceparent`）時照上游的 |
| `OTEL_SERVICE_NAME` | `api`／`external-api` | 與 Prometheus 的 job 名稱相同，Grafana 才能從 trace 跳到同一個服務的指標 |
| `APP_RELEASE` | `unknown` | `service.version` |

- `src/instrumentation.ts` 必須在 `http`、`@nestjs/core`、`pino` 被載入之前執行：`main.ts` 第一個 import 它，`main.external.ts` 在 `external-process-env` 之後
  （那裡先設 `API_SURFACE`，服務名稱才分得出來）。這時 `ConfigModule` 還沒載入，所以它自己照 `@nestjs/config` 的順序讀 `process.env` 與 `.env`；格式驗證仍在 `env.schema.ts`。
- 程序關閉時 `TraceFlusher`（`core/tracing`）把批次裡剩下的 span 送出。

### 3.2 有哪些 span

| span | 來源 | 屬性 |
| --- | --- | --- |
| `GET /users/:id`（根） | `@opentelemetry/instrumentation-http`；名稱與 `http.route` 由 `applyCustomAttributesOnSpan` 以 §2.2 的路由樣板補上 | `http.response.status_code`、`url.path`、`url.query`（遮蔽過，§3.3）、`b2b.tenant` |
| `UserController.list`、`list` | `@opentelemetry/instrumentation-nestjs-core` | controller、handler |
| `db.transaction` | `withTransaction`（手動） | 交易的範圍；單一查詢沒有 span（§9.2 D6） |
| `job <名稱>`（根） | `JobQueue` 的 worker（手動） | `b2b.job.name`、`b2b.job.id`、`b2b.job.retry`、`b2b.tenant` |
| 對外連線 | `@opentelemetry/instrumentation-undici`（webhook、外部 IdP） | |
| 物件儲存 | `@opentelemetry/instrumentation-aws-sdk` | S3 的操作 |

- **租戶**：`Tenancy` 每次進入租戶（HTTP、WebSocket、背景工作）都在目前的 span 標上 `b2b.tenant`（`annotateTenant`），Tempo 以 `{ span.b2b.tenant = "acme" }` 搜尋整個 trace。
- **手動 span** 用 `core/tracing` 的 `inSpan(name, attributes, fn)`：拋錯時記下例外並標成錯誤。屬性不放查詢參數、請求內容、email 這類可能含個資的東西。
- **日誌**：`@opentelemetry/instrumentation-pino` 讓 span 裡寫的日誌多了 `trace_id`、`span_id`；拿日誌的 `trace_id` 到 Grafana 的 Explore（Tempo）就能打開那個 trace。
- `/health`、`/metrics` 不產生 span；api 自己發出的 HTTP 請求只留 undici 與 aws-sdk 的 span（`http` 的對外 span 關掉，避免與 aws-sdk 重複）。

### 3.3 隱私

- 網址裡的憑證參數（`token`、`code`、`state`、`ticket`、`code_verifier`、`id_token_hint`）在 span **建立時** 換成 `[Redacted]`（`RedactUrlProcessor`），
  名單與日誌共用 `core/logger/sensitive-query.ts`（§9.2 D7）。trace 存在 Tempo，看得到的人比看得到日誌的人多。
- 不記錄請求與回應的內容、標頭（`Authorization`、cookie）。

---

## 4. 健康檢查

| 端點 | 用途 | 檢查 |
| --- | --- | --- |
| `GET /health` | 存活（容器的 HEALTHCHECK） | 程序在、event loop 轉得動（回得了就是） |
| `GET /health/ready` | 就緒（LB） | `database`：平台 DB `select 1`；`storage`：物件儲存；`jobs`：pg-boss 自己的連線池（它用 `pg`，與 api 的平台池分開）；`eventLoop`：最近 30 秒的 event loop 延遲 p99 ≤ `HEALTH_EVENT_LOOP_LAG_MS`（預設 1000，`0` 不檢查） |

- 任一項失敗回 `{ status: 'degraded', checks }`（HTTP 200，照舊）。每一項最多等 2 秒，連線卡住時也能在探針的逾時（3 秒）內回應。
- **租戶 DB 不在就緒檢查裡**（§9.2 D8）：單一租戶的 DB 掛掉不該讓整個程序被 LB 摘掉；`Tenancy.enter` 已經只對那個租戶回 503，
  看指標 `api_tenant_unavailable_total{reason="maintenance"}`（告警 `TenantUnavailable`）。

---

## 5. 前端（apm-service）

前端的錯誤回報本身見 [`07-apm-service.md`](./07-apm-service.md)；這裡是它和 Grafana 的連接。

### 5.1 指標

apm-service 的 `/metrics`（只開在內部介面）除了 Web Vitals 之外，有每一筆存下的錯誤事件：

| 指標 | 標籤 | 說明 |
| --- | --- | --- |
| `apm_web_vital` | `project`、`route`、`name` | Web Vitals 與路由切換耗時（histogram；[`07-apm-service.md`](./07-apm-service.md) §3.4） |
| `apm_envelopes_total` | `result` | 收到的 envelope（`accepted`、`rate_limited`、`invalid`、`unauthorized`） |
| `apm_items_total` | `project`、`type` | envelope 裡的項目 |
| `apm_events_total` | `project`、`level`、`release` | 存下的錯誤事件 |

`release` 每次部署都是新值：每個專案只保留最近看到的 `APM_RELEASE_LABEL_LIMIT`（預設 10）個，被淘汰的 release 連同它的時間序列一起刪掉（§9.2 D13）；
沒有 release 的是 `unknown`，格式不對的是 `other`。看舊版本的錯誤數要回到 Prometheus 的歷史資料。

### 5.2 issues 與堆疊

Grafana 以 [Infinity](https://grafana.com/grafana/plugins/yesoreyeram-infinity-datasource/) 外掛讀 apm-service 的查詢 API（Sentry 相容，[`07-apm-service.md`](./07-apm-service.md) §3.3），
在「前端」儀表板顯示：

- **issues 表**：`GET /api/0/projects/b2b-system/<project>/issues/?statsPeriod=…`，依最後出現排序。點標題 → 同一個儀表板帶上 `issue` 變數。
- **最新事件** 與 **堆疊**：`GET /api/0/organizations/b2b-system/issues/<id>/events/latest/`，堆疊是 sourcemap 還原過的（還原在 apm-service 查詢時做）。

請求由 Grafana 的伺服器端發出：`APM_AUTH_TOKEN` 只存在 Grafana 的資料來源（`secureJsonData`），瀏覽器拿不到；資料來源的 `allowedHosts` 只允許 apm-service，
儀表板的網址寫錯也不會把 token 送到別處（§9.2 D14）。

### 5.3 前端與 api 的 trace 沒有串起來

前端仍是 `tracePropagationTargets: []`（[`frontend/19-observability.md`](./frontend/19-observability.md) §5）：api 的 trace 從 api 開始，看不到使用者在瀏覽器上的那一段。
理由與日後要串時的做法見 §9.2 D15。要對照前端錯誤與後端時，用錯誤頁「複製錯誤資訊」裡的 `requestId` 搜尋日誌。

---

## 6. 部署

### 6.1 啟用

```bash
docker compose --env-file deploy/prod.env -f docker-compose.prod.yml -f docker-compose.monitoring.yml up -d --build
```

`docker-compose.monitoring.yml` 疊在正式的 compose 上（§9.2 D10）：加入 `prometheus`、`tempo`、`postgres-exporter`、`grafana`，把 api、external-api、apm-service 接上
`monitoring` 網路，讓 api 開 `/metrics`（`MONITORING_ENABLED` 預設改成 `true`，§1.1）並把 trace 送到 Tempo。不疊這份檔案就是監控整套關閉。
啟用時 `deploy/prod.env` 要多兩個值（範本見 `deploy/prod.env.example` 的「監控」）：

| 變數 | 說明 |
| --- | --- |
| `GRAFANA_ADMIN_PASSWORD` | Grafana 的 admin 密碼 |
| `POSTGRES_MONITOR_PASSWORD` | postgres-exporter 用的 `b2b_monitor` 角色（`pg_monitor`，只讀統計、讀不到業務資料） |
| `APM_AUTH_TOKEN` | APM 開啟時已經是必填；Grafana 用它讀 apm-service 的查詢 API。APM 關閉時可以留空 |

APM 關閉（沒有 `apm` profile，[`07-apm-service.md`](./07-apm-service.md) §8.1）時監控照樣疊得上：apm-service 不存在，Prometheus 的 `apm-service` 目標顯示 down
（沒有告警盯它）、Grafana 的 APM 資料來源與「前端」儀表板沒有資料，其他儀表板與告警不受影響。

`b2b_monitor` 由 `deploy/postgres/10-roles.sh` 在 **第一次初始化資料目錄時** 建立（設了 `POSTGRES_MONITOR_PASSWORD` 才建）。既有部署要先以超級使用者執行一次
`deploy/monitoring/create-monitor-role.sql`（檔頭有指令）。

選填的值：`GRAFANA_ROOT_URL`、`MONITORING_BIND_ADDRESS`（預設 `127.0.0.1`）、`OTEL_TRACES_SAMPLER_ARG`（預設 `0.2`）、`PROMETHEUS_RETENTION`（`30d`）、
`PROMETHEUS_RETENTION_SIZE`（`20GB`）、`TEMPO_RETENTION`（`168h`）、`PROMETHEUS_MEM_LIMIT`、`TEMPO_MEM_LIMIT`。

### 6.2 網路與存取

| 服務 | 對主機 | 網路 |
| --- | --- | --- |
| api、external-api 的 `/metrics`、OTLP | 不發布 | `monitoring`（只有監控的服務在裡面） |
| Prometheus、Tempo | 不發布 | `monitoring` |
| postgres-exporter | 不發布 | `data`（連 postgres）、`monitoring` |
| Grafana | `${MONITORING_BIND_ADDRESS:-127.0.0.1}:3300` | `monitoring` |

- 租戶的 nginx（`deploy/nginx*.conf`）不轉發任何監控的東西。從外面看 Grafana 經 SSH tunnel（`ssh -L 3300:127.0.0.1:3300 <主機>`），
  或在前置 LB 另開一個網域並加上 TLS 與存取限制。
- Grafana 關閉註冊與匿名存取，只有 admin；要給其他人帳號時在 Grafana 裡建立（之後可以接 apps/api 的 OIDC Provider，還沒做）。
- apm-service 的 `/metrics` 與查詢 API 原本就只開在 `APM_BIND_ADDRESS`；Prometheus 與 Grafana 經 `monitoring` 網路連 `apm-service:9100`。

### 6.3 告警

規則在 `deploy/monitoring/rules/b2b-alerts.yml`，Prometheus 評估、Grafana 的 Alerting 頁看得到狀態：

| 告警 | 條件（摘要） |
| --- | --- |
| `ApiDown` | api／external-api 2 分鐘抓不到指標 |
| `ApiHighErrorRate` | 5 分鐘內 5xx 超過 5%（每秒請求 > 0.5 時才判斷） |
| `ApiSlowRoute` | 某個路由的 p95 > 2 秒持續 10 分鐘 |
| `ApiEventLoopLag` | event loop 延遲 p99 > 0.5 秒持續 5 分鐘 |
| `Argon2Saturated` | 登入的密碼驗證排不到名額（`503 AUTH_BUSY`） |
| `MfaEmailCodeSlow` | Email 驗證碼從入列到寄出的 p95 > 60 秒持續 10 分鐘（[`backend/21-mfa.md`](./backend/21-mfa.md) §12）；短時間修不好時，平台可以暫時關掉 Email 驗證 |
| `TenantUnavailable` | 有租戶因 migration 落後或 DB 連不上而暫停服務 |
| `JobBacklog`、`JobFailures`、`OutboxRelayFailing` | 佇列積壓 > 500 筆 15 分鐘；15 分鐘內失敗 > 10 次；outbox 搬移失敗 |
| `PostgresDown`、`PostgresConnectionsHigh` | exporter 連不上；連線數超過 `max_connections` 的 70%（考慮 PgBouncer 的時候） |
| `FrontendErrorSpike`、`FrontendLcpPoor` | 某個前端某一版 15 分鐘內 > 50 筆錯誤；LCP p75 > 4 秒 |

門檻是起點，上線後依實際的基準值調整。**還沒有通知管道**：要寄信或推到聊天工具時，在 Grafana 設 contact point（YAML 放 `deploy/monitoring/grafana/provisioning/alerting/`），
或另加 Alertmanager。

### 6.4 Grafana

資料來源與儀表板都以檔案提供（`deploy/monitoring/grafana/provisioning/`、`deploy/monitoring/grafana/dashboards/`），在 Grafana 裡的修改不會存回檔案：
要改儀表板就改 JSON（可以在 Grafana 裡調好之後「Export → JSON」貼回來），重新部署。

| 資料來源 | uid | 說明 |
| --- | --- | --- |
| Prometheus | `prometheus` | 預設；exemplar 連到 Tempo |
| Tempo | `tempo` | 依 `service.name`、`b2b.tenant` 搜尋；trace → 同一服務的指標 |
| APM | `apm` | Infinity 外掛，網址 `APM_QUERY_URL`（正式 `http://apm-service:9100`），Bearer token 是 `APM_AUTH_TOKEN` |

| 儀表板 | uid | 內容 |
| --- | --- | --- |
| api 概況 | `b2b-api` | 每秒請求、5xx 比例、p95、event loop；依路由的流量與延遲、狀態碼、被限流的桶；CPU、記憶體、GC；並行上限；快取命中率與筆數；WebSocket |
| 容量與資料庫 | `b2b-capacity` | Postgres 連線（依 database 與狀態）與預算、租戶連線池、交易時間、提交與回滾、shared buffers 命中率、鎖、database 大小、最耗時的查詢（pg_stat_statements） |
| 背景工作 | `b2b-jobs` | 佇列深度、積壓、執行結果、失敗、耗時 |
| 前端（錯誤與 Web Vitals） | `b2b-frontend` | LCP／INP／CLS／FCP／TTFB 的 p75（Google 的門檻上色）、依 release 的錯誤、收件結果、issues 表、最新事件與堆疊、頁面的 p75 |

「最耗時的查詢」以 `queryid` 表示；要看 SQL 時在 Postgres 執行 `SELECT query FROM pg_stat_statements WHERE queryid = <id>`（exporter 不輸出 SQL 本文，避免把參數帶進指標）。

### 6.5 保留與容量

| 資料 | 保留 | 存放 |
| --- | --- | --- |
| 指標 | `PROMETHEUS_RETENTION`（30 天）或 `PROMETHEUS_RETENTION_SIZE`（20 GB），先到者為準 | volume `prometheus-data` |
| trace | `TEMPO_RETENTION`（7 天） | volume `tempo-data`（本機磁碟） |
| Grafana 的使用者、偏好 | 永久 | volume `grafana-data` |

時間序列的數量大約是「實際出現的（方法 × 路由 × 狀態碼）組合 × 15」（12 個 bucket 加上 `+Inf`、`_sum`、`_count`），再加上固定的幾百條。
trace 的量與取樣率成正比：每秒 50 個請求、取樣 20% 約每天 86 萬個 trace。量大或要多台時把 Tempo 改成物件儲存（`storage.trace.backend: s3`）。

---

## 7. 本機開發

```bash
pnpm monitoring:up     # docker-compose.yml 的 monitoring profile：Prometheus（:9090）、Tempo（:4318）、postgres-exporter、Grafana（:3300）
pnpm monitoring:down
```

- api、external-api、apm-service 跑在主機上（`pnpm dev`、`pnpm dev:external-api`、`pnpm dev:apm`），Prometheus 經 `host.docker.internal` 抓
  （`deploy/monitoring/prometheus.dev.yml`）。沒有啟動的目標在 Prometheus 的 Targets 頁顯示 down，不影響其他目標。Linux 的 Docker 要讓 api 聽 `0.0.0.0`（`LISTEN_HOST`）。
- 要看 trace：`.env` 設 `OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`，重啟 api。
- 不需要監控時 `.env` 設 `MONITORING_ENABLED=false`：api 不開 9464／9465、不量指標也不送 trace（§1.1）。
- Grafana 不必登入就能看儀表板、用 Explore；要改儀表板以 admin／admin 登入。
- 開發的 postgres 沒有載入 pg_stat_statements：「最耗時的查詢」是空的。

---

## 8. 測試

| 對象 | 測試 |
| --- | --- |
| `ObservedGauge`（相加、取消登記、一個來源失敗） | `apps/api/src/core/metrics/__tests__/registry.spec.ts` |
| 路由標籤、HTTP 指標（樣板、掛載點、萬用路由、499） | `apps/api/src/core/metrics/__tests__/http-metrics.spec.ts` |
| `/metrics` 的輸出與 404；`MONITORING_ENABLED` 關閉時不開 port（`metricsPortOf`） | `apps/api/src/core/metrics/__tests__/metrics-server.spec.ts` |
| `MONITORING_ENABLED` 關閉時不載入 tracing（`tracingEndpointOf`） | `apps/api/src/core/tracing/__tests__/tracing-endpoint.spec.ts` |
| 正式 compose 沒疊／疊上監控時 api 的 `MONITORING_ENABLED` | `apps/api/src/core/config/__tests__/prod-compose-env.spec.ts` |
| 並行上限的指標 | `apps/api/src/core/concurrency/__tests__/limiter-metrics.spec.ts` |
| trace 的網址遮蔽 | `apps/api/src/core/tracing/__tests__/redact-url.processor.spec.ts` |
| 就緒檢查（每一項、event loop 門檻、逾時） | `apps/api/src/modules/health/__tests__/health.service.spec.ts` |
| apm-service 的錯誤事件數與 release 淘汰 | `apps/apm-service/src/metrics/__tests__/apm-metrics.spec.ts`、`apps/apm-service/test/sentry-api.spec.ts` |

部署設定由 `sh deploy/check-monitoring.sh` 檢查（CI 的 deploy job 也跑）：正式 ＋ 監控的 compose 疊加（APM 開啟與關閉各一次）、沒疊監控的正式 compose、本機的 `monitoring` profile、Prometheus 的設定與告警規則（`promtool`）、儀表板的 JSON 與資料來源 uid。PromQL 是否查得到資料沒有自動測試：改了儀表板或指標之後以 §7 起一套，確認 Prometheus 的 Targets 與 Rules 頁都是綠的、面板有資料。

---

## 9. 設計決策：後端可觀測性與監控

### 9.1 背景

2026-10-07 以前，api 只有日誌（`core/logger`，結構化、帶 `requestId`）、`/health` 與 `/health/ready`（平台 DB 與物件儲存）。
沒有任何指標或 tracing：答不了「哪支 API 變慢」「哪個租戶的 DB 有問題」「佇列有沒有積壓」「權限快取命中率多少」。
前端的錯誤與 Web Vitals 已經由 apps/apm-service 收下（[`frontend/19-observability.md`](./frontend/19-observability.md)），但只能以查詢 API 看，沒有圖表與告警。
限制：部署是單機的 docker compose、刻意不引入 Redis（[`01-system.md`](./01-system.md) §4.3）、租戶數可能很多、日誌與稽核有遮蔽個資的規則。

### 9.2 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | 指標用 `prom-client`，api 自己的 registry（不用全域的）；指標是模組層級的單例，清單集中在 `core/metrics/instruments.ts`；狀態型的指標用「抓取時才去問」的 `ObservedGauge`，來源以 `WeakRef` 登記 | 事實上的標準格式，社群的儀表板與 Node 的標準指標直接可用；單例讓 service 不必為了指標改建構子（既有的單元測試都直接 `new`）；`WeakRef` 讓測試建了又丟的 app 不必另外取消登記 |
| D2 | `/metrics` 另開一個 port（`METRICS_PORT`／`EXTERNAL_METRICS_PORT`），不掛在 Nest 的路由上、不驗證；靠網路隔離（compose 的 `monitoring` 網路、port 不發布） | 不經過租戶解析、限流與路由稽核；nginx 本來就只轉發 3000，不必在每份 nginx 設定擋 `/api/metrics`；與 apm-service 的 `/metrics` 同一種做法（提案的開放問題 1） |
| D3 | 指標不帶租戶標籤；租戶放在 span 的 `b2b.tenant` 與日誌 | 時間序列數 ＝ 租戶數 × 其他標籤，租戶多時 Prometheus 撐不住；要看某個租戶時看 trace 已經夠（開放問題 3） |
| D4 | 路由標籤是 Express 的路由樣板；沒有對到的請求是 `unmatched`，萬用的中介軟體樣板（`{/*splat}`）不算路由 | 實際網址帶 id，每個值都是一條新的序列；404 的路徑由客戶端決定 |
| D5 | tracing 用 OpenTelemetry，只做 trace（不用 OTel 的 metrics），以 OTLP/HTTP 送出；沒設 `OTEL_EXPORTER_OTLP_ENDPOINT` 時完全不載入；取樣是 parent-based ＋ 比例 | 一套指標就夠，兩套並存會有兩份不一致的數字；OTLP 讓 Tempo 之外的後端（Jaeger、商業服務）換了不必改程式；不設定時零成本 |
| D6 | 不做每一條查詢的 span（postgres.js 沒有 instrumentation）；改以 `db.transaction` 的 span 與 histogram 量交易，加上 postgres-exporter 的 pg_stat_statements 看查詢 | 包裝 postgres.js 的 `unsafe` 要碰 Drizzle 的內部、交易裡的查詢走的是另一個物件；連線池排隊多半是交易太長造成的，交易的時間比單一查詢更有用 |
| D7 | 網址裡的憑證參數在 span 建立時遮蔽，名單與日誌共用（`core/logger/sensitive-query.ts`） | `@opentelemetry/instrumentation-http` 記 `url.query`、Nest 的記 `url.full`，啟用連結的 `token`、OIDC 的 `code` 會原樣進 Tempo（驗證時發現，§9.4） |
| D8 | 就緒檢查加上 pg-boss 的連線池與 event loop 延遲；租戶 DB 不放；每一項最多 2 秒 | pg-boss 用自己的 `pg` 連線池，平台池正常不代表它正常；event loop 卡住時請求都在排隊，讓 LB 先導走；單一租戶不該拖垮整個程序（`Tenancy` 已經只對那個租戶 503） |
| D9 | 佇列深度讀 pg-boss 的 `getQueues()` 快照（最多落後約一分鐘），快取 15 秒，只在執行工作的程序回報 | 直接數 `pgboss.job` 會掃保留期內的所有工作；佇列在平台 DB、所有程序看到的是同一份，每個程序都回報會讓加總變好幾倍 |
| D10 | 監控是獨立的 `docker-compose.monitoring.yml`，疊在正式的 compose 上：Prometheus ＋ Tempo ＋ Grafana ＋ postgres-exporter；本機是 `docker-compose.yml` 的 `monitoring` profile | 選用：不用監控的部署不必多出必填變數與四個容器；疊加讓既有服務只多一個網路與幾個環境變數 |
| D11 | Grafana 只綁 `MONITORING_BIND_ADDRESS`（預設 `127.0.0.1`），資料來源與儀表板以檔案提供，UI 的修改不存回 | 儀表板進版控、可以 review；Grafana 有所有指標與 trace，不能和租戶的入口放在一起 |
| D12 | postgres-exporter 以只有 `pg_monitor` 的 `b2b_monitor` 角色連 `postgres` database；開 `stat_statements`（前 50 名，不含 SQL 本文） | 讀不到業務資料；pg_stat_statements 的 extension 建在 `postgres`；SQL 本文可能帶常數（雖然大多是參數化的），不進指標 |
| D13 | apm-service 新增 `apm_events_total{project,level,release}`；`release` 每個專案只保留最近 `APM_RELEASE_LABEL_LIMIT` 個，淘汰時刪掉它的時間序列 | 「新版本的錯誤是不是變多」是部署後最常問的問題；release 每次部署都是新值，不淘汰就會無限增加 |
| D14 | Grafana 以 Infinity 外掛讀 apm-service 的查詢 API（issues、事件、還原過的堆疊），token 存在資料來源、`allowedHosts` 只允許 apm-service | 不必在 apm-service 再做一套網頁；請求在 Grafana 的伺服器端發出，token 不經過瀏覽器 |
| D15 | 前端 **不** 把 `traceparent` 傳給 api（維持 `tracePropagationTargets: []`） | 前端的取樣率是 10%，api 的取樣是 parent-based：傳了之後 api 的 trace 也只剩 10%，而且前端沒有追蹤 fetch，串起來也只多一段 pageload。要串時的做法：前端開 `propagateTraceparent` 並追蹤 fetch、api 的取樣改成不看上游的未取樣決定，apm-service 把 span 轉成 OTLP 送 Tempo |
| D16 | Tempo 單一程序、本機磁碟、保留 7 天，開 `local-blocks`（TraceQL metrics，給 Grafana 的 Traces Drilldown） | 單機部署的量用本機磁碟就夠；設定裡寫好改物件儲存的方式 |

提案時的開放問題與結論：

| 問題 | 結論 |
| --- | --- |
| `/metrics` 的存取控制：只開在內網，還是要 token？ | 內網：另開 port、只在 `monitoring` 網路（D2） |
| 前端錯誤回報要自建端點還是接 Sentry？ | 已在前端可觀測性時結論：自建模擬 Sentry API 的 apm-service（[`frontend/19-observability.md`](./frontend/19-observability.md) §9.2 D1） |
| 要不要有依租戶的指標？ | 不要；租戶在 trace 與日誌（D3） |

### 9.3 評估過的方案

| 方案 | 結論 |
| --- | --- |
| `/metrics` 掛在 api 的路由上（`@Public()`） | 不採用：要在每份 nginx 設定擋 `/api/metrics`，漏了就對外公開；還要繞過 `TenantMiddleware` 與限流（D2） |
| `/metrics` 加 Bearer token | 不採用：Prometheus 與 api 在同一個私有網路，token 只多一個要輪替的秘密 |
| OpenTelemetry 的 metrics（OTLP 或 Prometheus exporter） | 不採用：`prom-client` 的 Node 標準指標與社群儀表板更成熟；trace 與指標分開，兩邊都換得掉（D5） |
| `@opentelemetry/sdk-node` ＋ auto-instrumentations 整包 | 不採用：會載入幾十個用不到的 instrumentation（含對 `pg` 的，pg-boss 的輪詢會產生大量 span）；只列需要的 |
| `@willsoto/nestjs-prometheus` | 不採用：要掛在 Nest 的路由上（同第一列）；自己寫只有幾十行 |
| 包裝 postgres.js 產生每一條查詢的 span | 不採用（D6） |
| Loki ＋ Grafana Alloy 收日誌 | 這一版不做：要掛 Docker socket 或改 logging driver；日誌已經帶 `trace_id`，要做時從 trace 跳日誌只差資料來源的設定 |
| Alertmanager | 這一版不做：還沒有決定通知管道；規則已在 Prometheus，加上它只要多一個服務與 `alerting` 設定 |
| SigNoz、OpenObserve、Uptrace 這類一體化的服務 | 不採用：多一個 ClickHouse 要維運，也用不到 Grafana 的現成儀表板 |
| 在 apm-service 做 issues 的網頁 | 不採用：Grafana ＋ Infinity 已經能列表、連結、顯示堆疊（D14） |
| 依租戶的指標、或只對前 N 個租戶加標籤 | 不採用（D3） |

### 9.4 實作紀錄

- `@opentelemetry/instrumentation-express`（0.71）對 Nest 12 的 Express 5 不產生任何 span，根 span 只有 `GET`。拿掉它，改由 http instrumentation 的
  `applyCustomAttributesOnSpan` 以 §2.2 的路由函式補上名稱與 `http.route`。那個函式因此搬到不依賴任何套件的 `core/metrics/route-label.ts`（tracing 在其他模組之前載入）。
- 瀏覽器驗證時發現 `url.query`、`url.full` 帶著原始的 query string，加上 D7；遮蔽的名單也因此從 `core/logger/redact.ts` 搬到不依賴 pino 的 `sensitive-query.ts`。
- Nest 的 `forRoutes('*')` 在 Express 5 變成 `{/*splat}`，中介軟體也會把它設在 `req.route`：404 的請求一開始都歸到這個樣板，加上萬用路由的判斷（D4）。
- `prom-client` 沒有標籤的 gauge 在沒有值時回 `0`（不是不輸出），`api_tenant_pools_open`、`api_realtime_connections` 因此一直有值。
- Grafana 13 的匿名存取只支援 Viewer：本機開發改成匿名 Viewer ＋ `GF_USERS_VIEWERS_CAN_EDIT`（可以用 Explore）。
- Infinity 外掛的資料來源設 `url` 之後，查詢只寫路徑；正式與本機的 apm-service 位址不同，儀表板因此不必改。
- 提案原本把「依租戶最近一次連線失敗的時間」當成指標；為了不帶租戶標籤（D3），改成 `api_tenant_unavailable_total{reason}` ＋ 日誌的 `tenant` 欄位。
