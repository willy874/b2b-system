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
| `Select`                      | `@base-ui/react/select`                     |
| `Combobox` / `Autocomplete`   | `@base-ui/react/combobox`、`autocomplete`   |
| `Checkbox` / `CheckboxGroup`  | `@base-ui/react/checkbox`、`checkbox-group` |
| `Radio` / `RadioGroup`        | `@base-ui/react/radio`、`radio-group`       |
| `Switch`                      | `@base-ui/react/switch`                     |
| `Dialog`                      | `@base-ui/react/dialog`                     |
| `AlertDialog`                 | `@base-ui/react/alert-dialog`               |
| `Popover`                     | `@base-ui/react/popover`                    |
| `Tooltip`                     | `@base-ui/react/tooltip`                    |
| `Menu` / `ContextMenu`        | `@base-ui/react/menu`、`context-menu`       |
| `Tabs`                        | `@base-ui/react/tabs`                       |
| `Accordion` / `Collapsible`   | `@base-ui/react/accordion`、`collapsible`   |
| `Toast`                       | `@base-ui/react/toast`                      |
| `Toolbar`                     | `@base-ui/react/toolbar`                    |
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
| `FileUpload`                     | 自製（`<input type="file">` ＋ 拖放）                |

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
├── Link.tsx            以 <a> / TanStack Link 渲染的變體
├── Button.css          該元件的樣式（用 component 層 token）
├── Button.test.tsx
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
  `<div {...slot('body', 'ge-dialog__body')}>`；攤開後不再另寫 `className` / `style` / `data-testid`。
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
import "./Dialog.css";

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
        <BaseDialog.Backdrop className="ge-dialog__backdrop" />
        <BaseDialog.Popup
          className={cn("ge-dialog__popup", `ge-dialog__popup--${size}`, className)}
          {...rest}
        >
          <header className="ge-dialog__header">
            <BaseDialog.Title className="ge-dialog__title">{title}</BaseDialog.Title>
            {description && (
              <BaseDialog.Description className="ge-dialog__description">
                {description}
              </BaseDialog.Description>
            )}
          </header>
          <div className="ge-dialog__body">{children}</div>
          {footer && <footer className="ge-dialog__footer">{footer}</footer>}
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
.ge-button[data-disabled] {
  opacity: 0.5;
  cursor: not-allowed;
}
.ge-select-item[data-highlighted] {
  background: var(--ge-color-surface-hover);
}
.ge-select-item[data-selected] {
  font-weight: 600;
}
.ge-dialog__popup[data-open] {
  animation: ge-dialog-in 160ms ease-out;
}
.ge-dialog__popup[data-closed] {
  animation: ge-dialog-out 120ms ease-in;
}
```

### 3.4 `render` prop — 換底層元素

Base UI 每個 part 都支援 `render` 來改變實際渲染的元素，讓我們能把
TanStack Router 的 `Link` 塞進 Menu item 而不失去鍵盤行為：

```tsx
<Menu.Item render={<Link to="/role/$roleId" params={{ roleId }} />}>{t("role.detail")}</Menu.Item>
```

---

## 4. Design Token

三層 CSS 變數。

```
themes/
├── seed.css        ① 原始值：色階、間距刻度、字級、圓角、陰影
├── alias.css       ② 語意層：surface / text / border / primary / danger …
├── component.css   ③ 元件層：--ge-button-bg、--ge-dialog-radius …
├── index.ts        依序 import（順序即優先序）
├── light.ts        淺色模式的 alias 值
├── dark.ts         （預留，Phase 0 不啟用）
└── contrast.test.ts  對比度驗證
```

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
├── Table.tsx             版面外殼 ＋ TanStack Table 整合
├── TableHeader.tsx       排序、欄寬拖曳
├── TableBody.tsx         虛擬捲動（列數 > 100 時啟用）
├── TableRow.tsx          選取、hover、單擊/雙擊行為
├── TableEmpty.tsx
├── TableSkeleton.tsx
├── useTableSelection.ts  跨頁保留的選取狀態
└── index.ts
```

固定的互動行為（這組行為已在實際的管理後台使用者身上驗證過）：

- 尚未進入選取模式時，單擊列身 **不做任何事**
- 已勾選至少一列後，單擊列身 **切換該列選取**
- 雙擊任一列 **開啟詳情**
- 點擊列內的按鈕或勾選框 **只觸發該元件**（`stopPropagation`）

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
