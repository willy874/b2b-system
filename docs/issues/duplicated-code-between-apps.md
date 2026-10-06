# 兩個前端之間仍有大量複製的程式，而且已經開始分岔

## 現況

把兩個 app 的同名檔案逐一 diff（platform ↔ backstage，路徑相對 `apps/<app>/src/`）。「不同」是 `diff` 輸出中 `<`、`>` 的行數：

| 檔案 | 行數（platform／backstage） | 差異 |
| --- | --- | --- |
| `app/layouts/SidebarNav.tsx` 的渲染部分 | platform L93–227 ／ backstage L179–313 | class 前綴 `ga-` 換成 `ge-` 之後完全相同；只差上方的選單資料 |
| `app/layouts/DashboardLayout.css` | 262／262 | 換掉 class 前綴之後完全相同 |
| `app/layouts/DashboardLayout.tsx` | 157／174 | 71 行不同（選單、品牌、帳號選單項目） |
| platform `app/ErrorPages.tsx` ↔ backstage `core/components/ErrorPage/ErrorPage.tsx` | 152／166 | `CHUNK_ERROR_PATTERN`、`isChunkLoadError()`（platform L13–19 ／ backstage L37–43）照抄；`ForbiddenPage`、`NotFoundPage`、`RouteErrorPage` 結構相同 |
| `features/login/pages/AuthShell.tsx` ↔ `features/auth/pages/AuthShell.tsx` | 28／28 | 完全相同 |
| `…/pages/SsoCallback/page.tsx` | 74／74 | 8 行不同 |
| `features/account/pages/Profile/page.tsx` | 269／272 | 39 行不同；改密碼表單、密碼規則常數、未儲存提醒都各寫一份 |
| `features/account/pages/Preference/page.tsx` | 106／114 | 20 行不同 |
| `features/job/pages/JobList/`：`page.tsx`、`JobTable`、`JobRowActions`、`JobQueueSummary`、`JobDetail` | — | 分別 19、26、5、8、48 行不同；平台多一個租戶欄 |
| `features/audit-log/pages/AuditLogList/`：`page.tsx`、`AuditLogTable` | — | 14、34 行不同 |
| `features/notification/components/NotificationBell.tsx` | 103／91 | 28 行不同 |

backstage 的程式裡有兩處註解自己承認是複製的：

- `core/components/ErrorPage/ErrorPage.tsx` L35：「與 apps/platform 的 app/ErrorPages.tsx 相同」。
- `app/sessionRedirect.ts` L15：「與 apps/platform 的 app/sessionRedirect.ts 相同」。

已經分岔的例子（一邊改了，另一邊沒跟上）：

- `JobQueueSummary`：平台 L43 的失敗數 Chip 有 `data-testid="job-queue-failed"` 與 `data-value`；backstage 沒有。
  E2E 在 backstage 無法用同樣的方式斷言。
- 改密碼的註解：
  - backstage `features/account/pages/Profile/page.tsx` L23 指向不存在的 `apps/api/src/modules/auth/password.ts`。
  - 平台同一行指向正確的 `modules/credential/password.ts`。

規格的說法：

- [`frontend/17-shared-packages.md`](../architecture/frontend/17-shared-packages.md) §5 把 `app/` 與同名的 feature 列為「不是複製，行為或端點本來就不同」。
- 但上表的差異只在選單資料、端點、class 前綴，正好是 §2 的第 2 題「把那一點改成參數或 module augmentation 後放 web-core」。
- §5（L167）要求改安全相關部分時「同一批檢查另一個 app」。這靠人工，已經漏掉一次。

## 影響

- 兩個前端的行為會越來越不一致：一邊修了 bug、補了 testid 或文案，另一邊不會自動得到。
- 每加一個共同的行為（例：側欄的新互動、錯誤頁的新狀態）都要改兩處，審查也要看兩次。
- 目前不影響資料正確性；已經造成的行為差異見上方連結。

## 修正方式

依影響大小，依序搬進 `packages/web-core`（判斷依據是 17 §2 的表）：

（`SessionWatcher` 已於 2026-10-06 搬進 `web-core/shell`，見 [`17-shared-packages.md`](../architecture/frontend/17-shared-packages.md) §3.4。）

1. `isChunkLoadError()`、`RouteErrorPage`、403／404 頁 → `web-core/components`。各 app 只留文案或外框的差異。
2. `AuthShell` → `web-core/components`（只用到 `app.title` 一個字串）。
3. 側欄 → `web-core/layout` 的 `SideNav`：
   - 選單資料由 props 傳入。
   - 樣式改成 CSS Module，`DashboardLayout.css` 不再以 `ge-`／`ga-` 全域 class 各寫一份。
4. 改密碼 → `web-core` 的 `ChangePasswordSection`：接收各 app 的 mutation options 與登出原因常數。
5. job、audit-log 列表的展示元件：欄位設定（例如平台的租戶欄）改成參數。
6. 搬完之後刪掉「與 apps/platform … 相同」這類註解，並更新 17 §5 的清單。

## 驗證方式

- 搬進 web-core 的元件在 `packages/web-core` 補單元測試；兩個 app 原本的測試照過。
- 把這次用的比對（同名檔案，行集合相似度高於 0.7 且超過 30 行）做成測試或腳本，新的複製會被擋下。
