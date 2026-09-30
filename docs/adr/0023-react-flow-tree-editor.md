# ADR-0023 — 樹狀圖編輯器以 React Flow（`@xyflow/react`）＋ dagre 實作

- 狀態：**採用**
- 日期：2026-09-30
- 相關：[`../architecture/frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §3.13

## 背景

後台需要一個能在「可平移、縮放的畫布」上編輯樹狀結構的元件，第一個場景是角色技能樹（節點自由擺位、
一個技能可以有多個前置），之後也會用在目錄、組織圖、流程這類只在乎結構的樹。需求：

- 畫布：平移、縮放、小地圖、框選；節點內容由呼叫端自訂（技能名稱、等級、花費…）。
- 編輯：新增根／子節點、刪除、拖曳擺位、從節點拖線建立父子關係（擋下循環）、復原／重做。
- 排版：一鍵自動排版；也要支援「永遠自動排版、不能拖」的模式。
- 外觀全部走 Design Token、支援深色主題；鍵盤可操作；不引入第二套 UI 樣式。

## 決定

- **畫布與互動用 React Flow 12（`@xyflow/react`，MIT）**；**排版用 dagre（`@dagrejs/dagre`，MIT）**。
- 包成設計系統元件 **`components/TreeEditor/`**，不讓 `features/` 直接碰 React Flow：
  props 只用自己的型別（`TreeEditorValue` = `nodes` ＋ `edges`），不匯出 React Flow 的型別（§3.1 規則 1）。
- **資料模型與 React Flow 分開**：`treeGraph.ts`（新增、刪除、連線規則、循環檢查、子孫查詢）與 `layout.ts`（dagre）是純函式，
  `features/` 在畫布外（屬性面板、匯入）操作同一份資料也用它們。
- **不 import `@xyflow/react/dist/base.css`**：那份是不分層的全域 CSS（會蓋過 `@layer components`）且寫死色碼。
  用得到的規則改寫進 `TreeEditor.module.css`，以 `:global(.react-flow__*)` 限定在元件根元素之下，顏色只引用 alias token。
- 工具列（新增、刪除、排版、復原、縮放）用設計系統的 `IconButton` ＋ `Tooltip`，不用 React Flow 的 `Controls`。
- 同時支援 `mode: 'tree'`（單一父節點，連到已有父節點的節點＝換父節點）與 `'dag'`（多個前置、不能循環）。

## 理由

1. **React Flow 是 React 生態裡節點編輯器的事實標準。** 平移／縮放（d3-zoom）、拖曳、連線、框選、小地圖、
   鍵盤聚焦與刪除、只渲染可視範圍的節點都已經做好；節點是一般的 React 元件，`renderNode` 可以直接放設計系統元件。
2. **它是「無樣式」可接受的程度。** 樣式只有一份可選的 base.css，外觀全部由 CSS 變數與 class 決定，
   可以完全改用我們的 token；不像 AntV X6／G6 自帶主題與 canvas 繪製，要另外對應深色主題。
3. **dagre 同時處理樹與 DAG。** 分層排版（Sugiyama）會把多個前置的節點放在比所有父節點更深的那一層並減少交叉，
   技能樹與一般樹共用一條路徑；體積小、同步執行、不需要 web worker。
4. **授權乾淨。** 兩者都是 MIT；React Flow 的浮水印可以依授權移除（`proOptions.hideAttribution`）。

## 代價

| 代價 | 緩解 |
| ---- | ---- |
| 體積：`@xyflow/react`（含 zustand、d3-zoom、d3-drag）約 67 KB gzip、dagre 約 17 KB gzip（2026-09-30 以 vite lib 建置量測） | 只有 `TreeEditor` 匯入；頁面是 lazy 載入，沒用到的頁面不下載 |
| React Flow 的必要樣式要自己維護一份 | 約 60 條規則，集中在 `TreeEditor.module.css` 的最後一段並註明來源；升級大版本時對照 base.css 的差異 |
| 受控模式下每次拖曳都要換算整份 `nodes` | 拖曳中的座標只放在元件內部狀態，放開時才 `onChange` 一次（同時也是一步復原） |
| jsdom 沒有布局，元件測試要補 ResizeObserver、DOMMatrixReadOnly、`getBBox`；拖線連線無法在 jsdom 模擬 | 連線規則在 `treeGraph.test.ts` 以純函式測；拖線、拖曳以 Storybook 手動確認 |
| dagre 的排版只看結構，不保留使用者手動擺的位置 | `manual` 模式下只有按「自動排版」才整份重排；新增的節點以 `placeChild` / `placeRoot` 就近放置 |

## 替代方案

| 方案 | 不採用的理由 |
| ---- | ---- |
| AntV X6 / G6 | 功能完整，但自帶樣式與 canvas／SVG 繪製引擎，節點要用它的 API 或 React 橋接；深色主題與 token 要另外對應，體積更大 |
| JointJS / GoJS | 進階功能（或全部）是商業授權 |
| Cytoscape.js | 偏圖分析與大量節點的視覺化，canvas 繪製，自訂 HTML 節點與編輯互動要自己補 |
| Rete.js | 針對「有輸入／輸出埠的資料流節點」設計，樹狀編輯用不到它的抽象，維護也較不活躍 |
| react-d3-tree | 只能顯示階層樹（單一父節點），沒有連線編輯、小地圖，也不支援 DAG |
| elkjs（排版） | 排版品質更好、選項多，但約 1.4 MB（要放 web worker），授權是 EPL-2.0；需要正交連線或分組時再評估 |
| d3-hierarchy / d3-flextree（排版） | 樹狀排版很整齊，但只支援單一父節點，DAG 還是要另一套 |
| 完全自製（SVG ＋ d3-zoom） | 平移縮放、拖曳、連線、框選、聚焦與虛擬化都要自己做，成本遠高於改寫一份樣式 |
