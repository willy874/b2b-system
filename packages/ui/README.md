# @b2b-system/ui

backstage 與 apps/platform 共用的 **設計系統**：Base UI 之上的元件、Design Token、圖示、共用的 UnoCSS 設定與 Storybook。
規格見 [`docs/architecture/frontend/07-ui-system.md`](../../docs/architecture/frontend/07-ui-system.md)。

只有原始碼、不 build：`exports` 直接指向 `src/`，由各 app 自己的 Vite 編譯（CSS Module 的 class 前綴因此是 app 的：backstage `ge-`、platform `ga-`）。

## 匯入

```ts
import { Button } from '@b2b-system/ui/Button'; // 一個元件一個子路徑，對應 src/components/<Name>/index.ts
import { createSlots } from '@b2b-system/ui/slots'; // 另有 labels、types、useControllableState、useLatestRef
import ChevronDown from '@b2b-system/ui/icons/chevron-down.svg?react';
import { installFakeLayout } from '@b2b-system/ui/testing'; // 測試替身（jsdom 沒有布局）
```

```css
/* app 的 src/index.css */
@import '@b2b-system/ui/styles.css'; /* tokens.css ＋ 全域 base 層 */
```

app 的 `uno.config.ts` 轉出 `@b2b-system/ui/uno.config`。另有 barrel `@b2b-system/ui`，app 裡一律用子路徑。

## 目錄

| 路徑 | 內容 |
| --- | --- |
| `src/components/<Name>/` | 元件、`Xxx.module.css`、測試、story、`index.ts` |
| `src/components/__tests__/` | 結構測試（`design-system.test.ts`）、`ref-forwarding`、`slots` |
| `src/styles/` | `tokens.css`（seed／alias／component 三層）、`index.css`、`contrast.test.ts` |
| `src/icons/` | SVG 圖示（以 `?react` 匯入） |
| `src/testing/` | 給元件測試用的替身（jsdom 沒有布局） |
| `uno.config.ts` | 共用的 UnoCSS 設定（關掉顏色工具類） |
| `.storybook/`、`vite.config.ts` | Storybook 與它專用的 Vite 設定 |

## 規則

- **不出現業務名詞**：props、檔名、story 的範例資料都要領域中立；業務元件放 app 的 `features/<name>/components/`。
- 只依賴 `@b2b-system/web-shared` 與第三方套件；不 import `@b2b-system/web-core`、任何 app 的程式碼（`@/…`）、`api-sdk`、`realtime`。不依賴語系，預設文案寫死、由 `@b2b-system/web-core/shell` 的 `ComponentLabelsHost` 經 `ComponentLabelsContext` 傳入。
- 依賴語系或 store 的元件（例：`RichTable`）放 `@b2b-system/web-core/components`，不放這裡。
- 新增元件：`src/components/<Name>/` 要有 `index.ts`、`*.test.tsx`、`*.stories.tsx`（🔒 `design-system.test.ts`），並加進 `src/components/index.ts`。
- 顏色一律走 `tokens.css` 的 alias；CSS 不寫十六進位色碼、`rgb()`、seed 色（🔒 `design-system.test.ts`），樣式用 CSS Module 包在 `@layer components`。
- 不匯出 Base UI 的型別；`features/` 不直接 import Base UI（各 app 的 `app/__tests__/no-base-ui-in-features.test.ts`）。

## 測試與 Storybook

```bash
pnpm --filter @b2b-system/ui test
pnpm --filter @b2b-system/ui typecheck
pnpm storybook          # :6006（= pnpm --filter @b2b-system/ui storybook）
pnpm storybook:build    # 輸出到 packages/ui/storybook-static/
```
