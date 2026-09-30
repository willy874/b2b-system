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

beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  queryClient.clear();
  usePermissionStore.getState().clear();
  resetPagePermissionRegistry();
});
afterAll(() => server.close());
```

`onUnhandledRequest: 'error'` 是刻意的：漏寫 handler 的請求會讓測試失敗，
而不是靜默回 404 然後在斷言時才莫名其妙。

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

### 4.4 選擇器

**一律用 `data-testid`**，不用 CSS class 或文字內容（文字會因語系而變）。

```
data-testid="<feature>-<element>[-<variant>]"
role-table-row
role-create-submit
user-status-chip-active
```

`variant` 必須是字面量；隨資料變動的部分（權限鍵、id、日期）放 `data-value`，
不拼進 testid：`data-testid="permission-checkbox" data-value="user:read"`
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
