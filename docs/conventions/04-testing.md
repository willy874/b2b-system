# 04 — 測試規範

測試策略與覆蓋率目標在
[`architecture/frontend/10-testing.md`](../architecture/frontend/10-testing.md) 與
[`architecture/backend/07-testing.md`](../architecture/backend/07-testing.md)；
這份規定 **測試怎麼寫、放哪裡、什麼時候一定要寫**。

---

## 1. 檔案位置與命名

| 範圍                | 放哪裡                                           | 副檔名          | 🔒 由誰收進來                   |
| ------------------- | ------------------------------------------------ | --------------- | ------------------------------- |
| backstage 單元／元件 | 受測檔旁的 `__tests__/`，或元件資料夾內同層       | `*.test.ts(x)`  | `apps/backstage/vitest.config.ts`     |
| platform 單元／元件 | 受測檔旁的 `__tests__/`，或元件資料夾內同層       | `*.test.ts(x)`  | `apps/platform/vitest.config.ts`    |
| api 單元            | 受測檔旁的 `__tests__/`                           | `*.spec.ts`     | `apps/api/vitest.config.ts`     |
| api 整合（真 DB）   | `apps/api/test/`                                 | `*.spec.ts`     | `apps/api/vitest.config.ts`     |
| file-storage 單元   | 受測檔旁的 `__tests__/`                           | `*.spec.ts`     | `apps/file-storage/vitest.config.ts` |
| file-storage 整合（AWS SDK） | `apps/file-storage/test/`               | `*.spec.ts`     | `apps/file-storage/vitest.config.ts` |
| E2E（瀏覽器）       | `apps/e2e/tests/`                                | `*.spec.ts`     | `apps/e2e/playwright.config.ts` |

- 檔名跟受測對象同名：`useRolePermission.ts` → `__tests__/useRolePermission.test.tsx`。
- 副檔名寫錯（backstage 用 `.spec`、api 用 `.test`）不會被執行，等於沒寫。

---

## 2. 寫法

- `describe` 寫受測對象（可加括號說明角色），`it` 用 zh-TW 寫 **可觀察的行為**：

  ```ts
  describe('useRolePermission（feature 的權限 facade）', () => {
    it('canManagePermission 需要 role:update ＋ permission:read', () => { … });
  });
  ```

  ❌ `it('works')`、`it('test canManagePermission')`

- 一個 `it` 驗一件事；需要的前置狀態用小工具函式（例：`hydrate(keys)`）說清楚。
- 對應到規格或缺陷時，在 `describe` 標出處：`describe('路由稽核（docs/architecture/backend/05-rbac.md §7）')`。
- 查詢 DOM 優先用 `getByRole` ＋ 可存取名稱；E2E 一律用 `data-testid`（文字會隨語系變）。
  列表項目用 `[data-testid="x"][data-value="y"]`，不拼接 testid（見 [`06-literal-strings.md`](./06-literal-strings.md) §3.3）。
- 不測實作細節（內部 state、私有函式）；測輸入 → 輸出、使用者看得到的結果。
- 測試之間不共享可變狀態；全域註冊表在 `beforeEach` 重設（例：`resetPagePermissionRegistry()`）。
- 不用 `sleep` / 固定等待；用 `findBy*`、`waitFor`、Playwright 的 auto-wait。

---

## 3. 各層用什麼測

| 受測對象                           | 測法                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| 純函式、`adapter.ts`               | 直接呼叫，table-driven                                                       |
| 權限 facade hook                   | `renderHook` ＋ 直接設定 permission store                                     |
| 有權限 gating 的元件               | **三案例**：有權限 → 顯示／無權限 → 不顯示／未水合 → 不閃現                  |
| 頁面                               | `renderWithPermissions` ＋ MSW handler                                        |
| 後端 service 業務規則              | 單元測試，repository 用假物件                                                 |
| 後端 repository、DB 約束、trigger  | 整合測試，Testcontainers 起真 Postgres；**不用 sqlite / mock DB**             |
| 跨前後端的使用者流程               | Playwright，只放關鍵路徑                                                      |

後端的 HTTP 整合測試以 `listenOnLoopback(app)`（`apps/api/test/http.ts`）取得給 supertest 的 server，
**不要** 直接把 `app.getHttpServer()` 交給 supertest：supertest 會替每個請求 `listen(0)`（綁在 `::`）再連 `127.0.0.1`，
macOS 上那個埠可能已被別的程序綁在 `127.0.0.1`，請求會被它接走，測試偶發地拿到 401、404 或逾時。

MSW handler 要模擬權限行為（無權限回 403），不能一律回 200。見
[`architecture/frontend/10-testing.md`](../architecture/frontend/10-testing.md) §3.5。

---

## 4. 什麼時候一定要寫

| 變更                                  | 至少要有                                                 |
| ------------------------------------- | -------------------------------------------------------- |
| 修 bug                                | 一個先失敗、修完才通過的測試                             |
| 新增頁面                              | 頁面的三個權限案例                                       |
| 新增 feature hook                     | hook 測試                                                |
| 新增 / 修改 service 業務規則          | 對應的單元測試（成功 ＋ 每個 `AppException` 分支）        |
| 新增 DB 約束或 trigger                | 整合測試證明它真的擋得住                                 |
| 新增 `components/` 元件               | 🔒 `design-system.test.ts` 會要求資料夾內有測試檔與 `.stories.tsx` |
| E2E 需要新 testid                     | testid 與測試在 **同一個 PR** 加進原始碼                 |
| 新增 E2E 流程                         | 在關鍵狀態呼叫 `snapshot(page, '<name>')`（前端 10 §4.5） |

各自的「必測清單」見兩份架構文件的最後一節，實作時逐項打勾。

---

## 5. 執行

```bash
pnpm test         # backstage ＋ api（api 整合測試需要 Docker）
pnpm test:e2e     # 先跑 pnpm dev:e2e 與 backstage
```

測試失敗時修程式或修測試，**不** 用 `it.skip` / `it.only` 提交。
