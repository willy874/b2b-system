# 前端 19 — 可觀測性（錯誤回報、版本識別、Web Vitals、bundle 預算）

兩個前端（backstage、apps/platform）把錯誤與效能資料送到 [`apps/apm-service`](../07-apm-service.md)：一個 **模擬 Sentry API** 的小服務。
前端用官方的 `@sentry/browser`，機制在 `web-core/telemetry`，app 只負責接上（[`17-shared-packages.md`](./17-shared-packages.md)）。

後端的指標與 tracing、Grafana 的儀表板（含這裡的錯誤與 Web Vitals）見 [`../08-monitoring.md`](../08-monitoring.md)。

---

## 1. 概觀

```
瀏覽器（@sentry/browser，web-core/telemetry）
  │  POST /apm/api/<專案 id>/envelope/?sentry_key=…     ← 同源，CSP 的 connect-src 'self' 不必改
  ▼
nginx（deploy/nginx.conf、nginx.platform.conf）／ vite dev proxy：去掉 /apm 前綴
  ▼
apps/apm-service（:9100）
  ├─ .data/events/…        錯誤事件（遮罩後），每個事件另寫一行日誌
  ├─ .data/sourcemaps/…    sourcemap；查詢事件時還原堆疊
  └─ /metrics              Web Vitals 的 histogram
```

| 段 | 內容 | 章節 |
| --- | --- | --- |
| 錯誤回報 | 未捕捉例外、React 錯誤、query／mutation 的非預期錯誤、SharedWorker 的錯誤、chunk 載入失敗 | §2、§4、§6 |
| 版本識別 | 產物帶 release（commit），每個請求帶 `x-client-release` | §3 |
| 效能 | Web Vitals（LCP、INP、CLS、FCP、TTFB）與路由切換耗時，依頁面的 path 樣板彙總 | §5 |
| bundle 預算 | CI 檢查首頁初始載入與最大 chunk 的 gzip 大小 | §7 |

---

## 2. 收集點

| 來源（tag `source`） | 怎麼收 | 位置 |
| --- | --- | --- |
| `window`、`promise` | SDK 的 `globalHandlersIntegration`（`error`、`unhandledrejection`）；`browserApiErrorsIntegration` 包裝計時器與事件處理器 | `web-core/telemetry/telemetry.ts` 的 `initTelemetry` |
| `react` | `createRoot(container, telemetryRootOptions())`：React 19 的 `onUncaughtError`、`onCaughtError`、`onRecoverableError`。TanStack Router 的錯誤邊界也是 React 的錯誤邊界，路由頁面 render 時的錯誤經 `onCaughtError` 收到，`RouteErrorPage` 不必自己上報 | 各 app 的 `main.tsx` |
| `query`、`mutation` | `telemetryPlugin` 訂閱 QueryCache／MutationCache 的「這次變成錯誤」：錯誤 **不是** `AppError`、`NetworkError`、`RequestAbortedError` 才上報 | `web-core/plugins/app/telemetry.ts` |
| `worker` | 批次佇列的 SharedWorker（與退回的 dedicated worker）裡的 `error`／`unhandledrejection` 經 port 送 `worker-error` 給一個連線中的分頁，由它上報 | `web-core/batch/workers/*`、`BatchQueueHost.reportError`、`BatchQueueClient` |
| chunk 載入失敗 | 屬於 `react`（路由的 lazy 頁面）；`isChunkLoadError` 判斷後固定一組（fingerprint `chunk-load-error`、等級 `warning`、tag `kind: chunkLoad`），不和程式錯誤混在一起 | `web-core/errors/chunkLoad.ts` |

**不上報**：`AppError`（後端已以同一個 `requestId` 記錄；只出現在 breadcrumb）、網路中斷、請求中止（[`05-data-layer.md`](./05-data-layer.md) §7.2）。

**breadcrumb**（錯誤發生前的足跡，最多 30 則）只留三種：

| 分類 | 內容 |
| --- | --- |
| `fetch`、`xhr` | method、狀態碼、網址的 path 樣板（`/api/users/:id`）、回應的 `x-request-id` → 從前端錯誤可以接到後端那次請求的日誌 |
| `navigation` | 換頁前後的 path 樣板（`bindTelemetryRouter` 加的，不是 SDK 的 history breadcrumb） |
| `realtime` | 即時推播的連線失敗、handshake 被拒（`RealtimeClient` 的 `warn`） |

DOM 點擊、console 的 breadcrumb 關掉：會帶出畫面上的文字（使用者名稱、email）。

---

## 3. release 與 `x-client-release`

- 建置時 `vite.config.ts` 的 `define` 把 `APP_RELEASE` 寫成 `__APP_RELEASE__`（CI 與 Docker 帶 commit 前 7 碼，本機是 `dev`），app 經 `ENV.RELEASE` 交給 `telemetryPlugin`。
- 每個事件帶 `release`；apm-service 以它找 sourcemap、以 `query=release:<v>` 篩選。
- 每個 HTTP 請求帶 `x-client-release`（`web-core/plugins/fetcher/client-release.ts`，與 `x-client-id` 同一種 interceptor）。
  api 的存取日誌記成 `clientRelease`（`apps/api/src/core/logger/client-release.ts`，只接受 `[A-Za-z0-9._-]{1,40}`）：部署後新舊版前端並存時分得出是哪一版發的請求。

---

## 4. 遮罩與隱私

送出前在 `beforeSend`（錯誤）、`beforeSendSpan`（Web Vitals）、`beforeBreadcrumb` 遮罩；apm-service 收件時再做一次（[`../07-apm-service.md`](../07-apm-service.md) §6）。

| 項目 | 處理 |
| --- | --- |
| 使用者 | 只有 `id`（`useTelemetryUser(profile.user.id)`，登出後清掉）；`dataCollection.userInfo: false`，SDK 不自動帶其他欄位 |
| 網址 | 同源只留 path、其他來源留 origin；路徑裡的 UUID、數字、24 碼以上的 hex 換成 `:id`；去掉 query string 與 fragment（重設密碼信的 `?token=`、OIDC 的 `?code=`） |
| 頁面 | 事件的 `transaction` 與 tag `route` 是 path 樣板（`/user/$userId`），不是網址 |
| 文字 | 例外訊息、message：去掉網址的 query string；email → `[email]`；JWT、`b2bt_…`、32 字以上的長字串 → `[token]`；截斷 1000 字 |
| 標頭、cookie、body | `dataCollection`：cookie、body、query 參數不收；請求標頭只收 `User-Agent` |
| `extra` | 丟掉 |
| span（Web Vitals） | 只留 `browser.web_vital.<名稱>.value` 與 `sentry.*` 的必要屬性；元素選擇器（`…lcp.element`、`…inp.target`、`…cls.source.N`）、資源網址、元件名稱、User-Agent 丟掉；名稱換成頁面樣板 |
| 租戶 | tag `host`（目前的網域）：租戶由網域決定（[`../05-tenancy.md`](../05-tenancy.md)），不另外帶租戶代碼 |

**去重與上限**：同一個錯誤（類型＋訊息）在同一個分頁每分鐘最多送一次；一個分頁一次載入最多送 50 個錯誤，避免迴圈裡的錯誤灌爆收件端。

**不存本機**：SDK 的佇列只在記憶體；`browserTracingIntegration` 的 `linkPreviousTrace: 'off'`，不用 sessionStorage 串前一個 trace
（[`09-state-and-storage.md`](./09-state-and-storage.md) §4.2）。

---

## 5. Web Vitals 與路由切換

- `browserTracingIntegration` 放在 `web-core/telemetry/tracing.ts`，`initTelemetry` 以 `import()` 載入：沒有 DSN 或取樣率是 0 時不下載這段程式（約 59 KB，未壓縮）。
- 取樣率 `VITE_APM_TRACES_SAMPLE_RATE`（預設 `0.1`，以頁面載入為單位）；錯誤事件不取樣。
- span 以 **path 樣板** 命名：pageload 的名稱在 `bindTelemetryRouter` 解析出第一頁時改成樣板；路由切換由 `bindTelemetryRouter` 在
  `onBeforeNavigate` 開一個 navigation span（SDK 的 `instrumentNavigation` 關掉，它只知道網址）。同一次換頁 router 可能發出不只一次
  `onBeforeNavigate`，以目的地網址去重；第一次載入（沒有 `fromLocation`）不算換頁。
- SDK v11 預設以 **span streaming** 送出（envelope 的 `span` 項目），`beforeSendTransaction` 不會被呼叫；遮罩在 `beforeSendSpan`。
- **頁面歸屬**：LCP、CLS、FCP、TTFB 是頁面載入的指標，SDK 卻在換頁（或離開分頁）時才回報、掛上當下的頁面名稱；`beforeSendSpan` 把它們改回
  這次載入的第一頁。INP 屬於互動，跟著互動當下的頁面。
- 不追蹤 fetch／XHR 的 span、不加 `sentry-trace`／`baggage` 標頭（`tracePropagationTargets: []`）。
- apm-service 從 transaction 的 `measurements`、span 的 `browser.web_vital.<名稱>.value` 屬性與 navigation 的起訖時間取出數值，
  輸出成 `apm_web_vital{project,route,name}` histogram（[`../07-apm-service.md`](../07-apm-service.md) §3.4）。`route` 每個專案最多 200 種。

---

## 6. 複製錯誤資訊

`RouteErrorPage`（頁面載入或渲染失敗）與 `UnexpectedErrorPage`（頁面需要的資料拿不到）多一個「複製錯誤資訊」按鈕
（`web-core/components/ErrorPage/CopyErrorInfoButton.tsx`，`data-testid="error-page-copy-info"`）：

```
錯誤代碼 7f3a9c21e0… · 版本 1a2b3c4 · 2026-10-07T06:03:12.000Z · /user/$userId
```

- 代碼：頁面上的錯誤是 `AppError` 時用它的 `requestId`（查後端日誌），否則用最近一次上報的事件 id（查 apm-service 的事件）。
  事件 id 在 **點擊時** 才讀：React 在錯誤頁畫出來之後才呼叫 `onCaughtError` 上報。
- 時間是 UTC 的 ISO 8601，不受使用者時區影響。
- chunk 載入失敗的頁面（「系統已更新」）沒有這個按鈕：重新整理就好。

---

## 7. bundle 預算

```bash
pnpm bundle:check   # BUILD_MANIFEST=true 建置兩個前端，再跑 scripts/check-bundle-budget.mjs
```

| 項目 | 算法 |
| --- | --- |
| 初始載入 | entry 沿 Vite manifest 的 `imports`（靜態）走到的所有 JS chunk 的 gzip 總和；`dynamicImports`（lazy 頁面、tracing）不算 |
| 最大 chunk | 任何一個 JS chunk（含 lazy 與 worker）的 gzip 大小 |

- 預算在各 app 的 `bundle-budget.json`（`initialKb`、`maxChunkKb`）。2026-10-07 以現值加約 10% 設定：backstage 395／215 KB、apps/platform 350／180 KB。
- CI 的 `bundle` job 跑 `pnpm bundle:check`，表格寫進 job summary；超過就失敗。
- 超過時先看是不是把大套件打進了首頁（改成動態 `import()`），真的需要才調高 `bundle-budget.json`，並在 PR 說明原因。
- manifest 只在 `BUILD_MANIFEST=true` 時產生：正式產物不帶（nginx 會原樣提供 `dist` 裡的每個檔案）。

---

## 8. 設定與開發

| 變數（建置時，`VITE_` 進產物） | 說明 |
| --- | --- |
| `VITE_APM_PROJECT_ID`、`VITE_APM_PUBLIC_KEY` | apm-service 的專案 id 與 public key；DSN 在執行時組成 `<協定>//<key>@<location.host>/apm/<id>` |
| `VITE_APM_DSN` | 完整的 DSN（接真的 Sentry 或 GlitchTip）；有值時優先 |
| `VITE_APM_TRACES_SAMPLE_RATE` | Web Vitals 的取樣率，預設 `0.1` |
| `APP_RELEASE` | 寫進產物的 release；沒設時是 `dev`（Docker 的預設是 `unknown`） |

- **開發**：都沒設時不送出，SDK 照常處理事件，最後由只 `console.debug` 的 transport 印出要送的內容（D11）。要在本機收事件：
  `pnpm dev:apm`，並以 shell 設 `VITE_APM_PROJECT_ID=1 VITE_APM_PUBLIC_KEY=<.env 的 APM_PROJECTS 裡那一把>` 再起前端。
- **正式**：`docker-compose.prod.yml` 以建置參數帶入（backstage 是專案 1、apps/platform 是 2），見 [`../07-apm-service.md`](../07-apm-service.md) §8。
- **換成真正的 Sentry**：設 `VITE_APM_DSN`、把 Sentry 的收件網域加進 CSP 的 `connect-src`（`deploy/nginx.security-headers.conf`），
  sourcemap 改用 `sentry-cli` 上傳；前端程式不必改。
- **加第三個前端**：在 `APM_PROJECTS` 加一個專案，app 的 `main.tsx` 照 backstage 接上 `telemetryPlugin`、`telemetryRootOptions`、`bindTelemetryRouter`，
  `App.tsx` 的 profile 同步處加 `useTelemetryUser`，nginx 設定加 `/apm/` 的收件端點。

---

## 9. 設計決策：前端可觀測性

### 9.1 背景

2026-10-07 以前，後端出錯有 `requestId` 串起來的日誌與稽核，前端出錯什麼都沒留下：程式沒有 `window.onerror`、`createRoot` 沒有錯誤回呼，
`RouteErrorPage` 只顯示、不記錄；產物沒有版本識別；批次佇列的 SharedWorker 錯誤分頁收不到；沒有 Web Vitals；CI 不檢查 bundle 大小。
限制是 CSP 只允許同源（租戶網域是萬用網域加上客戶網域）、本機不能存個資（[`09-state-and-storage.md`](./09-state-and-storage.md) §4.2）、
apps/platform 的登入頁沒有登入狀態且網址可能帶憑證、`web-core` 不呼叫 app 的 API。

### 9.2 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | 新增 `apps/apm-service`，實作 Sentry SDK 會呼叫的收件 API；前端用官方 `@sentry/browser` | SDK 已處理全域錯誤、堆疊解析、breadcrumb、去重、取樣、離開頁面時送出、429 退避；之後換成 Sentry 或 GlitchTip 只要改 DSN 與 CSP |
| D2 | 同源：nginx 與 vite 把 `/apm/` 轉給 apm-service；DSN 在執行時以 `location.host` 組成 | CSP 維持 `connect-src 'self'`；租戶網域在建置時無法寫死 |
| D3 | 收件只處理 envelope 的 `event`、`transaction`、`span`，其餘接受後丟棄；不支援舊的 `/store/`；超過速率回 `429` ＋ `X-Sentry-Rate-Limits`、`Retry-After` | SDK v8 起只送 envelope；回對 429 的格式 SDK 才會照著退避 |
| D4 | sourcemap 存 apm-service 的 `.data/sourcemaps/<project>/<release>/`（與 apps/file-storage 的 `.data/` 同一種做法），以 Sentry 舊版的 release 檔案 API（multipart）上傳；建置用 `BUILD_SOURCEMAP=hidden`，`.map` 不進映像 | 舊版 API 是單純的 multipart；新版的 artifact bundle 要實作 chunk upload 與 debug id |
| D5 | 堆疊在 **查詢時** 還原（`@jridgewell/trace-mapping`），收件時只存原始事件 | sourcemap 晚於事件上傳也能還原；收件路徑不碰大檔案 |
| D6 | 事件存成每專案每天一個 NDJSON 檔，保留 `APM_RETENTION_DAYS`（預設 30）天；每個錯誤事件另寫一行日誌到 stdout | 規模是單一產品的前端錯誤，不需要資料庫；stdout 讓既有的日誌平台也收得到 |
| D7 | 遮罩兩端都做：SDK 的 `beforeSend`／`beforeBreadcrumb`／`dataCollection` ＋ apm-service 收件時再做一次；使用者只帶 id | 客戶端擋住大部分，伺服器端兜底，防止 SDK 升級或設定錯誤帶出個資；id 本身要查 DB 才對得到人 |
| D8 | fingerprint ＝ 例外類型 ＋ 正規化後的訊息（數字、UUID、引號內的字串、長 hex 換成佔位）；SDK 帶了 `fingerprint` 就用它；chunk 載入失敗固定一組 | 壓縮後的函式名稱每版不同，不能拿來分組；不分 release，才看得出「同一個錯誤延續到新版」 |
| D9 | release ＝ commit 前 7 碼，建置時注入；請求帶 `x-client-release`，api 存取日誌記成 `clientRelease` | 錯誤與後端日誌都能對到是哪一版的前端 |
| D10 | Web Vitals 由 apm-service 彙總成自己的 `/metrics`（標籤 `project`、`route`、`name`），`route` 每個專案最多 200 種；tracing 以動態 `import()` 載入 | 不必等後端的 `core/metrics`（當時還是提案；之後做在 [`../08-monitoring.md`](../08-monitoring.md)）；限制標籤數防止被灌入任意值；首頁不必多載 tracing 的程式 |
| D11 | 沒有設定 DSN 時，SDK 改用只 `console.debug` 的 transport | 開發時看得到會送出什麼，又不必起 apm-service |
| D12 | bundle 預算用自己的腳本讀 Vite manifest，不引入 `size-limit` | 只需要 manifest 與 gzip，不必多一套設定格式與依賴 |

提案時的開放問題與結論：

| 問題 | 結論 |
| --- | --- |
| 自建端點，還是接 Sentry 之類的服務？ | 自建 apm-service，模擬 Sentry 的 API（D1～D3） |
| 錯誤事件要不要帶使用者 id？ | 只帶 id（D7） |
| sourcemap 存哪裡、保留多久？ | apm-service 的 `.data/`；不自動刪除（D4） |
| 要不要一起做「有新版本」的偵測？ | 不做。等量到 chunk 載入失敗的實際數量再決定；另一條路是部署時保留上一版的 `assets/` |
| Web Vitals 的取樣率？ | 預設 10%，以環境變數調整；錯誤全收 |
| 開發環境要不要上報？ | 不送，只 `console.debug`（D11） |
| 租戶或使用者能不能關閉上報？ | 不提供開關：內容不含個人識別資訊；客戶合約要求時再加租戶層的系統設定 |

### 9.3 評估過的方案

| 方案 | 結論 |
| --- | --- |
| 接 Sentry SaaS | 不採用：CSP 要放寬到外部網域、資料離開自己的基礎設施、每個租戶網域都要處理；D1 保留了日後換過去的路 |
| 自己寫上報的客戶端與格式，送到 api 的 `POST /client-telemetry` | 不採用：全域錯誤、堆疊解析、離開頁面時送出、退避都要自己做；api 多一個公開端點 |
| 實作 Sentry 新版的 artifact bundle（chunk upload、debug id） | 不採用：舊版的 release 檔案 API 足夠，`sentry-cli` 以外的上傳方式也簡單 |
| 收件時就還原堆疊 | 不採用：sourcemap 晚到時就永遠還原不了（D5） |
| 錯誤存進 Postgres | 不採用：多一個跨服務的依賴；NDJSON 以日期分檔，保留期限就是刪檔 |
| `size-limit` | 不採用（D12） |

### 9.4 實作紀錄

- 提案寫「前端錯誤寫進 api 的日誌」，改成獨立的 apm-service（D1）；F3 原本依賴後端的 `core/metrics`，改由 apm-service 自己輸出 `/metrics`（D10）。
- `browserTracingIntegration` 與 `startBrowserTracingNavigationSpan` 在 `@sentry/browser` 的同一個模組：只要有一處靜態 import，整段 tracing 就進首頁。
  兩者都放進 `tracing.ts` 動態載入後，首頁的 JS 少約 18 KB（gzip）。
- `@sentry/browser` v11 以 `dataCollection` 取代 `sendDefaultPii`；`captureException` 的第二個參數不能同時給 `tags` 與 `mechanism`（tag 放在 `captureContext`）。
- v11 預設 span streaming：Web Vitals 是獨立的 `span` 項目，`beforeSendTransaction` 不會被呼叫。瀏覽器驗證時發現三件事並修正：span 的屬性帶元素選擇器與資源網址
  （改在 `beforeSendSpan` 以白名單過濾）、LCP 掛在下一頁（改回第一頁）、一次換頁出現兩個 navigation span（以目的地去重）。apm-service 也補上從 streamed
  segment span（屬性 `sentry.op: navigation`）取路由切換耗時。
- 租戶以 tag `host`（網域）表示：profile 沒有租戶代碼，而網域就是租戶的識別（[`../05-tenancy.md`](../05-tenancy.md)）。
- `isChunkLoadError` 從 `components/ErrorPage` 搬到 `web-core/errors`：telemetry 也要用，components 又要 import telemetry（複製錯誤資訊），放在 errors 才不會循環。
