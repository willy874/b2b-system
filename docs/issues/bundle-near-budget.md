# backstage 的首頁初始載入超過 bundle 預算

## 現況

`apps/backstage/bundle-budget.json`：`initialKb` 395、`maxChunkKb` 215（gzip，2026-10-07 以當時的值加約 10% 設定）。
apps/platform：`initialKb` 350、`maxChunkKb` 180。算法見 [`frontend/19-observability.md`](../architecture/frontend/19-observability.md) §7。

### 量測數字（2026-10-10，`c97f5fc7`／`6780a8c0`，產物相同）

| app | 項目 | 實際（gzip） | 預算 | 結果 |
| --- | --- | --- | --- | --- |
| backstage | 初始載入 | 400.3 KB | 395.0 KB | **超過 5.3 KB（101%）** |
| backstage | 最大 chunk | 209.7 KB（entry `index-*.js`） | 215.0 KB | 97.5% |
| platform | 初始載入 | 339.9 KB | 350.0 KB | 97.1%，餘 10.1 KB |
| platform | 最大 chunk | 176.0 KB（entry） | 180.0 KB | 97.8%，餘 4.0 KB |

CI 的 `bundle 預算` job 在 main 上從 `0e3c39ee`（2026-10-09，run 37946793328，backstage 399.9 KB）起失敗。
apps/platform 共用 web-core，同樣貼近上限：下一個進首屏的共用機制就會讓兩個 app 一起超過。

量測方式：本機 `pnpm bundle:check` 失敗於 `tsc -b`（`apps/backstage/node_modules/.bin/tsc` 指向已移除的 typescript 5.9.3，`pnpm install` 過期，與預算無關），
改用 `BUILD_MANIFEST=true BUILD_SOURCEMAP=hidden vite build` ＋ `node scripts/check-bundle-budget.mjs apps/<app>`；產物與 CI 相同（`tsc -b` 只做型別檢查）。
模組的歸屬以 sourcemap 計算；下文「實測」都是在暫用的 git worktree 實際改程式後重新建置量到的初始載入差值。

### 組成

初始載入共 110 個 chunk、未壓縮 1184 KB。entry 209.7 KB，其餘 109 個 chunk 合計約 190 KB（最大的是 zod 的 `schemas-*.js` 24.5 KB、
Base UI 的 `PopoverPopup-*.js` 17.1 KB 與 `composite-*.js` 14.1 KB、i18next 的 `useTranslation-*.js` 14.1 KB），其中約 100 個小於 3 KB。

依來源（以 sourcemap 歸屬的未壓縮位元組；gzip 是把該來源的程式單獨壓縮的近似值，加總不等於 400）：

| 來源 | 未壓縮 | gzip（近似） | 拿掉後的實測差值 |
| --- | --- | --- | --- |
| `react-dom` ＋ `react` ＋ `scheduler` | 214 KB | 66 KB | — |
| `@base-ui/react` ＋ `@base-ui/utils` ＋ `@floating-ui/*` | 166 KB | 56 KB | — |
| `zod`（route 的 search 驗證） | 87 KB | 24 KB | −24.5 KB |
| `@sentry/core` ＋ `@sentry/browser` ＋ `@sentry/browser-utils` | 95 KB | 33 KB | −32.6 KB |
| `@tanstack/router-core` ＋ `react-router` ＋ `history` ＋ `store` | 72 KB | 26 KB | — |
| `i18next` | 42 KB | 13 KB | — |
| `@tanstack/query-core` ＋ `react-query` | 39 KB | 11 KB | — |
| `socket.io-client` ＋ `engine.io-client` ＋ parser | 39 KB | 13 KB | −12.5 KB |
| `packages/ui`（元件與 icons） | 56 KB | 13 KB | — |
| `packages/web-core`（其中 `batch` 20 KB、`errors` 15 KB、`realtime` 9 KB、`command-palette` 7 KB） | 122 KB | — | `BatchQueueHost` −2.0、`CommandPalette` −1.5 |
| app 自己的檔案（598 個） | 164 KB | — | 見「根因」2 |

app 的檔案裡，與「首屏要畫的東西」無關、卻在初始載入的：各 feature 的 mutation hook（`hooks/` 共 17.8 KB）、還原按鈕元件、
批次操作的實作（`batch.ts` 6.3 KB）與它們用到的 146 個 `apis/*/fetcher.ts`（14.6 KB）。

### 時間線

2026-10-07 設預算（`a36fde40`）以來，在暫用 worktree 逐一建置 main 上的合併點（與 CI 的 job summary 一致）：

| 提交 | 內容 | backstage 初始 | 差值 | platform 初始 |
| --- | --- | --- | --- | --- |
| `a36fde40` 10-07 | 設預算時 | 358.9 | — | 317.7 |
| `3fbd43b6` 10-07 | MFA（TOTP、Email、政策） | 363.4 | +4.5 | 320.1 |
| `282855d9` 10-07 | 系統設定整併等十項 | 371.5 | **+8.1** | 320.6 |
| `4537b95c` 10-08 | 通知中心的詳細內容、刪除與批次操作 | 376.2 | +3.4（與前一點 `d37378ee` 372.8 比） | **333.2（+12.3）** |
| `0949acc9` 10-08 | 匯入／匯出 | 379.3 | +2.9 | 333.6 |
| `c12b3de1` 10-08 | 組織管理＋多階段審批 | 383.9 | +4.6 | 333.8 |
| `c9afa726` 10-08 | 留言與關注 | 385.3 | +1.5 | 333.9 |
| `915039ed` 10-08 | 匯入匯出擴充到六種資源 | 387.5 | +2.2 | 333.9 |
| `3c859b91` 10-08 | 富文本 | 389.2 | +1.7 | 335.0 |
| `6b4c4fe3` 10-09 | MFA 新方式 | 390.5 | +1.3 | 336.2 |
| `4376ad38` 10-09 | 圖片資產與選圖 | 393.2 | +2.5 | 338.5 |
| `738ebf12` 10-09 | 圖片庫 | 399.9 | **+6.4** | 338.6 |
| `7c71cfe2` 10-10 | 目前 | 400.3 | — | 339.9 |

三天 +41.4 KB（+11.5%），最大 chunk 196.2 → 209.7 KB。沒有單一的元凶：每個新 feature 都在 plugin 的同步階段登記回收桶、批次操作、
命令面板等，平均每個 +2～8 KB；同時拆出更多「首屏與 lazy 頁面共用」的小 chunk（見根因 4）。
設預算時 Sentry、socket.io、zod 就已經在首屏，預算是在已經偏胖的基準上加 10%。

## 根因

以下的鏈都是靜態 `import`（`檔案:行號` 是發出那個 import 的行）。工具：沿 `main.tsx` 的靜態 import 走（同 `app/__tests__/entry-imports.test.ts`，另外跟進 web-core），
再以 sourcemap 確認模組真的在初始 chunk 裡（packages 宣告了 `sideEffects`，barrel 轉出但沒用到的模組會被拿掉，所以只看 import 圖會高估）。

### 1. 基礎設施在同步階段整包載入（web-core，兩個 app 共有）

- **Sentry**：`main.tsx:16`（`@b2b-system/web-core/plugins/app`）→ `plugins/app/index.ts:7` → `plugins/app/telemetry.ts:3` → `telemetry/index.ts:2`
  → `telemetry/telemetry.ts:1-20` 靜態 `import { init, captureException, … } from '@sentry/browser'`（`main.tsx:19` 也直接匯入 `web-core/telemetry`）。
  `telemetryPlugin` 在同步階段呼叫 `initTelemetry`，所以 SDK 本體（33 KB gzip）在首屏；只有 tracing 已經是動態載入（§9.4）。
- **socket.io**：`main.tsx:16` → `plugins/app/index.ts:6` → `plugins/app/realtime.ts:11-18`（`socketIoRealtimeTransport`）→ `realtime/index.ts:5`
  → `realtime/socketIoTransport.ts:2` 靜態 `import { io } from 'socket.io-client'`。登入頁、非 leader 的分頁都用不到。
- **批次佇列的主執行緒退路**：`plugins/app/batch-queue.ts:3` → `batch/index.ts` → `batch/connect.ts:1` 靜態 import `BatchQueueHost`，
  只有 `connectInline()`（`connect.ts:58-73`，連 Worker 都沒有的環境＝測試）用到；瀏覽器實際跑在 SharedWorker 裡。
- **命令面板**：`web-core/layout/DashboardShell.tsx:10` 匯入、`:170` 一律渲染 `<CommandPalette />`（Dialog、虛擬列表、搜尋），按 ⌘K 才需要。

### 2. feature 的同步登記帶入了「執行用」的程式

[`02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §4.3 已經規定偏好分頁、首頁區塊以 `lazy()` 登記；回收桶與批次操作沒有比照，
而它們的模組直接 import mutation hook：

- 回收桶（每個有軟刪除的 feature）：
  - `main.tsx:36` → `features/role/index.tsx:18` → `role/plugin.ts:11` → `role/trash.ts:4` → `components/RoleRestoreAction.tsx:6` → `hooks/useRoleMutations.ts`
  - `main.tsx:26` → `app/features.ts:31` → `file/index.tsx:9` → `file/plugin.ts:18` → `file/trash.ts:4-5` → `File/FolderRestoreAction.tsx:6` → `useFileMutations`、`useFolderMutations`
  - 同樣的形狀：`app/features.ts:32/33/44/15` → gallery／group／organization／announcement 的 `plugin.ts` → `trash.ts` → `*RestoreAction.tsx` → `use*Mutations.ts`；
    user 的 `trash.ts:4` → `UserRestoreAction`
- 批次操作：
  - `main.tsx:40` → `features/user/index.tsx:16` → `user/plugin.ts:4` → `user/batch.ts:9`（只為了 `roleRefs`）→ `hooks/useUserMutations.ts`
  - `main.tsx:30` → `features/approval/index.tsx:11` → `approval/plugin.ts:4` → `approval/batch.ts:7`（`approvalReviewedChanges`）→ `hooks/useApprovalMutations.ts`
  - `app/features.ts:31` → `file/plugin.ts:10` → `file/batch.ts:9` → `apis/file/upload-file/fetcher.ts:12` → `uploadParts.ts`（分段上傳）；`file/batch.ts:11` → `core/file` 的縮圖
  - `app/features.ts:32` → `gallery/plugin.ts:4` → `gallery/batch.ts`（上傳、刪除、貼標籤的實作）
  - 批次操作要在同步階段登記 **id 與名稱**（佇列交派工作前要知道這個分頁會做什麼），但 `run` 的實作只在真的執行時才需要。
- 檔案預覽：`file/plugin.ts:15` → `preview/builtins.ts:3` → `ImagePreview.tsx`、`TextPreview.tsx`（小，1～2 KB）。
- 站內通知：`main.tsx:34` → `notification/index.tsx:15` → `notification/plugin.ts:8` → `components/NotificationBell.tsx`
  → `:12` `constants.ts`（通知句子的對照表）、`:15` `useNotificationMutations`、`:18` `NotificationList.tsx` → `:19` `adapter.ts`、`:7` web-core 的 `NotificationDetailDialog`。
  鈴鐺是頂列工具，本來就在首屏渲染（§4.4），屬於設計上的成本。
- 不是問題的：`navigation.ts`（23 個，合計 3.2 KB 未壓縮，`useBadge` 是 hook 參照）與 `search.ts`（7 個，2.7 KB，只 import `apis/*/query`）。

`app/features.ts` 靜態 import 所有可啟用 feature 的 plugin（§9.2 D1 決定「不做 dynamic import」），但實測改成動態載入沒有幫助（見修正方式「不採用」）。

### 3. route 的 search 驗證用完整的 zod

`main.tsx:28` → `app/plugin.ts:21`（`routeTree`）→ `app/routes.tsx:3-26`（每個 feature 的 `Routes`）→ `features/*/routes/pages.ts` 的 `validateSearch`
→ `features/*/routes/model.ts:2` `import { z } from 'zod'`（23 個 model 檔）。另有 `web-core/locales/zodErrorMap.ts:1/62`（i18n 初始化時 `z.config`）、
`web-shared/constants/sort.ts:1`（`sortSearchSchema`）。route 物件要在建立 router 時存在，TanStack Router 的 `validateSearch` 不能 lazy，
所以 zod 的 classic API（`z.string().trim()…` 的方法鏈，無法 tree-shake）整包 24.5 KB 進首屏，表單用的其實在 lazy 頁面。

### 4. 首屏被切成 110 個 chunk，gzip 的重複成本約 38 KB

Rolldown 依「哪些 entry／lazy 頁面共用」切 chunk：首屏的模組只要也被某個 lazy 頁面用到，就被切成獨立的小 chunk（約 100 個小於 3 KB），
每個 chunk 各自壓縮，字典無法共用。實測把「首屏的所有模組」放進同一個 chunk（內容完全不變）：初始載入 400.3 → **362.6 KB**（−37.7）。
每個新 feature 都會增加共用的切點，所以時間線上的成長有一部分是這個成本；反過來，把某段程式改成 lazy 也可能因為多切出 chunk 讓總量變大（見「不採用」）。

### 5. 本來就大的依賴

`react-dom`（66 KB gzip）、Base UI（56 KB）、TanStack Router（26 KB）、i18next（13 KB）、TanStack Query（11 KB）是首屏真的要用的，不在這次的處理範圍。

## 影響

- CI 的 `bundle 預算` job 在 main 上已經失敗（`0e3c39ee` 起）：之後每個 PR 都會被擋，或被迫在不知原因的情況下調高預算
  （違反 [`frontend/19-observability.md`](../architecture/frontend/19-observability.md) §7「調高要在 PR 說明原因」）。
- apps/platform 只剩 2～3% 的餘裕；web-core 再多一個首屏的機制，兩個 app 會一起超過。
- 成長速度約每天 +14 KB（10-07～10-09 的功能密集期），單純調高 10% 撐不過兩三個功能。
- 使用者端：首次載入要下載、解析 400 KB（gzip，未壓縮 1.18 MB）的 JS，其中約 90 KB（Sentry、socket.io、zod、執行用的 feature 程式）在第一個畫面用不到；
  另外約 38 KB 是切成太多小 chunk 的壓縮損失。對 LCP 與低階裝置的解析時間有實際影響，但不是功能錯誤。

嚴重度中：規格（§7）定的 CI 檢查在 main 上已經失敗、兩個 app 都貼近上限且成長快；使用者端是效能退化，沒有功能錯誤。

## 修正方式

順序依「省最多、風險最低、互不衝突」排列；S1 單獨就能讓兩個 app 回到預算內，可以先做當作止血。
每一步合併前都重跑 `bundle:check` 記下數字——根因 4 讓「拿掉一段程式」和「總量變小」不一定同向。

### S1 Sentry 延後載入（web-core/telemetry）

實測：backstage −32.6 KB、platform −32.5 KB；SDK 改成 lazy chunk 約 16 KB gzip（只含用到的函式；不能 `import('@sentry/browser')` 整個命名空間，那會帶進 replay、feedback，約 136 KB）。

設計（滿足 §2「啟動過程中的錯誤也收得到」）：

1. 新增 `telemetry/sdk.ts`，以具名 re-export 匯出 `telemetry.ts` 現在用到的函式；`telemetry.ts` 只 `import type` 自 `@sentry/*`。
2. `initTelemetry` 在同步階段：
   - 掛一組輕量的早期攔截：`window` 的 `error`、`unhandledrejection` 推進記憶體佇列（上限 20 筆，含 `source`、`handled`、時間）；
   - `captureError`、`setTelemetryUser`、`addTelemetryBreadcrumb` 在 SDK 就緒前也進佇列（breadcrumb 上限 30，與 `maxBreadcrumbs` 相同）；
   - **立刻** `import('./sdk')`（不等登入、不等 idle），與 router 建立、第一次 render 並行下載。
3. 載入完成：以現在的選項 `init()`、移除早期攔截、依序重送佇列（`captureException` 帶原本的 `mechanism`；`beforeSendError` 的去重與每頁 50 個上限照常適用），
   再載入 tracing（取樣到時）。`enabled: false`（`VITE_APM_ENABLED=false`）時完全不下載。
4. `getTelemetryContext().eventId`：SDK 就緒前回傳 `undefined`；`captureError` 回傳值在就緒前是 `undefined`（現在未初始化時也是）。

風險：SDK 就緒前的錯誤沒有 fetch／xhr 的 breadcrumb 與 `browserApiErrorsIntegration` 的包裝（堆疊仍完整）；sdk chunk 載入失敗時佇列裡的錯誤丟失
（此時多半是部署換版，`chunk 載入失敗` 本身也送不出去，與現況相同）。
規格：`19-observability.md` §2（收集點加「SDK 就緒前」一列）、§7、§9.2 新增決定、§9.4 實作紀錄；`plugins/app/telemetry.ts` 的註解。

### S2 socket.io 在連線時才載入（web-core/realtime）

實測：backstage −12.5 KB、platform −12.4 KB。

`socketIoRealtimeTransport()` 回傳的 transport 在第一次 `connect()` 時才 `import('socket.io-client')` 建立 socket；之前的 `on()` 訂閱先記下、建立後補掛；
`isConnected`／`isActive` 在載入前是 `false`；`dispose()` 早於載入完成時不建立 socket。只有當選 leader 且有 session 的分頁會下載（§3.3），登入頁不下載。
風險：登入後第一次連線晚一個 chunk 的下載時間（約 12 KB）；重連不受影響。
規格：[`11-realtime.md`](../architecture/frontend/11-realtime.md) §2（「唯一 import `socket.io-client` 的檔案」改成「唯一、而且是動態」）、§3；`transport-boundary.test.ts` 一併檢查沒有靜態 import。

### S3 feature 的同步登記只放資料與 loader（backstage 的 features）

實測：回收桶 −4.0 KB；批次操作的上限（把登記整個拿掉）−5.7 KB；兩者合併 −9.9 KB（mutation hook 兩邊都用到，要一起改才拿得掉）。

1. **回收桶**：`trash.ts` 的 `RestoreAction` 以 `lazy()` 登記（同偏好分頁 §4.3）；`features/trash` 的列表頁在儲存格外包 `<Suspense>`（還原按鈕的骨架）。
2. **批次操作**：`batch.ts` 只保留 id、`labelKey`、`successKey`、`localeScope` 與一個載入實作的 `run`：
   `run: async (id, ctx) => (await import('./batchRuns')).activateUser(id, ctx)`，或在 web-core 加 `lazyBatchRun(load, name)` 的小工具。
   `roleRefs`、`approvalReviewedChanges` 這類「變更宣告」從 `hooks/use*Mutations.ts` 搬到 feature 內的 `changes.ts`，讓 hook 與批次實作都 import 它，而不是互相 import。
   檔案與圖片庫的 `uploadSources`／`enqueue*Uploads` 照舊同步（頁面與 plugin 都用）。
3. 規則寫進規格：同步階段的登記只能帶「資料（id、語系 key、權限、route）與 lazy 的元件或 loader」，不能 import `hooks/`、`components/`
   （頂列工具除外，§4.4）。`navigation.ts` 的 `useBadge` 與 `search.ts` 量過很小，維持現狀，但同樣只能 import `apis/*/query`。

規格：[`02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §4（新增「同步登記的原則」一節，整合 §4.3、§4.7 的 lazy 規則）、§5；
[`03-feature-anatomy.md`](../architecture/frontend/03-feature-anatomy.md)（`batch.ts`／`trash.ts` 的形狀）；[`13-trash.md`](../architecture/frontend/13-trash.md)；
[`07-ui-system.md`](../architecture/frontend/07-ui-system.md) §13（批次操作的登記）。

### S4 web-core 的小項：命令面板、批次佇列的主執行緒退路

實測：命令面板改 lazy −1.5 KB（兩個 app 各自）；`BatchQueueHost` 移出首屏 −2.0／−2.1 KB。

- `DashboardShell` 在面板第一次開啟（store 的 `open` 變成 `true`）後才渲染 lazy 的 `CommandPalette`；觸發按鈕與快捷鍵照舊同步登記。
  第一次按 ⌘K 多一次小 chunk 的下載（可在滑過搜尋按鈕時預載）。規格：[`18-command-palette.md`](../architecture/frontend/18-command-palette.md)。
- `connectInline()` 以動態 import 載入 `BatchQueueHost`（`connectBatchQueue` 改成回傳 Promise，或 inline 模式只由測試以 `connect` 選項注入）。
  規格：`07-ui-system.md` §13（佇列的連線方式）。

### S5 vendor 的 chunk 分組（兩個 app 的 `vite.config.ts`）

以 `build.rolldownOptions.output.codeSplitting.groups` 把「首屏一定整包用到」的依賴各放一個 chunk：

```ts
groups: [
  { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 30 },
  { name: 'tanstack', test: /node_modules[\\/]@tanstack[\\/](router-core|react-router|history|store|react-store|query-core|react-query)[\\/]/, priority: 20 },
  { name: 'i18n', test: /node_modules[\\/](i18next|react-i18next)[\\/]/, priority: 20 },
  // zod：只在 S6 之前加；S6 之後 classic 只有 lazy 頁面用，放進群組會把它整包拉回首屏
]
```

實測：單獨套用 −16.1 KB（400.3 → 384.2），最大 chunk 209.7 → 153.5 KB；在 S1～S4 之後再 −20.6 KB；platform 在 S1～S4 之後 −3.4 KB。
**拆分本身不會減少要下載的程式**，省下的是根因 4 的壓縮損失；另一個好處是 vendor chunk 在一般的功能修改下 hash 不變，回訪的使用者不必重下載。

注意與風險：

- 只能放「首屏一定整包用到」的套件。加上 Base UI 群組實測反而較差（388.7 KB）：Base UI 只在 lazy 頁面用的元件也被拉進首屏。
- 精準的做法是把「首屏的所有模組」放一個群組（實測 −37.7～−39.9 KB），但需要 tree-shaking 之後的模組清單；以 plugin 在 `buildEnd` 沿 `importedIds`
  算出的靜態閉包會把 barrel 轉出、實際沒用到的模組一起拉進來（實測未壓縮 1185 → 1458 KB、初始 446.6 KB），要兩階段建置才做得到，暫不採用。
- Rolldown 的實驗選項 `experimentalInlineCommonChunks`（把小的共用 chunk 複製進使用端）實測更差（447～460 KB），不採用。
- 群組改變了模組的執行順序邊界：合併前跑 E2E 的登入、推播、批次佇列案例；之後新增依賴時檢查是否該加進群組。

規格：`19-observability.md` §7（chunk 分組的規則與理由）；兩個 app 的 config 各一份（設定檔不進 packages），在 `apps/platform/README.md` 的同步規則加一行。

### S6 route 的 search 驗證改用 `zod/mini`

實測上限（首屏完全沒有 zod）：−24.5 KB。以代表性的 search schema（`coerce`、`int`、`min/max`、`default`、`catch`、`enum`、uuid 的 union、`transform`、排序陣列）
用 Rolldown 打包比較：classic 24.0 KB、`zod/mini` 7.8 KB（gzip）→ 預期 **−15～16 KB**（兩個 app 都有）。

- `features/*/routes/model.ts`、`web-shared/constants/sort.ts` 的 `sortSearchSchema`、`web-core/locales/zodErrorMap.ts` 改用 `zod/mini` 的函式式 API
  （`z.catch(z._default(z.coerce.number().check(z.int(), z.minimum(0)), 0), 0)`）；`z.config` 寫在 core 的全域設定，classic 與 mini 共用，表單的錯誤訊息不受影響（要以測試確認）。
- 表單（lazy 頁面）照舊用 classic；classic 建在同一份 `zod/v4/core` 上，lazy 頁面只多載 classic 那一層。
- 替代方案：web-core/router 自寫十來個 search 參數的解析函式（約 −22 KB），但會有兩套驗證寫法；先做 `zod/mini`，不夠再考慮。
- 規格：[`04-routing.md`](../architecture/frontend/04-routing.md) §3（`validateSearch` 的寫法與範例）、[`03-feature-anatomy.md`](../architecture/frontend/03-feature-anatomy.md) 的 `routes/model.ts`。

### 不採用

| 方案 | 實測／理由 |
| --- | --- |
| 可啟用 feature 的 plugin 改成動態載入（`FEATURE_CATALOG` 放 `() => import('…/plugin')`） | S3 之後再做，初始 390.4 → 393.3 KB（**+2.9**）：route 物件仍要靜態組進 route tree，`plugin.ts` 本身很小，拆出去只多切 chunk；而且預設全部啟用，登入後馬上要下載。維持 §9.2 D1 |
| 通知鈴鐺的面板（`NotificationList`、詳細內容對話框）改 lazy | 在 S3 之後再做，初始反而 +17.1 KB（初始 chunk 增加到 171 個）、最大 chunk −44.7 KB。鈴鐺本來就在首屏渲染；S5 之後若要再省可以重新量 |
| 以 Preact（`preact/compat`）取代 `react-dom` | 估計可省約 50 KB（未實測），但 telemetry 用了 React 19 的 `createRoot` 錯誤回呼，Base UI、TanStack Router 以 React 19 為前提，相容層的風險與維護成本遠大於收益 |
| 只調高預算 | 成長約每天 +14 KB，加 10% 撐不過兩三個功能；而且超過的部分大多是首屏用不到的程式 |

### 預期效果（實測累積，S6 為估計）

| 步驟 | backstage 初始 | 最大 chunk | platform 初始 |
| --- | --- | --- | --- |
| 現況 | 400.3 | 209.7 | 339.9 |
| S1 | 367.7 | 177.1 | 307.4 |
| S1～S4 | 342.2 | 155.4 | 291.8 |
| ＋S5 | 321.6 | 122.5（lazy 的 `RichTextEditor`；entry 105.3） | 288.4 |
| ＋S6（估） | 約 305 | 同上 | 約 272 |

### 防止回歸

1. `app/__tests__/entry-imports.test.ts` 新增規則：
   - 首屏不出現 `features/*/hooks/use*Mutations.ts`、`features/*/components/*RestoreAction*.tsx`、`features/*/batchRuns.ts`（頂列工具 `NotificationBell` 的子樹列為例外並註明理由）；
   - resolver 跟進 `@b2b-system/web-core/*`、`@b2b-system/web-shared/*` 到 `packages/*/src`，禁止首屏靜態出現的套件 specifier 加上 `@sentry/browser`、`socket.io-client`，
     S6 之後再加 `zod`（只允許 `zod/mini`）。動態 `import()` 不算，所以經過 barrel 也不會誤判。
2. web-core：`telemetry` 加一個邊界測試（同 `realtime/transport-boundary.test.ts`）：只有 `telemetry/sdk.ts` 以值 import `@sentry/*`，且 `sdk.ts` 只被動態載入；
   S1 的佇列重送、`enabled: false` 不下載、SDK 就緒前的 `captureError` 各一個單元測試。
3. `scripts/check-bundle-budget.mjs` 加選用的 `forbiddenInitial`（`bundle-budget.json`）：bundle job 以 `BUILD_SOURCEMAP=hidden` 建置，
   讀初始 chunk 的 sourcemap，列出的模組（`@sentry/`、`socket.io-client`、`engine.io-client`、`zod/v4/classic`、`BatchQueueHost`、`CommandPalette.tsx`）出現就失敗。
   這是唯一看得到 tree-shaking 之後實際內容的檢查，能抓到靜態 import 圖看不出的情況（例：web-core 的 barrel）。
4. job summary 多印「與預算的差距」與初始 chunk 數，review 時看得出趨勢。

### 預算調整

- 不調高。S1 單獨就讓兩個 app 回到預算內（367.7／395、307.4／350），可以先合併止血。
- S1～S5 完成後 **調低** 到實測值加約 5%：backstage `initialKb` 340、`maxChunkKb` 135；platform `initialKb` 305、`maxChunkKb` 依當時最大 chunk ＋10%。
  S6 完成後再調一次（backstage 約 320、platform 約 285）。餘裕從 10% 改成 5%：根因 2 的規則與 `forbiddenInitial` 會擋掉大部分「不小心進首屏」的情況，
  剩下的成長應該是真的需要、要在 PR 說明原因的。調整寫進 `19-observability.md` §7 的現況與 `bundle-budget.json` 的 `$comment`。

## 驗證方式

- 每一步：`BUILD_MANIFEST=true vite build` ＋ `node scripts/check-bundle-budget.mjs apps/backstage apps/platform`（或 `pnpm bundle:check`），
  記下初始載入、最大 chunk 與初始 chunk 數；CI 的 `bundle 預算` job 綠燈。
- 以 `BUILD_SOURCEMAP=hidden` 建置，確認初始 chunk 的 sourcemap 不含 `@sentry/`、`socket.io-client`、各 feature 的 `use*Mutations`（S6 之後還有 `zod/v4/classic`）。
- S1：`web-core` 的 telemetry 測試；以 `pnpm dev:apm` 起 apm-service，在 `main.tsx` 的 bootstrap 期間丟一個錯誤，確認 SDK 載入後補送、帶正確的 `source`；
  `VITE_APM_ENABLED=false` 時 network 沒有 sdk chunk。
- S2：`web-core` 的 realtime 測試；E2E 的推播案例；登入頁的 network 沒有 socket.io 的 chunk；兩個分頁只有 leader 下載。
- S3：回收桶的還原、各列表的批次操作（含檔案與圖片庫的上傳接手）的 E2E；`entry-imports.test.ts` 的新規則。
- S5：E2E 全跑一次（模組執行順序）；部署後確認 vendor chunk 的檔名在只改 app 程式的提交之間不變。
- S6：`04-routing` 涉及的列表頁網址參數（預設值不寫進網址、非法值回到預設）、表單的錯誤訊息語系。

（2026-10-10 backstage 各功能的優化分析發現；同日補根因分析與方案設計。）
