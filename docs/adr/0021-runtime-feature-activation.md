# ADR-0021 — 前端 feature 改為執行期啟用：程式碼仍在同一份 build，啟用與停用可在 App 啟動後發生

- 狀態：**採用**（實作中，branch `feat/runtime-features`）
- 日期：2026-09-30
- 相關：修改 [ADR-0001](./0001-plugin-based-app-context.md)（「所有 plugin 在 `load()` 前同步 `use()`」的前提）；
  牽動 [ADR-0012](./0012-batch-queue-worker.md)（批次佇列的分派）、[ADR-0020](./0020-physical-tenant-isolation.md)（啟用清單以租戶為單位）；
  正式文件待實作後寫進 [`../architecture/frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md)

## 背景

ADR-0001 的 plugin 容器假設 **所有 feature 在 App 啟動時就確定**：`main.tsx` 依序 `use()`、`load()` 一次、最後建立 router。
之後要支援「哪些 feature 可用，執行期才決定」（例：租戶買了哪些模組、某個模組被平台暫時關閉），
而決定的時間點可能在第一次 render 之後（登入後才知道、使用中被切換）。

目前的實作在 App 啟動後才 `context.use(xxxFeaturePlugin())` 時，會有以下問題：

| # | 現象 | 位置 |
| --- | --- | --- |
| P1 | 晚到的 plugin 的 `onInit` 永遠不會執行（語系包沒有登記）；再呼叫一次 `load()` 會讓 **所有** plugin 的 `onInit` 重跑 | `shared/context/createContext.ts` 的 `load()` |
| P2 | route 加不進去：`routeTree` 在模組載入時就用靜態 import 組好，router 只建一次 | `app/routes.tsx`、`app/plugin.ts` |
| P3 | **未註冊的路徑一律放行**：`usePageAccess` 對 `resolvePageKey()` miss 回 `canAccess: true`；route 比頁面權限先存在時頁面沒有保護，`useMemo` 也不會因為後來的註冊而重算 | `core/permission/hooks.ts` |
| P4 | 註冊表（頁面權限、頂列工具、偏好分頁與列表、批次操作）是模組層級的 `Map`，沒有訂閱；側邊選單是 `app/` 裡寫死的常數 | `core/*/registry.ts`、`app/layouts/SidebarNav.tsx` |
| P5 | 註冊表沒有反註冊；同名 plugin 再 `use()` 時舊的被 destroy，但重新註冊會丟 `already registered` | 同上 |
| P6 | 佇列把工作交給尚未載入該 feature 的分頁時，該筆直接記成失敗（`BatchOperation "…" 尚未註冊`） | `core/batch/BatchQueueClient.ts` |
| P7 | `attrs` 以 `Object.assign` 掛上 context，不是響應式的，已經 render 的元件看不到 | `shared/context/createContext.ts` |

## 決定

### 動態到什麼程度

| 方案 | 結論 |
| --- | --- |
| A. 啟動時決定、之後變更就整頁重新載入 | 不採用：清單可能要登入後才知道（登入頁已經 render）；使用中切換會丟掉未儲存的表單與進行中的批次佇列；access token 只在記憶體，重新載入要再走一次續期 |
| **B. 程式碼在同一份 build；哪些 feature 啟用、何時啟用、何時停用在執行期決定** | **採用**：所有可能的 feature 在編譯期都已知，型別、路由型別、測試的完整性都還保得住；變動的只有「啟用狀態」 |
| C. 遠端載入不在 build 內的模組（Module Federation、import map） | 不採用（延後）：ADR-0001 已因單一部署而排除；需要跨部署的版本相容、共用依賴、CSP 與完整性驗證，複雜度不成比例。B 的設計不擋住之後往 C 走 |

### 具體決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **feature 分兩種**：**常駐**（沒有它 App 就不成立的）維持同步 `use()`；**可啟用** 的 feature 登記在 `app/features.ts` 的 `FEATURE_CATALOG`：`{ [id]: { plugin, routes } }`，以 `satisfies Record<TenantFeature, …>` 對齊後端的 id。catalog 是 `app/` 的一部分，仍是唯一認識所有 feature 的組裝層。程式碼照樣在主 bundle（route 物件本來就要靜態組進 route tree，頁面本來就是 lazy），這裡不做 dynamic import | 不把所有 feature 都改成動態；常駐的部分行為不變，改動集中在可啟用的那些 |
| D2 | **context 支援啟動後安裝與移除**：新增 `context.install(factory): Promise<void>` 與 `context.uninstall(name)`。`install` 同步執行 factory（註冊表寫入）後，立刻 await 這一個 plugin 的 `onInit`；每個 plugin 記錄狀態 `registered → initializing → ready \| failed`，`load()` 只初始化尚未初始化的（可重入）。`onInit` 失敗 → 自動 `uninstall`、記 log，**不影響其他 feature** | 解 P1；把「單一 plugin 的完整生命週期」變成可以單獨執行的單位 |
| D3 | **可啟用的 feature 不得提供 `attrs`**：型別上以 `DynamicFeaturePluginFactory`（結果沒有 `attrs`）限制；需要對外提供能力就走註冊表或 eventBus | 解 P7：`attrs` 的型別透過 declaration merging 永遠存在，執行期卻可能不存在，是型別說謊 |
| D4 | **註冊表改成可訂閱、可反註冊**：`core/*/registry.ts` 改用 `@/shared/store` 的 store；`registerXxx()` 回傳反註冊函式，plugin 以 `clearup` 收集，`uninstall` 時自動執行。讀取端改用 `useStore` 訂閱（`useHeaderTools`、偏好頁、`TableColumnsSection`、權限 hooks）。**重複註冊仍丟例外**（ADR-0001 的規則不變）——有了反註冊，重新安裝不會再撞到 | 解 P4、P5 |
| D5 | **側邊選單維持 `app/` 的靜態表，項目依頁面權限是否已註冊來顯示**：`usePageAccessChecker` 對未註冊的頁面回 `false`，而權限註冊表可訂閱（D4）之後，feature 安裝或卸載時選單自動出現或消失。不另做選單註冊表 | 選單的分組與順序本來就是組裝層的決定；少一個註冊表，也少一個「feature 要記得登記」的地方 |
| D6 | **route 物件維持靜態，啟用與否在 route 上判斷**：`app/routes.tsx` 照舊 import 所有 feature 的 route 物件組成完整的 route tree，**不在執行期改 route tree**。可啟用 feature 的最上層 route **自己** 宣告 `beforeLoad: requireFeature(<ID>)`（`core/feature`；TanStack Router 不允許事後以 `route.update()` 補上 `beforeLoad`）：已安裝 → 通過；清單還沒到或安裝中 → **等待**；未啟用 → `notFound()`；安裝失敗 → 錯誤頁；沒有 session → 不擋（導向登入頁交給 `SessionWatcher`） | 解 P2。執行期重建 route tree（`router.update`）會讓 `Register` 的型別與執行期脫節、已經掛著的 match 失效；B 方案下所有 route 在編譯期都已知，沒有必要。等待是必要的：route 的 loader 會下載語系包，必須在 feature 安裝（登記語系包）之後才跑 |
| D7 | **權限檢查不再對「屬於 feature 的路徑」放行**：`usePageAccess` 的「未註冊 → 放行」只保留給明確列出的公開前綴（`/auth`、devtools）；其他未註冊的路徑視為 **未就緒**（顯示載入中，不渲染頁面）。在 D6 之下正常情況不會發生，這是第二道防線 | 解 P3：fail-open 是這次問題裡唯一的安全性缺口 |
| D8 | **啟用清單的來源**：平台 DB 的 `tenants.features`（可啟用 feature 的 id 陣列），由平台管理者在 apps/auth 的租戶詳情頁開關，與 `allowExternalIdp`（ADR-0020 D22）同一種平台層開關。api 在 `/auth/profile` 回傳 `features`，前端與權限一起水合（同一個 query），存進 `core/feature` 的 store。平台管理者變更時，api 對該租戶的所有連線推播 `resource.changed`（來源 `tenantFeature`），前端依資源依賴圖重新取得 profile。前端比對新舊清單，對新增的 `install`、對移除的 `uninstall` | 與權限同一個節奏（ADR-0005），不多一個請求、不多一種推播事件；決定「租戶買了哪些模組」的是平台，所以放平台 DB |
| D9 | **停用時正在看的頁面**：卸載 **前** 若目前路由屬於該 feature，先導向首頁並 toast 說明；未儲存提醒（`useUnsavedChangesGuard`）**不** 攔（`ignoreBlocker`），與 session 結束時的處理一致。查詢快取不另外清除：離開頁面後沒有觀察者，由 `gcTime` 回收 | 被停用的 feature 的頁面已經不能操作（api 也會拒絕，見 D11），留在原頁只會一直報錯；先離開再卸載，頁面才不會在權限註冊撤回後以「未註冊」的狀態重新渲染 |
| D10 | **批次佇列認不得的操作不判定失敗**：分頁連上佇列後宣告自己能執行的操作（`capabilities`），註冊表變動時重新宣告；佇列只把項目交給宣告支援的分頁，沒有分頁支援時該工作保持排隊（其他分頁安裝完成後接手）。分頁的操作 **減少**（feature 被卸載）時送 `cancel-operations`，佇列取消使用那些操作、尚未結束的工作（與使用者按取消相同，狀態 `cancelled`） | 解 P6。各分頁安裝的時間點不同（剛開的分頁要等 profile），不該因此讓工作失敗；卸載只會因為租戶停用了 feature，而那對所有分頁都成立 |
| D11 | **前端的啟用狀態不是存取控制**：api 以 `@RequireFeature('<id>')` 標在 controller 上，由全域 guard 判斷；未啟用回 `FEATURE_DISABLED`（**404**，不暴露功能存在，與 [ADR-0022](./0022-feature-flags.md) 的 `@RequireFlag` 相同）。該 feature 的背景工作照常執行（資料仍在，重新啟用後要是一致的） | 前端的隱藏只是體驗；與權限「由伺服器判定」（ADR-0005）同一個原則 |
| D12 | **完整性測試改寫**：`feature-registration.test.ts` 改為「對 catalog 裡每個 feature 執行 `install` 後，註冊的鍵集合 = 常駐 feature 的鍵 ∪ 該 feature 的鍵；`uninstall` 後回到常駐的集合」，並加上 install → uninstall → install 不丟例外的案例 | 保住 ADR-0001 用測試取代編譯期完整性的做法，並驗證 D4 的反註冊確實乾淨 |

## 流程

### 啟動與登入

```
bootstrap
  ├─ use(常駐 plugin …) → use(featureActivationPlugin) → use(appContextPlugin) → load()
  ├─ createRouter（完整 route tree，含可啟用 feature 的 route）
  └─ render
登入成功（session 建立）
  ├─ /auth/profile → { user, roles, permissions, features }
  ├─ useSyncPermissions：權限水合
  └─ useSyncFeatures：FeatureActivator.apply(features)
       └─ 對新增的 id：context.install(plugin)
            ├─ 同步：註冊權限、偏好、批次操作 → 各註冊表通知訂閱者，選單與頁面自動更新
            └─ onInit：登記語系包
```

### 直接貼可啟用 feature 的網址

`beforeLoad: requireFeature` 等待「清單已套用且該 feature 不在安裝中」→ 通過後才跑 route 的 loader（語系下載）與權限判斷；
清單套用後不在清單內 → 404。沒有 session 時不擋，照舊由 `SessionWatcher` 導向登入頁。
Layout 以 `useFeatureGate` 再擋一次（D7）：未定 → 骨架屏、未啟用 → 404、安裝失敗 → 錯誤頁。

### 使用中被停用

平台管理者改了清單 → api 對租戶的連線推 `resource.changed`（`tenantFeature`）→ 依賴圖讓 profile 重新取得
→ `FeatureActivator.apply()` → 目前頁面屬於被移除的 feature 就先導向首頁 → `context.uninstall(name)`
→ 撤回註冊（選單項目消失、偏好分頁消失、批次操作消失）→ 分頁向佇列重新宣告操作，佇列取消該 feature 的工作。

## 代價

| 代價 | 緩解 |
| --- | --- |
| 註冊表從 `Map` 改成 store，每個讀取端都要改成訂閱 | 共用的 `createRegistry()`（`shared/registry`）；plugin 容器以 `collectRegistrations()` 包住 factory 與 `onInit`，feature 的註冊寫法完全不變 |
| 可啟用 feature 的程式碼仍在主 bundle 裡 | route 物件不含頁面元件，量很小；真正的頁面仍是 lazy |
| 「安裝中」多了一個狀態：選單項目與頁面會在登入後才出現 | 選單在權限水合前本來就是空的（`useMenuItems`），清單與權限並行取得，使用者看到的時間點不變 |
| 可啟用 feature 不能提供 `attrs` | 目前沒有 feature 提供 `attrs`；需要時走註冊表 |
| 前後端要各維護一份「feature id」 | feature id 由 api 定義成 enum，經 OpenAPI 產進 `@b2b-system/api-sdk`（與權限鍵同一個做法，ADR-0007），前端的 catalog 以型別檢查涵蓋所有 id |

## 原本待決、已定案的事項

1. **清單存在哪裡、誰能改**：只做平台層（平台 DB 的 `tenants.features`，apps/auth 設定），見 D8。租戶內自行開關（租戶管理者在 backstage 設定）這次不做；需要時在平台的「可用」之下再加一層「開啟」。新租戶與既有租戶預設啟用全部。
2. **可啟用的 feature**：`file`、`auditLog`、`job`。其餘維持常駐：
   - `approval`：使用者註冊的審核（`user-registration.approval.ts`）依賴它，停用會讓核心流程壞掉。
   - `identity-provider`：已經由 `allowExternalIdp`（ADR-0020 D22）開關，不做第二套。
   - `auth`、`home`、`account`、`user`、`role`、`permission`、`system`：RBAC 骨架本身。
3. **使用者層級的啟用**：不做；「同一個租戶裡只有部分人可用」由權限表達。
4. **與 feature flag（[ADR-0022](./0022-feature-flags.md)）的關係**：這份 ADR 處理的是 **長期存在的模組**（商業上的開通），不會被移除；
   feature flag 處理的是 **會被移除的暫時開關**。flag 提案實作時沿用這裡的前端機制（`install` / `uninstall`、可訂閱的註冊表），不必再「只在讀取時判斷」。

## 替代方案

| 方案 | 不採用的理由 |
| --- | --- |
| 啟動時一次取得清單、變更時整頁重新載入 | 見「動態到什麼程度」A |
| 執行期重建 route tree（`router.update({ routeTree })`） | 型別與執行期脫節；已掛載的 match 會失效；B 方案下 route 在編譯期都已知，沒有必要 |
| 維持現狀，只在 UI 層依清單隱藏選單 | 路徑仍然可達（P3 的 fail-open 還在）；註冊表、語系、批次佇列的問題都沒解 |
| 每個 feature 各自讀 feature flag 決定要不要註冊 | 決定點散落在各 feature；啟用狀態變更時沒有人負責反註冊 |
