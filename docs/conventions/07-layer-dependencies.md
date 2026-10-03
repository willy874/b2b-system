# 07 — 層級依賴限制

依照 **workspace package** 與 **資料夾** 劃分層級，並規定每一層「可以 import 誰」。
原則只有一條：**依賴只能往下指**；同層之間要互動，走該層明定的出口。

各層的職責說明見 [`architecture/frontend/01-architecture.md`](../architecture/frontend/01-architecture.md)、
[`architecture/backend/01-architecture.md`](../architecture/backend/01-architecture.md)；這份只講依賴方向。

---

## 1. Package 層（monorepo）

```
apps/backstage ─┬────▶ packages/api-sdk
apps/auth ──────┤
                └────▶ packages/realtime ◀──── apps/api

apps/e2e ┄┄┄┄┄▶ 只透過瀏覽器 / HTTP 操作執行中的系統，不 import 任何 workspace 原始碼

apps/file-storage  獨立的 S3 相容服務；不依賴任何 workspace package，也不被任何 package import
```

| Package                | 可以依賴（workspace）                    | 不可以                                                       | 強度 |
| ---------------------- | ---------------------------------------- | ------------------------------------------------------------ | ---- |
| `packages/api-sdk`     | 無                                       | 任何 workspace package；手改 `src/generated/`                 | 👀   |
| `packages/realtime`    | 無（只依賴 `zod`）                       | 任何 workspace package；DOM / Node 專屬 API                   | 👀   |
| `apps/backstage`             | `api-sdk`、`realtime`                     | `apps/*`                                                     | 🔒 `package.json` |
| `apps/auth`            | `api-sdk`、`realtime`                     | `apps/*`（backstage 的程式碼是 **複製** 過來的，不 import；[`architecture/04-sso.md`](../architecture/04-sso.md) §12.2 D14） | 🔒 `package.json` |
| `apps/api`             | `realtime`                               | `api-sdk`（後端才是型別的來源，不能反過來依賴產物）、`apps/*` | 🔒 `package.json` |
| `apps/e2e`             | 無                                       | 任何 `apps/*` 原始碼；只透過瀏覽器與 HTTP 操作系統            | 👀   |
| `apps/file-storage`    | 無                                       | 任何 workspace package；其他 app 只透過 S3 HTTP API 與它溝通 | 🔒 `package.json` |

- `apps/*` 之間 **永不互相 import**；packages 永不 import apps。
- 新增 workspace 依賴要先在 `package.json` 宣告；pnpm 的隔離會讓未宣告的 import 解析失敗。
- `apps/auth` 的資料夾層級與 §2 的 `apps/backstage` 相同，§2 的矩陣同樣適用。
- `apps/backstage` 只在 `src/shared/api-sdk/` 這 **一個地方** import `@b2b-system/api-sdk`，其餘一律 `@/shared/api-sdk`。
  `@b2b-system/realtime` 同理，只經由 `src/shared/websocket-sdk/`。
- `@sigrea/core` 只在 `src/shared/store/` import，其餘一律 `@/shared/store`（React 綁定 `@/shared/hooks`）；
  `shared/store/` 與 `shared/context/` 不 import React。🔒 oxlint `no-restricted-imports`

---

## 2. `apps/backstage/src`

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
   唯一例外是 `apis/resources.ts`（資源依賴圖）：它可以 import 各操作 `query.ts` 的 key 常數；
   操作資料夾 **不可** 反過來 import 它（會形成循環）。
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
| `core/`           | ✅        | ✅   | ❌     | ❌                              | ⚠️¹      |
| `common/`         | ✅        | ✅   | ✅     | ⚠️⁴                             | ⚠️¹      |
| `modules/<a>/`    | ✅        | ✅   | ✅     | ⚠️²                             | ⚠️¹      |
| 組裝根            | ✅        | ✅   | ✅     | ✅                              | ❌       |
| `db/seeds/`、`scripts/` | ✅  | ✅   | ✅     | ⚠️³                             | ✅       |

1. 只允許 import **權限目錄** `db/seeds/permissions.ts`（它是權限鍵的唯一來源）。
2. 跨模組只能 import 對方的 `*.module.ts`、`*.service.ts`、`dto/`、`*.constants.ts`、`*.types.ts`（只限 `import type`）與純函式；
   **不可 import 對方的 `*.repository.ts`、`*.controller.ts`**；不用 `forwardRef`。
3. 只能 import 不依賴 DI 的純函式（例：`modules/credential/password.ts`）。
4. 只有 `common/guards/permissions.guard.ts` 可以注入 **全域葉節點** 模組的 service：
   `PermissionService`（`modules/permission`）、`AuditService`（`modules/audit-log`），
   以及平台端點用的 `PlatformAdminService`、`PlatformAuditService`（`modules/platform-admin`）。
   這是 [`architecture/backend/05-rbac.md`](../architecture/backend/05-rbac.md) §3、§3.2 的設計；其他 `common/` 檔案不可 import `modules/`。
   這三個模組因此必須保持葉節點（不依賴其他業務模組的 DI），否則 guard 會把整串依賴帶進每個模組。

`core/` 不 import `modules/` 是硬規則（見 [`03-backend.md`](./03-backend.md) §1）。

---

## 4. 檢查方式

**api** 的規則由 🔒 `apps/api/src/__tests__/layer-dependencies.spec.ts` 強制（`pnpm test` 會跑）：
`core/` 不依賴 `modules/`、`common/`；`common/` 只有 guard 能注入 §3.2 註 4 的四個 service；
跨模組不 import repository / controller；葉節點（`permission`、`audit-log`、`platform-admin`、`platform-notification`、`credential`）只依賴彼此；
模組之間以資料夾計不循環（`import/no-cycle` 只看檔案，抓不到「A 的 service → B、B 的純函式 → A」）；不用 `forwardRef`。

**backstage** 目前由 `.oxlintrc.json` 的 `no-restricted-imports` 擋一部分，其餘用搜尋自查：

```bash
# backstage：shared / components 往上依賴
git grep -nE "from '@/(core|apis|plugins|features|app)" -- apps/backstage/src/shared apps/backstage/src/components ':!*__tests__*'
# backstage：core 依賴 features / app / apis
git grep -nE "from '@/(features|app|apis|plugins)" -- apps/backstage/src/core ':!*__tests__*'
# backstage：feature 深入其他 feature（routes/external.ts 以外）
git grep -nE "from '@/features/[a-z-]+/" -- apps/backstage/src/features ':!*/routes/external.ts' ':!*__tests__*'
```

backstage 補上 `no-restricted-imports`（或比照 api 寫成測試）後，把對應列的強度改成 🔒。
