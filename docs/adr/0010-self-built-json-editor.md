# ADR-0010 — JsonEditor 自製，外觀與操作對標 svelte-jsoneditor

- 狀態：**採用**
- 日期：2026-09-25
- 相關：[`../architecture/frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §3.12、[ADR-0002](./0002-base-ui-over-mui.md)

## 背景

稽核日誌的明細需要 JSON 預覽（`JsonViewer`，已完成）；之後的遊戲編輯器要編輯設定檔與遊戲資料，需要 JSON 編輯器。
開源方案中最完整的是 [svelte-jsoneditor](https://github.com/josdejong/svelte-jsoneditor)（ISC；React 以 `vanilla-jsoneditor` 使用）：
tree／text／table 三種模式、修復、查詢、JSON Schema 驗證，官方標示可處理 512 MB 的文件。

## 決定

- **自製 `components/JsonEditor/`**，建在 `JsonViewer` 的行模型（`toJsonLines`）、收合狀態（`useJsonTree`）與行渲染（`JsonTree`）上。
- **外觀與操作以 svelte-jsoneditor 為基準**：鍵名不加引號、值依型別上色、收合顯示計數徽章；點鍵名／值直接編輯、
  輸入自動判斷型別、每行的操作選單（插入、新增子項、複製、轉換型別、刪除）、tree／text 兩種模式、復原／重做。
  顏色變數 `--json-*` 與它的 `--jse-*` 一一對應。
- 第一版不做：table 模式、搜尋／取代、JSON Schema 驗證、拖曳排序、JSON 修復、查詢轉換。需要時依同一基準補上。

## 理由

1. **設計系統一致。** 包 `vanilla-jsoneditor` 要用它自己的 DOM 與 CSS，選單、按鈕、焦點樣式、深色主題都要另外覆寫才能和
   `Menu`、`Tooltip`、`Button` 一致；自製直接用這些元件與 alias token（[ADR-0002](./0002-base-ui-over-mui.md) 的同一個取捨）。
2. **與 `JsonViewer` 共用一套實作。** 行模型、收合、虛擬捲動（`useVirtualRows`）只有一份，預覽與編輯的外觀不會分岔。
3. **不引入第二個 UI runtime。** `vanilla-jsoneditor` 內含 Svelte runtime 與 CodeMirror，只為一個元件就增加可觀的 bundle；
   目前的需求（稽核預覽、設定檔編輯）用不到它大部分的功能。
4. **資料操作不可變。** 每一步都是新的根、未改到的子樹沿用原參考，復原／重做只要保存根的參考，受控元件與 TanStack Query 的資料也能直接交給它。

## 代價

| 代價 | 緩解 |
| ---- | ---- |
| 進階功能（Schema 驗證、搜尋、table 模式、修復）要自己做 | 行模型與操作都已抽成純函式（`jsonLines.ts`、`jsonEdit.ts`），加功能不必改渲染層；需求出現時再依 svelte-jsoneditor 的行為補 |
| 收合狀態以路徑字串為鍵，陣列插入／刪除後，後面元素的收合狀態會錯位一格 | 只影響收合外觀、不影響資料；需要時改用穩定 id（svelte-jsoneditor 的做法） |
| 文字模式是 `<textarea>`，沒有語法上色與行號 | 文字模式的定位是貼上／複製整份 JSON；上色與行號之後可換成 CodeMirror（只影響文字模式） |

## 替代方案

| 方案 | 不採用的理由 |
| ---- | ---- |
| 包 `vanilla-jsoneditor` | 功能最齊全，但見理由 1、3；樣式與鍵盤行為要持續和上游版本對齊 |
| `json-edit-react` | React 原生、可主題化，但沒有虛擬捲動，大型資料會卡；外觀要大改才能對齊 |
| `@uiw/react-json-view` | 只有檢視，編輯能力不足 |
