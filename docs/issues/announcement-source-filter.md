# 通知總覽：決策 D1 的 `sourceId` 篩選沒有實作，詳細規格也沒寫

## 現況

- [`backend/19-announcement.md`](../architecture/backend/19-announcement.md) §9.2 D1（273 行）：`GET /notifications/all` 可篩選
  `type`、`recipientId`、`actorId`、**`sourceId`**、時間、`unread`。
- 同一個端點的詳細規格 [`backend/15-notification.md`](../architecture/backend/15-notification.md) §6.1（248 行）只列
  `type`、`recipientId`、`actorId`、`unread`、`from`／`to`，沒有 `sourceId`，也沒有說明拿掉的理由（19 的 §9.5 A1 實作紀錄同樣沒提）。
- 實作跟著 15 §6.1：`apps/api/src/modules/notification/dto/notification.dto.ts` 74–85 行的 `ListAllNotificationSchema`
  有 `type`、`recipientId`、`actorId`、`from`、`to`（`unread` 來自 `ListNotificationSchema`），沒有 `sourceId`。
- 前端 `apps/backstage/src/features/notification/pages/NotificationOverview/useNotificationOverviewFilters.tsx` 只有事件、收件人、
  未讀、日期區間；後端支援的 `actorId` 沒有接。這與 [`frontend/15-notification.md`](../architecture/frontend/15-notification.md) §4.1
  的「篩選」一列一致，不算偏離，但「觸發者」欄位已經顯示在表格上，卻不能依它篩選。
- 公告的發送紀錄（`features/announcement/pages/AnnouncementDetail/components/AnnouncementDispatchSection.tsx` 84–95 行）只顯示
  「已讀 x／y」，沒有辦法看「這次發送送給了誰、誰還沒讀」——這正是 `sourceId` 篩選要回答的問題（D1 的理由：「到底有沒有送到」）。

另外確認過發送紀錄的撤回：前端只對 `revoked` 隱藏按鈕（`AnnouncementDispatchSection.tsx` 107–108 行），`pending`、`sending`、`failed`
也能撤回。這與規格一致——19 §3 的撤回只對已撤回回 `409 ANNOUNCEMENT_DISPATCH_NOT_REVOCABLE`，分批寫入與撤回以發送紀錄的列鎖互斥
（`announcement-dispatch.service.ts` 316–319 行、`finish()` 不覆蓋 `revoked`），撤回尚未發完的等於取消。**不是問題，不另外記。**

## 影響

- 兩份規格對同一個端點的篩選說法不一，讀 D1 的人會以為可以依發送紀錄查通知。
- 管理者無法從一次公告發送追到收件人與已讀狀態，只能看總數。

嚴重度低：規格之間的不一致與少一個篩選；現有功能的結果都正確。

## 修正方式

擇一：

1. **補上**（建議）：`ListAllNotificationSchema` 加 `sourceId: z.string().uuid().optional()`，repository 加條件
   （`(source_id, recipient_id)` 的部分唯一索引已可使用）；15 §6.1 的篩選補上。前端通知總覽接受網址的 `sourceId`
   （不必放進篩選面板），發送紀錄的「已讀 x／y」連到 `/notification/all?sourceId=<dispatchId>`（要有 `notification:read` 才顯示連結）。
   順手把 `actorId` 接進篩選面板（伺服器端搜尋使用者，同收件人），並更新 frontend/15 §4.1。
2. **不做**：把 19 §9.2 D1 的 `sourceId` 刪掉或註明「實作時未做」，讓兩份規格一致。

## 驗證方式

- 選 1：api 整合測試 `GET /notifications/all?sourceId=<dispatchId>` 只回該次發送的通知；非 uuid 回 400。
  前端通知總覽的測試：網址帶 `sourceId` 時查詢帶上它；發送紀錄的連結只在有 `notification:read` 時出現。
- 選 2：19 D1 與 15 §6.1 的篩選清單相同。

（2026-10-10 backstage 各功能的優化分析發現。）
