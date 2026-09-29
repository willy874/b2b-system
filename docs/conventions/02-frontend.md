# 02 — 前端規範

`apps/backstage`。分層的完整說明在 [`architecture/frontend/`](../architecture/frontend/README.md)；
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
| 8   | 只有 `core/realtime/socketIoTransport.ts` import `socket.io-client`；其他地方經由 `RealtimeTransport`、`useRealtimeEvent()`、`realtime.relay` | 換掉 Socket.io 只換一個檔案（[`architecture/frontend/11-realtime.md`](../architecture/frontend/11-realtime.md) §2） | 🔒 測試（`transport-boundary.test.ts`） |

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

遵守 [`architecture/frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §3.1 的六條契約：

1. 不洩漏 Base UI 型別到 props（🔒 `design-system.test.ts`）。
2. forward `ref`、`className`、`data-*`、`aria-*`（🔒 `ref-forwarding.test.tsx`）。
3. 受控／非受控都支援。
4. 樣式只用 token。
5. 透傳 `data-testid`（🔒 `design-system.test.ts`）。
6. 多層元件開出 `classNames` / `styles` / `testIds`（`Partial<Record<XxxSlot, T>>`），以 `createSlots()` 實作（👀 Review）。

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
- 寫入後 **不手列 query key**：`onSuccess` 呼叫 `invalidateResources()` 宣告後端改了什麼，
  由 `apis/resources.ts` 的依賴圖換算。見 [`architecture/frontend/05-data-layer.md`](../architecture/frontend/05-data-layer.md) §6.2。

---

## 5. 資料層（`apis/`）

- 一個操作一個資料夾（`get-role-list/`），內含 `fetcher.ts` ＋ `query.ts` 或 `mutation.ts`。
  不做一個 `role.api.ts` 裝全部。
- Query key：第一個元素是 `XXX_QUERY_KEY` 常數，其餘是扁平原始值，由單一
  `getXxxQueryKeys()` 產生。見 [`architecture/frontend/05-data-layer.md`](../architecture/frontend/05-data-layer.md) §4.1。
- 改了後端 controller / DTO 後必跑 `pnpm --filter @b2b-system/api openapi:generate && pnpm sdk:generate`，
  不手改 `packages/api-sdk/src/generated/`。

---

## 6. 狀態

選擇順序：**網址 → TanStack Query → signal store → `useState`**。
不把伺服器資料複製進 store（唯一例外是權限集合）。
見 [`architecture/frontend/09-state-and-storage.md`](../architecture/frontend/09-state-and-storage.md) §1。

跨分頁同步（👀 Review）：每個頻道只有一個 **持有者**。名稱與訊息型別只寫在持有者旁的 `createXxxChannel()`，
持有者從建構參數收下 `channel`、負責 `close()`，其他程式碼呼叫持有者的方法而不直接 `post` / `on`。
持久化的狀態用帶頻道的 `dictStorage`。見 [`architecture/frontend/09-state-and-storage.md`](../architecture/frontend/09-state-and-storage.md) §5。

| ❌ 不要 | ✅ 改成 |
| ------- | ------- |
| 模組層級 `let channel` ＋ `initXxxChannel()` | class 持有 `channel`，`start()` / `stop()` / `dispose()` |
| 在呼叫端拼頻道名稱 ``createChannel(`realtime-control:${backend}`)`` | `createRealtimeControlChannel(backend)` |
| store 與 localStorage 各自同步（`syncStore` ＋ `storage.set`） | `createDictStorage(ns, { channel })`，`subscribe` 收其他分頁的值 |

---

## 7. 樣式

- 不寫十六進位色碼、`rgb()`；用 token 或 UnoCSS 對應的 token class（`components/` 的 CSS 有 🔒 測試，其餘 👀）。
- 尺寸、間距用 token；不寫魔術數字。
- 陰影與遮罩也是顏色：用 `--shadow-tooltip` / `--shadow-popover` / `--shadow-toast` / `--shadow-dialog` / `--color-backdrop`，
  不寫 `box-shadow: … rgb(…)`（`components/` 的 CSS 有 🔒 測試擋 `rgb()` / `hsl()`）。
- className 不得以字串模板組成，見 [`06-literal-strings.md`](./06-literal-strings.md)。
- 設計系統元件（`components/`）的樣式寫在同資料夾的 `Xxx.module.css`，整份包在 `@layer components`；
  不再新增全域 `.css` 或 `ge-` 前綴的 class（🔒 `design-system.test.ts`）。寫法見
  [`architecture/frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §3.4。
- 元件的變體、尺寸、布林外觀用 `data-*` 屬性表達（`data-variant={variant}`、`data-block={block || undefined}`），
  CSS 選 `.root[data-variant='primary']`；測試斷言屬性，不斷言 class（👀 Review）。
- 顏色與陰影只引用 alias 層（`--color-*`、`--shadow-*`），不直接用 `--seed-gray-*` 等 seed 色——
  深色主題只覆寫 alias（`components/` 的 CSS 有 🔒 測試）。中性底色用 `--color-fill-subtle` / `--color-fill`。
  見 [`architecture/frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §4.4。
- 語意色：`-main` 給背景／邊框，`-text` 給文字（對比度不同）。見
  [`architecture/frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §4.2。

---

## 8. i18n

- 畫面上的字一律走 `t()`，不寫死中英文字串。
  例外：
  - `components/` 不能依賴 `core/locales`，元件的預設文案（`emptyTitle`、`labels` 等）可以寫死，
    但 `features/` 使用時 **必須** 以 `t()` 傳入。
  - 語言選單的語言名稱用該語言本身書寫（`繁體中文`、`English`），不翻譯。
- key 不得以字串模板組成，見 [`06-literal-strings.md`](./06-literal-strings.md)。
- 兩個語系檔（`en_US.json`、`zh_TW.json`）同一批修改；🔒 `locales.test.ts` 會比對兩邊鍵集合，並檢查每個錯誤碼與權限都有翻譯。
- 權限名稱 `permission.<resource>.<action>`、錯誤訊息 `error.<CODE>`。見
  [`architecture/frontend/08-i18n.md`](../architecture/frontend/08-i18n.md) §3。

---

## 9. 可近性

- 可點的東西用 `<button>` / `<a>`，不在 `<div>` 上掛 `onClick`。
- 只有圖示的按鈕要有 `aria-label`。
- 基線見 [`architecture/frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §5。
