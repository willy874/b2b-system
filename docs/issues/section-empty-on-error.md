# 頁面裡的區塊在載入中或查詢失敗時顯示「無」或什麼都不顯示

## 現況

[`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §6.1 的表格之後規定：不經過 `RichTable` 的資料畫面
（「頁面的一個區塊」也算）**不能把查詢失敗畫成空狀態**，沒有資料而且查詢失敗時以 `QueryError`（`web-core/components`）取代內容。
`RichTable` 由 `app/__tests__/rich-table-error.test.ts` 守住，詳情頁裡的區塊沒有對應的檢查，下列各處把 `data === undefined`
（載入中或失敗）當成「沒有資料」：

| 位置 | 行為 |
| --- | --- |
| `apps/backstage/src/features/role/pages/RoleDetail/components/RolePermissionSection.tsx` 21–29 行 | `permissions?.length` 為假就顯示 `common.none`（「無」）。呼叫端 `RoleDetail/page.tsx` 38–41、130 行直接傳 `rolePermissions.data?.permissions`，載入中與失敗都變成「這個角色沒有任何權限」（缺 `permission:read` 時查詢必然 403 的情形另見 [`role-detail-permission-query.md`](./role-detail-permission-query.md)） |
| `apps/backstage/src/features/role/pages/RoleDetail/components/RoleHolderSection.tsx` 20、63 行 | `holders`／`groups` 是 `undefined` 時整段不渲染（元件註解把 `undefined` 定義為「沒有權限」）。`RoleDetail/page.tsx` 134–135 行在有權限、但查詢載入中或失敗時同樣傳 `undefined`：只剩「持有者」的標題，下面空白 |
| `apps/backstage/src/features/group/pages/GroupDetail/components/GroupMemberSection.tsx` 66、109–111 行 | `members?.length` 為假就顯示「無」。`GroupDetail/page.tsx` 84–85 行的 `total` 在查詢失敗時退回 `group.data.memberCount`，標題寫「成員（12）」、下面寫「無」，互相矛盾 |
| `apps/backstage/src/features/notification/components/NotificationPreferenceSection.tsx` 23、27、37 行 | 只看 `isPending`；失敗時 `data` 是 `undefined`，渲染說明文字加上零列，看起來像「沒有可以設定的事件」 |
| `apps/backstage/src/features/announcement/components/AudiencePicker.tsx` 48、137–141 行 | 受眾預覽沒有 `data` 就顯示 `announcement.audience.counting`（「計算收件人數中…」）；預覽失敗時永遠停在這句，沒有錯誤與重試 |
| `apps/backstage/src/features/comment/components/WatchButton.tsx` 13 行 | `!state.data` 時 `return null`：載入中與失敗都讓「關注」按鈕消失，使用者不知道是不能關注還是出錯 |
| `apps/backstage/src/features/organization/pages/Organization/components/OrgUnitMemberSection.tsx` 67、191–195 行 | 失敗時 `total` 為 0、列表顯示「無」（載入中顯示「…」）；標題變成「成員（0）」 |
| `apps/backstage/src/features/user/pages/UserDetail/components/UserGroupSection.tsx` 64–79 行 | 有處理失敗（錯誤訊息＋重試），但是自己寫的一份，與 `QueryError` 的外觀、testid 不同；載入中顯示「…」（78 行），其他區塊多半是 Skeleton |

`AudiencePicker` 的預覽端點（`POST /announcements/audience-preview`）要 `announcement:update`，而建立頁的頁面鍵只要
`announcement:create`；但權限依賴（[`iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md) 依賴表
`announcement:create` → `announcement:update`）保證有 create 的人一定有 update，**權限不會讓預覽失敗**，失敗只來自網路或伺服器錯誤。

## 影響

- 查詢失敗時管理者看到的是錯誤的事實：「這個角色沒有權限」「這個群組沒有成員」「這個部門 0 人」「沒有可以設定的通知」，
  可能據此做出錯誤的操作（例如再加一次權限、以為群組是空的就刪掉）。
- 公告建立頁的人數一直停在「計算中」，無從得知要重試。
- 每個區塊各自處理（或不處理），新增區塊時沒有範本可循，也沒有測試擋下。

嚴重度中：行為與 §6.1 的規定不一致；只在查詢失敗或載入中出現，不會寫壞資料，但畫面傳達錯誤的資訊。

## 修正方式

1. 在 `packages/web-core/src/components/` 加一個區塊用的狀態元件（例如 `QueryBoundary`／`SectionState`），輸入一個 query
   （`isPending`、`isError`、`error`、`refetch`、`data`）：
   載入中 → `Skeleton`（可傳高度）；沒有資料而且失敗 → `QueryError`（`compact` 外觀、`onRetry={refetch}`）；
   有資料 → render prop。有舊資料又失敗時保留內容並在上方提示，與 `RichTable` 一致。
2. 上表各處改用它；子元件的 props 從「`data | undefined`」改成直接收 query 或由呼叫端包住，讓「沒有權限」（不渲染）與
   「載入中／失敗」分開表達（`RoleHolderSection`、`RolePermissionSection`、`GroupMemberSection` 的 `total` 不再退回 `memberCount`）。
3. `UserGroupSection` 的手寫錯誤改用同一個元件；`AudiencePicker` 的人數在失敗時顯示錯誤與重試；`WatchButton` 失敗時顯示停用的按鈕＋tooltip（或小的重試），不要消失。
4. 07-ui-system.md §6.1 補一句「區塊用 `<元件名>`」，讓規則有具體的做法。

## 驗證方式

- 每個區塊的元件測試加一案：msw 讓該查詢回 500 → 看得到錯誤訊息與重試按鈕、看不到「無」；點重試後顯示資料。
- `RoleDetail`、`GroupDetail` 的頁面測試：權限查詢失敗時 `role-permission-chips` 不含「無」；成員查詢失敗時標題不顯示 `memberCount`。
- 共用元件在 `packages/web-core` 有自己的測試（載入中、失敗、有舊資料又失敗、有資料）。

（2026-10-10 backstage 各功能的優化分析發現。）
