# ADR-0011 — JsonEditor 改以 CodeMirror 6 實作，JsonViewer 對齊它的外觀

- 狀態：**採用**（取代 [ADR-0010](./0010-self-built-json-editor.md)）
- 日期：2026-09-25
- 相關：[`../architecture/frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §3.12

## 背景

[ADR-0010](./0010-self-built-json-editor.md) 自製了樹狀 ＋ 文字兩種模式的 `JsonEditor`，外觀對標 svelte-jsoneditor。
重新評估時發現：

- `JsonEditor` 還沒有任何 feature 使用（只有 story 與測試），現在換底層的成本最低；一旦有頁面依賴就會變貴。
- 自製的部分約 1,400 行，已知問題（陣列插入／刪除後收合狀態錯位、文字模式沒有上色與行號）都要繼續自己修；
  搜尋、復原、摺疊這些編輯器的基本功能，成熟的編輯器核心已經做得更好。
- 遊戲資料與設定檔的編輯者會直接讀寫 JSON 文字；行內的樹狀操作選單不是必要功能。

## 決定

- **`JsonEditor` 的底層換成 CodeMirror 6**（`@codemirror/*`，MIT）：語法上色、行號、摺疊、括號配對與自動補上、
  復原／重做、搜尋、lint（JSON 解析錯誤 ＋ `validator` 的結果以波浪底線標示）。**拿掉樹狀模式**與行內的操作選單。
- **公開介面盡量不變**：`value` / `defaultValue` / `onChange`（內容合法時回報解析後的值）、`readOnly`、`maxHeight`、
  `defaultExpandDepth`（初始摺疊）、`validator` / `onValidationChange`、`labels`、slot。
  移除 `mode` / `defaultMode` / `onModeChange`、`virtualThreshold`（CodeMirror 本身只渲染可視範圍）。
- **搜尋列與驗證清單仍用設計系統元件**：搜尋列（`JsonSearchBar`）以 portal 渲染進 CodeMirror 的搜尋面板位置，
  搜尋狀態交給 `@codemirror/search`；驗證清單點一下會打開包住它的摺疊並選取出錯的位置。
- **`JsonViewer` 維持自製、不載入 CodeMirror**，但外觀對齊 CodeMirror：左側行號欄（行號 ＋ 摺疊箭頭）、
  內容是 `JSON.stringify(value, null, 2)` 的原始文字（鍵名帶引號、縮排是真的空白）、收合顯示 `{…}`、行號在收合處跳號。
- **兩者共用一份外觀定義** `JsonViewer/jsonTheme.module.css`：`--json-*` 變數（顏色、字型、行高、欄寬）與語法上色的 class。
  CodeMirror 經由 `HighlightStyle` 的 `class` 直接套同一組 class，版面則在 `JsonEditor/editorTheme.ts` 以 `EditorView.theme` 引用同一組變數。

## 理由

1. **編輯體驗交給成熟的編輯器核心。** 復原合併、IME、選取、捲動、大型文件、鍵盤操作都已經被大量使用驗證過，
   自製的樹狀編輯器要追上這些細節成本很高。
2. **與 [ADR-0010](./0010-self-built-json-editor.md) 當初排除 `vanilla-jsoneditor` 的理由不衝突。** CodeMirror 是無頭的編輯器核心，
   沒有自帶的選單、按鈕或第二個 UI runtime；工具列、搜尋列、驗證清單仍是設計系統元件，顏色只走 token。
3. **預覽不需要付編輯器的成本。** 稽核日誌等唯讀場景用 `JsonViewer`，不下載 CodeMirror；
   兩者用同一份變數與 class，並排時外觀一致（行號欄寬、行高、縮排、顏色逐項對齊）。
4. **不在正式 bundle 裡，直到有頁面使用。** CodeMirror 只被 `JsonEditor` 匯入；以正式建置確認目前沒有任何 chunk 含 CodeMirror。

## 代價

| 代價 | 緩解 |
| ---- | ---- |
| CodeMirror（用到的部分）約 120 KB gzip | 只有用到 `JsonEditor` 的頁面（本身是 lazy 載入）才下載；預覽用 `JsonViewer` |
| 沒有樹狀模式的行內編輯、型別轉換、插入／複製節點 | 編輯者直接改文字；真的需要時可在 CodeMirror 上加指令或 widget，不必回到自製 |
| CodeMirror 的預設樣式是不分層的 `<style>`，會蓋過 `@layer components` | 版面以 `EditorView.theme` 設定（同樣是不分層、較高特異度），值只引用 `--json-*` 變數，仍不寫色碼 |
| 外部換掉 `value`（不是編輯器剛回報的那一個參考）時整份內容重建，復原紀錄、游標、摺疊會重設 | 與 ADR-0010 相同的語意（外部換值清空復原）；受控時把 `onChange` 的值原樣傳回即可避免 |
| 摺疊中的內容有驗證錯誤時，摺疊處沒有標記 | 錯誤清單一定列出；點一下會打開摺疊並選取 |
| jsdom 沒有 `Range.getClientRects`，元件測試要補上替身，且無法模擬 contenteditable 的輸入 | 測試直接對 `EditorView` 送 transaction；互動以 Storybook 手動確認 |

## 替代方案

| 方案 | 不採用的理由 |
| ---- | ---- |
| 維持 ADR-0010 的自製樹狀編輯器 | 見背景；功能與已知問題都要自己維護 |
| 只把文字模式換成 CodeMirror、保留樹狀模式 | 兩套編輯模型（樹狀的不可變操作、CodeMirror 的文字交易）要各自維護復原與同步，成本最高 |
| `JsonViewer` 也用 CodeMirror 的唯讀模式 | 外觀自然一致，但稽核日誌等唯讀頁面要多下載約 120 KB；自製的預覽以共用變數對齊就夠了 |
| Monaco Editor | 體積大一個數量級（含 web worker），深色／淺色主題要另外對應 token |
| 包 `vanilla-jsoneditor` | 見 [ADR-0010](./0010-self-built-json-editor.md) 的理由 1、3 |
