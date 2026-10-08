# 前端 21 — 匯入／匯出

匯出對話框、「我的匯入匯出」、類似 Excel 的匯入預覽。後端的框架、API 與規則見 [`../backend/22-data-transfer.md`](../backend/22-data-transfer.md)；
這份只講前端的元件、狀態與請求。

> 程式碼：`packages/ui/src/components/DataGrid/`、`packages/web-core/src/data-transfer/`（匯出、列表、共用型別與字串）、
> `packages/web-core/src/data-import/`（匯入工作區）、`packages/web-core/src/form/importDrafts.ts`（預覽草稿的儲存）、
> backstage `apis/data-transfer/`、`features/data-transfer/`、`features/user/pages/UserImport/`、使用者列表與稽核日誌頁的入口。

---

## 1. 程式放哪

| 位置 | 內容 |
| --- | --- |
| `packages/ui/src/components/DataGrid/` | **通用** 的試算表式表格（§3），不含業務名詞；底層是 `react-data-grid`，型別不外露 |
| `packages/web-core/src/data-transfer/` | 匯出與列表：`ExportDialog`、`TransferTable`、`useTransferQuery`、`downloadFromUrl()`／`downloadBlob()`、`useIssueMessage()`（問題代碼的翻譯）、共用型別與 `DataTransferApi`／`ImportApi` |
| `packages/web-core/src/data-import/` | 匯入頁的整頁元件 `ImportWorkspace`（設定、對應、預覽、結果）、預覽的狀態 `importState`（reducer）、`useImportWorkspace` |
| `packages/web-core/src/form/importDrafts.ts` | 預覽草稿的加密儲存與 session 結束時的清理（在首屏的 `SessionWatcher` 用到，所以不放在匯入模組裡） |
| `packages/web-core/src/locales/resources/*.json` 的 `dataTransfer` | 步驟、按鈕、狀態、問題代碼（`dataTransfer.issue.<code>`） |
| `apps/backstage/src/apis/data-transfer/<operation>/` | 每支 API 一個資料夾；`analyze-import` 以 `FormData` 送出（這個 app 第一個 multipart 的 fetcher），範本與結果報告是附件（HTTP 管道回 Blob，§6） |
| `apps/backstage/src/features/data-transfer/` | 「我的匯入匯出」（`/data-transfer`）、route id `dataTransfer.detail`（通知的連結） |
| `apps/backstage/src/features/user/pages/UserImport/` | 使用者匯入頁（`/user/import?mode=create\|update&transfer=<id>`）：把 fetcher 與 `type: 'user'` 交給 `ImportWorkspace` |
| 使用者列表、稽核日誌頁 | 頁首的「匯出」「匯入」、批次列的「匯出選取」 |

- web-core 不呼叫 app 的 API：`ImportWorkspace`、`ExportDialog`、`TransferTable` 以 props 接收一組 fetcher（`DataTransferApi`／`ImportApi`）與查詢鍵，
  與 MFA 的 `MfaSelfApi` 同一個做法。app 在各 feature 的 `hooks/*Api.ts` 組好（feature 之間不共用模組，所以使用者與稽核日誌各一份）。
- 欄位名稱、選項、說明都由 `GET /data-transfers/importers/:type` 依請求的語系回傳；前端不為每個資源寫欄位定義。
- 匯入頁屬於各資源的 feature：頁面權限與麵包屑是靜態的，頁面只有幾十行。

## 2. 匯出

**入口**

- 列表頁首的「匯出」：範圍預設為「符合目前篩選的全部」。
- 批次列的「匯出選取」：`BatchBar` 新增一種 **不入佇列** 的動作 `{ kind: 'run', run({ rows, allMatching }) }`（`web-core/batch` 的 `RunBatchAction`）。
  「選取全部符合」時不先逐頁收集，`allMatching` 為 true，匯出改用篩選條件（D3）。
- 沒有該資源的匯出權限、或租戶沒有啟用 `dataTransfer` 時兩個入口都不顯示；權限未水合前不出現。

**`ExportDialog`**

| 項目 | 內容 |
| --- | --- |
| 範圍 | 「已勾選 N 筆」／「符合目前篩選的全部，約 N 筆」（附排序說明），有勾選時預設前者 |
| 格式 | CSV（預設）、XLSX、JSON、YAML、SQL（後端 `resources` 回傳的清單）；各附一句說明 |
| 欄位 | 預設全選、可取消勾選；上次的選擇存在偏好（`localStorage`，以資源類型為鍵，只留目前還有權讀的欄位） |
| 送出後 | 對話框變成進度：「正在匯出… 1 500／3 400」，可「在背景繼續」關閉，或取消 |

流程：`POST /exports` → 以 `useTransferQuery` 等推播（`Resource.DATA_TRANSFER` 讓 `transfer(id)` 失效並重抓；推播斷線時進行中的傳輸每 5 秒輪詢，重新連上時重查一次，連線中也每 15 秒保險輪詢，[`../backend/22-data-transfer.md`](../backend/22-data-transfer.md) §12 D39）
→ 完成時 `POST /:id/download` → `downloadFromUrl()`（`<a download>`，點完移除）。對話框已關閉時不自動下載，完成時的站內通知連到「我的匯入匯出」。
0 筆顯示「沒有符合的資料」；勾選範圍有幾筆已無法存取時顯示「已勾選 120 筆，匯出 118 筆」。

## 3. `DataGrid`（`@b2b-system/ui/DataGrid`）


**選型**

- 以 `react-data-grid` 為底層（[`../backend/22-data-transfer.md`](../backend/22-data-transfer.md) §12 D14）：MIT 授權、列與欄都虛擬捲動、內建鍵盤移動與儲存格編輯、可凍結欄。
- 樣式以 Design Token 覆寫它的 CSS 變數，不寫色碼。
- 外面包一層 ui 自己的 API，app 不直接 import 底層套件；之後要換實作只動 ui。

**功能**

| 功能 | 行為 |
| --- | --- |
| 凍結欄 | 列號、狀態（錯誤／警告／無變更圖示）固定在左側；修改模式另有「比對目標」欄（目標的名稱；手動指定的標「手動指定」，撤回的標「未比對」） |
| 表頭 | 欄名、必填 `*`、類型圖示；滑過顯示 `hint`、格式與選項 |
| 儲存格狀態 | 錯誤：紅框＋右上角三角（類似 Excel 的註解標記），`aria-invalid`，滑過或聚焦時顯示訊息；警告：琥珀色；修改模式有變更：品牌色底，滑過顯示「原值：…」；沒有變更：淡化 |
| 鍵盤 | 方向鍵、Tab、Home／End、Ctrl＋方向鍵跳到邊界；Enter 或 F2 編輯、Esc 取消、Delete 清空；F8 跳到下一個錯誤 |
| 編輯器 | 文字（預設，可以加自動完成）；有選項的欄位是 **包成儲存格樣子的 `Select`**（D36）：`enum` 是固定選項、`reference` 是遠端查詢（`options` 端點），多值欄位可以多選；修改模式的「比對目標」欄也是下拉選單（§4.1）。日期與布林以文字輸入，由後端解析（D24） |
| 複製貼上 | 選取儲存格時：Ctrl＋C 複製目前的儲存格；Ctrl＋V 把 TSV（從 Excel 複製的範圍）貼到以目前儲存格為左上角的範圍，超出表格的部分忽略，一次貼上是一次編輯、一次 `validate`。**編輯中** 的複製貼上交給瀏覽器，只作用在輸入框選取的文字（D38） |
| 復原 | ⌘Z／Ctrl＋Z 復原、⌘⇧Z／Ctrl＋Shift＋Z（Windows 另有 Ctrl＋Y）重做，記最近 50 次編輯；焦點不在表格時也可以用（預覽掛載期間登記在全域快捷鍵，D37），在輸入框裡是瀏覽器原生的文字復原。在前端的 JSON 上還原後，被還原的列重新送 `validate` |
| 篩選 | 全部／錯誤／警告（修改模式另有有變更／無變更），分頁標籤上顯示各自的數量；在前端做 |
| 建議 | 錯誤附有建議值時，訊息帶上「建議：財務管理員」（不自動更正，D7） |
| 列 | 新增列（列尾）；勾選列後「從匯入中移除」（只影響前端的 JSON，D15） |

**編輯器**（`DataGridEditors.tsx`）

- 下拉選單（欄位有 `options`、`rowOptions` 或 `loadOptions`）：`Select` 的觸發鈕填滿儲存格（品牌色框、沒有圓角），進入編輯時直接展開。
  功能就是 `Select` 的：搜尋、虛擬捲動、多選（`multiple`，儲存格以 `;` 串接）、遠端查詢（展開時查一次、輸入關鍵字時去抖動 200 ms 再查）。
  單選選完就寫回並結束編輯；多選在收合（點外面）或按 Tab 時寫回，Esc 取消。
- 自動完成（欄位有 `loadSuggestions`）：照常輸入任意文字，下方列出建議（portal 到 body，儲存格會裁切超出的內容）；↑↓ 選擇、Enter 採用、第一次 Esc 只收起建議。
  匯入預覽的建議來源見 §4.1。

`DataGrid` 是受控元件：列（`{ key, cells, states, header, tone }`）、欄、儲存格狀態都由 props 傳入，編輯、貼上、清除都以 `onCellsChange(changes)` 回報；
Ctrl＋Z／Ctrl＋Shift＋Z 交給呼叫端的 `onUndo`／`onRedo`。外面包一層 ui 自己的 API，app 不直接 import 底層套件；之後要換實作只動這個資料夾。

## 4. 匯入工作區（`ImportWorkspace`）

### 4.1 狀態與請求

預覽的狀態在 `web-core/data-import` 的 `importState`（reducer）與 `useImportWorkspace`：

```ts
interface ImportState {
  mode: 'create' | 'update';
  fileName: string | null;
  columns: ImportColumnView[];               // analyze 回傳
  ignored: string[];                         // 不會匯入的標頭
  rows: ImportRow[];                         // 前端持有的 JSON；編輯就是改這裡的 cells
  results: Record<number, RowValidation>;    // rowNo → 後端的驗證結果
  revisions: Record<number, number>;         // rowNo → 修改序號
  pending: Record<number, number>;           // 已修改、還沒拿到結果的列 → 需要驗證的修改序號
  history: { undo: Edit[]; redo: Edit[] };   // 一次編輯是受影響列的前後快照
}
// 步驟（setup → analyzing → mapping → preview → submitting）在 useImportWorkspace；
// 檔案內重複、同一個目標多次以 computeLocalIssues(state) 計算
```

- 以 reducer 管理，每個動作（編輯、貼上、套用建議、新增列、移除列、復原）都是純函式，可以單獨測試。
  參考實作把解析、驗證、比對、送出全塞在一個上千行的 hook 裡，靠一堆 ref 串起來；這裡解析與驗證都在後端，前端只剩狀態轉移。
- 編輯：
  - 改完儲存格（Enter、離開儲存格、貼上、套用建議）立即更新 `rows`，該列進入 `pending`，顯示「驗證中」的淡色。
  - 300 ms 內的修改合併成一個 `validate` 請求（最多 1 000 列）；回來後換掉這些列的 `results`。
  - 回應回來時若該列又被改過（比對列的修改序號），丟棄這次結果，等下一次。
  - 每次 `rows` 改變後重算 `localIssues`（5 000 列的字串比對在數毫秒內完成）。
  - 編輯在 Enter、離開儲存格或貼上時才算數，不是每打一個字一次。參考實作每打一個字就對整批重新驗證。
- 套用按鈕在 `pending` 不為空時停用，顯示「驗證中…」。
- 修改模式的比對目標（[`../backend/22-data-transfer.md`](../backend/22-data-transfer.md) §7.5、D34）：列上的 `target` 是 `undefined`（自動比對）、`null`（撤回）或 `{ id, label }`（手動指定），
  以 `setTarget` 動作改變——與編輯儲存格一樣是一次可以復原的編輯，該列重新驗證；送 `validate` 與套用時轉成 `targetId`（`targetIdOf`）。
  下拉選單第一頁就是「自動比對」「撤回比對」，其下是 `searchTargets` 的搜尋結果。app 沒有給 `searchTargets` 時比對目標欄唯讀。
- 文字欄的自動完成（D35）：同一欄已經填過的值；新增模式的唯一欄（Email、帳號）不建議填過的值（一定重複），改成輸入 `alice@` 時補完同一欄出現過的網域；
  修改模式另外向伺服器查現有的值（欄位有 `suggest`）。
- 套用前的確認框以大字列出「將新增／將修改 N 列」「沒有變更（略過）」「有錯誤」，有錯誤的列不算在要寫入的列數裡。
- 篩選（只看錯誤列等）在前端做。

### 4.2 草稿與離開頁面

- 預覽中的資料只在前端，所以：
  - 有未套用的資料時，以 `useUnsavedChangesGuard` 擋住離開頁面與關閉分頁。
  - 每次修改後（節流 2 秒）把 `{ type, mode, fileName, columns, rows, results }` 存進 IndexedDB 草稿，重新整理後顯示「接續上次未完成的匯入（檔名、N 列、儲存時間）」。
- 草稿存在 `web-core/form` 的 `importDraftStore()`（自己的 IndexedDB `b2b-system:import-drafts`，`createDraftStore` 新增的 `dbName` 選項），與表單草稿（`useFormDraft`）用同一套加密（AES-GCM、金鑰不落地），但規則不同：
  | 項目 | 表單草稿 | 匯入草稿 |
  | --- | --- | --- |
  | 何時存 | 只在 session 非自願結束時 | 每次修改後（節流） |
  | 單筆上限 | 256 KiB | 20 MiB（5 000 列 × 15 欄的 JSON 約數 MB） |
  | 數量 | 20 | 每個「身分 × 資源 × 模式」一份 |
  | 期限 | 24 小時 | 24 小時 |
  | 清除 | 恢復或放棄時 | 套用送出成功、放棄、登出、身分改變時 |
- 草稿恢復後，`results` 可能已過時（資料庫變了），所以恢復時自動把全部列重新 `validate` 一次。

### 4.3 效能

- 5 000 列 × 15 欄靠虛擬捲動只渲染可見的部分。
- 儲存格平常是唯讀的顯示元件，**只有正在編輯的那一格** 掛上輸入元件。參考實作每一格都是常駐的輸入元件。

### 4.4 Bundle

- 匯入頁以 `lazyRouteComponent` 載入，`DataGrid` 跟著拆成獨立的 chunk。
- `react-data-grid` 約 23 KB gzip；`pnpm bundle:check` 確認 chunk 低於 `maxChunkKb`（backstage 215 KB gzip）。
- 匯出（`web-core/data-transfer`）與匯入（`web-core/data-import`）是兩個模組：列表頁只帶匯出對話框，不帶表格。

### 4.5 步驟

| 步驟 | 元件 | 說明 |
| --- | --- | --- |
| 選擇模式 | `ImportWorkspace` | 只有一種模式的權限時不顯示切換；切換寫進網址，有預覽資料時由未儲存提醒先確認 |
| 上傳與分析 | `ImportSetup` | `FileUpload`（`.csv`、`.tsv`、`.txt`、`.xlsx`、`.json`、`.yaml`、`.yml`）、編碼、工作表（分析回報多個時）；「不上傳，直接輸入」建立 20 列空白。上傳區在最上面：熟悉的人直接選檔分析 |
| 範本與欄位說明 | `ImportSetup` | 在上傳區下方：下載 Excel／CSV／JSON／YAML 範本（經 HTTP 管道取得 Blob 再存檔）；欄位說明表（必填、格式、選項、說明、比對鍵） |
| 對應欄位 | `ImportMapping` | 分析回 `needsMapping` 時出現；以記憶體中的同一個檔案加上 `mapping` 再分析一次 |
| 預覽與修正 | `ImportPreview` | `DataGrid`、篩選、復原、重新比對（修改模式）、新增／移除列；套用前的確認框可以勾選略過有錯誤的列 |
| 進度與結果 | `ImportResult` | 網址帶 `transfer=<id>`：進度條（可取消）、計數、逐列結果（失敗的在前，最多 1 000 列）、結果報告、以失敗的列重新匯入 |

## 5. 「我的匯入匯出」（`/data-transfer`）

- 只列出自己的傳輸：建立時間、類型與模式／格式、資料（資源名稱與檔名）、狀態、筆數、保留到。
- 每一列的動作依狀態而定：匯出完成 → 下載（每次重新取得連結）；進行中 → 取消（帶 `version`）；匯入已結束 → 查看結果（到該資源的匯入頁，
  route id 依資源類型，例 `user.import`）；已結束 → 刪除（確認後立即刪除檔案與結果，不影響業務資料）。
- 進度靠推播即時更新（`Resource.DATA_TRANSFER` 的 collection 與 entity）；稽核日誌的列表不因進度推播重抓。
- 入口在頂列的 **帳號選單**（與個人資料、偏好設定同一處），所有登入的人都看得到，沒有額外的權限；命令面板也列出它。

## 6. 下載檔案

- 匯出檔：後端回 presigned 連結（獨立的檔案網域），`downloadFromUrl()` 以 `<a download>` 觸發。
- 範本與結果報告：要帶 access token，所以經過 app 的 HTTP 管道。`HttpContext` 遇到成功的 `Content-Disposition: attachment` 回應時，
  `data` 是 `Blob`（錯誤一律是 JSON 信封，照常解析）；fetcher 從 `Content-Disposition` 取檔名，`downloadBlob()` 存成檔案。

## 7. 與規劃不同的實作

| 項目 | 規劃 | 實作 | 原因 |
| --- | --- | --- | --- |
| 側欄入口 | 側欄的「個人」群組 | 頂列的帳號選單（`placement: 'account'`） | 側欄沒有「個人」群組；帳號選單就是放個人頁面（個人資料、偏好設定）的地方，不必為一個入口新增群組 |
| 複製 | 範圍複製成 TSV | 只複製目前的儲存格 | `react-data-grid` 沒有範圍選取；貼上仍支援範圍 |
| 建議值 | 儲存格選單的「改成…」「全部套用」 | 建議放在錯誤訊息裡 | 選單要自己實作焦點管理；先以訊息提示，之後需要再加 |
| 編輯器 | 日期用 DatePicker、`reference` 用可搜尋的 Select | `reference`、`enum` 用包成儲存格的 `Select`（D36）；日期仍是文字輸入 | 日期由後端解析（D24），文字輸入已足夠；下拉選單需要搜尋與多選，原生的 `datalist` 做不到 |
| 預覽草稿的儲存 | `web-core/data-transfer` 的 `importDraftStore` | `web-core/form/importDrafts.ts` | session 結束時的清理在首屏；放在匯入模組會把表格帶進首屏 |
| 匯入與匯出的模組 | 一個 `web-core/data-transfer` | `data-transfer`（匯出、列表）與 `data-import`（匯入工作區） | 列表頁只需要匯出對話框，不必帶表格 |

## 8. 測試

| 層 | 涵蓋 |
| --- | --- |
| ui（`DataGrid.test.tsx`） | grid 角色、必填標記、錯誤儲存格的 `aria-invalid` 與訊息、Delete 清空、Ctrl＋Z、TSV 解析、範圍貼上與編輯中的貼上、下拉選單（單選、遠端多選）、自動完成 |
| web-core（`importState.test.ts`） | 編輯、復原與重做、過時的驗證結果被丟棄、新增與移除列、檔案內重複、同一個目標多次、摘要、比對目標的手動指定與撤回 |
| web-core（`ExportDialog.test.tsx`、`ImportWorkspace.test.tsx`） | 範圍與欄位、完成後自動下載；上傳 → 分析 → 預覽標出錯誤 → 確認框的數字 → 勾選略過後套用；復原／重做的快捷鍵與離開後取消登記 |
| web-core（`BatchBar.test.tsx`） | `kind: 'run'` 的動作不出確認框、不入列 |
| backstage | 使用者列表的入口（有權限、沒有權限、feature 未啟用、未水合）；「我的匯入匯出」的列表與下載；匯入頁的模式依權限 |
