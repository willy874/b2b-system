# 前端 07 — UI 系統（Base UI）

## 1. 分工

```
┌──────────────────────────────────────────────────────────┐
│ features/*/components/       業務元件（RoleTable、UserStatusChip）│
├──────────────────────────────────────────────────────────┤
│ src/components/              ★ 設計系統元件（我們寫的）         │
│                              Button · Input · Select · Dialog … │
├──────────────────────────────────────────────────────────┤
│ @base-ui/react               行為與可近性（無樣式）             │
│                              焦點管理 · 鍵盤 · ARIA · 定位      │
├──────────────────────────────────────────────────────────┤
│ src/themes/                  Design Token（CSS 變數，三層）     │
│ UnoCSS                       工具類                           │
└──────────────────────────────────────────────────────────┘
```

Base UI 提供 **狀態機與可近性**，一點樣式都沒有。`src/components/` 是我們把它
變成「B2B System 的樣子」的地方。這一層會比搭配 MUI 時厚得多——搭 MUI 時
`components/Select` 只是薄包裝，我們的要自己寫完整外觀。

這是有意識的成本，換來的是：**沒有要對抗的既有樣式**，而且未來畫布、屬性面板、
時間軸這些非標準 UI 不會與設計系統打架。

---

## 2. 元件清單

### 2.1 有 Base UI 對應的（包裝）

| 我們的元件                    | Base UI 匯入                                |
| ----------------------------- | ------------------------------------------- |
| `Button`                      | `@base-ui/react/button` ＋ `use-button`     |
| `Input`                       | `@base-ui/react/input`、`field`             |
| `Checkbox` / `CheckboxGroup`  | `@base-ui/react/checkbox`、`checkbox-group` |
| `Radio` / `RadioGroup`        | `@base-ui/react/radio`、`radio-group`       |
| `Switch`                      | `@base-ui/react/switch`                     |
| `Dialog`                      | `@base-ui/react/dialog`                     |
| `AlertDialog`                 | `@base-ui/react/alert-dialog`               |
| `Popover`                     | `@base-ui/react/popover`                    |
| `Tooltip`                     | `@base-ui/react/tooltip`                    |
| `ContextMenu`                 | `@base-ui/react/context-menu`               |
| `Tabs`                        | `@base-ui/react/tabs`                       |
| `Accordion` / `Collapsible`   | `@base-ui/react/accordion`、`collapsible`   |
| `Toast`                       | `@base-ui/react/toast`                      |
| `ScrollArea`                  | `@base-ui/react/scroll-area`                |
| `Progress` / `Meter`          | `@base-ui/react/progress`、`meter`          |
| `NumberField`                 | `@base-ui/react/number-field`               |
| `Separator`                   | `@base-ui/react/separator`                  |
| `Avatar`                      | `@base-ui/react/avatar`                     |
| `Field` / `Fieldset` / `Form` | `@base-ui/react/field`、`fieldset`、`form`  |

### 2.2 Base UI 沒有的（自己實作）

| 元件                             | 實作基礎                                             |
| -------------------------------- | ---------------------------------------------------- |
| `Table`                          | TanStack Table ＋ TanStack Virtual ＋ 原生 `<table>` |
| `Pagination`                     | 純自製（`<nav>` ＋ Button）                          |
| `DatePicker` / `DateRangePicker` | 自製，日期運算用 `dayjs`；彈層用 Base UI `Popover`   |
| `Breadcrumbs`                    | 純自製（`<nav aria-label="breadcrumb">`）            |
| `Skeleton` / `Spinner`           | 純 CSS                                               |
| `Icon`                           | SVG sprite ＋ `vite-plugin-svgr`                     |
| `Empty`                          | 版面元件                                             |
| `Chip` / `Badge`                 | 純自製                                               |
| `ConfirmDialogProvider` / `useConfirm` | 包在 `AlertDialog` 外的命令式 API（§3.11）       |
| `FileUpload`                     | 自製（`<input type="file">` ＋ 拖放）                |
| `TextEllipsis` / `BoxEllipsis` / `ButtonEllipsis` | 自製：CSS 省略號 ＋ `ResizeObserver` 量測；提示框用 `Tooltip`、下拉用 `Menu`（§3.8） |
| `Select`（含搜尋，取代原本的 `Combobox`）/ `Menu` | 自製列表 ＋ Base UI `Popover`（定位、點外面／Esc 關閉、焦點歸還）＋ TanStack Virtual（§3.10） |
| `VirtualList`                    | TanStack Virtual；長列表的虛擬捲動 ＋ 無限捲動（§3.10） |
| `Typography` / `Title` / `Text` / `Paragraph` | 自製；`copyable` 的複製按鈕用 `Tooltip` ＋ `navigator.clipboard`（§3.9） |
| `JsonViewer` / `JsonEditor`      | `JsonEditor` 是 CodeMirror 6；`JsonViewer` 自製（逐行渲染 ＋ `useVirtualRows`），外觀對齊 CodeMirror（§3.12、[ADR-0011](../../adr/0011-codemirror-json-editor.md)） |
| `JsonDiff`                       | 自製：Myers 逐行差異 ＋ `useVirtualRows`，外觀沿用 `JsonViewer`（§3.12） |
| `TreeEditor`                     | React Flow（`@xyflow/react`）＋ dagre 自動排版；樣式改寫進 CSS Module，工具列用設計系統元件（§3.13、[ADR-0023](../../adr/0023-react-flow-tree-editor.md)） |

> **DatePicker 是最大的一塊自製工作**，排入
> [`../../overview/03-roadmap.md`](../../overview/03-roadmap.md) 的 M2，已完成：`components/DatePicker/` 底下是
> `Calendar`（真正的 `<table>` ＋ roving tabindex）、`DatePicker` 與
> `DateRangePicker`，稽核日誌的時間篩選用的就是它。

---

## 3. 包裝的契約

每個 `src/components/<Name>/` 遵循同一個形狀：

```
components/Button/
├── Button.tsx          主元件
├── IconButton.tsx      變體
├── Link.tsx            ButtonLink：按鈕外觀的 TanStack Link（createLink ＋ <a>）
├── Button.module.css   該元件的樣式（CSS Module，用 component 層 token）
├── Button.test.tsx
├── Button.stories.tsx  Storybook（§9）
└── index.ts            只匯出公開 API
```

### 3.1 六條規則

| #   | 規則                                                | 理由                    |
| --- | --------------------------------------------------- | ----------------------- |
| 1   | **不洩漏 Base UI 的型別到 props**                   | 換掉底層時 props 不變   |
| 2   | **forward `ref`、`className`、`data-*`、`aria-*`**  | 呼叫端需要能覆寫與標註  |
| 3   | **受控／非受控都支援**（`value` ＋ `defaultValue`） | 表單與獨立使用都要能用  |
| 4   | **樣式只用 token，不寫死顏色與尺寸**                | 主題與 dark mode 的前提 |
| 5   | **每個元件有 `data-testid` 透傳**                   | E2E 依賴                |
| 6   | **多層元件開出 `classNames` / `styles` / `testIds`** | 內層也要能覆寫與標註，不必退回複合形式 |

#### 規則 6：逐層覆寫

元件內部有兩層以上 DOM（`Dialog` 的 backdrop / header / body、`Table` 的 row / cell …）時，
除了根元素的 `className` / `data-testid`，再開出三個 `Partial<Record<XxxSlot, T>>` 參數：

| 參數         | 型別                  | 行為                                         |
| ------------ | --------------------- | -------------------------------------------- |
| `classNames` | `string`              | 疊加在該層預設 class 之後                    |
| `styles`     | `CSSProperties`       | 與該層預設 inline style 逐屬性合併，呼叫端優先 |
| `testIds`    | `string`              | 取代該層預設 `data-testid`；`data-value` 保留 |

- 層名以 `export type XxxSlot = 'header' | 'body' | …` 匯出，寫在 Props 介面上方，
  並在註解標明頂層 `className` / `data-testid` 落在哪一層（不一定是最外層，例如 `Select` 落在觸發按鈕）。
- 頂層 `data-testid` 落到的那一層，頂層值優先於 `testIds` 的同名鍵。
- 實作一律用 `components/slots.ts` 的 `createSlots()`：
  `<div {...slot('body', styles.body)}>`；攤開後不再另寫 `className` / `style` / `data-testid`。
- `styles` prop 與 `import styles from './Xxx.module.css'` 同名：一律在解構時改名為
  `styles: styleOverrides`，再傳 `createSlots({ classNames, styles: styleOverrides, testIds })`。
- 被當成內層的設計系統元件（`Icon`、`Popover`、`Select`、`Empty`、`Calendar`）因此也接受 `style`。
- 只有單層的元件（`Button`、`Chip`、`Input` …）不開這三個參數。

```tsx
<Dialog
  title={t('role.create.title')}
  classNames={{ body: 'grid gap-4' }}
  testIds={{ footer: 'role-create-footer' }}
/>
```

### 3.2 範例：`Dialog`

Base UI 的 Dialog 是複合元件（`Root` / `Trigger` / `Portal` / `Backdrop` /
`Popup` / `Title` / `Description` / `Close`）。我們把最常見的組合收成一個
元件，同時保留複合形式：

```tsx
// components/Dialog/Dialog.tsx
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import { cn } from "@/shared/utils";
import styles from "./Dialog.module.css";

export interface DialogProps {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl"; // xl（72rem）放得下畫布，例如角色權限的技能樹
  /** 點擊遮罩或按 Esc 是否關閉。破壞性操作應設為 false */
  dismissible?: boolean;
  children: ReactNode;
  className?: string;
  "data-testid"?: string;
}

export function Dialog({
  open,
  defaultOpen,
  onOpenChange,
  title,
  description,
  footer,
  size = "md",
  dismissible = true,
  children,
  className,
  ...rest
}: DialogProps) {
  return (
    <BaseDialog.Root
      open={open}
      defaultOpen={defaultOpen}
      onOpenChange={onOpenChange}
      dismissible={dismissible}
    >
      <BaseDialog.Portal>
        <BaseDialog.Backdrop className={styles.backdrop} />
        <BaseDialog.Popup
          className={cn(styles.popup, className)}
          data-size={size}
          {...rest}
        >
          <header className={styles.header}>
            <BaseDialog.Title className={styles.title}>{title}</BaseDialog.Title>
            {description && (
              <BaseDialog.Description className={styles.description}>
                {description}
              </BaseDialog.Description>
            )}
          </header>
          <div className={styles.body}>{children}</div>
          {footer && <footer className={styles.footer}>{footer}</footer>}
        </BaseDialog.Popup>
      </BaseDialog.Portal>
    </BaseDialog.Root>
  );
}

/** 需要完全自訂版面時使用複合形式 */
export const DialogPrimitive = BaseDialog;
```

**`dismissible` 的預設值是產品決定**：刪除確認對話框設 `false`，避免誤觸遮罩
造成「以為取消了但其實什麼都沒發生」的困惑。

### 3.3 Base UI 的狀態屬性

Base UI 用 `data-*` 屬性暴露狀態，樣式直接掛在上面，不需要在 React 裡算
className：

```css
/* Button.module.css */
.root[data-disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}
/* Select.module.css */
.item[data-highlighted] {
  background: var(--ge-color-surface-hover);
}
.item[data-selected] {
  font-weight: 600;
}
/* Dialog.module.css */
.popup[data-open] {
  animation: dialog-in 160ms ease-out;
}
.popup[data-closed] {
  animation: dialog-out 120ms ease-in;
}
```

我們自己的變體（`variant`、`size`、`tone`、`block` …）也用同一套寫法：元件把 prop 寫成
`data-variant={variant}`、`data-block={block || undefined}`，CSS 選 `.root[data-variant='primary']`、
`.root[data-block]`，不再維護「prop → modifier class」的對照表。

### 3.4 樣式檔：CSS Module ＋ `@layer`

每個元件的樣式是同資料夾的 `Xxx.module.css`（🔒 `design-system.test.ts` 擋下非 module 的 `.css`）：

```css
/* Button.module.css */
@layer components {
  .root { … }
  .root[data-variant='primary'] { … }
  .icon { … }
}
```

```tsx
import styles from './Button.module.css';

<button className={cn(styles.root, className)} data-variant={variant} data-size={size} />
```

| 約定 | 說明 |
| --- | --- |
| class 名稱 | 模組內的短名：根元素 `.root`，其餘以該層的角色命名（`.title`、`.popup`、`.itemText`），不再寫 `ge-` 前綴與 BEM |
| 變體 | 用 `data-*` 屬性（§3.3），不用 modifier class；測試也斷言屬性，不斷言 class |
| 產出的 class | 開發時 `ge-[檔名]__[本地名]__[hash]`，正式建置 `ge-[hash]`（`vite.config.ts` 的 `css.modules`）；Vitest 產生 `_本地名_hash` 這種穩定名稱 |
| keyframes | 寫在模組裡，名稱會自動加上作用域，不會和其他元件撞名 |
| 外部覆寫 | 呼叫端只能透過 `className` / `classNames` / `styles`，不能選到元件內部的 class（hash 過，也不是公開 API） |

**`@layer` 決定覆寫順序。** `index.html` 的 `<head>` 以內嵌 `<style>` 宣告
`@layer reset, base, components, utilities;`：

- 元件模組、`app/` 與 `core/` 的版面 CSS 都包在 `@layer components`。
- UnoCSS 以 `outputToCssLayers` 輸出到 `utilities`，排在元件之後，
  所以 `classNames={{ body: 'grid gap-4' }}` 這類工具類 **一定** 蓋得過元件預設值，與選擇器權重、CSS 載入順序無關。
- 順序宣告必須是頁面上第一個出現的 `@layer`，所以放在 `index.html`，不放在任何 CSS 檔：
  正式建置時 CSS 會被拆成多個 chunk，`<link>` 的先後不保證與 import 順序相同（例如 `Toast` 的 CSS 會排在 `index.css` 之前）。

### 3.5 `render` prop — 換底層元素

Base UI 每個 part 都支援 `render` 來改變實際渲染的元素，讓我們能把
TanStack Router 的 `Link` 塞進 Menu item 而不失去鍵盤行為：

```tsx
<Menu.Item render={<Link to="/role/$roleId" params={{ roleId }} />}>{t("role.detail")}</Menu.Item>
```

### 3.6 `ButtonLink` — 會換頁的按鈕

「點了就換頁」的動作（建立、管理權限…）用 `ButtonLink`，不寫 `<Button onClick={() => navigate(...)}>`：
它是 TanStack `createLink()` 包住與 `Button` 同一份樣式的 `<a>`，所以有真正的 `href`
（可中鍵開新分頁、看得到目的網址、可預先載入），props 是 `to` / `params` / `search` ＋ `Button` 的外觀。

```tsx
<ButtonLink variant="primary" to={RoleCreateRoute.to} search={search} data-testid="role-create-button">
  {t("role.create.action")}
</ButtonLink>
```

| 需求               | 用                                           |
| ------------------ | -------------------------------------------- |
| 按鈕外觀、站內換頁 | `ButtonLink`（`components/Button`）          |
| 文字連結           | `Link`（`components/Link`），站內時以 `render` 傳 router 的 `Link` |
| 不換頁的動作       | `Button`                                     |

`disabled` 時 TanStack 會拿掉 `href` 並擋下點擊，`ButtonLink` 另外標上 `aria-disabled` 與 `data-disabled`。

### 3.7 Toast 與 eventBus

提示走全域 eventBus，發的一方不需要在 Provider 底下、也不需要知道 toast 怎麼渲染：

```
useToast().success(…)  ─┐
plugin / 攔截器         ─┼─ eventBus.emit(GlobalEvents.TOAST_SHOW, options)
                         │
app/ToastHost ◀──────────┘ eventBus.on(TOAST_SHOW) → toaster.show(options)
  └─ <ToastProvider toaster={toaster}>   components/Toast（Base UI 的 toast manager）
```

- `components/Toast` 只提供 `createToaster()`（可在 React 樹外呼叫的 `show` / `close`）與 `ToastProvider`，
  不認識 eventBus；Base UI 的 manager 不出現在公開型別上。
- `core/notify` 的 `useToast()` 是 React 裡的入口；React 之外直接 `eventBus.emit(GlobalEvents.TOAST_SHOW, …)`。
- 整個 app 只有 `app/ToastHost` 持有 toaster；各類型的預設停留時間在 `DEFAULT_TOAST_TIMEOUT`（錯誤 8 秒，其餘 4 秒）。
- 測試用 `src/test/renderWithPermissions.tsx` 的 `AllProviders`，它已經掛好 eventBus 與 `ToastHost`。

### 3.8 省略號：`TextEllipsis` / `BoxEllipsis` / `ButtonEllipsis`

`components/Ellipsis/`。放不下時截斷或收起來，並在 hover／聚焦時讓使用者看到被藏起來的東西。

| 元件 | 放不下時 | 隱藏判斷點 | 隱藏替代節點 |
| --- | --- | --- | --- |
| `TextEllipsis` | 文字以省略號截斷（`lines` 可多行） | `collapseAt`：數字（父元素寬度 px）或 `'overflow'` | `collapsedContent` |
| `BoxEllipsis` | 一排項目從尾端收進溢出區 | `maxVisible`：數字或 `(寬度) => 數量`；`fit={false}` 只看它 | `renderOverflow`（預設 `+N`，提示框列出被隱藏的項目） |
| `ButtonEllipsis` | 一組按鈕從尾端收進「更多」下拉（`Menu`） | `maxVisible` 同上；`iconOnly`：數字（寬度 px）時先縮成只剩圖示 | `renderMoreTrigger`、`moreIcon`、`moreLabel` |

提示框：`TextEllipsis` 的 `tooltip` 為 `auto`（預設，被截斷或已收合才顯示）／`always`／`never`；
`ButtonEllipsis` 只剩圖示的按鈕以 `label` 為提示，`item.tooltip` 可覆寫。

**`TextEllipsis`**

- 數字判斷點量 **父元素** 而不是自己：收合後自己會變窄，拿自己比會永遠展不回來。
  父元素寬度為 0（尚未布局、`display: none`）時不判斷。
- `'overflow'` 收合時記下「當時的容器寬度」與「還差多少寬度」，容器變寬到補得回差額才展開，避免在臨界點來回閃動。
- 收合後原內容以視覺隱藏的方式保留給螢幕報讀器。

**`BoxEllipsis`**

- 每個頂層子節點是一個項目（Fragment 不展開）；容器寬度由父層決定（block，或在 flex 裡給 `min-width: 0` ＋ `flex: 1`）。
- 量測：項目的 key 或 `measureKey` 改變時，先渲染全部項目與「全部隱藏」時的溢出區量寬度，
  在 layout effect 裡同步算出可見數量（不會閃）；之後縮放只用快取寬度重算，`document.fonts.ready` 後再量一次。
- 可見數量的演算法是純函式 `fitCount()`，有 table-driven 測試。
- 容器 `overflow: hidden`，以 `padding: 4px; margin: -4px` 外推裁切邊界，項目的 focus ring 才不會被切掉。

**`ButtonEllipsis`**

- 以 `items: ButtonEllipsisItem[]`（`key`、`label`、`icon`、`onClick`、`disabled`、`loading`、`variant`、`tooltip`）描述按鈕；
  同一份資料渲染成外面的按鈕與下拉選項，`variant: 'danger'` 在下拉中顯示為危險色。
- `iconOnly` 切換會改變按鈕寬度，所以當成 `measureKey` 傳給 `BoxEllipsis` 觸發重新量測。
- 下拉按鈕預設 `aria-label="更多"`；`features/` 使用時以 `t()` 傳入 `moreLabel`。
- testid：按鈕 `button-ellipsis-item` ＋ `data-value={key}`、下拉按鈕 `button-ellipsis-more`、選項沿用 `menu-item`。

**共通**

- 狀態以 `data-truncated`、`data-collapsed`、`data-overflowing` 表達。
- 提示框切換用 `Tooltip` 的 `disabled`，而不是清空 `content`——後者會讓觸發元素重新掛載，量測狀態跟著遺失。
- 測試用 `src/test/fakeLayout.ts`：以 `data-testid` 指定元素尺寸並手動觸發 `ResizeObserver`（jsdom 沒有布局）。

### 3.9 文字：`Typography` / `Title` / `Text` / `Paragraph`

`components/Typography/`。`Typography` 是以 `variant` 指定外觀的底層元件；日常使用語意更明確的三個包裝：

| 元件 | 預設標籤 | 外觀參數 | 對應的 `variant` |
| --- | --- | --- | --- |
| `Title` | `h1`～`h3`（跟著 `level`） | `level`：`1` / `2` / `3` | `pageTitle` / `sectionTitle` / `bodyStrong` |
| `Text` | `span`（行內） | `size`：`md` / `sm`；`code` | `body` / `caption`；`code` 優先 |
| `Paragraph` | `p` | `size`：`md` / `sm` | `body` / `caption` |

- 共通參數：`tone`（`default` / `muted` / `brand` / `danger` / `success`）、`strong`、`copyable`、`as`（只換標籤、保留外觀）。
- 以 `data-variant`、`data-tone`、`data-strong` 表達外觀（§3.3）。

**`copyable`**

- `true` 或 `TypographyCopyableConfig`：`text`（省略時取 children 的純文字）、`copyLabel` / `copiedLabel`、
  `resetAfter`（預設 3000 ms）、`tooltip`（`false` 只留 `aria-label`）、`onCopy`、`onError`。
- 文字後面渲染一個行內 `<button>`（圖示 `copy`，成功後換成 `check` 並帶 `data-copied`），
  `aria-label` 與提示框都是目前的文案；預設 `複製` / `已複製`，`features/` 使用時以 `t()` 傳入。
- children 的純文字由 `getNodeText()` 攤平：只走字串、數字與元素的 `children`；
  children 是會自己產生文字的元件（例如 `<Trans>`）時要明確給 `text`。
- 寫入剪貼簿失敗（權限被拒、非安全環境）不切換成「已複製」，交給 `onError`；元件本身不發 toast（`components/` 不認識 eventBus）。
- 逐層覆寫（§3.1 規則 6）：`TypographySlot = 'copy'`；頂層 `className` / `data-testid` 落在文字本身，
  按鈕預設 `data-testid="typography-copy"`。

### 3.10 下拉列表：`Select` / `Menu` / `VirtualList`

Base UI 的 `Select` / `Menu` / `Combobox` 需要 **所有項目都掛在 DOM 上**（靠它們做鍵盤導覽），
無法虛擬捲動。所以這兩個元件改成：

- **Base UI `Popover`**：定位、點外面／Esc 關閉、焦點歸還、`--anchor-width` 等 CSS 變數。
- **自己的列表**：焦點留在列表容器（有搜尋框時留在輸入框），以 `aria-activedescendant` 指向作用列；
  鍵盤、虛擬捲動、無限捲動的 hook 都在 `components/VirtualList/`，三個元件共用：

| hook | 用途 |
| ---- | ---- |
| `useVirtualRows` | 列數超過 `virtualThreshold`（預設 100）才虛擬化；`scrollToIndex` 只在鍵盤移動與開啟時呼叫 |
| `useInfiniteScroll` | 距底部 64px 內呼叫 `onLoadMore`；同一筆數只觸發一次、內容不滿一屏自動補頁、失敗後要再捲動才重試；`resetKey` 換資料集時解鎖 |
| `useListNavigation` | ↑↓ / Home / End / PageUp / PageDown / typeahead，跳過停用列 |

**Select 的功能**（單選 props 不變；多選以 `multiple` 區分型別）：

| 功能 | props |
| ---- | ---- |
| 多選 | `multiple`、`value: T[]`；勾選不關閉 |
| 值與標籤的順序 | `valueOrder`：`selection`（勾選先後，預設）／`options`（選項順序） |
| 已選置頂 | `pinSelected`：取 **開啟當下** 的快照，開啟期間勾選不重排 |
| 全選 | `selectAll`（半勾狀態、Ctrl/⌘ + A）；只作用在目前看得到、未停用的選項 |
| 選項排序 | `sortOptions`：`asc` / `desc`（自然順序）或比較函式，含子選項 |
| 可展開的列 | 選項帶 `children` 即成為 `role="tree"`；群組列不是值，多選時勾群組 = 勾所有子孫；←／→ 收合展開 |
| 搜尋（原 `Combobox`） | `searchable`、`searchValue` / `onSearchChange`、`filterOption`（`false` = 後端搜尋）、`searchPlaceholder`、`noMatchLabel`、`clearSearchOnClose` |
| 無限捲動 | `hasMore`、`loading`、`onLoadMore`；搜尋字改變時自動解鎖分頁 |
| 兩行選項 | 選項 `description`，`itemSize` 設 48 |

**不抖動的約定**（改這幾個元件時要守住）：

1. 觸發鈕高度固定；多選標籤單行，放不下的收成 `+N`（`BoxEllipsis`）——觸發鈕尺寸不變，彈出層就不會移位。
2. 列高固定（`itemSize` 與 CSS 一致）、文字不換行；勾選框／✓ 常駐，只換 `data-state`，勾選不改變列的寬高。
3. 開啟期間不重排（`pinSelected` 用快照）；勾選、載入更多都不動捲動位置；捲軸以 `scrollbar-gutter: stable` 預留。
4. 列元件 `memo` ＋ 固定參考的 callback：勾一個項目只重繪狀態改變的列。

### 3.11 命令式確認：`useConfirm`

`components/ConfirmDialog/`。`AlertDialog` 是宣告式的，每個要確認的地方都得自己維護「待確認項目」的 state
與一份 `<AlertDialog>`；`useConfirm()` 把它收成一個回傳 `Promise<boolean>` 的函式：

```tsx
const confirm = useConfirm();

const handleDelete = async (row: RoleRowVM) => {
  await confirm({
    title: t('role.delete.title'),
    description: t('role.delete.confirm', { name: row.name }),
    confirmLabel: t('common.delete'),
    onConfirm: () => deleteRole.mutateAsync({ params: { roleId: row.id } }),
  });
};
```

| 行為 | 說明 |
| --- | --- |
| 回傳值 | 確認 → `true`；取消按鈕、Esc → `false`（沿用 `AlertDialog`：點遮罩不關閉） |
| `onConfirm` | 執行期間兩顆按鈕都 disabled、Esc 無效；成功才關閉並回傳 `true`；丟錯時對話框留著，使用者可重試或取消，錯誤提示交給全域處理 |
| 同時呼叫兩次 | 同時只有一個對話框：前一個還沒回答的以 `false` 結束 |
| 預設文案 | `ConfirmDialogProvider` 的 `confirmLabel` / `cancelLabel`；每次呼叫可覆寫 |
| 覆寫內層 | Provider 收 `AlertDialogSlot` 的 `classNames` / `styles` / `testIds`；每次呼叫的 `className` / `data-testid` 落在彈窗 |

- `app/ConfirmDialogHost` 掛在 `GlobalProvider`（`ToastHost` 內側），以 `t('common.confirm')` / `t('common.cancel')` 當預設文案；
  測試的 `AllProviders` 也已經掛好。
- 按鈕的 testid 與 `AlertDialog` 相同：`alert-dialog-confirm`、`alert-dialog-cancel`。
- 需要在對話框裡放表單或其他內容時，仍用宣告式的 `AlertDialog`（`children`）或 `Dialog`。

### 3.12 JSON：`JsonViewer` / `JsonEditor`

`JsonEditor` 以 **CodeMirror 6** 實作；`JsonViewer` 自製、不載入 CodeMirror，但外觀與它一致——
行號欄（行號 ＋ 摺疊箭頭）、原始 JSON 文字、同一套語法上色。兩者並排（例如編輯器下方預覽目前的值）時看起來是同一個元件。
決策見 [ADR-0011](../../adr/0011-codemirror-json-editor.md)（取代 [ADR-0010](../../adr/0010-self-built-json-editor.md) 的自製樹狀編輯器）。

**共用外觀**：`JsonViewer/jsonTheme.module.css` 是唯一的定義。

| 項目 | 內容 |
| ---- | ---- |
| 變數（`.theme`） | 版面：`--json-font-size`、`--json-line-height`（1.25rem）、`--json-padding-block`、`--json-content-inset`、`--json-fold-width`；顏色：`--json-background`、`--json-gutter-*`、`--json-key-color` → `--color-fg`、`--json-string-color` → `--color-success-text`、`--json-number-color` → `--color-danger-text`、`--json-boolean-color` → `--color-warning-text`、`--json-null-color` → `--color-brand`、`--json-delimiter-color` → `--color-fg-muted`、`--json-placeholder-*`、`--json-selection-background`、`--json-search-match-*`、`--json-error-color` |
| 語法上色 class | `.key` `.string` `.number` `.boolean` `.null` `.punctuation`；`JsonViewer` 直接用，`JsonEditor` 以 `HighlightStyle` 的 `class` 對應 `@lezer/json` 的標記 |
| 摺疊 | `.foldMarker`（邊框畫的箭頭，`data-open` 朝下）、`.foldPlaceholder`（`{…}` 中間的 `…`，滑過顯示 `labels.summary`） |

CodeMirror 的版面（`.cm-gutters`、`.cm-lineNumbers`、`.cm-line`…）在 `JsonEditor/editorTheme.ts` 以 `EditorView.theme` 設定，
值只引用上述變數：CodeMirror 的預設樣式是不分層的 `<style>`，`@layer components` 裡的規則壓不過它。
`JsonViewer.module.css` 以同一組變數畫出相同的行號欄寬（位數由元件以 `--json-line-number-digits` 提供，至少 2 位）、行高與留白。

**`JsonViewer`**（`components/JsonViewer/`）：顯示任意 JSON（稽核日誌的 `changes` / `metadata`、之後的設定檔與遊戲資料）。

| 功能 | props / 行為 |
| ---- | ---- |
| 內容 | 與 `JSON.stringify(value, null, 2)` 相同的文字：鍵名帶引號、縮排是真的空白（選取複製出來就是 JSON） |
| 行號 | 完整展開時的行號；收合的容器之後跳號，與 CodeMirror 摺疊後相同 |
| 收合 | 行號欄的箭頭；收合後顯示 `{…}` / `[…]`，滑過 `…` 顯示 `labels.summary`。`defaultExpandDepth` 決定一開始展開到第幾層；換一份 `value` 時收合狀態回到預設 |
| 高度 | `maxHeight`（預設 `20rem`），超過在框內捲動；長行不換行、在框內水平捲動，行號欄固定在左側 |
| 虛擬捲動 | 攤平成「一行一個元素」（`toJsonLines`，迴圈走訪不遞迴、循環參照顯示 `[Circular]`），行數超過 `virtualThreshold`（預設 100）以 `useVirtualRows` 只渲染可視範圍 |
| 可近性 | 捲動框是 `<section>`，傳 `aria-label` 即成為 `region` 地標；箭頭是 `<button aria-expanded>`；行號 `aria-hidden` |
| testid | 行：`json-viewer-item` ＋ `data-value`（節點路徑，如 `$["a"][0]`）＋ `data-line-number`；箭頭：`json-viewer-toggle` |

**`JsonDiff`**（`components/JsonDiff/`）：兩份 JSON 的逐行差異（unified diff），稽核日誌的「變更前後」用它。

| 功能 | props / 行為 |
| ---- | ---- |
| 內容 | `before` / `after` 各自以 `JSON.stringify(value, null, 2)` 攤成行，以 Myers 演算法逐行比對（O((N + M)·D)）；同一段變更先列刪除、再列新增。`undefined` 代表這一邊不存在（建立／刪除），另一邊整份是新增／刪除 |
| 行尾逗號 | 比對時忽略行尾逗號（陣列尾端加一項不會讓原本的最後一行變成「刪一行、加一行」）；未變更的行顯示新版的文字 |
| 外觀 | 行號欄並列舊版／新版行號，後接 `+` / `-` 標記；新增的行 `--color-success`、刪除的行 `--color-danger` 混色的底色；語法上色與 `JsonViewer` 相同（`jsonTheme.module.css`） |
| 摺疊 | 只保留變更前後 `context` 行（預設 3），其餘連續未變更的行收成摺疊列（只有一行的不收），點一下展開該段；換一份 `before` / `after` 時回到預設 |
| 沒有變更 | 兩邊相同或都不存在時顯示 `labels.empty` |
| 高度 | `maxHeight`（預設 `20rem`）；列數超過 `virtualThreshold`（預設 100）以 `useVirtualRows` 虛擬捲動 |
| 文案 | `labels.expandUnchanged(count)`、`labels.empty`；`features/` 以 `t()` 傳入 |
| testid | 行：`json-diff-item` ＋ `data-value`（`equal` / `added` / `removed`）＋ `data-old-line-number` / `data-new-line-number`；摺疊列：`json-diff-fold` ＋ `data-value`（區段起點） |

純邏輯在 `JsonDiff/diffLines.ts`：`diffJsonLines`（比對）、`toJsonDiffRows`（摺疊）、`tokenizeJsonLine`（一行切成語法上色的片段）。

**`JsonEditor`**（`components/JsonEditor/`）：

| 功能 | props / 行為 |
| ---- | ---- |
| 值 | `value` / `defaultValue` / `onChange`（受控／非受控）。內容是合法 JSON 時回報解析後的值，打到一半不回報。傳入的值與最後一次回報的不是同一個參考時，整份內容重新產生（復原紀錄、游標、摺疊重設） |
| 編輯 | CodeMirror：語法上色、行號、摺疊（行號欄的箭頭、⌘/Ctrl + Shift + [ ／ ]）、括號配對與自動補上、目前行底色 |
| 不合法的內容 | 解析錯誤以 lint 標在出錯的位置，下方顯示 `labels.parseError` ＋ 瀏覽器的訊息（`role="alert"`）；編輯區 `aria-invalid` |
| 工具列 | 搜尋、全部展開／全部收合（根節點保持展開）、格式化／壓縮（只改排版，不回報 `onChange`，可復原）、復原／重做（⌘/Ctrl + Z、⌘/Ctrl + Shift + Z） |
| 搜尋 | ⌘/Ctrl + F 或工具列的放大鏡：搜尋列（`JsonSearchBar`，設計系統元件）以 portal 渲染進 CodeMirror 的搜尋面板位置，查詢交給 `@codemirror/search`。不分大小寫、顯示「2 / 5」；Enter / Shift + Enter 上下一筆，跳到的位置會打開包住它的摺疊並置中；Esc 關閉 |
| 驗證 | `validator`（可非同步）；JSON Schema 用 `createJsonSchemaValidator(schema, { formatMessage })`。結果放進 CodeMirror 的 state，以 lint 畫波浪底線（滑過顯示訊息）：物件成員標鍵名（值是基本型別時連值），容器只標開頭的括號。編輯區下方列出錯誤，點一下打開摺疊並選取；`onValidationChange` 回報結果。validator 請保持參考固定 |
| 唯讀 | `readOnly`：可搜尋、摺疊、選取複製；不能改，沒有格式化／壓縮與復原 |
| 高度 | `maxHeight`（預設 `20rem`），超過在編輯區內捲動 |
| 文案 | `labels`（延伸 `JsonViewerLabels`）；`features/` 以 `t()` 傳入 |
| testid | 工具列 `json-editor-toolbar`、編輯區 `json-editor-content`、錯誤 `json-editor-error`、搜尋列 `json-editor-search`（輸入 `-input`、筆數 `-status`）、驗證清單 `json-editor-validation`（每筆 `json-editor-validation-item` ＋ `data-value` 路徑） |

檔案分工：

| 檔案 | 內容 |
| ---- | ---- |
| `JsonViewer/jsonTheme.module.css` | 兩個元件共用的變數與 class（見上） |
| `JsonViewer/jsonLines.ts` | `toJsonLines`（攤平成行，含行號）、`formatPath`（`['a', 0]` → `$["a"][0]`） |
| `JsonViewer/useJsonTree.ts` | 收合狀態：以「與 `defaultExpandDepth` 相反的路徑」記錄，換 `value` 時重設 |
| `JsonEditor/editorTheme.ts` | CodeMirror 的 `EditorView.theme` 與 `HighlightStyle` |
| `JsonEditor/jsonDocument.ts` | 在語法樹上找路徑的位置（`findPathRange`）、依深度摺疊（`foldAtDepth`）、摺疊摘要（`describeFold`） |
| `JsonEditor/validation.ts` | `JsonValidator` 型別與 `createJsonSchemaValidator`；ajv 在 `ajvValidator.ts`，第一次驗證時才動態載入 |
| `JsonEditor/useJsonValidation.ts` | 值改變時重新驗證（`useDeferredValue`），丟掉過期的非同步結果 |

**Bundle**：CodeMirror（用到的部分）約 120 KB gzip，只被 `JsonEditor` 匯入；沒有頁面用到 `JsonEditor` 時，正式建置不含 CodeMirror。
預覽一律用 `JsonViewer`。

**測試**：jsdom 沒有 `Range.getClientRects`，`JsonEditor.test.tsx` 補上替身；也無法模擬 contenteditable 的輸入，
測試以 `EditorView.findFromDOM()` 取得編輯器後直接送 transaction。

**JSON Schema 驗證器用 ajv**（與 svelte-jsoneditor 相同；依 `$schema` 選 draft-07／2019-09／2020-12，未宣告時 draft-07，含 `ajv-formats`）：

- 錯誤路徑：`required` 標在缺欄位的物件上；`additionalProperties` 標在多出來的那個鍵上。
- 訊息是 ajv 的英文；`features/` 要中文時傳 `formatMessage`，依 `keyword` / `params` 用 `t()` 組字。
- ajv 以動態 `import()` 載入：沒用到 schema 的頁面整個 bundle 都不含 ajv。
- ajv 會把 schema 編譯成 JavaScript（`new Function`）；之後若啟用不含 `unsafe-eval` 的 CSP，要改成建置時預先編譯（ajv standalone）。
- 評估過 `@cfworker/json-schema`（不用 eval、體積小），但屬性本身驗證失敗時會被誤報成 `additionalProperties`，不採用（[ADR-0010](../../adr/0010-self-built-json-editor.md)）。

尚未實作：取代（`@codemirror/search` 已支援，需要時在 `JsonSearchBar` 加欄位）、摺疊處的驗證錯誤標記。

### 3.13 樹狀圖：`TreeEditor`

在可平移、縮放的畫布上編輯樹狀／分層結構：技能樹、目錄、組織圖、流程。
底層是 React Flow（`@xyflow/react`）＋ dagre，決策見 [ADR-0023](../../adr/0023-react-flow-tree-editor.md)。

![TreeEditor Playground](./images/tree-editor/playground.png)

| 功能 | props / 行為 |
| ---- | ---- |
| 值 | `value` / `defaultValue` / `onChange`（受控／非受控）：`{ nodes: { id, data, position? }[], edges: { source, target }[] }`。`data` 是呼叫端自己的型別（泛型 `TData`），元件原樣保存。每一次編輯回報一整份新值；拖曳只在放開時回報 |
| 結構 | `mode`：`tree`（預設，單一父節點；連到已有父節點的節點＝換父節點）／`dag`（多個前置）。自己連自己、重複連線、形成循環一律擋下；`isValidConnection` 加額外規則 |
| 方向 | `direction`：`TB`（預設）/ `BT`（技能樹常見）/ `LR` / `RL`；決定排版方向與把手位置 |
| 排版 | `layout`：`manual`（預設，可拖曳、座標存在 `value`，沒有座標的節點自動補上）／`auto`（每次結構改變都重排、不能拖）。`manual` 的工具列有「自動排版」。`nodeSize`（預設 180 × 56）、`nodeGap`、`rankGap` |
| 新增 | 給 `createNode({ parentId? })` 才出現：工具列的新增根節點／子節點、節點外側的 `+`、Tab（選取一個節點時）。新節點就近放置（`placeChild` / `placeRoot`）並被選取 |
| 刪除 | Delete / Backspace 或工具列；刪節點時連同它身上的連線，子節點變成根節點。`onBeforeDelete` 可非同步確認（例如 `useConfirm()`），回傳 `false` 取消 |
| 復原 | 工具列、⌘/Ctrl + Z、⌘/Ctrl + Shift + Z（或 ⌘/Ctrl + Y），最多 100 步；外部換掉 `value`（不是元件剛回報的那一個參考）時清空 |
| 節點內容 | `renderNode(node, { selected, readOnly })`；沒給時顯示 `getNodeLabel(node)`（預設 `id`，也是節點的無障礙名稱）。框內的輸入框取得焦點時，快捷鍵交還給輸入框 |
| 選取 | `onSelectionChange(nodeIds)`：搭配旁邊的屬性面板，以 `updateNodeData` 改資料；`onNodeClick`、`onNodeDoubleClick`。`selectable={false}`：節點與連線不能選取、不能聚焦（結構唯讀、互動放在 `renderNode` 裡的按鈕時用，Tab 只停在按鈕上） |
| 狀態 | `getNodeState(node)` → `active`（已啟用）／`derived`（由其他節點帶出）／`available`（可啟用）／`locked`（不能操作），外框與底色由元件呈現（`data-state`）；`renderNode` 的第二個參數也拿得到 `state` |
| 強調 | `highlightedNodeIds`（`data-highlighted`，例如滑過節點時標出前置）、`activeEdgeIds`（已啟用的路徑，品牌色）、`highlightedEdgeIds`（強調的路徑）；連線 id 是 `getEdgeId(edge)` |
| 連線外觀 | `TreeEditorEdge.variant`：`solid`（預設）／`dashed`（例：跨分支的「需要」關係）；元件原樣保存 |
| 分組 | `groups: { id, label, nodeIds }[]`：在成員節點外畫出帶標題的背景（`computeGroupBounds`，不可選、不可拖、不接收滑鼠事件、在連線底下）；搭配 `layout="manual"` 自己排好分組最整齊 |
| 畫布 | 點陣背景、拖曳對齊 8px 格線、滾輪縮放（0.2–2 倍）、`showMinimap`（預設顯示）、`height`（預設 `32rem`）。初次顯示與「顯示全部」不放大超過 1 倍 |
| 唯讀 | `readOnly`：只能平移、縮放、選取；工具列只剩縮放與顯示全部 |
| 文案 | `labels`；`features/` 以 `t()` 傳入 |
| slot | `toolbar` / `canvas` / `node` / `group` / `minimap` / `empty`；`className` / `data-testid` 落在最外層 |
| testid | 工具列 `tree-editor-toolbar`、按鈕 `tree-editor-action` ＋ `data-value`（`add-root` / `add-child` / `delete` / `auto-layout` / `undo` / `redo` / `zoom-in` / `zoom-out` / `fit-view`）、畫布 `tree-editor-canvas`、節點 `tree-editor-item` ＋ `data-value`（節點 id）＋ `data-selected`＋ `data-state` ＋ `data-highlighted`、節點上的 `+` `tree-editor-add-child`、分組背景 `tree-editor-group` ＋ `data-value`（分組 id）、空狀態 `tree-editor-empty` |

```tsx
<TreeEditor<Skill>
  value={value}
  onChange={setValue}
  mode="dag"
  direction="BT"
  getNodeLabel={(node) => node.data.name}
  renderNode={(node) => <SkillCard skill={node.data} />}
  createNode={() => ({ id: crypto.randomUUID(), data: { name: t('skill.untitled'), cost: 1 } })}
  onBeforeDelete={() => confirm({ title: t('skill.deleteConfirm') })}
  onSelectionChange={(ids) => setSelectedId(ids[0])}
  labels={{ addRoot: t('skill.addRoot'), /* … */ }}
  aria-label={t('skill.tree')}
/>
```

檔案分工：

| 檔案 | 內容 |
| ---- | ---- |
| `TreeEditor/treeGraph.ts` | 型別與純函式：`checkConnection`、`connectNodes`、`addNode`、`removeElements`、`moveNodes`、`updateNodeData`、`getRootIds`、`getParentIds`、`getDescendantIds`、`getEdgeId` |
| `TreeEditor/layout.ts` | dagre 排版（`computeTreeLayout`、`layoutTree`、`fillMissingPositions`）、新節點的就近位置（`placeChild`、`placeRoot`）與分組背景的範圍（`computeGroupBounds`） |
| `TreeEditor/useTreeHistory.ts` | 以整份快照記錄的復原／重做 |
| `TreeEditor/TreeNode.tsx` | 畫布上的節點：外框、狀態、把手、`+`；分組背景（`TreeGroupNode`）；經由 context 取得 `renderNode` 等設定 |
| `TreeEditor/TreeEditor.module.css` | 元件樣式，以及改寫自 `@xyflow/react/dist/base.css` 的必要樣式（`--xy-*` 變數對應到 alias token） |

**樣式**：不 import React Flow 的 `base.css`（不分層的全域 CSS 會蓋過 `@layer components`，而且寫死色碼），
用得到的規則改寫在 `TreeEditor.module.css` 最後一段，以 `.root :global(.react-flow__*)` 限定範圍。升級 React Flow 大版本時對照它的 base.css。

**測試**：jsdom 沒有布局，`TreeEditor.test.tsx` 補上 ResizeObserver、DOMMatrixReadOnly 與 `getBBox` 的替身；
點節點用 `fireEvent.click`（`userEvent` 的 mousedown 沒有 `view`，d3-drag 會拋錯）。拖線連線與拖曳無法在 jsdom 模擬，
規則在 `treeGraph.test.ts` 以純函式測，互動以 Storybook 確認。jsdom 也不畫連線（需要量測把手位置），連線的 `variant`／強調同樣以 Storybook 確認。

**可解鎖的技能樹**（story `UnlockableSkillTree`）：`readOnly` ＋ `selectable={false}`，互動是節點內的 `<button className="nodrag">`
（原生焦點、Enter／Space、`disabled`）。React Flow 會對「不可選、不可拖、不可連、也沒有點擊處理」的節點設 `pointer-events: none`，
所以元件一律傳 `onNodeClick` 給 React Flow，節點內的按鈕才點得到。實際用例：角色權限的技能樹（`features/role`）。

**Bundle**：React Flow 約 67 KB gzip、dagre 約 17 KB gzip，只被 `TreeEditor` 匯入。

**Storybook 截圖**（2026-09-30，`docs/architecture/frontend/images/tree-editor/`）：

| 自動排版（`layout="auto"`、`LR`） | 技能樹（`dag`、`BT`、自訂內容 ＋ 屬性面板） |
| --- | --- |
| ![AutoLayout](./images/tree-editor/auto-layout.png) | ![SkillTree](./images/tree-editor/skill-tree.png) |
| **唯讀** | **技能樹（深色主題）** |
| ![ReadOnly](./images/tree-editor/read-only.png) | ![SkillTree dark](./images/tree-editor/skill-tree-dark.png) |
| **空狀態** | **可解鎖的技能樹**（學會「嚮導」、滑過時強調前置路徑；2026-09-30） |
| ![Empty](./images/tree-editor/empty.png) | ![UnlockableSkillTree](./images/tree-editor/unlockable-skill-tree.jpg) |

尚未實作：收合子樹、連線上的標籤、拖曳連線端點改接（React Flow 的 `onReconnect`）、複製／貼上節點。

---

## 4. Design Token

三層 CSS 變數。

```
themes/
├── tokens.css        ① seed ② alias（淺色 :root ＋ 深色 :root[data-theme='dark']）③ component
└── contrast.test.ts  兩個主題各自的對比度驗證
```

> 下方 §4.1 的範例是設計時的命名草稿（`--ge-*` 前綴）；實作的名稱以 `tokens.css` 為準
> （`--seed-*`、`--color-*`、`--button-*`）。

### 4.1 三層的意義

```css
/* ① seed：沒有語意，只是值 */
:root {
  --ge-seed-blue-500: #2f6feb;
  --ge-seed-gray-050: #f7f8fa;
  --ge-seed-gray-900: #16181d;
  --ge-seed-red-600: #d32f2f;
  --ge-seed-space-2: 8px;
  --ge-seed-radius-md: 6px;
}

/* ② alias：有語意，可依主題換值 */
:root {
  --ge-color-primary: var(--ge-seed-blue-500);
  --ge-color-primary-on: #fff;
  --ge-color-surface: #fff;
  --ge-color-surface-hover: var(--ge-seed-gray-050);
  --ge-color-text-primary: var(--ge-seed-gray-900);
  --ge-color-danger: var(--ge-seed-red-600);
  --ge-color-border: #e3e6eb;
}

/* ③ component：元件自己的旋鈕 */
:root {
  --ge-button-height-md: 36px;
  --ge-button-radius: var(--ge-seed-radius-md);
  --ge-button-bg-primary: var(--ge-color-primary);
  --ge-dialog-radius: 12px;
  --ge-dialog-width-md: 560px;
}
```

**元件 CSS 只准引用第 ③ 層**（必要時第 ② 層），**絕不引用第 ① 層或寫死值**。
這條規則讓換主題＝換第 ② 層的一份對照表。

### 4.2 `-main` / `-text` 的區分

飽和的狀態色作為 **背景填色** 沒問題，作為 **前景文字** 常常過不了 WCAG AA。
所以每個狀態色有兩個值：

```css
--ge-color-danger: #d32f2f; /* 填色：搭配 --ge-color-danger-on 使用 */
--ge-color-danger-text: #b3261e; /* 前景：在所有 surface 上 >= 4.5:1 */
```

`themes/contrast.test.ts` 對每一組 `-text` × 每一種 surface 斷言對比度 ≥ 4.5:1，
CI 會擋下不合格的調色。

### 4.3 UnoCSS 的角色

UnoCSS 負責 **排版**（flex、grid、間距、尺寸），**不負責顏色**。
顏色一律走 token。

```tsx
<div className="flex items-center gap-2 px-4 py-3">
  {" "}
  {/* ✅ UnoCSS 做版面 */}
  <span className="ge-text-danger">…</span> {/* ✅ token 做顏色 */}
  <span className="text-red-500">…</span> {/* ❌ 繞過 token */}
</div>
```

`uno.config.ts` 裡把顏色相關的工具類 **關掉**，讓錯誤用法無法通過建置。

UnoCSS 的輸出放在 `utilities` 層，排在元件的 `components` 層之後（§3.4），
所以傳進元件的工具類不必加 `!` 就能覆寫元件預設值。

### 4.4 深色主題

換主題 **只換 alias 層**：`tokens.css` 的 `:root[data-theme='dark']` 區塊覆寫顏色與陰影的 alias，
seed、尺寸、字型、z-index 與 component 層都沿用淺色。

| 項目 | 做法 |
| --- | --- |
| 切換機制 | `<html data-theme>`（`light` 或 `dark`）；`color-scheme` 跟著切，原生捲軸與表單控制項一起變 |
| 偏好 | `light` / `dark` / `system`（預設），存在 `preference` dictStorage 的 `theme` 鍵；**只存本機**，不同步到帳號 |
| 跟隨系統 | 在 JS 解析 `prefers-color-scheme` 後寫入 `data-theme`；CSS 不寫 `@media (prefers-color-scheme)`，深色對照表才不必寫兩份 |
| 首次繪製 | `public/theme-init.js` 在 `<head>` 同步執行，先設好 `data-theme`，避免先閃白；獨立成檔是因為正式環境的 CSP 不允許 inline script |
| 之後的變化 | `plugins/app/theme.ts`：使用者切換、其他分頁同步、系統深淺色變化（只在 `system` 時） |
| 入口 | 頂列的主題選單（`app/layouts/ThemeMenu.tsx`）與偏好頁；選項表 `THEME_OPTIONS` 在 `core/theme` |
| Storybook | 工具列的 **Theme** 切換 |

深色主題的調色原則：

- 主色與狀態色的 **前景**（`--color-brand`、`--color-*-text`）調亮到在深色 surface 上 ≥ 4.5:1；
  主色調亮後白字不夠，`--color-brand-fg` 改成深色。
- 狀態色的 **填色**（`--color-danger` 等）沿用淺色，搭配 `-on` 的白字仍 ≥ 3:1。
  所以危險按鈕的字用 `--color-danger-on`，不要借用 `--color-brand-fg`。
- 中性填色有自己的 alias：`--color-fill-subtle`（停用欄位、中性標籤）、`--color-fill`（軌道、骨架、頭像）、
  `--color-scrollbar(-hover)`、`--color-tooltip-bg/-fg`。元件不直接引用 `--seed-gray-*`
  （🔒 `design-system.test.ts` 擋 `components/` 的 CSS 引用 seed 色）。
- 深色背景上陰影不明顯，陰影與遮罩的 alias 在深色時更重。

新增顏色 alias 時：淺色 `:root` 與深色區塊要一起加；`contrast.test.ts` 會對兩個主題各跑一次，
且深色區塊只能覆寫淺色已有的 token。

### 4.5 疊放層級（z-index）

z-index 也是 token（`themes/tokens.css`），元件不寫數字：

| token              | 值  | 用在                                             |
| ------------------ | --- | ------------------------------------------------ |
| `--z-dialog`       | 70  | `Dialog` 的遮罩（popup 為 `+ 1`）                |
| `--z-alert-dialog` | 80  | `AlertDialog` 的遮罩（popup 為 `+ 1`）           |
| `--z-floating`     | 85  | `Popover`、`Select`、`Menu` 的定位層 |
| `--z-tooltip`      | 90  | `Tooltip`                                        |
| `--z-toast`        | 100 | `Toast`                                          |

錨定在觸發元素上的浮層共用 `--z-floating`，而且 **高於所有對話框**：它們常被放在對話框或另一個浮層裡面
（例：`RichTable` 篩選面板裡的 `Select`）。同一層之間由 DOM 順序決定——Base UI 開啟時才 portal 到
`body` 尾端，後開的（巢狀的子浮層）自然在上，不需要再分層。

---

## 5. 可近性基線

Base UI 已處理焦點陷阱、roving tabindex、ARIA 角色與鍵盤互動。我們仍需負責：

| 項目     | 要求                                                               |
| -------- | ------------------------------------------------------------------ |
| 對比度   | 文字 ≥ 4.5:1，大字與圖示 ≥ 3:1；表單控制項的外框用 `--color-border-control`（≥ 3:1，WCAG 1.4.11），裝飾性分隔線才用 `--color-border`（`contrast.test.ts` 驗證） |
| 焦點可見 | 每個互動元素有 `:focus-visible` 外框，`--ge-color-focus-ring` 2px  |
| 表單標籤 | 一律用 Base UI `Field.Label`，不用純視覺標籤                       |
| 錯誤訊息 | `Field.Error` 帶 `aria-describedby` 連到輸入元素；`Input` 依 Field 的錯誤狀態補 `aria-invalid`；表單層級的錯誤區用 `role="alert"` |
| 必填     | `Field` 的 `required` 除了 aria-hidden 的星號，另有給報讀器的「必填」文字（`ComponentLabelsContext`） |
| 圖示按鈕 | 必須有 `aria-label`                                                |
| 停用說明 | 原生 `disabled` 的按鈕收不到 hover／focus，提示出不來。`Button` / `IconButton` 的 `focusableWhenDisabled` 改用 `aria-disabled`（仍可聚焦、hover，點擊與 Enter／Space 被擋下）；包在 `Tooltip` 裡的停用按鈕自動打開，「為什麼不能按」一定看得到（[06-permission.md](./06-permission.md) §6.1）；`loading` 一律隱含開啟（送出中焦點不被踢回 `<body>`）。日曆超出 min / max 的日子同樣用 `aria-disabled`（roving tabindex 要能把焦點移過去）。Base UI 的 `Checkbox` 沒有這個開關，停用理由改寫進常駐的 `description`。其他元素用原生 `disabled` 時提示不會顯示 |
| 動態內容 | toast 用 Base UI Toast（已含 `aria-live`）；表格載入用 `aria-busy` |
| 減少動效 | `@media (prefers-reduced-motion: reduce)` 關閉所有非必要動畫       |

---

## 6. 表格

`components/Table/` 是自製元件中最複雜的一個：

```
components/Table/
├── Table.tsx             版面外殼 ＋ TanStack Table 整合（排序、分頁都交給伺服器）
├── TableHeader.tsx       表頭；可排序欄位以 <button> 承接點擊（鍵盤可操作）、aria-sort
├── TableRow.tsx          選取、hover、單擊/雙擊行為、展開列
├── TableSkeleton.tsx     載入中的骨架列（不帶 table-row testid）
├── sorting.ts            TableSorting 型別、toggleSorting()、排序圖示與 aria-sort 對照
├── pinning.ts            欄位固定、釘選列：預設值（actions 靠右）與量測 sticky 位移的 usePinLayout
├── columns.tsx           工具欄：createSelectColumn（勾選欄 CheckboxColumn）、ColumnMeta.settingsLabel
├── useTableSelection.ts  跨頁保留的選取狀態（id ＋ 勾選當下的資料），批次操作用
├── BatchActionBar.tsx    勾選後的批次操作列：已選筆數、清除選取、呼叫端的按鈕（§6.2）
├── slots.ts              TableSlot
└── index.ts
```

尚未實作（需要時再加）：`TableBody` 虛擬捲動（列數 > 100 時啟用）、欄寬拖曳。

勾選欄（CheckboxColumn）與批次操作的準備：`createSelectColumn(labels)` 產生 id 為 `__select` 的欄位——表頭全選／取消本頁
（部分勾選時半選）、每列一個勾選框；搭配 `useTableSelection(data, getRowId)` 取得 `rowSelection` / `onRowSelectionChange`，
以及跨頁保留的 `selectedIds`、`selectedRows`（勾選當下的資料，列還在目前頁時換成最新的一筆）與 `clear()`。
批次操作直接拿 `selectedRows` 送出；篩選條件改變時由呼叫端 `clear()`。列表頁的完整批次流程見 §6.2。

非字串表頭（勾選框、圖示）的欄位以 `meta.settingsLabel` 宣告欄位設定裡的名稱，才會進入欄位設定（排序、隱藏、固定）。

欄寬：只有宣告了 `size` 的欄位會在 `<th>` 設定寬度，其餘交給瀏覽器分配。

換行：**儲存格預設不換行**（`white-space: nowrap`），寬度不夠時整張表水平捲動，左右固定欄留在原位。
自動版面在寬度不夠時，會把「可以斷行」的欄（中文日期、描述，每個字之間都能斷）擠成一字一行，
不能斷的欄（email、識別碼）卻保持原寬，整張表看起來變形；不換行之後每一列都是一行高，欄位也不會被擠扁。

| 需求 | 做法 |
| ---- | ---- |
| 長文字（描述、備註） | `TextEllipsis` 加最大寬度（例：`className="max-w-60"`），放不下以省略號結尾、滑過顯示全文 |
| 真的要多行顯示 | 欄位宣告 `meta: { wrap: true }`（儲存格帶 `data-wrap`），通常再給 `size`，否則仍可能被擠得很窄 |

展開列：`expandedRowIds`（需要 `getRowId`）＋ `renderExpandedRow(row)`。展開的列正下方插入一列
`data-testid="table-expanded-row"`（`data-value` 是列 id），單一儲存格橫跨所有可見欄位；主列帶
`data-expanded`，兩者之間不畫分隔線。展開狀態由呼叫端管理（通常是操作欄的展開按鈕），
內容也由呼叫端決定——例如稽核日誌在展開當下才向後端取明細
（[`backend/06-audit-log.md`](../backend/06-audit-log.md) §7.3）。

展開內容 **不影響欄寬**：自動版面下，跨欄儲存格的內容寬度會被分攤回它橫跨的欄位，內容一寬（長字串、JSON）
展開／收合時整張表就會重新分配欄寬。所以展開儲存格裡包兩層：外層 `contain: inline-size`（對欄寬的貢獻為 0），
內層（slot `expandedContent`）寬度等於外框的可視寬度（外框是 `container-type: inline-size`，內層 `width: 100cqi`）並 sticky 貼左緣——
表格水平捲動時展開內容留在畫面上；過寬的內容在內容自己的捲動框裡處理（例如 `JsonViewer`）。

固定（pinning）：固定欄位、釘選列、固定表頭都用 `position: sticky` 貼在外框（捲動容器）的邊上；
sticky 儲存格有不透明底色（hover、選取狀態會同步），固定區與一般區交界畫分隔線。
位移由 `usePinLayout` 量實際的欄寬、列高算出（`ResizeObserver` 在尺寸改變時重量），所以沒宣告 `size` 的欄位也能多欄固定。

| prop | 型別 | 效果 |
| ---- | ---- | ---- |
| `columnPinning` | TanStack `ColumnPinningState` | 欄位固定在左（`left`）或右（`right`），陣列順序即排列順序；**預設 `{ right: ['actions'] }`**，傳 `{}` 取消。表頭與列都依「左固定 → 其餘 → 右固定」排列 |
| `rowPinning` | TanStack `RowPinningState` | 資料列貼在頂端（`top`）或底端（`bottom`），捲動時留在原位；需要 `getRowId`，列必須在 `data` 裡 |
| `stickyHeader` | `boolean` | 表頭在垂直捲動時留在上方；頂端的釘選列排在表頭下緣 |
| `maxHeight` | CSS 長度 | 固定表頭或有釘選列時外框的最大高度，預設 `70vh` |
| `fillHeight` | `boolean` | 填滿父層（有高度上限的 flex 欄）的剩餘高度：外框 `flex: 1`、最矮 `12rem`，固定是雙向捲動框，不套 `maxHeight` |

頁面本身捲動時 sticky 無效（外框為了水平捲動已經是捲動容器），所以 **固定表頭或有釘選列時，外框改成雙向捲動、最高 `maxHeight`**
（`fillHeight` 時高度由父層決定，外框一律是捲動框）。
疊放順序：固定欄 < 釘選列 < 釘選列 × 固定欄 < 表頭 < 表頭 × 固定欄。

`RichTable` 把這些固定都記在每張表的偏好裡（§6.1）。

固定的互動行為（這組行為已在實際的管理後台使用者身上驗證過）：

- 尚未進入選取模式時，單擊列身 **不做任何事**
- 已勾選至少一列後，單擊列身 **切換該列選取**
- 雙擊任一列 **開啟詳情**
- 點擊列內的按鈕、連結或勾選框 **只觸發該元件**——`TableRow` 會略過來自互動元素的點擊，
  呼叫端不必各自 `stopPropagation`

### 6.1 列表頁用 `RichTable`（`core/components/RichTable/`）

`Table` 不依賴語系與 store；列表頁實際使用的是 `core/` 的 `RichTable`，它在 `Table` 外面加上：

| 功能 | 元件 | 說明 |
| ---- | ---- | ---- |
| 分頁 | `Pagination` | `pagination={{ offset, limit, total, onChange }}`，文案走 `t()`；第一頁／最後一頁／可輸入頁碼，摘要用千分位；刪到最後一頁沒資料時自動退回最後一頁 |
| 版面 | `fillHeight`（預設 `true`） | 表格延展填滿剩餘高度、資料多時在表格內捲動，分頁列固定在底部。`DashboardLayout` 的主內容是一個視窗高的 flex 欄（側邊選單與主內容各自捲動），列表頁的根元素給 `flex min-h-0 flex-1 flex-col` 才接得到高度 |
| 篩選 | `FilterBar` | 篩選圖示按鈕（`IconButton`，只有圖示，名稱走 `aria-label`）點開的下拉表單；欄位型別 `text` / `select` / `multiSelect` / `dateRange` / `sort`（多欄排序，`SortEntry[]`，拖曳調整優先順序）/ `custom`。`value` ＋ `onSubmit` 以泛型型別化，一次送出整份值（只更新一次網址） |
| 搜尋 | `search` | `search={{ value, onChange, placeholder }}`：表格上方常駐的搜尋框，停止輸入 300ms 或按 Enter 才送出 |
| 篩選 Chip | `ActiveFilters` | 套用中的篩選（排序除外）以可移除的 Chip 列在表格上方；有篩選卻沒有結果時空狀態改成「沒有符合條件的結果」並提供「清除篩選」 |
| 查詢失敗 | `error` ＋ `onRetry` | 沒有資料時以錯誤訊息＋重試取代表格（不會落到「沒有資料」）；有舊資料時保留表格並在上方提示 |
| 欄位設定 | `TableSettings` | 齒輪按鈕點開的下拉清單：拖曳（dnd-kit，含鍵盤）排序、勾選顯示；依 `tableId` 存在 `core/store/tableColumnSettings`，偏好頁的「表格欄位」分頁改的是同一份 |

表頭可以直接設定多欄排序：`sorting` 是 `TableSorting[]`（陣列順序即優先順序），每一欄循環
**不排（`arrow-up-down`，淡化）→ 升冪（`arrow-up`）→ 降冪（`arrow-down`）→ 不排**。新排序的欄位加到最後，
移除時後面的往前遞補；排序中的欄位在圖示旁顯示優先順序數字（1、2、3…）。`onSortingChange` 回報點擊後
完整的陣列，與篩選面板的 `sort` 欄位是同一份狀態。全部取消＝空陣列，不送 `sort`，由後端套用預設排序。
篩選按鈕右上角的數量徽章（同時寫進 `aria-label`，例如「篩選（2 個條件）」）：`sort` 與 `defaultValue`（空陣列）不同才計入。

兩個面板 **都不即時套用**：面板裡的修改只改草稿，按送出鈕才生效，關掉面板就放棄草稿；每次打開都從目前生效的值開始。

| 面板 | 重設鈕（只改草稿） | 送出鈕 | 覆寫文字 |
| ---- | ------------------ | ------ | -------- |
| `FilterBar` | 「清除」→ `defaultValue`（不提供就不顯示） | 「搜尋」；文字欄位按 Enter 同義 | `labels={{ reset, submit }}` |
| `TableSettings` | 「恢復預設」→ `defaultValue` | 「套用」；草稿等於預設時呼叫 `onReset`，不留下多餘的設定 | `labels={{ reset, submit }}` |

兩顆按鈕透過 `Table` 的 `headerTrailing` **固定在最後一欄表頭的右側（與標題垂直置中）**（不論那一欄是什麼，也不會被包進排序按鈕）。
該欄的標題與按鈕都算進最小欄寬（grid `max-content auto`），標題不會被裁切——儲存格不換行後，寬度不夠時整張表水平捲動，欄位不會被擠到比內容窄。
`actions`（操作欄）固定在原位、不列入欄位設定。

**所有 Pin 都記在偏好裡**（`core/store/tableColumnSettings`，依 `tableId` 分開、存 localStorage、跨分頁同步）：

| 固定 | 在哪裡改 | 存在哪 | 預設 |
| ---- | -------- | ------ | ---- |
| 欄位固定（Column Pin） | 齒輪面板每一欄右側的「左／右」切換鈕；操作欄在面板下方的「固定」區塊 | `TableColumnSettings.pinnedColumns`（欄位 id → `'start'` / `'end'`） | 操作欄 `end` |
| 固定表頭 | 齒輪面板「固定」區塊的勾選框 | `TableColumnSettings.stickyHeader` | 關 |
| 資料列釘選（Row Pin） | 釘選欄（PinColumn，`__pin`）每列的選單：釘選到頂端／底端／取消 | `pinnedRows[tableId]`（`{ id, side: 'top' \| 'bottom', row }[]`） | 無 |

**每個 `RichTable` 預設都有這兩個工具欄**，排在所有欄位最前面，和一般欄位一樣進欄位設定（可排序、隱藏、固定）：

| 工具欄 | 出現條件 | 預設 |
| ------ | -------- | ---- |
| 勾選欄（CheckboxColumn，`__select`） | 預設都有；`enableRowSelection={false}` 關閉 | 顯示、固定在 `start`；沒有批次操作的表可以把 `__select` 放進 `defaultHidden` 預設隱藏（例：稽核日誌） |
| 釘選欄（PinColumn，`__pin`） | 有 `settings.tableId` 與 `getRowId`（釘選要記進偏好）；`enableRowPinning={false}` 關閉 | **隱藏**，使用者在欄位設定裡打開 |

勾選欄的選取狀態：呼叫端沒傳 `rowSelection` / `onRowSelectionChange` 時由 `RichTable` 內部的 `useTableSelection` 管理（跨頁保留）；
要做批次操作的頁面自己呼叫 `useTableSelection(data, getRowId)` 並把 `rowSelection` / `onRowSelectionChange` 傳進來接手，
再用 `selectedRows` 送出。沒有 `getRowId` 時與 TanStack 相同，以索引當列 id（換頁後同索引會被視為同一列，因此建議都提供 `getRowId`）。

預設值寫在 `core/store/tableColumnSettings` 的 `DEFAULT_PINNED_COLUMNS` / `DEFAULT_HIDDEN_COLUMNS`；
已存過設定的表遇到新加的欄位時，也套用這些預設（新欄位不會突然出現或沒被固定）。
各表另外要預設隱藏的欄位放在 `settings.defaultHidden`，並在 `registerPreferenceTable` 的 `defaultHidden` 登記同一份（兩處共用一個常數），
偏好頁的「恢復預設」才會一致。
偏好頁的卡片預設列出兩個工具欄；關掉勾選欄或釘選欄的表，在 `registerPreferenceTable` 對應設 `selectable: false` / `rowPinning: false`。

- 欄位固定與固定表頭跟欄位順序一樣是 **草稿**，按「套用」才生效；固定的欄位依目前的欄位順序排在左右兩側。
- 資料列釘選 **立即生效**，和欄位設定分開存：「恢復預設」不會清掉釘選列。釘選的列換頁、排序、篩選都不動——
  其他頁的釘選列以釘選當下的資料（`row`）併進 `data`，回到該頁時改用最新的那一筆；因為存的是整筆資料，重新整理後仍在，但內容可能是舊的。
  釘選欄被隱藏時，已釘選的列仍然釘在原位（偏好頁可整批清除）。
- 偏好頁「表格欄位」的卡片用同一個齒輪面板，並列出固定的欄位數、固定表頭、釘選的列數（可整批清除）。
- 釘選欄的儲存格由 context 取得狀態（`RowPin/`），理由同下方的 `ToolsHeader`；勾選欄與釘選欄的定義以翻譯後的字串為依賴 memo，
  不以 `t` 為依賴（每次渲染都是新函式，會讓勾選框重新掛載、失去焦點）。
- 呼叫端明確傳入 `columnPinning` / `stickyHeader` 時以它為準。
只有「有 `id` 且表頭是非空字串」的欄位可以設定。

表頭改成模組層級的 `ToolsHeader` 元件、設定由 context 傳入：TanStack 的 `flexRender` 把函式表頭當成元件，
每次渲染產生新函式會讓按鈕重新掛載，下拉面板在值改變時就會被關掉。

### 6.2 批次操作（`RichTable` 的 `batch`）

決策與理由見 [ADR-0012](../../adr/0012-batch-queue-worker.md)。後端 **沒有** 批次端點：確認後把適用的列送進
**全域批次佇列**，由佇列逐筆（一次一筆、堵塞式）交給分頁以一般的單筆 API 處理。
上傳這類彼此獨立的操作可以讓同一個工作並行數筆、回報位元組進度（[ADR-0013](../../adr/0013-file-manager-upload.md)、[12 §8](./12-file-manager.md)）。

| 層 | 檔案 | 職責 |
| -- | ---- | ---- |
| 設計系統 | `components/Table/BatchActionBar` | `role="toolbar"`：已選筆數（`batch-action-bar-count`，`data-value` 是筆數）、清除選取、呼叫端放進來的按鈕；不認識任何業務操作，文案由 `labels` 傳入 |
| 機制 | `core/batch` | 佇列：`BatchQueueHost`（在 SharedWorker / dedicated worker 裡）、`BatchQueueClient`（每個分頁一個，由 `batchQueuePlugin` 建立）、`connectBatchQueue()`；操作註冊表 `registerBatchOperation`；UI：`BatchProgressBar`、`BatchQueueIndicator`（AppHeader）、`BatchQueueNotifier`（結束時彈出）、`BatchResultDialog` |
| 列表 | `core/components/RichTable/BatchBar.tsx` | `batch` prop 的接線：勾選後顯示操作列，每個動作一顆按鈕（`data-testid="batch-action"`，`data-value` 是動作 id；顏色依 `tone`：`primary` / `success` / `warning` / `danger`，省略時 secondary；確認框在 `danger` / `warning` 時用危險色）；這張表（`batch.scope`）的工作進行中時換成進度條 |
| feature | `batch.ts` | 在 plugin 的同步階段註冊操作：每筆呼叫一次單筆 fetcher ＋ 失效快取（同單筆 mutation hook），**不發 toast**；失敗直接拋出 |
| feature | `pages/<List>/use<Name>BatchActions.ts` | 宣告這張表有哪些批次動作；`operation` 引用註冊的操作 id |

```tsx
// features/user/batch.ts（節錄）
registerBatchOperation({
  id: UserBatchOperation.DELETE,               // 'user.delete'
  labelKey: 'user.batch.delete.title',         // 佇列面板、進度條、結果對話框上的名稱
  localeScope: USER_LOCALE_SCOPE,              // 佇列 UI 在其他 feature 的頁面也會顯示：顯示前補載
  successKey: 'user.batch.delete.success',     // 全部成功時的 toast，參數 { count }
  run: async (userId, { signal }) => {             // 第二個參數：取消時中止的 signal、reportProgress、version
    await deleteUser({ params: { userId }, signal });
    invalidateResources([{ resource: Resource.USER, kind: 'delete', id: userId }]);
  },
});

// page.tsx
const selection = useTableSelection(rows, getRowId);
const batchActions = useUserBatchActions();
<UserTable batch={{ scope: USER_LIST_TABLE_ID, selection, actions: batchActions, getRowLabel: (row) => row.email,
                    getRowVersion: (row) => row.version }} … />
// getRowVersion（選填）：該列的樂觀鎖版本隨項目進佇列，操作從 run 的第二個參數取得（`{ version }`），
// 列表資料過時的列以 `<RESOURCE>_VERSION_CONFLICT` 逐筆失敗（backend/03-api-conventions.md §11）

// useUserBatchActions.ts（節錄）
{
  id: 'delete',
  label: t('user.batch.delete.action'),
  tone: 'danger',
  hidden: !permission.hydrated || !permission.canDelete, // 永遠不會有 → 隱藏
  isEligible: (row) => row.canDelete,                      // 沿用 adapter 的列旗標
  confirm: ({ eligible }) => ({ title: …, description: t('user.batch.delete.confirm', { count: eligible.length }) }),
  operation: UserBatchOperation.DELETE,
}
```

行為：

| 情境 | 結果 |
| ---- | ---- |
| 沒有勾選，或所有動作都 `hidden` | 不顯示操作列 |
| 選到的列都不適用（`isEligible` 全為 false） | 按鈕停用，tooltip 顯示該動作的 `ineligibleReason`（省略時用通用文案） |
| 部分列不適用 | 只送出適用的列；確認框自動補上「其中 N 筆不適用，將會略過」與「會在背景逐筆處理」 |
| 確認後 | 工作進入全域佇列（前面有工作就排隊）；這張表的操作列換成進度條（`batch-progress-bar`；每個工作一個 `batch-progress`，`data-status` 是 `queued` / `running` / `done` / `cancelled`，已處理筆數在 `batch-progress-count` 的 `data-value`），可以取消 |
| 每一筆 | 成功或失敗都即時反映在進度條（失敗筆數另外標示）；執行的分頁照單筆規則失效快取 |
| 全部成功 | 成功的列移出選取；彈出成功 toast（操作的 `successKey`） |
| 有失敗 | 彈出結果對話框（`batch-result-dialog`）逐筆列出名稱與原因（`batch-result-failure`，`data-value` 是 id）；失敗的列保留勾選，`*_NOT_FOUND`（已被別人刪除）一併移出 |
| 取消 | 處理中的項目收到中止（操作有接 `signal` 時立即停止，被中止的不算失敗），剩下的不再送出；彈出資訊 toast（已完成幾筆），已完成的不會還原 |

- 結束時的彈出只在 **一個分頁**：發起的分頁；它已經關掉就給任一個還開著的分頁。選取的更新只發生在發起的分頁（選取是頁面狀態）。
- 發起的分頁關掉或換頁，工作仍會繼續（SharedWorker 由其他分頁接手執行）；所有分頁都關掉時停止。
- 同一張表在其他分頁打開時也會看到進度條（佇列狀態經 Channel `batch-queue` 廣播，[09 §5](./09-state-and-storage.md)）。
- **AppHeader 的佇列按鈕**（`batch-queue-trigger`，徽章 `batch-queue-count` 是進行中的工作數）打開面板
  （`batch-queue-panel`），新的在上面：取消（`batch-progress-cancel`）、查看失敗項目（`batch-progress-failures`）、
  移除（`batch-progress-dismiss`）、清除已結束（`batch-queue-clear`）。已結束的工作最多保留 30 筆。
- session 結束時取消所有進行中的工作。
- 略過的列（不適用、沒送出）保留勾選，可以接著做別的批次動作。
- `batch` 提供時由 `batch.selection` 控制勾選欄，不必另外傳 `rowSelection` / `onRowSelectionChange`。
- 篩選條件（不含排序）改變時頁面呼叫 `selection.clear()`：勾選的列可能已不在結果裡。
- 佇列沒有啟用（`batchQueuePlugin` 未註冊，例如元件測試）時不顯示批次操作；測試用 `@/test/fakeBatchQueue` 建一個同行程的佇列並 `setActiveBatchQueue()`。

---

## 7. 圖示

- 來源：一套 SVG（建議 Lucide 或自繪），放在 `src/assets/icons/`
- 透過 `vite-plugin-svgr` 以 `import Icon from './x.svg?react'` 取得 React 元件
- `components/Icon/Icon.tsx` 統一尺寸（16 / 20 / 24）與 `currentColor` 著色
- **禁止**在元件裡內嵌 `<svg>` 字面量——圖示要可替換

---

## 8. 這一層的驗收

- [ ] 任何 `src/components/**/*.tsx` 都不 export Base UI 的型別
- [ ] 任何 `src/components/**/*.css` 都不出現十六進位色碼
- [ ] 任何 `src/features/**` 都不直接 import `@base-ui/react`
      （由 lint 規則 `no-restricted-imports` 強制）
- [ ] `contrast.test.ts` 全綠
- [ ] 每個元件都有 `.test.tsx`，至少涵蓋鍵盤操作與 disabled 狀態
- [ ] 每個元件都有 `.stories.tsx`（§9，🔒 `design-system.test.ts`）

---

## 9. Storybook

設計系統元件的目錄與互動沙盒。只收 `src/components/`；業務元件（`features/*/components/`）不寫 story——
它們依賴權限、API 與 i18n，要看就開 app。

```bash
pnpm storybook          # http://localhost:6006
pnpm storybook:build    # 靜態站輸出到 apps/backstage/storybook-static/（已 gitignore）
```

| 檔案 | 內容 |
| --- | --- |
| `apps/backstage/.storybook/main.ts` | 收 `src/components/**/*.stories.tsx`；addon：docs、a11y |
| `apps/backstage/.storybook/preview.tsx` | 載入 `virtual:uno.css` 與 `src/index.css`（token）；全域 `autodocs`；`router` decorator |
| `apps/backstage/.storybook/preview-head.html` | 與 `index.html` 相同的 `@layer` 順序宣告（§3.4），否則工具類蓋不過元件預設值 |

Vite 設定直接沿用 `apps/backstage/vite.config.ts`（UnoCSS、svgr、`@/` alias、CSS Module 命名），不另外維護一份。

### 9.1 寫法

- story 放在元件資料夾內，檔名 `Xxx.stories.tsx`，`title: 'Components/<資料夾名>'`。
- CSF3：`const meta = { … } satisfies Meta<typeof Xxx>; export default meta;`。
  CSF 規定要 default export，這是 [`conventions/01-general.md`](../../conventions/01-general.md) §2.3 允許的例外。
- 至少有一個 args 驅動的 `Playground`，另外列出有意義的變體、尺寸與狀態（disabled、invalid、loading、empty…）。
- 需要狀態的受控示範寫成同檔的具名元件（`function ControlledDemo()`），`render: () => <ControlledDemo />`。
- 回呼用 `storybook/test` 的 `fn()`，會出現在 Actions 面板。
- 需要 TanStack Router context 的元件（`ButtonLink`、`render` 接 router `Link`）設 `parameters: { router: true }`，
  由 `preview.tsx` 的 decorator 包一層記憶體 router。
- 跟元件本身一樣只 import `components/`、`shared/`，不 import `core/`、`features/`、`apis/`；範例資料用中性內容，不出現業務名詞。
- `design-system.test.ts` 的規則（不寫色碼、不用 `ge-` class）同樣套用在 story 上。
