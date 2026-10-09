---
name: app-start
description: 啟動本 repo 所有開發用的服務（postgres、Mailpit、api、backstage、platform、file-storage，選配 Grafana／Prometheus／Tempo 監控、apm／external-api／mock-idp／mock-messaging／storybook），等到全部就緒後在內建瀏覽器逐一開分頁，並列出可點擊的服務清單。使用者說「/app-start」「把開發環境跑起來」「啟動全部服務」「開 dev」「開 Grafana／監控」「preview 全部服務」時使用。
---

# app-start

一次把開發環境跑起來，並在 Browser pane 開好每個有畫面的服務，最後給一張可點擊的清單。
服務的定義在 [`.claude/launch.json`](../../launch.json)；指令與埠的事實來源是根目錄 `package.json`、`.env` 與 `CLAUDE.md`「常用指令」；
監控的事實來源是 [`docs/architecture/08-monitoring.md`](../../../docs/architecture/08-monitoring.md) §7。

## 0. 參數

| 參數 | 額外啟動 |
| --- | --- |
| （無） | 只有核心服務（`pnpm dev`） |
| `all` | 核心 ＋ `monitoring`、`apm`、`external-api`、`mock-idp`、`mock-messaging`、`storybook` |
| 個別名稱，如 `monitoring apm` | 核心 ＋ 指定的那幾個 |

`monitoring` 也接受 `grafana`、`監控` 這類說法。

## 1. 服務清單

| 服務 | 怎麼啟動 | 埠 | 開分頁的網址 | 就緒判斷 |
| --- | --- | --- | --- | --- |
| backstage（租戶後台） | launch.json `dev` | 5173 | http://localhost:5173 | HTTP 200 |
| platform（登入與平台管理） | `dev` 一併啟動 | 5175 | http://localhost:5175 | HTTP 200 |
| api（Swagger） | `dev` 一併啟動 | 3000 | http://localhost:3000/docs | `GET /health` 200 |
| api 的 `/metrics` | `dev` 一併啟動 | 9464 | 不開分頁 | `GET /metrics` 200 |
| Mailpit（看信） | `dev` 一併啟動（docker） | 8025 | http://localhost:8025 | HTTP 200 |
| file-storage（S3 相容） | `dev` 一併啟動 | 9000 | 不開分頁（沒有畫面） | 埠在聽 |
| postgres | `dev` 一併啟動（docker） | 5432 | 不開分頁 | 埠在聽 |
| Grafana（選配 `monitoring`） | `pnpm monitoring:up`（docker） | 3300 | http://localhost:3300/d/b2b-api | `GET /api/health` 200 |
| Prometheus（選配 `monitoring`） | 同上 | 9090 | http://localhost:9090/targets | `GET /-/ready` 200 |
| Tempo（選配 `monitoring`） | 同上 | 4318 | 不開分頁（trace 在 Grafana 的 Explore 看） | 埠在聽 |
| postgres-exporter（選配 `monitoring`） | 同上 | — | 不開分頁 | Prometheus 的 target `postgres` 為 up |
| apm-service（選配） | launch.json `apm` | 9100 | 不開分頁（只有收件 API） | 埠在聽 |
| external-api（選配） | launch.json `external-api` | 3001 | http://localhost:3001/docs | 埠在聽 |
| mock-idp（選配） | launch.json `mock-idp` | 4455 | 不開分頁 | 埠在聽 |
| mock-messaging（選配） | launch.json `mock-messaging` | 4466 | 不開分頁（`/_mock/messages` 看送出的簡訊與 Bot 訊息；api 要設 `MFA_*_API_URL=http://localhost:4466`） | 埠在聽 |
| storybook（選配） | launch.json `storybook` | 6006 | http://localhost:6006 | HTTP 200 |

Grafana 的儀表板（uid → 網址 `http://localhost:3300/d/<uid>`，定義在 `deploy/monitoring/grafana/dashboards/`）：

| uid | 標題 |
| --- | --- |
| `b2b-api` | api 概況 |
| `b2b-capacity` | 容量與資料庫 |
| `b2b-jobs` | 背景工作 |
| `b2b-frontend` | 前端（錯誤與 Web Vitals） |

本機的 Grafana 不必登入就能看儀表板與 Explore；要改儀表板以 admin 登入（帳密見 08-monitoring.md §7）。

## 2. 步驟

### 2.1 先看哪些已經在跑

另一個對話常開著 `pnpm dev`；**已經在聽的埠不要再起一次**（Vite 會跳到下一個埠、nest 會撞埠）。

```bash
lsof -nP -iTCP -sTCP:LISTEN | grep -E ':(3000|3001|3300|4318|4455|5173|5175|5432|6006|8025|9000|9090|9100|9464)\b'
```

- 5173 與 3000 都在聽 → 核心已在跑，跳過核心的啟動，只處理還沒起的選配服務。
- 只有部分在聽（例如 5173 在、3000 不在）→ 不要硬起 `dev`；回報哪些在、哪些不在，問使用者要不要先停掉殘留的程序。
- 3000 在聽、但 9464 不在 → api 可能是合併新依賴之前起的舊程序，見 §3。
- storybook 的 6006 被佔用時改用 `storybook-alt`（6007）。

### 2.2 前置檢查

```bash
cd <repo 根目錄>
docker info >/dev/null 2>&1 && echo docker-ok || echo docker-down
# lockfile 比安裝結果新 = 拉了新的 main 還沒 install
[ pnpm-lock.yaml -nt node_modules/.modules.yaml ] && echo need-install || echo deps-ok
```

- Docker 沒開就停下來請使用者開 Docker Desktop（postgres、Mailpit、監控都是 docker）。
- `need-install` → 先 `source ~/.nvm/nvm.sh && nvm use 24 && pnpm install`。漏掉這步時 api 的 `nest --watch` 會編譯失敗，
  但舊程序繼續佔著 3000，表面上看起來正常（實際踩過：合併監控後缺 `prom-client`，`/metrics` 一直沒起來）。
  核心原本就在跑時，install 完要重啟 `dev` 才會生效——那不是這次啟動的程序就先問使用者。

### 2.3 啟動

dev server 一律用 `mcp__Claude_Browser__preview_start`，**不要用 Bash 起 dev server**：

1. `preview_start { name: "dev" }`：build `packages/*` → postgres ＋ Mailpit → api、backstage、platform、file-storage。它會開 5173 的分頁。
2. 依參數再對每個選配的 dev server `preview_start { name: "<launch.json 名稱>" }`。
3. `monitoring`：它是 docker 容器、不是 dev server，用 Bash 跑（在 repo 根目錄、Node 24）：

   ```bash
   pnpm monitoring:up
   ```

`dev` 第一步要 build packages，通常要 30–90 秒。記下回傳的 `serverId`，之後看日誌與停止用。

### 2.4 等待就緒

用 Bash 輪詢，最多等 3 分鐘；不要用 sleep 一次睡很久。有選 `monitoring` 時把註解的兩行也打開：

```bash
for i in $(seq 1 90); do
  ok=1
  curl -fsS -o /dev/null http://localhost:3000/health || ok=0
  curl -fsS -o /dev/null http://localhost:9464/metrics || ok=0
  curl -fsS -o /dev/null http://localhost:5173 || ok=0
  curl -fsS -o /dev/null http://localhost:5175 || ok=0
  curl -fsS -o /dev/null http://localhost:8025 || ok=0
  # curl -fsS -o /dev/null http://localhost:3300/api/health || ok=0
  # curl -fsS -o /dev/null http://localhost:9090/-/ready || ok=0
  [ $ok = 1 ] && echo READY && break
  sleep 2
done
```

其他選配服務用 `lsof -iTCP:<埠> -sTCP:LISTEN` 判斷。逾時就到 §3 排查，不要假裝成功。

有選 `monitoring` 時，再等約 20 秒（第一次抓取）後看 Prometheus 的目標：

```bash
curl -fsS http://localhost:9090/api/v1/targets | jq -r '.data.activeTargets[] | "\(.labels.job)\t\(.health)\t\(.lastError)"'
```

- `api`、`postgres`、`tempo`、`prometheus` 應為 `up`。
- `apm-service`、`external-api` 沒有啟動時顯示 `down` 是預期的，回報時註明即可。

### 2.5 開分頁

先 `tabs_context` 看已開的分頁，同一個 origin 已經開著就不重開。

`preview_start { name: "dev" }` 開的 5173 分頁是在 api 就緒**之前**載入的，頁面會停在「伺服器發生錯誤」（/api 回 502），
所以就緒後要對它重新 `navigate` 一次。

其他有畫面的服務用一個 `browser_batch` 開：先 `tabs_create` 幾次拿到 tabId，再一個 batch 全部 `navigate`：

- `http://localhost:5175`
- `http://localhost:3000/docs`
- `http://localhost:8025`
- 選配 `monitoring`：`http://localhost:3300/d/b2b-api`、`http://localhost:9090/targets`
- 選配：`http://localhost:3001/docs`、`http://localhost:6006`

最後 `tabs_select` 回到 5173 的分頁。

### 2.6 確認畫面

對 5173 與 5175 各做一次 `read_console_messages { onlyErrors: true }`，並用 `get_page_text` 確認不是白畫面。

- **正常**：未登入時的 `401`、`AUTH_REFRESH_INVALID`（5175 會導到「登入狀態已失效」），頁面停在登入頁。
- **異常**：重新整理後仍有 `502`、白畫面、模組載入失敗 → 到 §3 排查。

有選 `monitoring` 時，等 Grafana 分頁載入幾秒後截一張圖，確認「api 概況」的面板有數字（不是 `No data`）。

### 2.7 回報

用 zh-TW 回一張表，網址寫成 markdown 連結方便點擊，並標出每個服務的狀態（✅ 已就緒／⏭️ 原本就在跑／⚠️ 失敗）：

```markdown
| 服務 | 網址 | 狀態 |
| --- | --- | --- |
| backstage（租戶後台） | [localhost:5173](http://localhost:5173) | ✅ |
| platform（登入與平台管理） | [localhost:5175](http://localhost:5175) | ✅ |
| api Swagger | [localhost:3000/docs](http://localhost:3000/docs) | ✅ |
| Mailpit | [localhost:8025](http://localhost:8025) | ✅ |
| file-storage | http://localhost:9000（無畫面） | ✅ |
| Grafana | [api 概況](http://localhost:3300/d/b2b-api)・[容量](http://localhost:3300/d/b2b-capacity)・[背景工作](http://localhost:3300/d/b2b-jobs)・[前端](http://localhost:3300/d/b2b-frontend) | ✅ |
| Prometheus | [localhost:9090/targets](http://localhost:9090/targets) | ✅（apm-service、external-api 未啟動） |
```

再補一行：登入帳號由 `pnpm db:seed:dev`（`apps/api/src/db/seeds/dev.ts`）建立；平台管理者見 `seeds/platform-admin.ts`。
**不要把密碼寫進回覆。**

有選 `monitoring`、而 `.env` 沒設 `OTEL_EXPORTER_OTLP_ENDPOINT` 時，補一句「目前不送 trace；要看 trace 在 `.env` 設
`OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318` 並重啟 api」。**不要自己改 `.env`**，問過使用者再改。

## 3. 排查

| 症狀 | 原因與處理 |
| --- | --- |
| 3000 正常但 9464 沒在聽、`preview_logs` 有 `Cannot find module '…'` | 拉了新的 main 沒 `pnpm install`，api 停在舊程序。`pnpm install` 後 `preview_stop` ＋ 重新 `preview_start { name: "dev" }` |
| api 起不來、日誌有 `relation … does not exist` 或缺欄位 | 合併新功能後沒 migrate：`pnpm db:migrate`（api 是 `--watch`，不必重啟） |
| 登入後少了某些選單 | 權限目錄只由 seed 寫入：`pnpm db:migrate && pnpm db:seed` |
| backstage 白畫面、import 找不到 `dist` | packages 過期：`pnpm build:packages`（`pnpm dev` 已會先跑，單獨起才會遇到） |
| `pnpm` 指令跑在 Node 20 | launch.json 已把 PATH 指到 Node 24；Bash 裡要先 `source ~/.nvm/nvm.sh && nvm use 24` |
| 5173 被佔、Vite 跳到 5174 | 有殘留的 Vite；backstage 只認 `DEFAULT_TENANT_DOMAINS=localhost:5173`，換埠會找不到租戶。停掉殘留程序再起 |
| Prometheus 的 `api` target 是 down | api 沒開 `/metrics`（`.env` 的 `METRICS_PORT=0`）或 api 沒起來；Prometheus 經 `host.docker.internal` 抓主機上的 9464 |
| Grafana 面板 `No data` | 剛起還沒抓到資料（等 30 秒）；或對應的 target 是 down。「最耗時的查詢」在開發環境一定是空的（沒載入 pg_stat_statements） |
| 其他錯誤 | `preview_logs { serverId, level: "error" }` 看 `dev` 的輸出；監控看 `docker logs b2b-system-grafana`（或 `-prometheus`、`-tempo`） |

## 4. 停止

使用者說「停掉」時：

- 對每個本次啟動的 `serverId` 呼叫 `preview_stop`。
- 本次有起監控就跑 `pnpm monitoring:down`（只 stop、不刪資料）。
- docker 的 postgres 與 Mailpit 保留（下次啟動更快）；要一起關才跑 `pnpm db:down`。

**不要停掉不是這次啟動的程序或容器**（可能是別的對話的 `pnpm dev`）。
