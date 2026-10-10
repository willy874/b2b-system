# 列表頁「網址查詢條件」的 hook 逐頁複製

## 現況

每個列表頁都有一個 `use*SearchFilter`／`use*Search` hook，把分頁、篩選、排序放在網址。核心都是同一段：

```ts
const search = XxxListRoute.useSearch();
const navigate = useNavigate();
const patch = useCallback(
  (next: Partial<XxxSearchQuery>) => void navigate({ to: XxxListRoute.to, search: { ...search, ...next } }),
  [navigate, search],
);
return { search, setKeyword: (k) => patch({ keyword: k || undefined, offset: 0 }), setPage: (offset, limit) => patch({ offset, limit }) };
```

backstage 有 12 份（共 358 行，路徑相對 `apps/backstage/src/features/`）：

| 檔案 | 與最小形狀的差異 |
| --- | --- |
| `webhook/pages/WebhookList/useWebhookSearchFilter.ts`（26 行） | 無（`setKeyword`、`setPage`） |
| `group/pages/GroupList/useGroupSearchFilter.ts`（28 行） | 與 webhook 逐行相同，只多 `setSort`（`diff` 只差路由名稱與這一行） |
| `role/pages/RoleList/useRoleSearchFilter.ts`、`service-account/pages/ServiceAccountList/useServiceAccountSearchFilter.ts` | 同 group |
| `announcement/pages/AnnouncementList/useAnnouncementSearchFilter.ts`、`job/pages/JobList/useJobSearchFilter.ts` | 多一兩個篩選 setter |
| `audit-log/pages/AuditLogList/useAuditLogSearchFilter.ts`、`approval/pages/ApprovalList/useApprovalSearchFilter.ts`、`user/pages/UserList/useUserSearchFilter.ts` | `setFilters`（改條件回到第一頁）、`setSort` |
| `trash/pages/TrashList/useTrashSearch.ts` | 另算目前的類型 |
| `permission/pages/PermissionList/usePermissionSearch.ts`、`file/pages/FileManager/useFileSearch.ts` | `patch` 多一個 `replace` 選項 |

另有兩處頁面內聯同一段 `patch`：`approval/pages/MyApprovalList/page.tsx:111-112`、`data-transfer/pages/DataTransferList/page.tsx:102`。
apps/platform 也有 5 份同樣的 hook（`apps/platform/src/features/{audit-log,feature-flag,job,platform-admin,tenant}/pages/*/use*SearchFilter.ts`）。

細節也不一致：webhook、group、role、service-account、announcement 用 `useNavigate({ from: XxxRoute.fullPath })`，其他 7 份用 `useNavigate()`。

route 的 search schema 也重複：`offset: z.coerce.number().int().min(0).catch(0)`、`limit: z.coerce.number().int().min(1).max(200).catch(20)`、
`keyword: z.string().trim().optional().catch(undefined)` 在 backstage 8 個、platform 4 個 `routes/model.ts` 逐字出現。

> 原本懷疑「17 個 `routes/model.ts` 只有 6 個把排序放進網址」也是問題：查證後不是。沒有排序參數的列表（webhook、job、announcement、notification…）
> 在表格欄位都設了 `enableSorting: false`（例：`webhook/pages/WebhookList/components/WebhookTable.tsx:51`），後端也沒有排序白名單，
> 不存在「有排序但沒進網址」的頁面，所以不列入。

## 影響

- 改共通行為要改 17 處以上（兩個 app）：例如改成 TanStack Router 的函式形式 `search: (prev) => ({ ...prev, ...next })`
  （現在 `patch` 讀的是 render 當下的 `search`，同一個事件裡連續呼叫兩次時，後一次會蓋掉前一次）、統一 `from`、統一「改條件回到第一頁」。
- 新列表頁的作法是複製一份再改名，hook 的測試也跟著逐頁複製。

嚴重度低：開發體驗與程式整潔，目前各頁行為正確。

## 修正方式

兩個 app 都需要，放 `packages/web-core/src/router/`（已有 `search.ts` 的網址序列化，`index.ts` 對外匯出）：

1. **`useRouteSearch(route, options?)`**：回傳 `{ search, patch(next, { replace? }) }`，`patch` 用函式形式的 `search`、`navigate` 帶 `from`。
   型別從 route 推導（`route.useSearch()` 的回傳型別），呼叫端不必再寫 `Partial<XxxSearchQuery>`。
2. **`useListSearch(route)`**：在 1 之上加列表的共通 setter——`setPage(offset, limit)`、`setKeyword(keyword)`、`setSort(sort)`、
   `setFilters(partial)`（後三者都會把 `offset` 歸零）。
3. **search schema 的共用片段** 放 `packages/web-shared/src/constants/`（與既有的 `sortSearchSchema` 同處）：`paginationSearchShape(defaultLimit)`、`keywordSearchSchema`，
   各 `routes/model.ts` 以 `z.object({ ...paginationSearchShape(20), keyword: keywordSearchSchema, ... })` 組合。
4. 逐頁替換：只有最小形狀的（webhook、group、role、service-account）直接在頁面用 `useListSearch`，刪掉 hook 檔；
   有額外 setter 的保留 feature 的 hook，但內部改由 `useListSearch` 組成；permission、file、trash 改用 `useRouteSearch`。
   apps/platform 的 5 份同一批換掉。

## 驗證方式

- `packages/web-core/src/router/__tests__/` 補 `useRouteSearch`／`useListSearch` 的測試：`setKeyword`／`setSort`／`setFilters` 回到第一頁、`setPage` 保留其他條件、
  同一事件裡連續 `patch` 兩次兩個值都保留、`replace` 不新增瀏覽紀錄。
- 各列表頁既有的頁面測試與 E2E（分頁、篩選、排序、上一頁還原）通過；`pnpm typecheck`。
- 替換後 `grep -rn "search: { ...search, ...next }" apps/*/src` 只剩 web-core 裡的實作（或沒有結果）。

（2026-10-10 backstage 各功能的優化分析發現。）
