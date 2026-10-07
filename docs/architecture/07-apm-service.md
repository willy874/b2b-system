# APM Service（模擬 Sentry API 的前端錯誤收件）

`apps/apm-service`（`@b2b-system/apm-service`）是一個 **模擬 Sentry API** 的獨立 HTTP 服務，
收兩個前端送來的錯誤事件與 Web Vitals，存在本機磁碟的 `.data/`。它照 Sentry 的設計：收件端點、envelope 格式、
DSN 驗證、429 的退避標頭、release 檔案（sourcemap）上傳與查詢 API 的路徑都與 Sentry 相同，所以

- 前端直接用官方的 `@sentry/browser`（[`frontend/19-observability.md`](./frontend/19-observability.md)）；
- 換成真正的 Sentry 或自架的 GlitchTip 時 **只改 DSN 與 CSP**，前端程式不變。

> 定位：與 [`apps/file-storage`](./03-file-storage.md) 相同，是「模擬外部服務」的小服務。只做 SDK 會呼叫的收件端點與少數查詢端點，
> 沒有網頁介面、告警與通知（設計決策見 [`frontend/19-observability.md`](./frontend/19-observability.md) §9）：圖表、issues 列表與告警在 Grafana
> （[`08-monitoring.md`](./08-monitoring.md) §5），由 Grafana 讀這裡的 `/metrics` 與查詢 API。

---

## 1. 啟動

```bash
pnpm dev:apm      # 單獨啟動（tsx watch），預設 http://127.0.0.1:9100
```

`pnpm dev` **不** 啟動它：開發時前端預設不送出（只 `console.debug`，[`frontend/19-observability.md`](./frontend/19-observability.md) §9.2 D11）。要在本機收事件時另外起它，並以 shell 設定前端的
`VITE_APM_PROJECT_ID`、`VITE_APM_PUBLIC_KEY`（[`frontend/19-observability.md`](./frontend/19-observability.md) §8）。

環境變數讀根目錄 `.env`（與 `apps/api` 共用），缺少或格式錯誤時 **啟動即失敗**：

| 變數 | 預設 | 說明 |
| --- | --- | --- |
| `APM_HOST` | `127.0.0.1` | 綁定的位址 |
| `APM_PORT` | `9100` | 埠號 |
| `APM_DATA_DIR` | `.data` | 資料目錄；相對路徑以 `apps/apm-service/` 為基準（已被 `.gitignore`） |
| `APM_ORG` | `b2b-system` | 查詢 API 路徑裡的 organization slug |
| `APM_PROJECTS` | —（必填） | `<數字 id>:<slug>:<public key>`，逗號分隔；例 `1:backstage:…,2:platform:…`。public key 16～64 碼英數 |
| `APM_AUTH_TOKEN` | —（必填） | 查詢與上傳 API 的 `Authorization: Bearer <token>`，至少 16 字 |
| `APM_RETENTION_DAYS` | `30` | 錯誤事件保留天數（1～365） |
| `APM_MAX_ENVELOPE_BYTES` | `1048576` | 一個 envelope（解壓縮後）的上限 |
| `APM_MAX_SOURCEMAP_BYTES` | `52428800` | 一個 sourcemap 檔案的上限 |
| `APM_RATE_LIMIT_PER_MINUTE` | `120` | 每個來源 IP、每個專案、每分鐘可以收幾個 envelope |
| `APM_TRUST_PROXY` | `false` | 在 nginx 後面時設 `true`：以 `X-Real-IP` 當來源 IP。直接對外時一定要關掉，否則任何人都能偽造來源繞過限流 |
| `APM_ROUTE_LABEL_LIMIT` | `200` | `/metrics` 的 `route` 標籤每個專案最多幾種，超過的歸 `other` |
| `APM_RELEASE_LABEL_LIMIT` | `10` | `apm_events_total` 的 `release` 標籤每個專案保留最近幾個；被淘汰的連同時間序列一起刪掉（[`08-monitoring.md`](./08-monitoring.md) §9.2 D13） |

---

## 2. 專案、DSN 與同源

每個前端是一個專案：backstage 是 `1`、apps/platform 是 `2`。DSN 的形狀是 Sentry 的
`<協定>://<public key>@<host>/<路徑前綴>/<專案 id>`：

```
https://<public key>@acme.example.com/apm/1
```

- **同源**：瀏覽器把事件送到自己網域的 `/apm/`，nginx（正式）與 vite（開發）轉給 apm-service 並去掉 `/apm` 前綴。
  CSP 的 `connect-src 'self'` 不必放寬；租戶網域是萬用網域加上客戶自有網域，DSN 由前端在執行時以 `location.host` 組成（[`frontend/19-observability.md`](./frontend/19-observability.md) §9.2 D2）。
- **public key 不是秘密**：它會出現在前端產物裡，只用來確認事件送到正確的專案。防濫用靠限流與內容上限（§6）。
- **只轉發收件端點**：nginx 只把 `^/apm/api/<數字>/envelope/?$` 轉給 apm-service（`deploy/nginx.conf`、`deploy/nginx.platform.conf`）；
  查詢、上傳 sourcemap 與 `/metrics` 只開在主機的內部介面（compose 的 `APM_BIND_ADDRESS`，預設 `127.0.0.1:9100`）。`deploy/check-nginx.sh` 驗證這個範圍。

---

## 3. 端點

錯誤一律回 Sentry 的格式 `{ "detail": "…" }`。

### 3.1 收件（SDK 用）

`POST /api/:projectId/envelope/`

| 項目 | 行為 |
| --- | --- |
| 驗證 | DSN 的 public key：query `sentry_key`（瀏覽器 SDK）、`X-Sentry-Auth: Sentry sentry_key=…`，或 envelope header 的 `dsn`（SDK 的 `tunnel`）。不符 `401`，專案不存在 `404` |
| 內容 | [envelope](https://develop.sentry.dev/sdk/data-model/envelopes/)；`Content-Encoding` 支援 `gzip`、`deflate`、`br`（上限套在解壓縮後的大小） |
| `event` | 遮罩後存檔（§4），並寫一行 `warn` 日誌 `client error`（`project`、`eventId`、`groupId`、`title`、`release`、`transaction`、`userId`、`host`） |
| `transaction`、`span` | 取出 Web Vitals 記進 `/metrics`（§3.4），本身不存 |
| 其他項目 | `session`、`client_report`、`attachment`…：接受後丟棄 |
| 回應 | `200 { "id": "<event id>" }` |
| 限流 | 超過 `APM_RATE_LIMIT_PER_MINUTE` 回 `429`，帶 `Retry-After` 與 `X-Sentry-Rate-Limits: <秒數>::organization`；SDK 依此暫停送出 |
| 上限 | 超過 `APM_MAX_ENVELOPE_BYTES` 回 `413`；一個 envelope 最多 100 個項目 |

不支援 Sentry 舊的 `/api/:projectId/store/`（SDK v8 起只送 envelope）。

### 3.2 release 檔案（sourcemap）

`Authorization: Bearer <APM_AUTH_TOKEN>`。

| 端點 | 說明 |
| --- | --- |
| `POST /api/0/projects/:org/:project/releases/:version/files/` | Sentry 舊版的 release 檔案上傳：multipart，欄位 `file`、`name`（例 `~/assets/index-abc123.js.map`）。成功 `201`；同名已存在 `409` |
| `GET /api/0/projects/:org/:project/releases/:version/files/` | 列出那個 release 的檔案（`id`、`name`、`size`、`sha1`、`dateCreated`） |

`version`（release）只能是英數與 `. _ + -`，最多 100 字；`name` 接受 `~/…`、`/…` 或完整網址，不接受 `..` 與空段落。

### 3.3 查詢

`Authorization: Bearer <APM_AUTH_TOKEN>`。

| 端點 | 說明 |
| --- | --- |
| `GET /api/0/projects/:org/:project/issues/` | 依 fingerprint 分組的錯誤（[`frontend/19-observability.md`](./frontend/19-observability.md) §9.2 D8）。參數：`statsPeriod`（`24h`、`14d`、`90m`、`2w`，預設 24 小時，最長到保留天數）、`query`、`sort`（`date` 最後出現、`freq` 次數、`new` 第一次出現）、`limit`（預設 25，最多 100） |
| `GET /api/0/projects/:org/:project/events/:eventId/` | 單一事件；堆疊以那一版的 sourcemap 還原（§5） |
| `GET /api/0/organizations/:org/issues/:issueId/events/latest/` | 某個 issue 最新的一筆事件 |

`query` 是 Sentry 搜尋語法的子集：`release:<v>`、`transaction:<path 樣板>`、`level:<等級>`、`host:<網域>`，其他文字比對標題；`is:…` 忽略。

issue 的欄位沿用 Sentry（`id`、`shortId`、`title`、`culprit`、`level`、`count`（字串）、`userCount`、`firstSeen`、`lastSeen`），
另外有 `lastRelease` 與 `latestEventID`。事件的 `entries` 有 `exception`（每一層 `filename`、`lineNo`、`colNo`、`function`、`context`，
還原過的另有 `raw` 與 `symbolicated: true`）、`message`、`breadcrumbs`、`request`。

```bash
curl -s -H "Authorization: Bearer $APM_AUTH_TOKEN" \
  "http://127.0.0.1:9100/api/0/projects/b2b-system/backstage/issues/?query=release:1a2b3c4&statsPeriod=24h"
```

### 3.4 指標與存活

| 端點 | 說明 |
| --- | --- |
| `GET /metrics` | Prometheus 文字格式：`apm_envelopes_total{result}`、`apm_items_total{project,type}`、`apm_events_total{project,level,release}`（存下的錯誤事件；`release` 只保留最近 `APM_RELEASE_LABEL_LIMIT` 個）、`apm_web_vital{project,route,name}`（histogram；`cls` 無單位，其餘毫秒；`name` 是 `lcp`、`inp`、`cls`、`fcp`、`ttfb`、`navigation`）。不驗證，只開在內部介面；Grafana 的「前端」儀表板與告警用它（[`08-monitoring.md`](./08-monitoring.md) §5） |
| `GET /_health` | 存活檢查（容器的 HEALTHCHECK） |

---

## 4. 儲存格式

```
.data/
├── events/<project>/<yyyy-mm-dd>.ndjson       錯誤事件；一行一筆，日期是 apm-service 收到的日期（UTC）
└── sourcemaps/<project>/<release>/<相對路徑>   上傳的 sourcemap（例 sourcemaps/backstage/1a2b3c4/assets/index-abc.js.map）
```

- 事件是遮罩、截斷後的形狀（`apps/apm-service/src/store/types.ts` 的 `StoredEvent`）：不是 Sentry 的原始 payload。
- 查詢讀最近幾天的檔案（新的在前）；寫到一半就停機時不完整的最後一行會被略過。
- 超過 `APM_RETENTION_DAYS` 的事件檔在啟動時與之後每 6 小時刪除。sourcemap 不自動刪除（量小；舊 release 不再需要時手動刪資料夾）。
- 換成資料庫或物件儲存時只換 `EventStore`、`SourcemapStore` 兩個類別。

---

## 5. sourcemap 的上傳

前端以 `BUILD_SOURCEMAP=hidden` 建置：產生 `.map` 但 js 裡不留參照。`.map` **不進正式映像**（nginx 會原樣提供 `dist` 裡的每個檔案）。

**本機建置**（`.data/` 就是儲存空間）：

```bash
APP_RELEASE=$(git rev-parse --short=7 HEAD) BUILD_SOURCEMAP=hidden pnpm --filter @b2b-system/backstage build
pnpm --filter @b2b-system/apm-service upload-sourcemaps \
  --project backstage --release $(git rev-parse --short=7 HEAD) --dir apps/backstage/dist --delete
```

`upload-sourcemaps` 以 `~/<相對路徑>` 命名、依序上傳；同名已存在（`409`）視為已上傳，同一個 release 重跑是安全的。
`--dir` 以執行指令的目錄為基準；位址是 `--url`、`APM_UPLOAD_URL`，或 `http://<APM_HOST>:<APM_PORT>`；token 是 `APM_AUTH_TOKEN`。
`--delete` 把上傳過的 `.map` 從 `dist/` 刪掉。

**Docker**：前端的 Dockerfile 在建置階段把 `.map` 搬到 `/sourcemaps`，另有一個只含 sourcemap 的 `sourcemaps` stage：

```bash
export APP_RELEASE=$(git rev-parse --short=7 HEAD)
docker build -f apps/backstage/Dockerfile --target sourcemaps --build-arg APP_RELEASE \
  --output type=local,dest=.sourcemaps/backstage .
pnpm --filter @b2b-system/apm-service upload-sourcemaps \
  --project backstage --release $APP_RELEASE --dir .sourcemaps/backstage --url http://127.0.0.1:9100
```

部署時以同一個 `APP_RELEASE` 起 compose（`APP_RELEASE=… docker compose … up -d --build`），產物裡的 release 才與 sourcemap 對得上。
堆疊在 **查詢時** 還原（[`frontend/19-observability.md`](./frontend/19-observability.md) §9.2 D5）：sourcemap 比事件晚上傳也能還原。

---

## 6. 遮罩與上限

前端送出前已經遮罩（[`frontend/19-observability.md`](./frontend/19-observability.md) §4）；apm-service 收件時 **再做一次**（[`frontend/19-observability.md`](./frontend/19-observability.md) §9.2 D7），
防止 SDK 升級、設定錯誤或有人直接打收件端點時個資落地（`apps/apm-service/src/ingest/scrub.ts`、`normalize.ts`）：

| 項目 | 處理 |
| --- | --- |
| 文字（例外訊息、message、breadcrumb） | 去掉網址的 query string 與 fragment；email → `[email]`；JWT、`b2bt_…`、32 字以上的長字串 → `[token]`；截斷 |
| `user` | 只留 `id` |
| `request` | 只留去掉 query 的 `url` 與 `User-Agent`；`headers`、`cookies`、`data`、`query_string` 丟掉 |
| `extra`、`contexts` | 丟掉 |
| breadcrumb 的 `data` | 只留 `method`、`status_code`、`url`、`from`、`to`、`route`、`requestId`、`reason` |
| 數量 | 例外 5 層、每層堆疊 100 層、breadcrumb 50 則、tag 50 個 |

限流是程序內的固定視窗（每個來源 IP × 專案，每分鐘）；apm-service 是單一實例的服務，不需要共享計數。

---

## 7. 程式結構

```
apps/apm-service/src/
├── main.ts                 進入點：讀 .env、建 services、定期清過期事件、listen
├── config.ts               環境變數（zod）
├── server.ts               node:http 伺服器：路由、Bearer 驗證、錯誤回應、存取日誌
├── router.ts               端點清單（路徑、方法、驗證方式）
├── services.ts             程序層級的物件（EventStore、SourcemapStore、Symbolicator、ApmMetrics、RateLimiter）
├── envelope/parse.ts       envelope 解析
├── ingest/                 auth（DSN、Bearer）、scrub、normalize（Sentry 事件 → 存檔格式）、fingerprint、vitals、rate-limit
├── handlers/               ingest（收件）、release-files（上傳與列出）、query（issues、事件）
├── store/                  EventStore（NDJSON）與事件的型別
├── sourcemaps/             SourcemapStore（.data/sourcemaps）、Symbolicator（@jridgewell/trace-mapping）
├── metrics/                最小的 Prometheus counter／histogram 與 apm 的指標
└── cli/upload-sourcemaps.ts
```

依賴只有 `zod` 與 `@jridgewell/trace-mapping`；不依賴任何 workspace package，也不被任何 package import
（[`conventions/07-layer-dependencies.md`](../conventions/07-layer-dependencies.md) §1）。前端的遮罩規則與 `ingest/scrub.ts` 各一份，改一邊要改另一邊。

---

## 8. 建置與部署

```bash
pnpm --filter @b2b-system/apm-service build   # esbuild 打成單一檔案 dist/main.js
```

`apps/apm-service/Dockerfile`：runtime 映像只有 `dist/`，以非 root 執行，資料在 volume `/data`。`docker-compose.prod.yml` 的 `apm-service`：

| 設定 | 值 |
| --- | --- |
| `APM_PROJECTS` | `1:backstage:${APM_BACKSTAGE_PUBLIC_KEY},2:platform:${APM_PLATFORM_PUBLIC_KEY}` |
| `APM_AUTH_TOKEN` | `deploy/prod.env` 必填 |
| `APM_TRUST_PROXY` | `true`（只經 nginx 進來；nginx 以 real_ip 算好的來源放在 `X-Real-IP`） |
| 網路 | `edge`（兩個前端的 nginx 轉發收件端點） |
| 埠 | `${APM_BIND_ADDRESS:-127.0.0.1}:9100`：上傳 sourcemap、查詢 API、Prometheus 抓 `/metrics` |

兩個前端的 nginx 啟動時就解析 upstream 的名稱，所以 compose 讓它們等 apm-service healthy。`deploy/smoke-test.sh` 經兩個 nginx 各送一個 envelope。

---

## 9. 測試

```bash
pnpm --filter @b2b-system/apm-service test
```

| 範圍 | 位置 |
| --- | --- |
| 單元：envelope 解析、驗證、遮罩、事件正規化與 fingerprint、Web Vitals 的取出、限流、事件與 sourcemap 的儲存、還原堆疊、指標 | `src/**/__tests__/*.spec.ts` |
| 整合：以 `@sentry/core`（瀏覽器 SDK 底層的同一套）產生 envelope 與收件網址，走過收件 → issues → 事件詳情的 sourcemap 還原、gzip、401／413／429、`/metrics`、release 檔案 | `test/sentry-api.spec.ts` |
