# 查詢失敗時，多個頁面顯示成「沒有資料」、一片空白或一直轉圈

## 現況

全域只處理 403：`packages/web-core/src/shell/GlobalProvider.tsx` 的 `PermissionDriftWatcher()`（L30 起）遇到其他錯誤直接略過（L37）。
其他查詢錯誤要由頁面自己顯示。`RichTable` 為此提供了 `error` 與 `onRetry`：
[`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §6.1 寫「沒有資料時以錯誤訊息＋重試取代表格（不會落到『沒有資料』）」。

下列頁面沒有讀查詢的 `error`。

backstage 的列表會落到空狀態（路徑都在 `apps/backstage/src/features/` 之下）：

| 頁面 | 位置 | 失敗時看到 |
| --- | --- | --- |
| 審批列表 | `approval/pages/ApprovalList/page.tsx` L27–38；`ApprovalTable` 沒有 `error` prop | 「沒有資料」 |
| 稽核日誌 | `audit-log/pages/AuditLogList/page.tsx` L25；`AuditLogTable` 沒有 `error` prop | 「沒有資料」 |
| 背景工作 | `job/pages/JobList/page.tsx` L29–43：佇列摘要與列表兩個查詢都沒有 | 佇列卡片消失，列表「沒有資料」 |
| 回收桶 | `trash/pages/TrashList/page.tsx` L66–68、L110 | 「回收桶是空的」 |
| 外部 IdP | `identity-provider/pages/IdentityProviderList/page.tsx` L34、L160 | 「還沒有任何外部 IdP 連線」 |
| 檔案管理 | `file/pages/FileManager/page.tsx` L170–198；`useFileListData.ts` L90 有回傳 `error`，頁面沒有用 | 「這個資料夾是空的」或「還沒有任何檔案」 |

backstage 的非列表頁面會一片空白，或顯示誤導的內容：

| 頁面 | 位置 | 失敗時看到 |
| --- | --- | --- |
| 系統設定 | `system/pages/SettingList/page.tsx` L19、L30–36 | 標題下方一片空白 |
| 權限目錄 | `permission/pages/PermissionList/page.tsx` L35、L67–68 | 分頁下方一片空白 |
| 事件通知 | `notification/pages/NotificationEventList/page.tsx` L23、L48–52 | 一片空白 |
| 審批詳情 | `approval/pages/ApprovalDetail/page.tsx` L28、L49–56：只有 `isPending` 分支 | 只有標題「審批詳情」的空對話框（例：從通知點進一筆已不存在的審批） |
| 使用者詳情的群組 | `user/pages/UserDetail/components/UserGroupSection.tsx` L22–31、L63 | 「無」 |

platform：

- `apps/platform/src/app/Layout.tsx`（L33–41）：profile 查詢失敗時權限永遠不會水合，畫面停在 `PageFallback` 一直轉圈。
- backstage 的 `apps/backstage/src/app/Layout.tsx`（L56–57、L66–67）遇到同樣情況會顯示 `UnexpectedErrorPage` 與重試。

同類頁面中，platform 的稽核日誌與背景工作都有傳 `error`（例：`apps/platform/src/features/audit-log/pages/AuditLogList/components/AuditLogTable.tsx` L135–136），backstage 的沒有。

## 影響

- 網路中斷、逾時、5xx、租戶暫時無法使用時，所有使用者都會遇到。
- 畫面看起來是「沒有資料」，使用者會誤判：
  - 審核者以為沒有待審的申請。
  - 管理者以為回收桶被清空、資料夾是空的、IdP 連線不見了。
- 沒有重試鈕，只能整頁重新整理。
- platform 的 profile 失敗時，整個後台一直轉圈，沒有任何說明。

## 修正方式

1. 列表頁：從 `useQuery` 取出 `error` 與 `refetch`，給 `RichTable` 傳 `error={query.error}`、`onRetry={() => void query.refetch()}`。
   `ApprovalTable`、`AuditLogTable`、`JobTable` 加上這兩個 prop 往下傳，比照 platform 的 `AuditLogTable`。
2. 直接用 `Table` 的頁面（回收桶、外部 IdP）：失敗時用 `QueryError`（`@b2b-system/web-core/components`）取代表格。
3. 非列表頁：加上 `isError` 分支顯示 `QueryError`。審批詳情比照 `group/pages/GroupDetail/page.tsx`（L58–69）：查無資料時以 `isNotFound` 決定不提供重試，並給「返回列表」。
4. 檔案管理：`FileBrowser` 在 `data.error` 而且沒有項目時，顯示錯誤與重試，不顯示 `emptyContent`。
5. `UserGroupSection`：失敗時顯示錯誤文字，不顯示「無」。
6. platform 的 `Layout`：比照 backstage，profile 失敗時顯示錯誤頁與重試。
7. 建議：補一個掃描測試，要求每個 `<RichTable` 都帶 `error`，避免之後新增的列表頁再漏掉。

## 驗證方式

- 以 MSW 讓查詢回 500，斷言出現 `QueryError`（或 RichTable 的錯誤畫面）與重試鈕，而且不出現空狀態：
  - 已有的頁面測試（路徑在 `apps/backstage/src/features/` 之下）：`trash/pages/TrashList/__tests__/TrashListPage.test.tsx`、`system/pages/SettingList/__tests__/SettingListPage.test.tsx`、
    `permission/pages/PermissionList/__tests__/PermissionListPage.test.tsx`、`notification/pages/NotificationEventList/__tests__/NotificationEventListPage.test.tsx`、
    `identity-provider/pages/IdentityProviderList/__tests__/IdentityProviderListPage.test.tsx`、`user/pages/UserDetail/__tests__/UserDetailPage.test.tsx`、
    `approval/pages/ApprovalDetail/__tests__/ApprovalReview.test.tsx`。
  - 審批列表、稽核日誌、背景工作、檔案管理目前沒有頁面測試，要新增。
- platform：新增 `apps/platform/src/app/__tests__/Layout.test.tsx`，profile 回 500 時出現錯誤頁，按重試成功後恢復。
