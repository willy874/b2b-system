# 前端有超過 400 行的元件，也有超過 200 行、把邏輯寫在頁面裡的 page.tsx

## 現況

以 `wc -l` 統計，不含測試與 stories。

**超過 400 行的元件**

| 檔案 | 行數 | 內容 |
| --- | --- | --- |
| `packages/ui/src/components/Select/Select.tsx` | 818 | `Select()`（L307–818）一個函式約 510 行：資料索引、搜尋、勾選狀態、虛擬捲動、鍵盤導覽、無限載入、渲染 |
| `packages/ui/src/components/TreeEditor/TreeEditor.tsx` | 722 | `TreeEditor`／`TreeEditorCanvas`（L240 起）：React Flow 的設定、復原、工具列、拖曳連線 |
| `packages/ui/src/components/JsonEditor/JsonEditor.tsx` | 666 | CodeMirror 的 extension 組裝（L272 起）與 `JsonEditor()`（L369 起）的狀態同步、搜尋、驗證 |
| `apps/backstage/src/features/file/pages/FileManager/components/FileBrowser.tsx` | 500 | 版面計算、虛擬捲動、框選、鍵盤、拖放上傳、拖曳移動都在一個元件 |
| `apps/backstage/src/features/announcement/components/TriggerField.tsx` | 450 | 純轉換函式 `toTriggerDraft()`（L90）、`fromTriggerDraft()`（L145）等（L44–162），加上 `TriggerField` 與 3 個子元件（L164–450） |
| `apps/backstage/src/features/file/pages/FileManager/components/FileShareDialog.tsx` | 431 | 對話框，加上 `AccessRequestSection`、`AccessRequestRow`、`AddGrantRow`、`GrantRow` 4 個子元件 |

`TriggerField.tsx` 的問題比較具體：同一個 feature 的 `components/draft.ts`（39 行）L4 要從元件檔匯入 `EMPTY_TRIGGER_DRAFT`、`fromTriggerDraft`、`toTriggerDraft`。資料轉換反過來依賴一個 UI 元件檔。

**超過 200 行的 page.tsx**

[`conventions/02-frontend.md`](../conventions/02-frontend.md) §2（L47）規定「`page.tsx` 要薄……超過 200 行就該拆」：

| 檔案 | 行數 | 寫在頁面裡的邏輯 |
| --- | --- | --- |
| `apps/platform/src/features/login/pages/Interaction/page.tsx` | 311 | 4 個 `useState`（L58–68）、以 email 探索 SSO（`useSsoDiscovery`）、登入表單 |
| `apps/backstage/src/features/account/pages/Profile/page.tsx` | 272 | 兩個 mutation、改密碼的驗證規則、確認流程、`expectSessionEnd` |
| `apps/platform/src/features/account/pages/Profile/page.tsx` | 269 | 同上（兩份幾乎相同，見 [`duplicated-code-between-apps.md`](./duplicated-code-between-apps.md)） |
| `apps/backstage/src/features/file/pages/FileManager/page.tsx` | 247 | 3 個對話框的目標狀態（L71–73）、選取能力的交集、預設資料夾的導向 |
| `apps/backstage/src/features/user/pages/UserCreate/page.tsx` | 213 | 表單、伺服器欄位錯誤、角色選項 |
| `apps/platform/src/features/login/pages/Register/page.tsx` | 210 | 表單與註冊流程 |

## 影響

- 單一函式動輒數百行，改一個行為要讀完整個檔案。review 與測試都難以只看到相關的部分。
- 頁面裡的邏輯沒辦法單獨用 hook 測試，只能整頁渲染再操作。
- `TriggerField.tsx` 的依賴方向讓轉換邏輯綁在 UI 檔上，改 UI 時容易誤動到資料轉換。
- 都是可讀性問題，不影響執行。

## 修正方式

依優先順序：

1. `TriggerField.tsx`：把 `TriggerDraft`、`EMPTY_TRIGGER_DRAFT`、`toTriggerDraft()`、`fromTriggerDraft()` 與輔助函式（L44–162）搬到 `components/triggerDraft.ts`（或併進 `draft.ts`）。元件檔只留 UI。
2. 兩個 Profile 頁：抽出 `ChangePasswordSection`，把密碼規則、確認、`expectSessionEnd` 都收進去。頁面只組裝。可以與 [`duplicated-code-between-apps.md`](./duplicated-code-between-apps.md) 一起做，放進 web-core 兩邊共用。
3. `Select.tsx`：
   - 拆出 `useSelectModel()`：排序、索引、搜尋、勾選狀態、`rowState`。
   - 拆出 `useSelectActions()`：`commit`、`toggleExpand`、鍵盤。
   - 元件只留渲染。`selectModel.ts` 已經有純函式，延續同樣的分法。
4. `FileBrowser.tsx`、`FileShareDialog.tsx`：子元件各自成檔；`FileBrowser` 的鍵盤與點擊委派抽成 hook（例：`useBrowserKeyboard()`）。
5. `FileManager/page.tsx`：L71–73 的對話框目標狀態收進一個 `useFileDialogs()`，與 `useRenameTarget()` 同樣的寫法。
6. `TreeEditor.tsx`、`JsonEditor.tsx`：設定與 extension 組裝搬到同資料夾的模組（例：`jsonEditorExtensions.ts`），元件只處理 props 與狀態同步。
7. `Interaction`、`UserCreate`、`Register`：流程搬進 feature 的 `hooks/`，頁面只接 props。

## 驗證方式

- 既有測試照過：`packages/ui` 的 Select、TreeEditor、JsonEditor 測試，以及 FileManager、Profile、公告的測試。
- 拆出來的純函式與 hook 補單元測試。例如 `triggerDraft.ts` 的 `toTriggerDraft`／`fromTriggerDraft` 往返測試。
- 拆完後重跑 `wc -l`：元件檔不超過 400 行，`page.tsx` 不超過 200 行。
