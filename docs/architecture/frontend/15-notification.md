# 前端 15 — 站內通知

> 狀態：**已實作**（`features/notification`：頂列鈴鐺、Popover、列表頁 `/notification`、通知總覽 `/notification/all`、事件管理頁 `/notification/events`、偏好頁的通知分頁；`core/route-link` 的 route id 註冊表）。
> 後端（`notifications` 表、`NotificationService.notify()`、API、推播、保留清理）見 [`../backend/15-notification.md`](../backend/15-notification.md)；
> 決策見 [`backend/15-notification.md`](../backend/15-notification.md) §12.2 D3、D8、D12。

## 1. 組成

```
core/route-link/                        route id → route 的註冊表（不認識任何 feature）
├── registry.ts                         registerRouteLink()、resolveRouteLink()
├── hooks.ts                            useRouteLinkResolver()：訂閱註冊表
└── RouteLink.tsx                       <RouteLink to="<route id>">：前端跨 feature 的連結，解析不出來就只顯示文字

features/approval/routeLinks.ts         登記 approval.detail
features/file/routeLinks.ts             登記 file.folder（可啟用的 feature：沒啟用就沒有登記）
features/account/routeLinks.ts          登記 account.profile
features/user/routeLinks.ts             登記 user.detail（目前只給前端跨 feature 連結用）
features/group/routeLinks.ts            登記 group.detail（同上）

features/notification/                  只讀註冊表，不 import 其他 feature
├── plugin.ts                           頁面權限 ＋ registerHeaderTool('notification')（同步階段）
├── permission.ts                       NOTIFICATION_PAGE（只需要登入）、NOTIFICATION_OVERVIEW_PAGE（notification:read）、NOTIFICATION_EVENT_PAGE（system:read）
├── constants.ts                        句子的 i18n key 對照表、審批類型的名稱
├── adapter.ts                          DTO → NotificationVM（句子、補充、連結）、translateMessage()
├── hooks/
│   ├── useNotificationUnreadCount.ts   未讀數（推播不可用時每分鐘重抓）
│   ├── useNotificationList.ts          keyset 無限捲動 ＋ 解析連結
│   ├── useNotificationMutations.ts     標為已讀、全部已讀
│   ├── useOpenNotification.ts          點一則：未讀的標為已讀
│   ├── useNotificationEventPermission.ts  事件管理頁的權限 facade
│   ├── useNotificationEventDraft.ts    事件管理頁的草稿（只記和伺服器不同的開關）
│   ├── useUpdateNotificationEventsMutation.ts
│   ├── useUpdateNotificationPreferencesMutation.ts
│   └── useNotificationLocale.ts        鈴鐺自己載入語系包
├── components/
│   ├── NotificationBell.tsx            頂列工具：徽章 ＋ Popover
│   ├── NotificationList.tsx            VirtualList（鈴鐺與列表頁共用）
│   ├── NotificationPreferenceSection.tsx  偏好頁的通知分頁（§10）
│   └── NotificationItem.tsx            一則通知
├── pages/NotificationList/             列表頁：全部／未讀、全部已讀
├── pages/NotificationOverview/         通知總覽（§4.1）
└── pages/NotificationEventList/        事件管理頁（§9）

apis/notification/
├── get-notification-list/              GET /notifications（infinite query）
├── get-notification-unread-count/      GET /notifications/unread-count
├── get-notification-overview/          GET /notifications/all（infinite query）
├── mark-notification-read/             POST /notifications/:id/read
├── mark-all-notifications-read/        POST /notifications/read-all
├── get-notification-event-list/        GET /notification-events
├── update-notification-events/         PATCH /notification-events
├── get-notification-preference-list/   GET /me/notification-preferences
└── update-notification-preferences/    PATCH /me/notification-preferences
```

拿掉 `main.tsx` 的 `.use(notificationFeaturePlugin())`，鈴鐺、列表頁與偏好頁的「頂列工具」那一列一起消失；
各 feature 登記的 route id 仍在，只是沒有人讀。

## 2. 頂列鈴鐺

`registerHeaderTool({ key: 'notification', order: 400, icon: 'bell', labelI18nKey: 'notification.label' })`：
排在內建工具（批次佇列 100 … 主題 300）之後、最靠近帳號選單；使用者可以在偏好頁隱藏或排序（[`02-plugin-system.md`](./02-plugin-system.md) §4.4）。

| 項目 | 規則 |
| --- | --- |
| 徽章 | 未讀數（`GET /notifications/unread-count`）；0 不顯示，超過 99 顯示 `99+`。數量含在按鈕的 `aria-label`（`notification.triggerUnread`），徽章本身 `aria-hidden` |
| 未讀數的來源 | 只有 query，不存 localStorage（[`09-state-and-storage.md`](./09-state-and-storage.md) §4.2）。沒有 session 時不查詢；推播斷線或沒有推播（mock）時每 60 秒重抓 |
| Popover | 標題、「全部已讀」（沒有未讀時停用）、最近的通知（`NotificationList`，`filter: all`）、「查看全部」連到列表頁。**打開時才抓列表**（`enabled: open`） |
| 點一則 | 未讀的呼叫 `POST /notifications/:id/read`（不等回應；失敗只提示），連結由 `<Link>` 換頁，並關閉 Popover |
| 語系 | 鈴鐺在每一頁都看得到，不經過本 feature 的 route loader：按鈕的字（`notification.label`、`trigger`、`triggerUnread`）放 **全域** 語系包；Popover 的內容在 feature 的 scope，由 `useNotificationLocale()` 在鈴鐺掛上時載入 |

## 3. 連結：route id 註冊表（`core/route-link`）

後端存 `link = { route: '<route id>', params }`，不存路徑（[`backend/15-notification.md`](../backend/15-notification.md) §12.2 D3）。feature 在 plugin 的 **同步** 階段把自己的頁面登記成 route id；
讀的一方只查註冊表，不 import 其他 feature 的 route。

```ts
// features/approval/routeLinks.ts
registerRouteLink('approval.detail', {
  route: ApprovalDetailRoute,          // 只讀它的 path（routeBasePath），不 import 頁面元件
  params: { approvalId: 'approvalId' }, // route 的 $參數 ← link.params 的名稱
});
// features/file/routeLinks.ts
registerRouteLink('file.folder', { route: FileListRoute, search: { folder: 'folderId' } });
// features/account/routeLinks.ts
registerRouteLink('account.profile', { route: ProfileRoute });
```

| 規則 | 說明 |
| --- | --- |
| 登記時檢查 | id 格式與後端相同（`<feature>.<頁面>`，camelCase，可多層）；`params` 必須剛好對上 path 的 `$參數`；重複登記丟例外。都是程式錯誤，啟動就失敗 |
| 解析 | `resolveRouteLink(link)` → `{ to, params, search }`，直接交給 TanStack 的 `<Link>`。`params`、`search` 對照表裡的參數都是必要的 |
| 不可點 | 沒有連結、route id 沒有登記（所屬 feature 沒安裝、被停用或 id 被改名）、缺參數、參數不是非空字串 → `undefined`，只顯示文字 |
| 可撤回 | 註冊表以 `createRegistry` 建立：可啟用的 feature（例：檔案）卸載時撤回，連結跟著變成不可點；讀取端用 `useRouteLinkResolver()` 訂閱 |
| 權限 | 註冊表不管權限：點進去照常經過頁面權限與 API 權限（D5），沒權限就是 403 頁 |
| 改名 | 已發出的 id **不改名**（舊通知靠它）；頁面搬家時只改登記的 `route` |

目前的 route id 與後端的對照見 [`../backend/15-notification.md`](../backend/15-notification.md) §4.1。

## 4. 列表頁（`/notification`）

- 頁面權限 `NOTIFICATION_PAGE`：`access: []`（只需要登入，與個人資料頁相同）。不受權限管制，權限未水合時照常顯示，不會閃 403。
  側邊選單沒有項目，入口是鈴鐺的「查看全部」。
- 分頁「全部」／「未讀」寫進網址 `?filter=unread`（預設 `all` 不寫）；「全部已讀」按鈕同 Popover。
- 列表是 `VirtualList`（[`07-ui-system.md`](./07-ui-system.md) §3.10 的同一套虛擬捲動與無限捲動），keyset 游標接續下一頁；
  查詢失敗顯示 `QueryError`（不落到空狀態）。

### 4.1 通知總覽（`/notification/all`）

租戶內所有人的通知（[`backend/19-announcement.md`](../backend/19-announcement.md) §9.2 D1；後端見 [`../backend/15-notification.md`](../backend/15-notification.md) §6.1）。

| 項目 | 規則 |
| --- | --- |
| 權限 | 頁面鍵 `NOTIFICATION_OVERVIEW_PAGE`：`notification:read`。與 `/notification` 是父子路徑，頁面鍵取前綴最長的；沒有權限的人仍進得了自己的 `/notification` |
| 選單 | 側邊選單「系統管理 › 通知總覽」（`menu-notification-overview`），排在事件通知之前 |
| 表格 | `RichTable`：時間、收件人、事件（`NOTIFICATION_EVENT_LABEL` 的名稱；不認得的顯示 `type`）、內容（收件人看到的句子與補充，§5）、觸發者、已讀（時間，未讀顯示 Chip） |
| 篩選 | 事件、收件人（伺服器端搜尋使用者；網址帶進來的收件人另外取名稱）、未讀、日期區間（使用者當地的日曆日，換成偏好時區的日界線，同稽核日誌）；全部寫進網址 |
| 分頁 | keyset：表格下方「載入更多」（一次 50 筆），不顯示總數 |

## 5. 句子

依 `type` 找 i18n key，key 一律寫在 `constants.ts` 的對照表（[`../../conventions/06-literal-strings.md`](../../conventions/06-literal-strings.md) §3.1），
`adapter.ts` 把參數轉成 `TranslatableMessage`：

| `type` | 句子（`notification.message.*`） | 補充（第二行起） |
| --- | --- | --- |
| `approval.pending` | `approvalPending`：「{申請人} 送出了{審批類型}申請，等待審核」 | 摘要（`subject`，原樣顯示；空字串不顯示） |
| `approval.result` | `approvalApproved`／`approvalRejected`（依 `status`） | 摘要 |
| `user.rolesChanged` | `userRolesChanged` | 「新增：A、B」「移除：C」（`Intl.ListFormat` 依語系串起來；沒有的那一邊不顯示） |
| `announcement.published` | `announcementPublished`：「公告：{標題}」 | —（點開到全文頁，[`16-announcement.md`](./16-announcement.md)） |
| 其他（前端比後端舊） | `unknown`：「你有一則新通知」 | — |

- 參數缺少或型別不對（舊資料、後端改版）也退回 `unknown`，不讓畫面壞掉。
- 審批類型的名稱是 `APPROVAL_TYPE_LABEL_KEY`（`satisfies Record<ApprovalType, string>`：後端加類型而前端沒跟上時編譯失敗）；參數裡不認得的類型用通用的名稱。
- 每一則另外顯示觸發者（`actor.name`，null 是「系統」）與相對時間（`formatRelativeTime`，滑過顯示完整時間）。未讀的有圓點與粗體，並有 sr-only 的「未讀：」。

新增一種通知：`constants.ts` 加 key、`adapter.ts` 的 `describeNotification()` 加一個分支、兩個語系檔加句子、`adapter.test.ts` 加案例
（後端的步驟見 [`../backend/15-notification.md`](../backend/15-notification.md) §9）。

## 6. 快取與推播

| 來源變更 | 失效 |
| --- | --- |
| `notification` create（新通知，伺服器推給收件人） | `NOTIFICATION_LIST`、`NOTIFICATION_UNREAD_COUNT`、`NOTIFICATION_OVERVIEW` |
| `notification` update（標為已讀、全部已讀；本分頁的 mutation 也以它宣告） | 同上 |
| `notificationPolicy` update（事件管理頁的修改，推給 `system:read` 的人） | `NOTIFICATION_EVENT_LIST`、`NOTIFICATION_PREFERENCE_LIST`（能不能調整來自租戶的政策） |
| `notificationPreference` update（自己的通知設定，只推給本人） | `NOTIFICATION_PREFERENCE_LIST` |

- 兩個 query 都放在 `collection`：已讀一則也會讓「未讀」列表少一筆，逐筆改快取不如整個重抓（infinite query 只重抓已載入的頁數）。
- **稽核列表不跟著失效**：`AUDIT_LOG` 的 `derivesFromAnyChange` 改成 `{ except: [Resource.NOTIFICATION] }`（`core/cache/resourceGraph.ts` 新增的形式）。
  通知不寫稽核（D9），後端也不把 `notification` 推給 `auditLog:read`（[`../backend/08-realtime.md`](../backend/08-realtime.md) §6.1 的 `recordsAudit: false`）；
  不排除的話，有 `auditLog:read` 的人每收到一則自己的通知、每按一次已讀，都會重抓一次稽核列表。
- 其他資源的寫入不直接影響通知：通知由後端在業務交易提交後另外推給收件人（例：審核者核准後，申請人收到 `notification create`）。

## 7. Mock

`mocks/handlers/notification.ts`：自己的四個端點只需要登入（沒有 403 的情境），總覽要 `notification:read`（mock 只有自己這個收件人）；已讀會改變 mock 的狀態，重新整理後還原。
`mocks/resources/fixtures.ts` 的 `NOTIFICATION_FIXTURES` 有三種類型各一則，外加一則前端不認得的類型（示範通用文字與不可點）。

## 8. 測試

| 對象 | 檔案 |
| --- | --- |
| route id 註冊表：path／search 參數、沒有參數、不可點的各種情況、重複與格式錯誤、params 對不上 path、卸載撤回 | `core/route-link/__tests__/registry.test.ts` |
| 可啟用的檔案 feature 安裝後登記 `file.folder`、卸載後撤回 | `app/__tests__/features.test.ts` |
| 句子：三種類型、審批類型不認得、空摘要、參數不合預期與不認得的類型退回通用文字、清單依語系 | `features/notification/__tests__/adapter.test.ts` |
| hook：未讀數（沒有 session 不查）、列表（連結解析、篩選、游標、`enabled`、執行期登記後變可點）、已讀與全部已讀宣告的變更 | `features/notification/hooks/__tests__/*.test.tsx` |
| 鈴鐺：徽章與可存取名稱、打開前不抓、`99+`、句子與不可點、點了標為已讀並換頁、全部已讀、查看全部、空狀態 | `features/notification/components/__tests__/NotificationBell.test.tsx` |
| 列表頁：只需要登入的三個權限案例（沒有權限、有其他權限、未水合）、未讀分頁寫進網址、全部已讀、查詢失敗 | `features/notification/pages/NotificationList/__tests__/NotificationListPage.test.tsx` |
| 依賴圖：`notification` 的 create／update 只失效通知、不碰稽核；其他寫入不影響通知；`except` 的引擎行為 | `apis/__tests__/resources.test.ts`、`core/cache/__tests__/resourceGraph.test.ts` |
| 通知總覽：三個權限案例（有 `notification:read`、沒有但仍進得了 `/notification`、未水合）、每一列的欄位與不認得的事件、網址的篩選帶進查詢、載入更多以游標接續；adapter | `features/notification/pages/NotificationOverview/__tests__/*` |
| 頁面註冊表的鍵集合含 `NOTIFICATION_PAGE`、`NOTIFICATION_OVERVIEW_PAGE`、`NOTIFICATION_EVENT_PAGE` | `core/permission/__tests__/feature-registration.test.ts` |
| 相對時間 | `shared/date/__tests__/date.test.ts` |
| E2E：註冊申請 → 審核者的鈴鐺（推播）→ 點開到審批詳情、標為已讀；角色被改 → 本人收到通知（專用帳號 `e2e-notifyme`，未讀數精確斷言）→ 到個人資料頁、全部已讀、列表頁的未讀分頁 | `apps/e2e/tests/notification.spec.ts` |
| 事件管理頁：分組與不認得的事件、草稿（切回伺服器的值移除、有覆寫而切回預設送 `null`、恢復預設、允許個人關閉與開關記在同一筆）、頁面（只送改過的、允許個人關閉、恢復預設、`mandatory` 停用、三個權限案例） | `features/notification/pages/NotificationEventList/__tests__/*`、`features/notification/hooks/__tests__/useNotificationEventDraft.test.ts` |
| 偏好頁的通知分頁：切換即儲存只送一筆、鎖住的管道停用並顯示原因 | `features/notification/components/__tests__/NotificationPreferenceSection.test.tsx` |

## 9. 事件管理頁（`/notification/events`）

租戶層決定每個事件經由哪些管道送出（[`backend/16-notification-event.md`](../backend/16-notification-event.md) §9.2 D12、D13；後端見
[`../backend/16-notification-event.md`](../backend/16-notification-event.md)）。

| 項目 | 規則 |
| --- | --- |
| 權限 | 頁面鍵 `NOTIFICATION_EVENT_PAGE`：`system:read` 檢視、`system:update`（`canUpdate`）切換與恢復預設；沒有 `system:update` 或權限未水合時整頁唯讀。與 `/notification` 是父子路徑，頁面鍵取前綴最長的 |
| 選單 | 側邊選單「系統管理 › 事件通知」（`menu-notification-event`），排在系統設定之後 |
| 版面 | 依後端的 `category` 分組（後端目錄的順序）；一列一個事件：名稱、說明、收件人，右側每個管道一個開關、預設值、「已修改」與「恢復預設」，以及「允許個人關閉」的勾選（管道關閉時停用；`mandatory` 沒有） |
| `mandatory` | 開關停用並顯示鎖頭與「安全相關，不能關閉」 |
| 送出 | 一整頁一份草稿，只送改過的「事件 ＋ 管道」與改過的欄位（`enabled`、`allowUserOverride`）；有覆寫而切回預設值時送 `enabled: null`（不留一筆與預設相同的覆寫）。成功後以 `notificationPolicy update` 宣告變更 |
| 文字 | 名稱、說明、收件人在 `constants.ts` 的 `NOTIFICATION_EVENT_LABEL`（key 是後端的 `type`），分類在 `NOTIFICATION_EVENT_CATEGORY_LABEL_KEY`，管道在 `NOTIFICATION_CHANNEL_LABEL_KEY`（`satisfies Record<NotificationChannel, string>`）。後端新增了前端不認得的事件或分類時以原字串顯示，開關照常可用 |

## 10. 偏好頁的通知分頁

使用者在租戶允許的範圍內決定自己要收哪些通知（[`backend/16-notification-event.md`](../backend/16-notification-event.md) §9.2 D14、D15；後端見
[`../backend/16-notification-event.md`](../backend/16-notification-event.md) §5）。

| 項目 | 規則 |
| --- | --- |
| 位置 | `features/notification` 在 plugin 的同步階段以 `registerPreferenceSection({ key: 'notification', order: 100, … })` 插進偏好頁（[`02-plugin-system.md`](./02-plugin-system.md) §4.3），排在表格欄位設定（200）之前；偏好頁不認識通知 |
| 權限 | 只需要登入（`GET`／`PATCH /me/notification-preferences` 是 `@Authenticated()`），沒有權限 gating |
| 版面 | 一列一個事件（名稱、說明，與事件管理頁共用 `NOTIFICATION_EVENT_LABEL`），每個管道一個開關 |
| 鎖住 | `lock` 不是 `null` 時開關停用並顯示原因（`NOTIFICATION_PREFERENCE_LOCK_LABEL_KEY`：安全相關／管理者已關閉／管理者要求接收） |
| 儲存 | 切換即儲存（與偏好頁其他欄位相同），一次送一筆；成功後以 `notificationPreference update` 宣告變更並 toast |

