# 前端可觀測性

- 優先度：P2
- 狀態：實作中（branch：`feat/frontend-observability`）
- 依賴：—
- 相關：[`observability.md`](./observability.md)（後端的指標與 tracing；原本列在那裡的「前端錯誤回報」「bundle 大小預算」已搬到這份）、
  [`frontend/05-data-layer.md`](../architecture/frontend/05-data-layer.md) §3.4、§7（錯誤處理）、
  [`frontend/09-state-and-storage.md`](../architecture/frontend/09-state-and-storage.md) §4.2（本機儲存的限制）、
  [`../architecture/01-system.md`](../architecture/01-system.md) §5（錯誤與可觀測性）、§6（安全基線、CSP）、
  [`../architecture/03-file-storage.md`](../architecture/03-file-storage.md)（apps/file-storage：同一種「模擬外部服務的本機服務」）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

後端出錯時有日誌可查：每個請求帶 `requestId`，Pino 的結構化日誌、稽核紀錄、回應的 `x-request-id` 都對得起來（[`01-system.md`](../architecture/01-system.md) §5）。
**前端出錯時什麼都沒留下**。上線後回答不了「使用者說畫面壞了，壞在哪」「這次部署有沒有讓前端錯誤變多」「哪一頁慢」。

### 現在有的（只負責「顯示」，不負責「留下紀錄」）

| 項目 | 現況 | 位置 |
| --- | --- | --- |
| 後端錯誤 → 訊息 | `AppError`（帶 `requestId`）→ `useErrorMessage()`；不認得的碼顯示「代碼 {requestId}，請聯絡管理員」 | `web-core/errors`、`web-core/plugins/fetcher/api-adapter.ts`；05-data-layer §7 |
| 傳輸層失敗 | `NetworkError`、`RequestAbortedError` 與程式錯誤分開 | 05-data-layer §3.3、§3.4 |
| 路由層的錯誤 | `defaultErrorComponent: RouteErrorPage`：chunk 載入失敗提示重新整理，其他錯誤可重試；**不顯示技術訊息、也不記錄** | `web-core/components/ErrorPage/ErrorPage.tsx` |
| 啟動資料失敗 | `UnexpectedErrorPage`（profile 拿不到時） | `apps/*/src/app/Layout.tsx` |
| query／mutation 的錯誤 | `throwOnError: false`，由 UI 顯示；`GlobalProvider` 已訂閱 QueryCache／MutationCache（只處理 403） | `web-core/cache/queryClient.ts`、`web-core/shell/GlobalProvider.tsx` |
| sourcemap | `BUILD_SOURCEMAP=hidden` 可以產生不被參照的 `.map`，但沒有任何流程使用它 | `apps/backstage/vite.config.ts` |

### 缺口

1. **純前端的例外沒有任何紀錄**：render 時的 `TypeError`、事件處理器裡的例外、未處理的 Promise rejection、mutation 的 `mutationFn` 裡的程式錯誤
   （`useErrorMessage` 退回 `error.unknown`，連 `requestId` 都沒有）。使用者回報時只能描述畫面，開發者無從查起。
   程式裡沒有 `window.onerror`、`unhandledrejection`，`createRoot` 也沒有傳 React 19 的 `onUncaughtError`／`onCaughtError`。
2. **SharedWorker 的錯誤看不到**：批次佇列跑在 SharedWorker（`web-core/batch/workers/batchQueue.sharedWorker.ts`），worker 裡的例外不會到分頁的 `window.onerror`。
3. **不知道使用者跑的是哪一版**：產物裡沒有版本識別，請求也沒帶；錯誤無法對應到 release，也就無法判斷「這次部署是否造成回歸」。
4. **部署後的 chunk 載入失敗不知道有多少**：新映像換掉整個 `dist/`，開著的分頁引用舊的 hash 檔名會 404。`RouteErrorPage` 已提示重新整理，但不知道每次部署影響多少人。
5. **沒有效能資料**：沒有 Web Vitals（LCP、INP、CLS），不知道哪一頁慢、慢在載入還是互動。
6. **即時推播的健康只在 console**：`RealtimeClient` 的斷線、重連以 `console.warn` 輸出，使用者那端的狀況收不回來。
7. **bundle 大小沒有預算**：CI 只跑 typecheck／lint／test 與正式映像的 smoke test，加了一個大套件也不會被發現（MSW 曾經差點以約 430 KB 的 chunk 進入正式產物，見 `apps/backstage/src/main.tsx` 的註解）。

### 限制

- CSP 是 `connect-src 'self'`（`deploy/nginx.security-headers.conf`），而租戶網域是 `*.<TENANT_BASE_DOMAIN>` 加上客戶自有網域。
  送到外部服務要改 CSP，而且資料會離開我們的基礎設施。
- 本機儲存不能放個人識別資訊、不能放伺服器資料的複本（[`frontend/09-state-and-storage.md`](../architecture/frontend/09-state-and-storage.md) §4.2）。
- apps/platform 的登入互動與帳號流程頁 **沒有登入狀態**，且網址可能帶憑證（啟用、重設密碼信的 `?token=`，`apps/platform/src/features/login/routes/model.ts`）。
- `web-core` 不呼叫 app 的 API（[`../../CLAUDE.md`](../../CLAUDE.md) 前端規則 1）；兩個前端都要用，所以機制放 `web-core`，端點與 release 由 app 注入。

## 範圍

分三段，可以各自合併：

| 段 | 做 |
| --- | --- |
| **F1 錯誤回報與版本識別** | `apps/apm-service`（模擬 Sentry 的收件與查詢 API）；前端以官方 `@sentry/browser` 上報未捕捉例外、React 錯誤、query／mutation 的非預期錯誤、SharedWorker 錯誤、chunk 載入失敗；產物帶 release、請求帶 `x-client-release`；錯誤頁提供「複製錯誤資訊」；sourcemap 上傳到 apm-service 的 `.data/`，查詢時還原堆疊 |
| **F2 bundle 預算** | CI 建置兩個前端，檢查初始載入與單一 chunk 的 gzip 大小，超過就失敗，並在摘要列出 |
| **F3 效能與連線品質** | Web Vitals（LCP、INP、CLS、TTFB）與路由切換耗時，由 apm-service 彙總成自己的 `/metrics`（Prometheus）；即時推播的斷線與重連記成 breadcrumb |

| 做 | 不做（這一版） |
| --- | --- |
| 上面三段 | Sentry 的完整 API（只做 SDK 會呼叫的收件端點與少數查詢端點，見 D3、D5） |
| backstage 與 apps/platform 都接上 | Sentry 的網頁介面、告警、通知、使用者回饋表單 |
| 兩端都遮罩的上報格式 | Session replay、使用者行為分析（點擊、頁面瀏覽數） |
| | 依租戶的指標標籤（與 `observability.md` 開放問題 3 一致：租戶只出現在事件裡） |
| | 錯誤存進資料庫（存 apm-service 的 `.data/`） |
| | 「有新版本」的偵測、部署時保留上一版的 assets（開放問題 4） |

## 使用者故事

**作為 租戶管理者，我希望畫面出錯時能一鍵複製錯誤資訊交給客服，以便 不必描述「我按了什麼」。**

- **Given** 使用者在使用者詳情頁，頁面 render 時拋出 `TypeError`
- **When** 畫面顯示「發生未預期的錯誤」，使用者按「複製錯誤資訊」
- **Then** 剪貼簿是 `錯誤代碼 7f3a9c21… · 版本 1a2b3c4 · 2026-10-07 14:03:12 +08:00 · /user/$userId`；
  開發者以 `GET /apm/api/0/projects/b2b-system/backstage/events/<eventId>/` 取得事件，堆疊已用那一版的 sourcemap 還原成原始檔名與行號

**作為 開發者，我希望看到每個 release 的前端錯誤，以便 部署後馬上知道要不要回滾。**

- **Given** release `1a2b3c4` 部署後
- **When** 查詢 `GET /apm/api/0/projects/b2b-system/backstage/issues/?query=release:1a2b3c4`
- **Then** 依 fingerprint 分組列出錯誤、筆數、第一次與最後一次出現；chunk 載入失敗另成一組，不混進程式錯誤

**作為 開發者，我希望 PR 讓初始 JS 變大超過預算時 CI 失敗，以便 不會不知不覺把整個套件打進首頁。**

- **Given** `apps/backstage/bundle-budget.json` 的初始載入預算是 X KB（gzip）
- **When** PR 在常駐 feature 直接 import 一個大套件
- **Then** CI 的 bundle 檢查失敗，摘要列出超出的部分

**作為 維運，我希望看到每一頁的 LCP、INP p75，以便 知道該優化哪一頁。**（F3：apm-service 的 `/metrics`）

**作為 租戶的資安窗口，我希望前端上報的內容不含個資，以便 通過客戶的資安問卷。**

- **Given** 使用者在含 email 的表單輸入中發生錯誤
- **When** 錯誤被上報
- **Then** 上報內容只有頁面的 path 樣板（`/user/$userId`，不是網址）、錯誤類型、遮罩過的訊息、堆疊、使用者 id；沒有欄位值、query string、email、IP

## 設計

### 整體

```
瀏覽器（@sentry/browser）
  │  POST /apm/api/<projectId>/envelope/?sentry_key=…   ← 同源，CSP 不必改
  ▼
nginx（租戶網域與平台網域都有 /apm/）／ vite dev proxy
  ▼
apps/apm-service（:9100）
  ├─ .data/events/<project>/<yyyy-mm-dd>.ndjson   錯誤事件（保留 APM_RETENTION_DAYS 天）
  ├─ .data/sourcemaps/<project>/<release>/…       CI 上傳的 sourcemap
  ├─ stdout                                       每個錯誤事件一行 JSON（與 api 的 Pino 同形狀）
  └─ /metrics                                     Web Vitals 的 histogram（F3）
```

### apps/apm-service

照 `apps/file-storage` 的形狀：`node:http` ＋ zod、esbuild 打包、一行一筆 JSON 的日誌、資料放 `.data/`（`APM_DATA_DIR`，不進版控）。

| 端點 | 相容的 Sentry API | 驗證 |
| --- | --- | --- |
| `POST /api/:projectId/envelope/` | 收件（SDK 用的 envelope） | DSN 的 public key：`sentry_key` query 或 `X-Sentry-Auth` |
| `POST /api/0/projects/:org/:project/releases/:version/files/` | 上傳 release 檔案（multipart：`file`、`name`） | `Authorization: Bearer <APM_AUTH_TOKEN>` |
| `GET /api/0/projects/:org/:project/releases/:version/files/` | 列出 release 檔案 | 同上 |
| `GET /api/0/projects/:org/:project/issues/` | 依 fingerprint 分組的錯誤（`statsPeriod`、`query=release:…`） | 同上 |
| `GET /api/0/projects/:org/:project/events/:eventId/` | 單一事件；堆疊以 sourcemap 還原 | 同上 |
| `GET /metrics` | （非 Sentry）Prometheus 格式 | 不驗證；只在內網開放（nginx 不轉發） |
| `GET /_health` | （非 Sentry）存活 | 不驗證 |

專案以環境變數設定：`APM_PROJECTS="1:backstage:<publicKey>,2:platform:<publicKey>"`（數字 id、slug、public key），`APM_ORG` 預設 `b2b-system`。

### 前端（`packages/web-core/telemetry`）

- `initTelemetry({ app, release, dsn, environment, tracesSampleRate })`：以 `@sentry/browser` 初始化，**不用預設的整合清單**，明確列出要的：
  全域錯誤、Promise rejection、計時器與事件處理器的包裝、linked errors、去重、fetch breadcrumb（DOM、console、history 的 breadcrumb 關掉）。
- `telemetryPlugin` 在 app context 最前面註冊，最早開始收集；`createRoot(container, telemetryRootOptions())` 接上 React 19 的 `onUncaughtError`、`onCaughtError`、`onRecoverableError`。
  TanStack Router 的錯誤邊界是 React 的錯誤邊界，`onCaughtError` 會收到，`RouteErrorPage` 不必自己上報。
- 路由：router 建立後 `bindTelemetryRouter(router)`，每次 `onResolved` 把頁面的 path 樣板設成 scope 的 `transaction` 與 tag `route`，並加一則 navigation breadcrumb（只有樣板）。
- `GlobalProvider` 的 QueryCache／MutationCache 訂閱：錯誤 **不是** `AppError`、`NetworkError`、`RequestAbortedError` 時上報（tag `source: query｜mutation`）。`AppError` 後端已以 `requestId` 記錄，不上報。
- fetch breadcrumb：網址只留 path，數字與 UUID 段換成 `:id`；從回應補上 `x-request-id`，讓前端錯誤能接到後端那次請求的日誌。
- SharedWorker：worker 的 `error`／`unhandledrejection` 經既有的 port 協定轉給連線中的分頁上報。
- `x-client-release`：每個請求都帶（和 `client-id.ts` 同一種 interceptor），api 的存取日誌記成 `clientRelease`。
- 使用者：profile 載入後 `setUser({ id })`；租戶代碼放 tag `tenant`。
- 「複製錯誤資訊」：`RouteErrorPage`、`UnexpectedErrorPage`；內容是事件 id（沒有時退回 `requestId`）、release、時間、頁面的 path 樣板。

### app

- `vite.config.ts`：`define: { __APP_RELEASE__ }`，值取建置參數 `APP_RELEASE`（Dockerfile `ARG`，CI 帶 commit sha 前 7 碼），本機為 `dev`；dev server 把 `/apm` 代理到 apm-service。
- DSN：`VITE_APM_DSN`（完整 DSN，用於接真的 Sentry）或 `VITE_APM_PROJECT_ID` ＋ `VITE_APM_PUBLIC_KEY`（執行時以 `location.host` 組成同源的 DSN）。都沒設時不送出（D11）。

### bundle 預算（F2）

- 建置時開 `build.manifest`；`scripts/check-bundle-budget.mjs` 從 entry 沿 `imports`（不含 `dynamicImports`）算出 **初始載入** 的 gzip 總和與 **最大單一 chunk**。
- 每個 app 一份 `bundle-budget.json`（`initialKb`、`maxChunkKb`）；調高預算要改這個檔，review 看得到。
- CI 新增 job：`pnpm build:packages` → 建置兩個前端 → 檢查；結果寫進 `$GITHUB_STEP_SUMMARY`。

### 權限、稽核、推播

沒有新權限鍵、不寫稽核、不發領域事件；api 只多記一個存取日誌欄位。

## 開放問題

1. **自建端點寫進日誌，還是接 Sentry 之類的服務？**（原 `observability.md` 開放問題 2）
   **結論**（2026-10-07）：自建 `apps/apm-service`，**模擬 Sentry 的 API 介面**；前端直接用官方 SDK。見 D1～D3。
2. **錯誤事件要不要帶使用者 id？**
   **結論**：只帶 id，不帶 email、名稱、IP。見 D7。
3. **sourcemap 存哪裡、保留多久？**
   **結論**：存 apm-service 的 `.data/` 資料夾（與 apps/file-storage 的 `.data/` 同一種做法），以 Sentry 的 release 檔案 API 上傳。見 D4。
4. **要不要一起做「有新版本」的偵測？**
   **結論**：不放這份。等 F1 量到 chunk 載入失敗的實際數量再決定。
5. **Web Vitals 的取樣率？**
   **結論**：預設 10% 的頁面載入（`VITE_APM_TRACES_SAMPLE_RATE`）；錯誤事件全收（有去重與上限）。
6. **開發環境要不要上報？**
   **結論**：不送，只 `console.debug` 要送的內容；E2E 設定 DSN、送到本機的 apm-service，用來驗證格式與遮罩。見 D11。
7. **租戶或使用者能不能關閉上報？**
   **結論**：不提供開關；內容不含個人識別資訊。若客戶合約要求，再加租戶層的系統設定。

## 設計決策

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | 新增 `apps/apm-service`，實作 Sentry SDK 會呼叫的收件 API；前端用官方 `@sentry/browser` | SDK 已處理全域錯誤、堆疊解析、breadcrumb、去重、取樣、離開頁面時送出、429 退避，不必自己寫；之後要換成 Sentry 或自架的 GlitchTip 只要改 DSN 與 CSP，前端程式不變 |
| D2 | 同源：nginx 與 vite 把 `/apm/` 轉給 apm-service；DSN 在執行時以 `location.host` 組成 | CSP 維持 `connect-src 'self'`；租戶網域是萬用網域加上客戶網域，建置時無法寫死；SDK 對同源請求不觸發 preflight 問題 |
| D3 | 收件只處理 envelope 的 `event`、`transaction`、`span` 項目，其餘（`session`、`client_report`…）接受後丟棄；不支援舊的 `/store/` 端點；超過速率回 `429` ＋ `X-Sentry-Rate-Limits`、`Retry-After` | SDK v8 起只送 envelope；回對 429 的格式 SDK 才會照著退避 |
| D4 | sourcemap 存 `.data/sourcemaps/<project>/<release>/`，以 Sentry 舊版的 release 檔案 API（multipart）上傳；`pnpm --filter @b2b-system/apm-service upload-sourcemaps` 上傳一個 app 的 `dist/`；建置用 `BUILD_SOURCEMAP=hidden`，`.map` 上傳後刪掉、不進映像 | 舊版 API 是單純的 multipart，新版的 artifact bundle 要實作 chunk upload 與 debug id，成本高；路徑以 `~/assets/<檔名>` 命名，與 Sentry 的慣例相同 |
| D5 | 堆疊在 **查詢時** 還原（`@jridgewell/trace-mapping`），收件時只存原始事件 | sourcemap 晚於事件上傳也能還原；收件路徑不碰磁碟上的大檔案 |
| D6 | 事件存成每專案每天一個 NDJSON 檔，保留 `APM_RETENTION_DAYS`（預設 30）天；每個錯誤事件另寫一行日誌到 stdout | 規模是單一產品的前端錯誤，不需要資料庫；stdout 讓既有的日誌平台也收得到 |
| D7 | 遮罩兩端都做：SDK 的 `beforeSend`／`beforeBreadcrumb`（網址換成 path 樣板、去掉 query string、遮掉 email 與長 token）＋ apm-service 收件時再做一次並丟掉 `request.headers`、`request.cookies`、`user` 中 id 以外的欄位；`sendDefaultPii: false` | 客戶端遮罩擋住大部分，伺服器端兜底，防止 SDK 升級或設定錯誤帶出個資 |
| D8 | fingerprint ＝ 例外類型 ＋ 正規化後的訊息（數字、UUID、引號內的字串換成佔位）；SDK 帶了 `fingerprint` 就用它；chunk 載入失敗固定一組 | 壓縮後的函式名稱每版不同，不能拿來分組；不分 release，才看得出「同一個錯誤延續到新版」 |
| D9 | release ＝ commit sha 前 7 碼，建置時注入；請求帶 `x-client-release`，api 存取日誌記成 `clientRelease` | 錯誤與後端日誌都能對到是哪一版的前端 |
| D10 | F3 的 Web Vitals 由 apm-service 從 `transaction` 的 `measurements` 與 INP 的 `span` 彙總，在自己的 `/metrics` 輸出 histogram（標籤 `project`、`route`、`name`）；`route` 每個專案最多 200 種，超過歸 `other` | 不必等 `observability.md` 的 `core/metrics`；限制標籤數防止被灌入任意值 |
| D11 | 沒有設定 DSN 時，SDK 改用只 `console.debug` 的 transport | dev 看得到會送出什麼，又不必起 apm-service |
| D12 | bundle 預算用自己的腳本讀 Vite manifest，不引入 `size-limit` | 只需要 manifest 與 gzip，不必多一套設定格式與依賴 |

## 歸檔去向

- `docs/architecture/07-apm-service.md`（新；apps/apm-service，形式比照 `03-file-storage.md`，含設計決策）
- `docs/architecture/frontend/19-observability.md`（新）：收集點、遮罩、`telemetryPlugin` 的接法
- `docs/architecture/01-system.md` §5：表格加「前端錯誤」「前端版本」兩列
- `docs/architecture/frontend/05-data-layer.md` §7：哪些錯誤上報、哪些只進 breadcrumbs
- `docs/architecture/frontend/10-testing.md`：bundle 預算的調整規則
- [`../../CLAUDE.md`](../../CLAUDE.md)：Monorepo 結構、常用指令（`dev:apm`、`upload-sourcemaps`、bundle 檢查）
