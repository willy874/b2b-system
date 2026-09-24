# 02 — 前端規範

`apps/web`。分層的完整說明在 [`architecture/frontend/`](../architecture/frontend/README.md)；
這份只列 **寫程式時要遵守的規則**，細節一律連過去。

---

## 1. 分層規則（不可違反）

| #   | 規則                                                                                   | 理由                                             | 強度      |
| --- | -------------------------------------------------------------------------------------- | ------------------------------------------------ | --------- |
| 1   | `core/` 不 import `features/`；`shared/` 不 import 上層任何東西                        | 機制層要能被任何 feature 使用而不反向耦合        | 👀 Review |
| 2   | Feature 之間只經由 `routes/external.ts`（route 物件）、`apis/`、或 eventBus 互動       | 拿掉任何一個 feature，app 仍能啟動               | 👀 Review |
| 3   | 頁面權限在 plugin 的 **同步** 階段註冊；語系包在 `onInit`（非同步）階段                 | 第一次 render 時 `requirePagePermission()` 不會 miss | 👀 Review |
| 4   | 元件只透過 `apis/<domain>/<operation>/` 與後端對話，不直接 `fetch`                      | 攔截器（token、refresh、錯誤轉換）只在一處        | 👀 Review |
| 5   | `components/` 不出現業務名詞；業務元件放 `features/<name>/components/`                  | 設計系統要能搬到下一個產品                        | 👀 Review |
| 6   | 顏色一律走 Design Token（`themes/tokens.css`），不寫十六進位色碼                        | 主題與 dark mode 的前提                          | 🔒 測試（僅 `components/` 的 CSS） |
| 7   | Access token 只存在記憶體，不進 `localStorage` / `sessionStorage`                       | XSS 時不外洩長效憑證（[ADR-0004](../adr/0004-jwt-with-rotating-refresh-token.md)） | 👀 Review |

> 規則 1、2 在 [`architecture/frontend/01-architecture.md`](../architecture/frontend/01-architecture.md) §5
> 規劃以 `no-restricted-imports` 強制，**目前 `.oxlintrc.json` 尚未設定**，先靠 review。
> 補上後把標記改成 🔒。
>
> 完整的依賴矩陣見 [`07-layer-dependencies.md`](./07-layer-dependencies.md)。
>
> `design-system.test.ts` 另外守住：`features/` 不直接 import Base UI、`components/` 不匯出 Base UI 型別、
> `components/` 的 CSS 不出現十六進位色碼。

---

## 2. Feature

- 新增 feature 照 [`architecture/frontend/03-feature-anatomy.md`](../architecture/frontend/03-feature-anatomy.md) §5 的 SOP，
  檔案順序：`locale.ts` → `routes/` → `permission.ts` → `plugin.ts` → `hooks/` → `pages/` → `index.tsx`。
- `index.tsx` 是 feature 對外唯一入口；其他 feature 不得深入 import 它的內部檔案。
- 業務邏輯放哪裡：

| 邏輯類型          | 位置                                      |
| ----------------- | ----------------------------------------- |
| 純計算 / 判斷     | `hooks/` 內的純函式或 `utils.ts`          |
| 需要 React 狀態   | `hooks/useXxx.ts`                         |
| 需要打 API        | `hooks/useXxxMutation.ts`（包裝 `apis/`） |
| DTO → View Model  | `pages/<Page>/adapter.ts`                 |
| 渲染              | `pages/<Page>/components/*.tsx`           |

- **`page.tsx` 要薄**：只把 hook 的輸出接到元件 props，不含業務分支。超過 200 行就該拆。
- 表格、表單不直接吃 API DTO，先過 `adapter.ts`。

反面教材見 [`architecture/frontend/03-feature-anatomy.md`](../architecture/frontend/03-feature-anatomy.md) §6。

---

## 3. 元件

### 3.1 設計系統元件（`components/`）

遵守 [`architecture/frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §3.1 的五條契約：

1. 不洩漏 Base UI 型別到 props（🔒 `design-system.test.ts`）。
2. forward `ref`、`className`、`data-*`、`aria-*`（🔒 `ref-forwarding.test.tsx`）。
3. 受控／非受控都支援。
4. 樣式只用 token。
5. 透傳 `data-testid`（🔒 `design-system.test.ts`）。

### 3.2 業務元件（`features/<name>/components/`）

- props 用 `interface XxxProps`，放在元件檔上方。
- 一個檔案一個匯出元件；只在該檔使用的小元件可以同檔、不匯出。
- 權限判斷透過 feature 的權限 facade（`useRolePermission()` 等），不在元件裡直接比對權限鍵。
- 權限未水合前不渲染操作按鈕，避免「按鈕突然冒出來」。

---

## 4. Hook

- 以 `use` 開頭，一個檔案一個主要 hook。
- mutation hook 的形狀固定：展開 `getXxxMutationOptions()` → `onSuccess` 失效快取 ＋ toast。
  **錯誤不在 hook 裡吞掉**，交給全域處理或呼叫端表單。見
  [`architecture/frontend/03-feature-anatomy.md`](../architecture/frontend/03-feature-anatomy.md) §3.1。
- 寫入後要失效的 query key 對照 [`architecture/frontend/05-data-layer.md`](../architecture/frontend/05-data-layer.md) §6.2 失效矩陣。

---

## 5. 資料層（`apis/`）

- 一個操作一個資料夾（`get-role-list/`），內含 `fetcher.ts` ＋ `query.ts` 或 `mutation.ts`。
  不做一個 `role.api.ts` 裝全部。
- Query key：第一個元素是 `XXX_QUERY_KEY` 常數，其餘是扁平原始值，由單一
  `getXxxQueryKeys()` 產生。見 [`architecture/frontend/05-data-layer.md`](../architecture/frontend/05-data-layer.md) §4.1。
- 改了後端 controller / DTO 後必跑 `pnpm --filter @game-editor/api openapi:generate && pnpm sdk:generate`，
  不手改 `packages/api-sdk/src/generated/`。

---

## 6. 狀態

選擇順序：**網址 → TanStack Query → signal store → `useState`**。
不把伺服器資料複製進 store（唯一例外是權限集合）。
見 [`architecture/frontend/09-state-and-storage.md`](../architecture/frontend/09-state-and-storage.md) §1。

---

## 7. 樣式

- 不寫十六進位色碼、`rgb()`；用 token 或 UnoCSS 對應的 token class（`components/` 的 CSS 有 🔒 測試，其餘 👀）。
- 尺寸、間距用 token；不寫魔術數字。
- className 不得以字串模板組成，見 [`06-literal-strings.md`](./06-literal-strings.md)。
- 語意色：`-main` 給背景／邊框，`-text` 給文字（對比度不同）。見
  [`architecture/frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §4.2。

---

## 8. i18n

- 畫面上的字一律走 `t()`，不寫死中英文字串。
- key 不得以字串模板組成，見 [`06-literal-strings.md`](./06-literal-strings.md)。
- 兩個語系檔（`en_US.json`、`zh_TW.json`）同一批修改；🔒 `locales.test.ts` 會比對兩邊鍵集合，並檢查每個錯誤碼與權限都有翻譯。
- 權限名稱 `permission.<resource>.<action>`、錯誤訊息 `error.<CODE>`。見
  [`architecture/frontend/08-i18n.md`](../architecture/frontend/08-i18n.md) §3。

---

## 9. 可近性

- 可點的東西用 `<button>` / `<a>`，不在 `<div>` 上掛 `onClick`。
- 只有圖示的按鈕要有 `aria-label`。
- 基線見 [`architecture/frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §5。
