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
變成「Game Editor 的樣子」的地方。這一層會比搭配 MUI 時厚得多——搭 MUI 時
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
  size?: "sm" | "md" | "lg";
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
| 對比度   | 文字 ≥ 4.5:1，大字與圖示 ≥ 3:1（`contrast.test.ts` 驗證）          |
| 焦點可見 | 每個互動元素有 `:focus-visible` 外框，`--ge-color-focus-ring` 2px  |
| 表單標籤 | 一律用 Base UI `Field.Label`，不用純視覺標籤                       |
| 錯誤訊息 | `Field.Error` 帶 `aria-describedby` 連到輸入元素                   |
| 圖示按鈕 | 必須有 `aria-label`                                                |
| 動態內容 | toast 用 Base UI Toast（已含 `aria-live`）；表格載入用 `aria-busy` |
| 減少動效 | `@media (prefers-reduced-motion: reduce)` 關閉所有非必要動畫       |

---

## 6. 表格

`components/Table/` 是自製元件中最複雜的一個：

```
components/Table/
├── Table.tsx             版面外殼 ＋ TanStack Table 整合（排序、分頁都交給伺服器）
├── TableHeader.tsx       表頭；可排序欄位以 <button> 承接點擊（鍵盤可操作）、aria-sort
├── TableRow.tsx          選取、hover、單擊/雙擊行為
├── TableSkeleton.tsx     載入中的骨架列（不帶 table-row testid）
├── sorting.ts            TableSorting 型別、toggleSorting()、排序圖示與 aria-sort 對照
├── pinning.ts            欄位固定、釘選列：預設值（actions 靠右）與量測 sticky 位移的 usePinLayout
├── columns.tsx           工具欄：createSelectColumn（勾選欄 CheckboxColumn）、ColumnMeta.settingsLabel
├── useTableSelection.ts  跨頁保留的選取狀態（id ＋ 勾選當下的資料），批次操作用
├── slots.ts              TableSlot
└── index.ts
```

尚未實作（需要時再加）：`TableBody` 虛擬捲動（列數 > 100 時啟用）、欄寬拖曳。

勾選欄（CheckboxColumn）與批次操作的準備：`createSelectColumn(labels)` 產生 id 為 `__select` 的欄位——表頭全選／取消本頁
（部分勾選時半選）、每列一個勾選框；搭配 `useTableSelection(data, getRowId)` 取得 `rowSelection` / `onRowSelectionChange`，
以及跨頁保留的 `selectedIds`、`selectedRows`（勾選當下的資料，列還在目前頁時換成最新的一筆）與 `clear()`。
批次操作直接拿 `selectedRows` 送出；篩選條件改變或操作完成後由呼叫端 `clear()`。

非字串表頭（勾選框、圖示）的欄位以 `meta.settingsLabel` 宣告欄位設定裡的名稱，才會進入欄位設定（排序、隱藏、固定）。

欄寬：只有宣告了 `size` 的欄位會在 `<th>` 設定寬度，其餘交給瀏覽器分配。

固定（pinning）：固定欄位、釘選列、固定表頭都用 `position: sticky` 貼在外框（捲動容器）的邊上；
sticky 儲存格有不透明底色（hover、選取狀態會同步），固定區與一般區交界畫分隔線。
位移由 `usePinLayout` 量實際的欄寬、列高算出（`ResizeObserver` 在尺寸改變時重量），所以沒宣告 `size` 的欄位也能多欄固定。

| prop | 型別 | 效果 |
| ---- | ---- | ---- |
| `columnPinning` | TanStack `ColumnPinningState` | 欄位固定在左（`left`）或右（`right`），陣列順序即排列順序；**預設 `{ right: ['actions'] }`**，傳 `{}` 取消。表頭與列都依「左固定 → 其餘 → 右固定」排列 |
| `rowPinning` | TanStack `RowPinningState` | 資料列貼在頂端（`top`）或底端（`bottom`），捲動時留在原位；需要 `getRowId`，列必須在 `data` 裡 |
| `stickyHeader` | `boolean` | 表頭在垂直捲動時留在上方；頂端的釘選列排在表頭下緣 |
| `maxHeight` | CSS 長度 | 固定表頭或有釘選列時外框的最大高度，預設 `70vh` |

頁面本身捲動時 sticky 無效（外框為了水平捲動已經是捲動容器），所以 **固定表頭或有釘選列時，外框改成雙向捲動、最高 `maxHeight`**。
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
| 分頁 | `Pagination` | `pagination={{ offset, limit, total, onChange }}`，文案走 `t()` |
| 篩選 | `FilterBar` | 篩選圖示按鈕（`IconButton`，只有圖示，名稱走 `aria-label`）點開的下拉表單；欄位型別 `text` / `select` / `multiSelect` / `dateRange` / `sort`（多欄排序，`SortEntry[]`，拖曳調整優先順序）/ `custom`。`value` ＋ `onSubmit` 以泛型型別化，一次送出整份值（只更新一次網址） |
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

兩顆按鈕透過 `Table` 的 `headerTrailing` **固定在最後一欄表頭的右下角**（不論那一欄是什麼，也不會被包進排序按鈕）。
該欄的標題用 grid `minmax(0, max-content)` 排版：空間夠時完整顯示，欄寬被擠壓時標題裁掉（`overflow: hidden` ＋ 省略號），按鈕不縮。
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
| 勾選欄（CheckboxColumn，`__select`） | 預設都有；`enableRowSelection={false}` 關閉 | 顯示、固定在 `start` |
| 釘選欄（PinColumn，`__pin`） | 有 `settings.tableId` 與 `getRowId`（釘選要記進偏好）；`enableRowPinning={false}` 關閉 | **隱藏**，使用者在欄位設定裡打開 |

勾選欄的選取狀態：呼叫端沒傳 `rowSelection` / `onRowSelectionChange` 時由 `RichTable` 內部的 `useTableSelection` 管理（跨頁保留）；
要做批次操作的頁面自己呼叫 `useTableSelection(data, getRowId)` 並把 `rowSelection` / `onRowSelectionChange` 傳進來接手，
再用 `selectedRows` 送出。沒有 `getRowId` 時與 TanStack 相同，以索引當列 id（換頁後同索引會被視為同一列，因此建議都提供 `getRowId`）。

預設值寫在 `core/store/tableColumnSettings` 的 `DEFAULT_PINNED_COLUMNS` / `DEFAULT_HIDDEN_COLUMNS`；
已存過設定的表遇到新加的欄位時，也套用這些預設（新欄位不會突然出現或沒被固定）。
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
pnpm storybook:build    # 靜態站輸出到 apps/web/storybook-static/（已 gitignore）
```

| 檔案 | 內容 |
| --- | --- |
| `apps/web/.storybook/main.ts` | 收 `src/components/**/*.stories.tsx`；addon：docs、a11y |
| `apps/web/.storybook/preview.tsx` | 載入 `virtual:uno.css` 與 `src/index.css`（token）；全域 `autodocs`；`router` decorator |
| `apps/web/.storybook/preview-head.html` | 與 `index.html` 相同的 `@layer` 順序宣告（§3.4），否則工具類蓋不過元件預設值 |

Vite 設定直接沿用 `apps/web/vite.config.ts`（UnoCSS、svgr、`@/` alias、CSS Module 命名），不另外維護一份。

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
