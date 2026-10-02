# 前端 10 — 測試

## 1. 測試金字塔

| 層                            | 工具                             | 數量級        | 跑在        |
| ----------------------------- | -------------------------------- | ------------- | ----------- |
| 單元（純函式、adapter、hook） | Vitest                           | 多            | 每次 commit |
| 元件（含權限 gating）         | Vitest ＋ Testing Library ＋ MSW | 多            | 每次 commit |
| 整合（一個頁面的完整互動）    | 同上                             | 中            | 每次 commit |
| E2E（關鍵流程）               | Playwright                       | 少（< 20 條） | PR ＋ 每日  |

**RBAC 專案的特殊要求**：每一個受權限影響的 UI 元素都必須有「有權限」與
「無權限」兩個案例。這不是可選的——權限 gating 是這個專案的主要產出。

---

## 2. 設定

```
apps/backstage/src/test/
├── setup.ts              全域 setup（MSW server、jest-dom、清理）
├── render.tsx            AllProviders ＋ renderWithPermissions
├── fixtures/             固定的測試資料
└── helpers/              常用斷言與操作
```

```ts
// test/setup.ts
import "@testing-library/jest-dom/vitest";
import { server } from "@/mocks/server";
import { queryClient } from "@/core/cache";
import { usePermissionStore } from "@/core/store/permission";
import { resetPagePermissionRegistry } from "@/core/permission/registry";

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  server.resetHandlers();
  queryClient.clear();
  usePermissionStore.getState().clear();
  resetPagePermissionRegistry();
});
afterAll(() => server.close());
```

`onUnhandledFrame: 'error'`（MSW 2 叫 `onUnhandledRequest`）是刻意的：漏寫 handler 的請求會讓測試失敗，
而不是靜默回 404 然後在斷言時才莫名其妙。

`@testing-library/jest-dom` 7 把 `vitest` 列為 peer，pnpm 在整個 workspace 只裝一份 jest-dom，
它連到哪一份 `vitest` 取決於 peer 的組合。auth 與 backstage 的 `vitest` 若因 peer 不同被拆成兩份
（例：`@vitest/mocker` 的選用 peer `msw` 在 backstage 是 3、其他 workspace 被自動裝成 2），
`import '@testing-library/jest-dom/vitest'` 會擴充到另一份 `vitest` 的 `expect`，
`rejects.toThrow('…')` 之類的斷言跟著壞掉（`expected [Function] to throw error … but got ''`）。
根目錄 `package.json` 的 `pnpm.overrides`（`"@vitest/mocker>msw"`）就是為了讓各 workspace 的 `vitest` 收斂成同一份；
改 `msw` 或 `vitest` 的版本後，確認 `pnpm-lock.yaml` 裡 `jest-dom@7…(vitest@…)` 只有一種組合。

### 2.1 `renderWithPermissions`

```tsx
// test/render.tsx
export function renderWithPermissions(
  ui: ReactElement,
  permissions: PermissionKey[] = [],
  options?: { hydrated?: boolean; route?: string },
) {
  usePermissionStore.setState({
    permissions: new Set(permissions),
    hydrated: options?.hydrated ?? true,
  });
  return render(ui, { wrapper: (p) => <AllProviders route={options?.route} {...p} /> });
}
```

---

## 3. 各層的測法

### 3.1 純函式與 adapter

```ts
describe("toRoleRowVM", () => {
  it("系統角色永遠不可刪除，即使持有 role:delete", () => {
    const vm = toRoleRowVM(
      {
        id: "1",
        name: "Admin",
        isSystem: true,
        description: null,
        permissionCount: 14,
        createdAt: "...",
      },
      { canDelete: true } as RolePermissionFacade,
    );
    expect(vm.canDelete).toBe(false);
  });

  it('空描述正規化成 "-"', () => {
    expect(toRoleRowVM({ ...base, description: null }, facade).description).toBe("-");
  });
});
```

### 3.2 權限 hook

```tsx
describe("useRolePermission", () => {
  beforeEach(() => {
    resetPagePermissionRegistry();
    registerRolePagePermissions();
  });

  it("canManagePermission 需要 role:update 與 permission:read 兩者", () => {
    const { result } = renderHookWithPermissions(
      () => useRolePermission(),
      [PermissionKey.RoleRead, PermissionKey.RoleUpdate], // 缺 permission:read
    );
    expect(result.current.canUpdate).toBe(true);
    expect(result.current.canManagePermission).toBe(false);
  });
});
```

### 3.3 元件的權限 gating（三案例模式）

```tsx
describe("RoleListToolbar", () => {
  it("有 role:create → 顯示建立按鈕", () => {
    renderWithPermissions(<RoleListToolbar />, [PermissionKey.RoleRead, PermissionKey.RoleCreate]);
    expect(screen.getByRole("button", { name: "建立角色" })).toBeInTheDocument();
  });

  it("無 role:create → 不顯示建立按鈕", () => {
    renderWithPermissions(<RoleListToolbar />, [PermissionKey.RoleRead]);
    expect(screen.queryByRole("button", { name: "建立角色" })).not.toBeInTheDocument();
  });

  it("權限未水合 → 不閃現任何操作按鈕", () => {
    renderWithPermissions(<RoleListToolbar />, [], { hydrated: false });
    expect(screen.queryByRole("button", { name: "建立角色" })).not.toBeInTheDocument();
  });
});
```

第三個案例對應一個真實缺陷：水合前若元件已渲染且 `can()` 回 `false`，
按鈕會在資料回來後突然冒出來。要用 `hydrated` 擋住。

### 3.4 頁面整合

```tsx
describe("RoleListPage", () => {
  it("載入 → 顯示列表 → 刪除一列 → 列表刷新", async () => {
    const user = userEvent.setup();
    renderWithPermissions(<RoleListPage />, [PermissionKey.RoleRead, PermissionKey.RoleDelete]);

    await screen.findByText("系統管理員");

    await user.click(screen.getByTestId("role-row-menu-content-editor"));
    await user.click(screen.getByRole("menuitem", { name: "刪除" }));
    await user.click(screen.getByRole("button", { name: "確認刪除" }));

    await waitFor(() => expect(screen.queryByText("內容編輯")).not.toBeInTheDocument());
  });

  it("後端回 403 時顯示權限已變更提示並重新取得 profile", async () => {
    server.use(
      http.delete("/api/roles/:id", () =>
        HttpResponse.json({ error: { code: "AUTHZ_FORBIDDEN" } }, { status: 403 }),
      ),
    );
    // …斷言 toast 出現且 profile query 被重取
  });
});
```

### 3.5 MSW handler 必須模擬權限行為

```ts
// mocks/handlers/auth.ts
import { HttpResponse, http } from "msw/http"; // MSW 3 起不再從根入口 'msw' 匯出

let currentPermissions: string[] = ALL_PERMISSIONS;

export function setMockPermissions(keys: string[]) {
  currentPermissions = keys;
}

export const authHandlers = [
  http.get("/api/auth/profile", () =>
    HttpResponse.json({
      data: { user: mockUser, roles: mockRoles, permissions: currentPermissions },
    }),
  ),
];
```

這讓「登入後權限如何影響整個 app」可以被端到端地測到，而不只是元件層面。

---

## 4. E2E（Playwright）

### 4.1 範圍

只測 **跨頁面、跨角色、涉及真實後端的關鍵流程**。單一頁面的互動由元件測試涵蓋。

| #   | 流程                                                                   | 為什麼需要 E2E            |
| --- | ---------------------------------------------------------------------- | ------------------------- |
| 1   | 登入 → 首頁 → 登出                                                     | 涉及真實 cookie 與重導向  |
| 2   | 錯誤密碼 5 次 → 帳號鎖定                                               | 涉及後端狀態累積          |
| 3   | admin 建立角色（含權限） → 指派給使用者 → 該使用者登入後看得到對應選單 | **RBAC 的核心端到端驗證** |
| 4   | admin 移除某角色的權限 → 持有者重新整理後 UI 對應消失                  | 權限變更的傳播            |
| 5   | auditor 直接輸入 `/user/create` 網址 → 看到 403 頁                     | 路由守衛                  |
| 6   | 反提權：admin 嘗試授予自己沒有的權限 → 被擋下                          | 安全規則                  |
| 7   | 使用者被停用 → 其開著的分頁下一次操作被登出                            | Token 撤銷                |
| 8   | 兩個分頁同時操作 → 不會因 token 輪替而被登出                           | 跨分頁協調                |
| 9   | 切換語系 → 已造訪的頁面文字全部跟著換                                  | i18n scope 補載           |
| 10  | 系統角色的刪除按鈕不存在 / 被 disable                                  | 保護規則                  |
| 11  | 持有者停在頁面上時權限被移除 → 不重新整理也變成 403；推播漏掉時，下一次操作收到 403 後自我修正 | 推播與 `PermissionDriftWatcher` 兩條路 |
| 12  | 刪除使用者／角色／資料夾 → 提示的「復原」或回收桶還原；角色還原後持有者恢復權限 | 軟刪除、持有者邊與檔案物件跨前後端（[`backend/14-revisions.md`](../backend/14-revisions.md) §9） |
| 13  | 角色的版本紀錄看差異 → 還原到某一版；兩人同時編輯同一筆 → 後送出的看到衝突提示 | 版本歷史與樂觀鎖（[`backend/14-revisions.md`](../backend/14-revisions.md) §9） |
| 14  | 註冊申請 → 審核者的鈴鐺（推播）→ 點開到審批詳情並標為已讀；角色被改 → 本人收到通知 → 全部已讀 | 業務交易內寫入、推播到 user room、route id 連結（[`backend/15-notification.md`](../backend/15-notification.md) §12） |

### 4.2 結構

```
apps/e2e/
├── playwright.config.ts
├── fixtures/
│   ├── auth.ts           以不同角色登入的 fixture（storageState 重用）
│   └── seed.ts           每次測試前重置 DB 到已知狀態
├── helpers/
└── tests/
    ├── auth.spec.ts
    ├── rbac-lifecycle.spec.ts
    ├── permission-propagation.spec.ts
    └── route-guard.spec.ts
```

### 4.3 資料隔離

每個 spec 檔案開始前跑 `pnpm db:reset && pnpm db:seed && pnpm db:seed:e2e`，
確保起點一致。`db:seed:e2e` 用固定亂數種子，產生可預期的帳號：

```
e2e-superadmin@dev.local   super-admin
e2e-admin@dev.local        admin
e2e-auditor@dev.local      auditor
e2e-member@dev.local       member
密碼統一：E2E!Password123
```

會改變帳號狀態（鎖定、停用、整批改寫角色）的案例各有專用帳號（`e2e-lockme`、`e2e-disableme`、`e2e-revokeme`、`e2e-roleholder`、
`e2e-notifyme`（站內通知：角色被增減、未讀數要精確斷言；同一個案例不能並行跑兩份，`--repeat-each` 要搭配 `--workers=1`），
見 `apps/api/src/db/seeds/e2e.ts`），不和其他並行的案例共用。

#### 與正在跑的 dev 環境並行

`pnpm dev` 佔著 3000／5173／5175 而且連著共用 dev DB 時，E2E 另起一組服務：暫用 postgres、api、backstage、auth 都換埠。
前端的埠與 api 代理目標以 shell 的環境變數覆寫（`vite.config.ts` 讀 `process.env`，見 `.env.example`「開發伺服器」）：

```bash
docker run -d --name b2b-e2e-scratch-pg -e POSTGRES_USER=b2bsystem -e POSTGRES_PASSWORD=b2bsystem \
  -e POSTGRES_DB=b2b_system -p 5433:5432 postgres:17-alpine
export PLATFORM_DATABASE_URL=postgres://b2bsystem:b2bsystem@localhost:5433/b2b_platform
export DEFAULT_TENANT_DATABASE_URL=postgres://b2bsystem:b2bsystem@localhost:5433/b2b_system
export PORT=3100 DEV_API_PROXY_TARGET=http://localhost:3100 BACKSTAGE_DEV_PORT=5273 AUTH_DEV_PORT=5275
export DEFAULT_TENANT_DOMAINS=localhost:5273 APP_PUBLIC_URL=http://localhost:5273 \
  REALTIME_ALLOWED_ORIGINS=http://localhost:5273 FILE_STORAGE_ALLOWED_ORIGINS=http://localhost:5273
export AUTH_APP_URL=http://localhost:5275 OIDC_ISSUER=http://localhost:5275/api/oidc \
  VITE_AUTH_APP_URL=http://localhost:5275 VITE_OIDC_ISSUER=http://localhost:5275/api/oidc
export AUTH_RATE_LIMIT=1000 DEFAULT_RATE_LIMIT=10000 MAIL_TRANSPORT=smtp MAIL_SMTP_URL=smtp://127.0.0.1:1025
export E2E_BASE_URL=http://localhost:5273 E2E_AUTH_URL=http://localhost:5275
# 外部 IdP（pnpm dev:mock-idp，Playwright 會起）登記的 callback 跟著換埠
export MOCK_IDP_CALLBACK_URL=http://localhost:5275/api/oidc-interaction/external/callback
# 物件儲存另起一份（:9100、資料放暫存目錄），不寫進 dev 的 :9000 與它的 .data
export FILE_STORAGE_PORT=9100 FILE_STORAGE_DATA_DIR=/tmp/b2b-e2e-storage \
  FILE_STORAGE_ENDPOINT=http://127.0.0.1:9100/storage FILE_STORAGE_PUBLIC_ENDPOINT=http://localhost:9100/storage
```

- api **不要** 在同一個目錄再跑 `nest start --watch`：`deleteOutDir` 會刪掉另一個程序正在用的 `dist`。
  改成 `cd apps/api && node --enable-source-maps dist/src/main`（沿用 dev 的 watch 已建置好的產物）。
- backstage、auth 照常 `pnpm --filter … dev`，吃上面的環境變數換埠；Playwright 的 `webServer` 以 `E2E_BASE_URL`／`E2E_AUTH_URL` 沿用它們。
- `MAIL_SMTP_URL` 用 `127.0.0.1`：macOS 上連 `localhost` 每封信慢 15–20 秒，等信的測試會逾時（[`../backend/11-mail.md`](../backend/11-mail.md) §6）。
- file-storage 以 `cd apps/file-storage && pnpm exec tsx src/main.ts` 吃上面的變數起在 :9100。backstage 的 `/storage` 代理寫死 :9000，
  所以 `FILE_STORAGE_PUBLIC_ENDPOINT` 直接給 :9100：presigned URL 讓瀏覽器直連，CORS 由 `FILE_STORAGE_ALLOWED_ORIGINS` 放行 :5273。
  共用 :9000 的話，E2E 的檔案會寫進 dev 的 bucket，E2E 資料庫的維護排程也會把 dev 的物件當成殘留。
- `tenancy`、`sso`、`mail` 三個 spec 仍寫死 5173，只能在標準埠上跑；`sso-external` 第一個案例最後斷言網址是 5173，
  換埠時只有那一行失敗（流程本身有走完）。

### 4.4 選擇器

**一律用 `data-testid`**，不用 CSS class 或文字內容（文字會因語系而變）。

```
data-testid="<feature>-<element>[-<variant>]"
role-table-row
role-create-submit
user-status-chip-active
```

`variant` 必須是字面量；隨資料變動的部分（權限鍵、id、日期）放 `data-value`，
不拼進 testid：`data-testid="role-permission-node" data-value="user:read"`
（見 [`conventions/06-literal-strings.md`](../../conventions/06-literal-strings.md) §3.3）。

E2E 需要的 testid 必須在同一個 PR 內加進原始碼，不允許「先寫測試再補」。

### 4.5 關鍵快照

E2E 在流程的關鍵狀態拍整頁截圖，留給人事後翻看「這次跑的畫面長什麼樣子」：

```ts
await expect(page.getByTestId('role-list-page')).toContainText(ROLE_NAME);
await snapshot(page, 'role-created');
```

- helper 在 `apps/e2e/helpers/snapshot.ts`；輸出到 `apps/e2e/snapshots/<spec>/<test 標題>/<序號>-<name>.png`，
  同時附在 HTML report（`pnpm --filter @b2b-system/e2e report`）上。
- `apps/e2e/snapshots/` **不進版控**；`global-setup.ts` 每次執行前清空，只保留最近一次的結果。
- 只是紀錄，**不做像素比對**，也不取代 `expect`：先 `expect` 到畫面穩定，再拍。
- 拍的是「關鍵狀態」：流程的成功終點、被擋下的畫面（403、錯誤訊息、disabled）、跨角色／跨租戶的切換點。
  一個 test 通常 1–3 張，不要每一步都拍。
- `name` 用 kebab-case 字面量，不以字串模板組成（同 §4.4 的 testid）。

---

## 5. 覆蓋率目標

| 範圍                            | 目標                              |
| ------------------------------- | --------------------------------- |
| `core/permission/**`            | **100%** — 這是安全相關的核心邏輯 |
| `core/auth/**`                  | **≥ 95%**                         |
| `features/*/hooks/**`           | ≥ 85%                             |
| `features/*/pages/*/adapter.ts` | ≥ 90%                             |
| `components/**`                 | ≥ 70%                             |
| 整體                            | ≥ 75%                             |

覆蓋率不是目的，但 `core/permission` 與 `core/auth` 的 100% / 95% 是硬門檻：
這兩個模組出錯的後果是安全事件。

---

## 6. 必測的邊界案例清單

實作時逐項打勾：

**權限**

- [ ] `canSome([])` 回 `true`（空陣列＝不設限）
- [ ] `canEvery([])` 回 `true`
- [ ] 未知 `match` 值 → 丟例外
- [ ] 重複 `registerPagePermission` → 丟例外
- [ ] 重複的 route base → 丟例外
- [ ] `requirePagePermission` miss → 丟例外
- [ ] `resolvePageKey('/unknown')` → `undefined`
- [ ] `resolvePageKey('/')` 只精確命中根頁
- [ ] `resolvePageKey('/role/abc/permission')` 命中 `ROLE_PAGE`
- [ ] 註冊表的鍵集合 = 所有 feature page key 的聯集

**Session**

- [ ] 同時多個請求 → 只觸發一次續期
- [ ] 續期中收到 401 → 等待續期結果，不立即終止 session
- [ ] 終止是 latched：N 個失敗請求只觸發一次登出
- [ ] `BroadcastChannel` 不可用時（測試環境）降級為單分頁行為
- [ ] peer 廣播逾時 → 自己續期，不永久等待

**i18n**

- [ ] 兩個語系檔的 key 集合相同
- [ ] 切換語系後，已載入的 scope 會補載新語系
- [ ] 缺翻譯時 `useErrorMessage` 退回通用訊息

**儲存**

- [ ] `localStorage` 拋例外時（模擬私密模式）app 仍正常運作
