# 前端的死碼與過時的註解

## 現況

**沒有任何地方使用的程式**

以全 repo 搜尋確認（測試、文件以外沒有任何引用）：

- `apps/backstage/src/apis/user/get-user-roles/`：`fetcher.ts`、`query.ts` 整個操作沒有人呼叫。
  - `apis/resources.ts` 仍匯入 `USER_ROLES_QUERY_KEY`（L67），並放進 `user` 的 `entity`（L185）。
  - 結果是依賴圖替一個不存在的 query 做失效；`apis/__tests__/resources.test.ts` 也替它斷言。
- `features/role/routes/pages.ts` 的 `RoleDetailRoute`（L28–37）：
  - `context`（L31–36）每次 match 都建一個 `EventEmitter`，但全 repo 沒有任何 `emit` 或 `on`。
  - `features/role/enums/events.ts` 的 `RoleEvents`（L1–4）也沒有人用。
  - 文件的範例對應的就是這段死碼，見 [`frontend-docs-drift.md`](./frontend-docs-drift.md)。
- feature 的權限 hook：
  - `features/audit-log/hooks/useAuditLogPermission.ts`。
  - `features/permission/hooks/usePermissionPagePermission.ts`。
- `apis/file/upload-file/mutation.ts` 的 `getFileUploadMutationOptions`（L4）。上傳一律經批次佇列（`features/file/batch.ts`）。
- `packages/web-core`：
  - `app/context.ts` 的 `getAppContext()`（L42）、`hasAppContext()`（L47）。
    [`frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §2（L84、L114）仍說它是「給 fetcher 等非 React 程式碼用」的入口。
  - `auth/SessionStore.ts` 的 `getSessionStores()`（L275）。
  - `client/abort.ts` 的 `throwIfAborted()`（L53）。
  - `permission/registry.ts` 的 `getPagePermission()`（L41）。
- `packages/web-shared/src/utils/object.ts` 的 `isDefined()`（L1）。

**與程式不符的註解**

| 位置 | 註解 | 實際 |
| --- | --- | --- |
| `packages/web-core/src/components/RichTable/RichTable.tsx` L135 | `t`「每次渲染都是新函式」 | `useTranslation()` 的 `t` 有 memo，只在語系變更或語系包載入時換新 |
| `apps/backstage/src/features/account/pages/Profile/page.tsx` L23 | 密碼規則在 `apps/api/src/modules/auth/password.ts` | 檔案不存在；在 `apps/api/src/modules/credential/password.ts`（apps/platform 的同一行寫對了） |
| `apps/backstage/src/apis/resources.ts` L10、`apps/platform/src/apis/resources.ts` L5 | 機制見 `core/cache/resourceGraph.ts` | 已搬到 `packages/web-core/src/cache/resourceGraph.ts` |
| `apps/backstage/src/features/file/routes/model.ts` L15、`permission/routes/model.ts` L17、`user/routes/model.ts` L19 | `core/router/search.ts` | 已搬到 `packages/web-core/src/router/search.ts` |
| `packages/web-core/src/theme/theme.ts` L26 | `themes/tokens.css` | 在 `packages/ui/src/styles/tokens.css` |

## 影響

- 死碼讓人以為功能還在用。例如依賴圖替不存在的 query 做失效、route context 看起來是在用的機制。
- `RoleDetailRoute` 的 context 每次 match 都多建一個沒人用的物件。成本很小，但會誤導照抄的人。
- 指向不存在路徑的註解，讓處理的人找不到依據。共用 packages 抽出之後，路徑類的註解大多沒有一起更新。
- 都不影響執行。

## 修正方式

1. 刪除上列死碼：
   - 刪 `apis/user/get-user-roles/`，同時從 `apis/resources.ts` 的 `entity` 與 `resources.test.ts` 拿掉 `USER_ROLES_QUERY_KEY`。
   - 刪 `RoleDetailRoute` 的 `context` 與 `enums/events.ts`，同步改 [`frontend/04-routing.md`](../architecture/frontend/04-routing.md) §6。
   - packages 的公開函式若決定保留（例如 `getAppContext()` 給之後的非 React 程式碼用），在該 package 的 README 寫明用途；否則刪除，並更新 02 §2。
2. 逐一更新上表的註解。
3. 選做：把「註解裡引用、但不存在的路徑」的檢查做成測試。
   掃 `apps/*/src`、`packages/*/src` 註解中反引號括住的 `core/…`、`shared/…`、`themes/…` 路徑，確認檔案存在。

## 驗證方式

- `pnpm typecheck`、`pnpm test` 通過；`apis/__tests__/resources.test.ts` 的預期結果拿掉 `USER_ROLES_QUERY_KEY`。
- 用這次的搜尋方式重跑：上列的名稱與路徑都沒有殘留。
