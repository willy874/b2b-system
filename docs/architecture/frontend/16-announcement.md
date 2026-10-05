# 前端 16 — 公告

> 狀態：**已實作 A2～A4**（`features/announcement`：列表、建立、詳情與發送紀錄、收件人看全文、回收桶分頁）。
> 後端見 [`../backend/19-announcement.md`](../backend/19-announcement.md)；決策見 [`backend/19-announcement.md`](../backend/19-announcement.md) §9。
> 通知總覽（`/notification/all`）屬於 `features/notification`，見 [`15-notification.md`](./15-notification.md) §4.1。

## 1. 組成

```
features/announcement/                 可啟用的 feature（`announcement`，app/features.ts 安裝）
├── plugin.ts                          頁面權限、route id `announcement.message`、回收桶「公告」分頁（同步階段）
├── permission.ts                      ANNOUNCEMENT_PAGE、ANNOUNCEMENT_CREATE_PAGE、ANNOUNCEMENT_MESSAGE_PAGE
├── routes/pages.ts                    /announcement（create、$announcementId 子路由）、/announcement/message/$dispatchId
├── constants.ts                       狀態、發送狀態、觸發方式的 i18n key 與 Chip 色調
├── hooks/
│   ├── useAnnouncementPermission.ts   canCreate／canUpdate／canDelete ＋ canPublish
│   └── useAnnouncementMutations.ts    建立、修改、送出、暫停、恢復、刪除（含復原）、還原、撤回
├── components/
│   ├── AnnouncementForm.tsx           標題、內文、受眾、發送時間（建立與編輯共用）
│   ├── AudiencePicker.tsx             「全部」開關、使用者（伺服器端搜尋）／群組／角色多選、預覽人數
│   ├── TriggerField.tsx               立即／指定時間（偏好時區的日期 ＋ 時間）／週期（租戶時區；接下來 5 次的預覽）／事件點（觸發點 ＋ 延遲）
│   ├── triggerSummary.ts              觸發方式的一行摘要（列表、詳情、送出的確認）
│   ├── draft.ts                       表單草稿 ⇄ API
│   └── AnnouncementRestoreAction.tsx  回收桶的還原按鈕
└── pages/
    ├── AnnouncementList/              表格：標題、狀態、發送時間、最近一次已讀率、更新時間；關鍵字與狀態篩選
    ├── AnnouncementCreate/            對話框：存成草稿後開啟詳情
    ├── AnnouncementDetail/            對話框：內容與操作（AnnouncementSettingsSection）、發送紀錄（AnnouncementDispatchSection）
    └── AnnouncementMessage/           收件人看全文

apis/announcement/                     每個端點一個資料夾；受眾預覽是 POST 但當 query 用
shared/date                            zonedDateTime()、toZonedParts()：偏好時區的日期與時間 ⇄ ISO
```

## 2. 權限

| 頁面 | 頁面鍵 | 需要 |
| --- | --- | --- |
| `/announcement`（含詳情） | `ANNOUNCEMENT_PAGE` | `announcement:read` |
| `/announcement/create` | `ANNOUNCEMENT_CREATE_PAGE` | `announcement:read` ＋ `announcement:create` |
| `/announcement/message/$dispatchId` | `ANNOUNCEMENT_MESSAGE_PAGE` | 無（只看得到自己收到的） |

- 全文頁登記到靜態前綴 `/announcement/message`：前綴比對不認得 `$dispatchId` 這種參數段。
- 詳情的按鈕：草稿 → 編輯（`update`）、送出（`publish`）；排程中 → 暫停（`publish`），編輯要 `update` ＋ `publish`；
  暫停中 → 恢復；已完成 → 不能編輯；刪除要 `delete`；發送紀錄的撤回要 `publish`。未水合時都不顯示。

## 3. 表單

- 建立只存成草稿：送出在詳情頁做，確認框說明立即或排定的時間（`publish` 獨立於 `create`，D15）。
- 受眾的人數預覽隨選擇即時重抓（key 是排序過的 id 串）；已選但不在搜尋結果裡的使用者另外取名稱，標籤才顯示得出來。
- 指定時間以使用者偏好的時區輸入並標示時區；送出前換成 ISO。已送出的公告不能改成「立即」。
- 週期：每 N 天／週／月、時間、星期幾（週）、每月哪一天（1～28 或最後一天）、開始與結束日期、最多次數。日期與時間是 **租戶時區**
  的日曆，原樣送出；下方顯示伺服器算的「接下來 5 次」與它用的時區（`POST /announcements/recurrence-preview`，前端不自己算）。
- 事件點：從 `GET /announcements/trigger-events` 選觸發點（名稱與說明在 `ANNOUNCEMENT_EVENT_LABEL`；不認得的以 `event` 原樣顯示），
  延遲以分鐘、小時、天輸入（存成分鐘，最多 30 天）；帶回表單時換成最大的整除單位。說明每個人只會收到一次。
- 摘要的句子依頻率與「間隔是不是 1」挑 key（`RECURRENCE_SUMMARY_KEY`），不用 i18next 的複數：中文只有 `other`，「每天」會變成「每 1 天」。
- 版本衝突：`VersionConflictAlert` 提供重新載入，輸入保留。

## 4. 快取與推播

| 來源變更 | 失效 |
| --- | --- |
| `announcement` create／update／delete（自己的操作，或伺服器推給 `announcement:read` 的人；背景發送的狀態也以 update 推） | `ANNOUNCEMENT_LIST`；詳情與該公告的發送紀錄 |
| `announcement` create／delete | 回收桶列表 |

全文頁載入後以 `notification update` 宣告：後端讀全文時已把那則通知標為已讀，這個分頁的通知列表與未讀數跟著更新。

## 5. 測試

| 對象 | 檔案 |
| --- | --- |
| 權限 facade（auditor、能寫不能發、publish、沒有 read） | `hooks/__tests__/useAnnouncementPermission.test.tsx` |
| 草稿 ⇄ API（空白、缺日期、時區換算、週期的欄位、事件點的延遲換算） | `components/__tests__/draft.test.ts` |
| 觸發方式的摘要（立即、每天、每 2 週的星期幾、每月最後一天、事件點的立即與延遲） | `components/__tests__/triggerSummary.test.ts` |
| 列表：三個權限案例、已讀率、全文頁不受權限管制 | `pages/AnnouncementList/__tests__/*` |
| 建立：預覽人數、存成草稿後開啟詳情 | `pages/AnnouncementCreate/__tests__/*` |
| 詳情：各狀態與權限的按鈕、送出與暫停帶 version、撤回、未水合 | `pages/AnnouncementDetail/__tests__/*` |
| 全文：沒有權限也看得到、保留換行、404 沒有重試 | `pages/AnnouncementMessage/__tests__/*` |
| 安裝後登記 route id 與回收桶分頁、卸載後撤回 | `app/__tests__/features.test.ts` |
| 偏好時區的日期與時間（含夏令時間） | `packages/web-shared/src/date/__tests__/date.test.ts` |
