# 前端幾處多餘的請求與重算

## 現況

彼此無關的小問題，各自可以單獨修（路徑相對 `apps/backstage/src/features/`，後端的相對 `apps/api/src/`）。

**1. 審批流程編輯頁為了 `assigneeKinds` 抓整份流程列表，而列表端點對每個類型各查一次權限目錄**

- `approval-flow/pages/ApprovalFlowEdit/page.tsx:55-56`：編輯頁另外 `useQuery(getApprovalFlowListQueryOptions())`，只用到 `list.data?.assigneeKinds`
  （註解說明是與列表頁共用快取；從列表頁進來時不會多一個請求，直接開編輯頁的網址或重新整理時會）。
- 後端 `modules/approval/approval-flow.service.ts:56-70` 的 `list()` 逐一 `await this.toDto(...)`（`:64`），
  而 `toDto`（`:357-`）每次都呼叫 `this.permissionService.getCatalog()`（`:376`，`modules/permission/permission.service.ts:402-417`，每次查 DB 且沒有快取）
  與 `this.repo.countInFlight(flow.id)`（`:377`），每一關另有 `this.assignees.describe(...)`（`:365`）。類型數 × （目錄 ＋ 計數 ＋ 關卡數）個查詢依序執行。

**2. 部門規則的選項每次重繪都重算路徑**

- `approval-flow/pages/ApprovalFlowEdit/components/AssigneeRuleEditor.tsx:217-224`（`OrgUnitTarget`）：每次 render 重建 `byId` 的 `Map`、
  對每個部門呼叫 `orgUnitPath`（`:43-55`，往上走到根）、再 `toSorted` 與 `localeCompare`，沒有 `useMemo`。部門數 × 深度，編輯任何欄位都會重算。
- 另外，`core/components/OrgUnitPicker/OrgUnitPicker.tsx` 的 JSDoc（`:48-52`）寫著它由「使用者列表的部門篩選、組織頁的搬移、**審批流程的部門規則**」共用，
  但這裡實際上自己組了一份平面的路徑清單，沒有用 `OrgUnitPicker`。

（原第 3 項「圖片庫檢視器的按鍵 effect 沒有依賴陣列」已於 2026-10-10 修正：listener 只在開啟時註冊一次。）

**4. 檔案預覽元件被 plugin 靜態載入**

- `file/plugin.ts:16` import `registerBuiltinFilePreviewers`，`file/preview/builtins.ts:3-4` 靜態 import `ImagePreview` 與 `TextPreview`，
  兩個預覽元件（含 `TextPreview` 的 `getFileTextQueryOptions`）因此進了 plugin 安裝時就載入的 chunk，而不是開預覽時才載入。
  其他 feature 登記元件時用 `lazy()`（`notification/plugin.ts:14`、`approval/home.ts:8`、`comment/panel.ts:9`）。兩個元件本身不大，影響有限；
  同步登記只帶資料與 loader 的規則見 [`frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §4.8。

（原第 5 項「公告受眾選擇器的請求」已於 2026-10-10 修正：使用者選單在下拉打開後才搜尋，已選的人以 `GET /users?id=` 每 50 人一個請求取回名稱。）

**6. 圖片庫的無限捲動沒有頁數上限**

- `apis/gallery/get-gallery-items/query.ts:37-57`（`getGalleryItemsInfiniteQueryOptions`）沒有設 `maxPages`，往下捲多久，記憶體裡就留多少頁；
  檔案管理的 `apis/file/get-file-list/query.ts:91` 設了 `maxPages: FILE_INFINITE_MAX_PAGES`（10 頁，`docs/architecture/frontend/12-file-manager.md` 的無限捲動一列）。
  `maxPages` 需要 `getPreviousPageParam` 才能往回捲；圖片庫的列表 API 目前只回 `nextCursor`，所以不是單純加一個選項。

## 影響

- 1：重新整理審批流程編輯頁時，多一個隨類型數成長的序列查詢；目前類型只有幾種，延遲不明顯。
- 2：多餘的 CPU 工作，部門數上千時編輯流程會有感。
- 4：首次載入多下載一點不一定用得到的程式。
- 6：長時間瀏覽大型圖片庫時，分頁資料持續累積（畫面是虛擬捲動，主要是記憶體）。

嚴重度低：都是效能與整潔，沒有錯誤的結果。

## 修正方式

全部在 feature 或 api 的模組內修，不需要新的共用程式：

1. **審批流程**：
   - 後端：`list()` 在迴圈外取一次 `getCatalog()` 傳進 `toDto`（`get()` 也照樣傳）；`countInFlight` 改成一次查出所有流程的計數（`GROUP BY flow_id`）。
   - 前端（選做）：`assigneeKinds` 一併放進詳情端點 `GET /approval-flows/:type` 的回應，編輯頁就不必抓列表；改了 DTO 要依 CLAUDE.md 重產 openapi 與 SDK。
2. **部門規則**：`OrgUnitTarget` 改用 `core/components/OrgUnitPicker`（樹狀、可搜尋，和 JSDoc 的描述一致）；若要保留平面路徑的呈現，至少把 `byId` 與 `options` 包進以 `tree.data` 為依賴的 `useMemo`。
4. **檔案預覽**：`builtins.ts` 的 `component` 改成 `lazy(() => import('./ImagePreview'))`，`FileLightbox` 的預覽區包一層 `Suspense`（骨架沿用載入中的樣式）。
6. **圖片庫**：後端的 keyset 分頁補 `prevCursor`（與檔案列表相同的作法，`docs/architecture/backend/09-file.md` §6.1），前端加 `getPreviousPageParam` 與 `maxPages`；
   日期捲軸的 `startAt` 重新載入不受影響。規格 `docs/architecture/frontend/24-gallery.md` §3 同步補上頁數上限。

## 驗證方式

- 1：`approval-flow.service` 的單元測試以 spy 驗證 `list()` 只呼叫一次 `getCatalog`；api 整合測試的審批流程列表照常通過。
- 2：審批流程編輯頁既有的部門規則測試通過；改用 `OrgUnitPicker` 時補「搜尋部門代碼」的案例。
- 4：`pnpm bundle:check` 通過，建置輸出裡 `ImagePreview`、`TextPreview` 在獨立的 chunk；檔案預覽的既有測試通過。
- 6：`apis/gallery/get-gallery-items/__tests__/` 驗證 `maxPages`；gallery E2E 往下捲超過上限再往回捲，圖片仍正確顯示。

（2026-10-10 backstage 各功能的優化分析發現。）
