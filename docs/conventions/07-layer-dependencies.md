# 07 — 層級依賴限制

依照 **workspace package** 與 **資料夾** 劃分層級，並規定每一層「可以 import 誰」。
原則只有一條：**依賴只能往下指**；同層之間要互動，走該層明定的出口。

各層的職責說明見 [`architecture/frontend/01-architecture.md`](../architecture/frontend/01-architecture.md)、
[`architecture/backend/01-architecture.md`](../architecture/backend/01-architecture.md)；這份只講依賴方向。

---

## 1. Package 層（monorepo）

前端 package 的分工與「程式該放哪」的判斷見 [`architecture/frontend/17-shared-packages.md`](../architecture/frontend/17-shared-packages.md) §2。

```
apps/backstage ─┬────▶ packages/api-sdk
apps/platform ──┤
                ├────▶ packages/web-core ─┬──▶ packages/ui ──▶ packages/web-shared ──▶ packages/realtime ◀──── apps/api
                │                         ├──▶ packages/web-shared
                │                         ├──▶ packages/realtime
                │                         └──▶ packages/error-codes ◀──── apps/api
                ├────▶ packages/ui
                ├────▶ packages/web-shared
                └────▶ packages/realtime

apps/e2e ┄┄┄┄┄▶ 只透過瀏覽器 / HTTP 操作執行中的系統，不 import 任何 workspace 原始碼

apps/file-storage  獨立的 S3 相容服務；不依賴任何 workspace package，也不被任何 package import
apps/apm-service   獨立的前端錯誤收件服務（模擬 Sentry API）；同上
```

| Package                | 可以依賴（workspace）                    | 不可以                                                       | 強度 |
| ---------------------- | ---------------------------------------- | ------------------------------------------------------------ | ---- |
| `packages/api-sdk`     | 無                                       | 任何 workspace package；手改 `src/generated/`                 | 👀   |
| `packages/realtime`    | 無（只依賴 `zod`）                       | 任何 workspace package；DOM / Node 專屬 API                   | 👀   |
| `packages/error-codes` | 無（零依賴）                             | 任何依賴；常數以外的程式碼                                    | 👀   |
| `packages/web-shared`  | `realtime`                               | `ui`、`api-sdk`、`apps/*`                                     | 🔒 `package.json`、測試 |
| `packages/ui`          | `web-shared`                             | `web-core`、`api-sdk`、`realtime`、`apps/*`；業務名詞         | 🔒 `package.json`、測試（業務名詞 👀） |
| `packages/web-core`    | `ui`、`web-shared`、`error-codes`、`realtime` | `api-sdk`（各 app 的端點不同）、`apps/*`；業務名詞            | 🔒 `package.json`、測試（業務名詞 👀） |
| `apps/backstage`       | `api-sdk`、`realtime`、`web-core`、`web-shared`、`ui` | `apps/*`（錯誤碼經由 `web-core/errors`）             | 🔒 `package.json` |
| `apps/platform`        | `api-sdk`、`realtime`、`web-core`、`web-shared`、`ui` | `apps/*`（兩個前端共用的機制都在 `web-core`；[`architecture/04-sso.md`](../architecture/04-sso.md) §12.2 D14） | 🔒 `package.json` |
| `apps/api`             | `realtime`、`error-codes`                | `api-sdk`（後端才是型別的來源，不能反過來依賴產物）、`web-shared`、`ui`、`apps/*` | 🔒 `package.json` |
| `apps/e2e`             | 無                                       | 任何 `apps/*` 原始碼；只透過瀏覽器與 HTTP 操作系統            | 👀   |
| `apps/file-storage`    | 無                                       | 任何 workspace package；其他 app 只透過 S3 HTTP API 與它溝通 | 🔒 `package.json` |
| `apps/apm-service`     | 無                                       | 任何 workspace package；前端只透過 Sentry 的收件 API（`@sentry/browser`）與它溝通 | 🔒 `package.json` |

- `apps/*` 之間 **永不互相 import**；packages 永不 import apps；下層 package 永不 import 上層（`web-shared` ✗ `ui` ✗ `web-core`）。🔒 測試（§4）
- 新增 workspace 依賴要先在 `package.json` 宣告；pnpm 的隔離會讓未宣告的 import 解析失敗。
- `apps/platform` 的資料夾層級與 §2 的 `apps/backstage` 相同，§2 的矩陣同樣適用。
- `apps/backstage` 只在 `src/shared/api-sdk/` 這 **一個地方** import `@b2b-system/api-sdk`，其餘一律 `@/shared/api-sdk`。
  只轉出主入口（型別、URL builder、enum），不 import `@b2b-system/api-sdk/schemas`（zod schema 會整批進首屏；[`architecture/frontend/17-shared-packages.md`](../architecture/frontend/17-shared-packages.md) §1）。
  `@b2b-system/realtime` 同理，只經由 `src/shared/websocket-sdk/`（`packages/web-shared` 內部直接 import `@b2b-system/realtime`）。🔒 測試（§4；兩個 app 都適用）
- `@sigrea/core` 只在 `packages/web-shared/src/store/` import，其餘一律 `@b2b-system/web-shared/store`（React 綁定 `@b2b-system/web-shared/hooks`）；
  `web-shared` 的 `store/` 與 `context/` 不 import React。🔒 oxlint `no-restricted-imports`
- 前端共用的 packages 以子路徑匯入（`@b2b-system/web-shared/<module>`、`@b2b-system/ui/<Component>`、`@b2b-system/web-core/<module>`），不深入 `src/` 的內部檔案
  （例外：module augmentation 指向定義的檔案 `@b2b-system/web-core/app/context`、`@b2b-system/web-core/permission/register`）。

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
 plugins/   apis/         可插拔能力（多為 web-core 的門面）／通訊層
   │         │
 core/                    app 的機制層：權限目錄的門面（core/permission）、backstage 才有的模組
   │
 @b2b-system/web-core     兩個前端共用的機制層（packages/web-core；不認識任何 app）
   │
 @b2b-system/ui           設計系統元件、Design Token、圖示（packages/ui；不出現業務名詞）
   │
 @b2b-system/web-shared   純工具（packages/web-shared；store/、context/ 不依賴 React）
 shared/                  app 專屬的收斂點：api-sdk、websocket-sdk、constants（env）
```

`@b2b-system/web-core`、`@b2b-system/ui` 與 `@b2b-system/web-shared` 是原本 app 內的 `core/`（兩個前端共用的模組，連同 `plugins/{app,fetcher}`、
`app/` 的 providers 與頂列工具、`test/` 的輔助）、`components/`（含 `themes/`、`assets/icons/`）與 `shared/` 抽成的 workspace package，
在矩陣裡仍佔原本的位置；它們不可能 import app 的 `@/` 路徑（🔒 package 邊界）。`web-core` 的模組之間也照 `core/` 的規則：不認識 feature、apis、app。

### 2.2 依賴矩陣

列 = import 的一方，欄 = 被 import 的一方。✅ 可以、❌ 不可以、⚠️ 有條件。

| from ＼ to        | web-shared / shared | ui | web-core | core | apis | plugins | features | app | mocks |
| ----------------- | :-----------------: | :--------: | :------: | :--: | :--: | :-----: | :------: | :-: | :---: |
| `web-shared`      | ✅（同層）               | ❌         | ❌       | ❌   | ❌   | ❌      | ❌       | ❌  | ❌    |
| `ui`              | ✅⁵                      | ✅（同層） | ❌       | ❌   | ❌   | ❌      | ❌       | ❌  | ❌    |
| `web-core`        | ✅⁵                      | ✅         | ✅（同層）| ❌   | ❌   | ❌      | ❌       | ❌  | ❌    |
| `core/`           | ✅                       | ✅         | ✅       | ✅   | ❌   | ❌      | ❌       | ❌  | ❌    |
| `apis/`           | ✅                       | ❌         | ✅       | ✅   | ⚠️¹  | ❌      | ❌       | ❌  | ❌    |
| `plugins/`        | ✅                       | ⚠️⁶        | ✅       | ✅   | ❌   | ✅      | ⚠️⁶      | ⚠️⁷ | ❌    |
| `features/<a>/`   | ✅                       | ✅         | ✅       | ✅   | ✅   | ❌      | ⚠️²      | ❌  | ❌    |
| `app/`            | ✅                       | ✅         | ✅       | ✅   | ✅   | ❌      | ⚠️³      | ✅  | ❌    |
| `main.tsx`        | ✅                       | ✅         | ✅       | ✅   | ✅   | ✅      | ⚠️³      | ✅  | ⚠️⁴   |
| `mocks/`          | ✅                       | ❌         | ❌       | ❌   | ❌   | ❌      | ❌       | ❌  | ✅    |

1. `apis/<domain>/` 之間只能共用 `apis/<domain>/types.ts`；操作資料夾彼此不 import。
   唯一例外是 `apis/resources.ts`（資源依賴圖）：它可以 import 各操作 `query.ts` 的 key 常數；
   操作資料夾 **不可** 反過來 import 它（會形成循環）。
2. 不可 import 其他 feature；連結用 route id（`@b2b-system/web-core/route-link`，[`architecture/frontend/03-feature-anatomy.md`](../architecture/frontend/03-feature-anatomy.md) §4.1），其他需求走 `apis/` 或 eventBus。
3. 只能 import 對方的 `index.tsx`（`@/features/<name>`），不可深入內部檔案。
4. 只能在 `import.meta.env.VITE_ENABLE_MOCK` 判斷下以動態 `import()` 載入。
5. 只有 `@b2b-system/web-shared`；app 的 `shared/`（api-sdk、websocket-sdk、env）不在 package 裡，`ui`、`web-core` 碰不到（`web-core` 直接依賴 `@b2b-system/realtime`、`@b2b-system/error-codes`）。
6. 只有 `plugins/features/`：它們往別的 feature 的頁面掛畫面（偏好頁的分頁，[`architecture/frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §4.3），
   所以可以用 `ui`；擴充某個 feature 時只能 import 它的 `index.tsx`（同註 3，[`architecture/frontend/01-architecture.md`](../architecture/frontend/01-architecture.md) §1）。
   `plugins/app/` 是基礎設施，兩者都不用。
7. 只有 `plugins/app/i18n.ts` 以 `import()` 載入 `app/locales/*.json`：app 的全域語系包放在 `app/`，由 i18n plugin 交給 web-core（[`architecture/frontend/08-i18n.md`](../architecture/frontend/08-i18n.md) §2）。

測試檔（`__tests__/`、`*.test.*`、`*.spec.*`）與 `src/test/` 不受矩陣限制（整合測試需要組裝多層），
但正式程式碼不可 import 任何測試檔、`src/test/` 或 `@b2b-system/web-core/testing`。

矩陣、上面的註與這一段都 🔒 由測試強制（§4）；`src/` 底下多了矩陣裡沒有的資料夾，測試也會失敗，要先決定它在矩陣的位置。

### 2.3 同層規則

| 層              | 規則                                                                     |
| --------------- | ------------------------------------------------------------------------ |
| `ui`            | 元件之間可以互相組合（`Dialog` 用 `Button`），但不可形成循環；package 內用相對路徑 |
| `core/<module>/`、`web-core/<module>` | 經由該模組的 `index.ts`（`@b2b-system/web-core/<module>`）匯入，不深入內部檔案；package 內用相對路徑 |
| `features/`     | 彼此隔離；拿掉任何一個 feature，其他 feature 仍能編譯（🔒 測試：不互相 import，相對路徑也算） |

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
 db/connect.ts  db/provision.ts  db/bootstrap/
                                          不經 DI 的連線、租戶 DB 的建立與 migration、租戶的初始資料
                                          （CLI 與租戶佈建共用；不讀 .env、不用 console）

 db/seeds/  db/migrations/  cli/  scripts/
                                          獨立入口（CLI），不被執行期程式 import（註 1 的白名單除外）
```

### 3.2 依賴矩陣

| from ＼ to        | db/schema | core | common | modules/&lt;b&gt;               | db/seeds |
| ----------------- | :-------: | :--: | :----: | :-----------------------------: | :------: |
| `db/schema/`      | ✅（同層）| ❌   | ❌     | ❌                              | ❌       |
| `core/`           | ✅        | ✅   | ❌     | ❌                              | ⚠️¹      |
| `common/`         | ✅        | ✅   | ✅     | ⚠️⁴                             | ⚠️¹      |
| `modules/<a>/`    | ✅        | ✅   | ✅     | ⚠️²                             | ⚠️¹      |
| 組裝根            | ✅        | ✅   | ✅     | ✅                              | ❌       |
| `db/seeds/`、`cli/`、`scripts/` | ✅  | ✅   | ✅     | ⚠️³                             | ✅       |

1. 執行期（`core/`、`common/`、`modules/`）能 import 的 `db/` 檔案只有白名單：schema（`db/schema/`、`db/platform/schema/`、`db/relations.ts`）、
   權限目錄與系統角色的定義（`db/seeds/permissions.ts`、`db/seeds/platform-permissions.ts`、`db/seeds/roles.ts`，權限鍵的唯一來源）、
   `db/connect.ts`、`db/provision.ts`、`db/bootstrap/`，以及版本檢查讀的 `db/migrations/meta/_journal.json`。
   白名單裡的檔案自己 import 的 `db/` 檔案也要在白名單裡。其他的 `db/`（seed、migrate、reset 等 CLI）讀 `.env`、用 `console`，
   改它們不該變成 api 程序的行為。
2. 跨模組只能 import 對方的 `*.module.ts`、`*.service.ts`、`dto/`、`*.constants.ts`、`*.types.ts`（只限 `import type`）與純函式；
   **不可 import 對方的 `*.repository.ts`、`*.controller.ts`**；不用 `forwardRef`。
3. 只能 import 不依賴 DI 的純函式（例：`modules/credential/password.ts`、簽發 token 的 `modules/credential/auth-token-issue.ts`）。
4. 只有 `common/guards/permissions.guard.ts` 可以注入 **全域葉節點** 模組的 service：
   `PermissionService`（`modules/permission`）、`AuditService`（`modules/audit-log`），
   以及平台端點用的 `PlatformAdminService`、`PlatformAuditService`（`modules/platform-admin`）。
   這是 [`architecture/backend/05-rbac.md`](../architecture/backend/05-rbac.md) §3、§3.2 的設計；其他 `common/` 檔案不可 import `modules/`。
   這三個模組因此必須保持葉節點（不依賴其他業務模組的 DI），否則 guard 會把整串依賴帶進每個模組。

`core/` 不 import `modules/` 是硬規則（見 [`03-backend.md`](./03-backend.md) §1）。

---

## 4. 檢查方式

**api** 的規則由 🔒 `apps/api/src/__tests__/layer-dependencies.spec.ts` 強制（`pnpm test` 會跑）：
`core/` 不依賴 `modules/`、`common/`；執行期只 import §3.2 註 1 白名單裡的 `db/` 檔案；`common/` 只有 guard 能注入 §3.2 註 4 的四個 service；
跨模組不 import repository / controller；葉節點（`permission`、`audit-log`、`platform-admin`、`platform-notification`、`credential`）只依賴彼此；
模組之間以資料夾計不循環（`import/no-cycle` 只看檔案，抓不到「A 的 service → B、B 的純函式 → A」）；不用 `forwardRef`。

**前端** 由 🔒 `packages/web-core/src/__tests__/layer-dependencies.test.ts` 強制（`pnpm test` 會跑，CI 也是）。
它掃每個依賴 `@b2b-system/web-core` 的 app（加第三個前端時自動納入）與 `packages/{web-shared,ui,web-core}`：

- app：`src/` 底下只有矩陣裡的層；§2.2 的矩陣與註 1–7；正式程式碼不 import 測試；只有 `src/shared/api-sdk/`、`src/shared/websocket-sdk/`
  import `@b2b-system/api-sdk`（只用主入口）與 `@b2b-system/realtime`（§1）；每個 `features/<name>/index.tsx` 都匯出 `Routes` 與 `<name>FeaturePlugin`
  （[`architecture/frontend/03-feature-anatomy.md`](../architecture/frontend/03-feature-anatomy.md) §2.1）。
- packages：不 import app（`@/`、跳出 `src/` 的相對路徑）；只 import §1 表格允許的 workspace package。

測試與 api 的版本一樣以正規表示式找 `import … from`、`export … from`、`import '…'` 與 `import('…')`（含 `import type`）；
樣式（`.css`）不算依賴。`@sigrea/core` 與 web-shared 的 React 限制由 `.oxlintrc.json` 的 `no-restricted-imports` 擋（§1）。
違規時測試列出 `檔案 → specifier`；修不了的既有違規要在本檔加「現況」一節並在測試裡列為例外，目前沒有。
