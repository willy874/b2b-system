# 07 — 層級依賴限制

依照 **workspace package** 與 **資料夾** 劃分層級，並規定每一層「可以 import 誰」。
原則只有一條：**依賴只能往下指**；同層之間要互動，走該層明定的出口。

各層的職責說明見 [`architecture/frontend/01-architecture.md`](../architecture/frontend/01-architecture.md)、
[`architecture/backend/01-architecture.md`](../architecture/backend/01-architecture.md)；這份只講依賴方向。

---

## 1. Package 層（monorepo）

```
apps/web ──────▶ packages/api-sdk
   │
   └───────────▶ packages/utils ◀─────── apps/api

apps/e2e ┄┄┄┄┄▶ 只透過瀏覽器 / HTTP 操作執行中的系統，不 import 任何 workspace 原始碼
```

| Package                | 可以依賴（workspace）                    | 不可以                                                       | 強度 |
| ---------------------- | ---------------------------------------- | ------------------------------------------------------------ | ---- |
| `packages/utils`       | 無                                       | 任何 workspace package；DOM / Node 專屬 API（要前後端都能跑） | 👀   |
| `packages/api-sdk`     | 無                                       | 任何 workspace package；手改 `src/generated/`                 | 👀   |
| `apps/web`             | `api-sdk`、`utils`                        | `apps/*`                                                     | 🔒 `package.json` |
| `apps/api`             | `utils`                                  | `api-sdk`（後端才是型別的來源，不能反過來依賴產物）、`apps/*` | 🔒 `package.json` |
| `apps/e2e`             | 無                                       | 任何 `apps/*` 原始碼；只透過瀏覽器與 HTTP 操作系統            | 👀   |

- `apps/*` 之間 **永不互相 import**；packages 永不 import apps。
- 新增 workspace 依賴要先在 `package.json` 宣告；pnpm 的隔離會讓未宣告的 import 解析失敗。
- `apps/web` 只在 `src/shared/api-sdk/` 這 **一個地方** import `@game-editor/api-sdk`，其餘一律 `@/shared/api-sdk`。

---

## 2. `apps/web/src`

### 2.1 層級

```
 main.tsx                 組裝根：可 import 任何層
   │
 app/                     App Shell
   │
 features/<name>/         業務功能（彼此隔離）
   │
 plugins/   apis/         可插拔能力／通訊層
   │         │
 core/                    機制層
   │
 components/              設計系統
   │
 shared/  themes/  assets/   純工具、Design Token、靜態資源
```

### 2.2 依賴矩陣

列 = import 的一方，欄 = 被 import 的一方。✅ 可以、❌ 不可以、⚠️ 有條件。

| from ＼ to        | shared / themes / assets | components | core | apis | plugins | features | app | mocks |
| ----------------- | :----------------------: | :--------: | :--: | :--: | :-----: | :------: | :-: | :---: |
| `shared/`         | ✅（同層）               | ❌         | ❌   | ❌   | ❌      | ❌       | ❌  | ❌    |
| `components/`     | ✅                       | ✅（同層） | ❌   | ❌   | ❌      | ❌       | ❌  | ❌    |
| `core/`           | ✅                       | ✅         | ✅   | ❌   | ❌      | ❌       | ❌  | ❌    |
| `apis/`           | ✅                       | ❌         | ✅   | ⚠️¹  | ❌      | ❌       | ❌  | ❌    |
| `plugins/`        | ✅                       | ❌         | ✅   | ❌   | ✅      | ❌       | ❌  | ❌    |
| `features/<a>/`   | ✅                       | ✅         | ✅   | ✅   | ❌      | ⚠️²      | ❌  | ❌    |
| `app/`            | ✅                       | ✅         | ✅   | ✅   | ❌      | ⚠️³      | ✅  | ❌    |
| `main.tsx`        | ✅                       | ✅         | ✅   | ✅   | ✅      | ⚠️³      | ✅  | ⚠️⁴   |
| `mocks/`          | ✅                       | ❌         | ❌   | ❌   | ❌      | ❌       | ❌  | ✅    |

1. `apis/<domain>/` 之間只能共用 `apis/<domain>/types.ts`；操作資料夾彼此不 import。
2. 只能在自己的 `routes/external.ts` 裡 re-export 對方的 **route 物件**；其他需求走 `apis/` 或 eventBus。
3. 只能 import 對方的 `index.tsx`（`@/features/<name>`），不可深入內部檔案。
4. 只能在 `import.meta.env.VITE_ENABLE_MOCK` 判斷下以動態 `import()` 載入。

測試檔（`__tests__/`、`*.test.*`、`*.spec.*`）與 `src/test/` 不受矩陣限制（整合測試需要組裝多層），
但正式程式碼不可 import 任何測試檔或 `src/test/`。

### 2.3 同層規則

| 層              | 規則                                                                     |
| --------------- | ------------------------------------------------------------------------ |
| `components/`   | 元件之間可以互相組合（`Dialog` 用 `Button`），但不可形成循環             |
| `core/<module>/` | 經由該模組的 `index.ts` 匯入，不深入內部檔案                             |
| `features/`     | 彼此隔離；拿掉任何一個 feature，其他 feature 仍能編譯                     |

---

## 3. `apps/api/src`

### 3.1 層級

```
 main.ts / app.module.ts / swagger.ts     組裝根
   │
 modules/<name>/                          業務模組（只透過對方 exports 互動）
   │
 common/                                  decorator / guard / 共用型別（薄）
   │
 core/                                    機制層
   │
 db/schema/  db/relations.ts              表定義

 db/seeds/  db/migrations/  scripts/      獨立入口（CLI），不被執行期程式 import
```

### 3.2 依賴矩陣

| from ＼ to        | db/schema | core | common | modules/&lt;b&gt;               | db/seeds |
| ----------------- | :-------: | :--: | :----: | :-----------------------------: | :------: |
| `db/schema/`      | ✅（同層）| ❌   | ❌     | ❌                              | ❌       |
| `core/`           | ✅        | ✅   | ❌     | ❌                              | ❌       |
| `common/`         | ✅        | ✅   | ✅     | ❌                              | ⚠️¹      |
| `modules/<a>/`    | ✅        | ✅   | ✅     | ⚠️²                             | ⚠️¹      |
| 組裝根            | ✅        | ✅   | ✅     | ✅                              | ❌       |
| `db/seeds/`、`scripts/` | ✅  | ✅   | ✅     | ⚠️³                             | ✅       |

1. 只允許 import **權限目錄** `db/seeds/permissions.ts`（它是權限鍵的唯一來源）。
2. 跨模組只能 import 對方的 `*.module.ts`、`*.service.ts`、`dto/`、`*.constants.ts` 與純函式；
   **不可 import 對方的 `*.repository.ts`、`*.controller.ts`**；不用 `forwardRef`。
3. 只能 import 不依賴 DI 的純函式（例：`modules/auth/password.ts`）。

`core/` 不 import `modules/` 是硬規則（見 [`03-backend.md`](./03-backend.md) §1）。

---

## 4. 檢查方式

目前沒有 lint 規則強制（`.oxlintrc.json` 只開了 `import/no-cycle`），先用搜尋自查：

```bash
# web：shared / components 往上依賴
git grep -nE "from '@/(core|apis|plugins|features|app)" -- apps/web/src/shared apps/web/src/components ':!*__tests__*'
# web：core 依賴 features / app / apis
git grep -nE "from '@/(features|app|apis|plugins)" -- apps/web/src/core ':!*__tests__*'
# web：feature 深入其他 feature（routes/external.ts 以外）
git grep -nE "from '@/features/[a-z-]+/" -- apps/web/src/features ':!*/routes/external.ts' ':!*__tests__*'
# api：core 依賴 modules / common
git grep -nE "from '@/(modules|common)" -- apps/api/src/core ':!*__tests__*'
# api：common 依賴 modules
git grep -nE "from '@/modules/" -- apps/api/src/common ':!*__tests__*'
# api：跨模組 import repository / controller
git grep -nE "from '@/modules/[a-z-]+/[a-z.-]+\.(repository|controller)'" -- apps/api/src/modules ':!*__tests__*'
```

補上 `no-restricted-imports`（或自訂腳本）後，把對應列的強度改成 🔒。

---

## 5. 現況（規則建立時的既有違規）

規則建立於 2026-09-24。修改到這些檔案時順手修正，清完後刪除對應列。

| 位置                                                         | 違反                         | 建議                                                     |
| ------------------------------------------------------------ | ---------------------------- | -------------------------------------------------------- |
| `web/features/role/pages/RoleDetail/page.tsx`                | 深入 `@/features/user/routes` | 改從 `role/routes/external.ts` 取得                      |
| `api/core/cache/permission-cache.service.ts`                 | `core` → `common/types`      | `PermissionKey` 型別下移到 `core/` 或 `db/`              |
| `api/common/guards/permissions.guard.ts`                     | `common` → `modules`         | 把 guard 需要的介面抽到 `core/`，由 module 提供實作      |
| `api/modules/auth/*` → `modules/user/user.repository`        | 跨模組 import repository     | 由 `UserService` 開出需要的方法                          |
| `api/modules/user/*` → `modules/auth/refresh-token.repository` | 跨模組 import repository   | 由 `AuthTokenService` 開出需要的方法                     |
