# 站內通知中心

- 優先度：P1
- 狀態：提案
- 依賴：—
- 相關：郵件（[`backend/11-mail.md`](../architecture/backend/11-mail.md)）、[`tags-comments.md`](./tags-comments.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

即時推播（[`backend/08-realtime.md`](../architecture/backend/08-realtime.md)）目前只用來讓快取失效，
推播是「看到就過去了」：使用者不在線上就收不到，也沒有已讀／未讀。
前端 `core/notify` 只有 toast。審批送出、被指派角色、檔案被分享這些事件，都需要一個能回頭看的收件匣。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| `notifications` 表：收件人、類型、參數、已讀時間 | 使用者自訂每種通知走哪些管道（先全部站內） |
| App Shell 的鈴鐺、未讀數、通知列表、全部已讀 | 推送到手機 |
| 模組訂閱 `DomainEventBus` 產生通知 | |
| 新通知經 realtime 推到線上的使用者 | |

## 初步構想

- 通知內容存「類型 ＋ 參數」，文字由前端依語系組（沿用 i18n key 必須是字面量的規則）
- 產生通知的邏輯放在各模組（`modules/<name>/<name>.notifications.ts`），`modules/notification` 只負責儲存與查詢
- 權限：看自己的通知用 `@Authenticated()`，不需要權限鍵
- 保留期限：已讀 N 天後刪除（排程工作，[`backend/10-jobs.md`](../architecture/backend/10-jobs.md)）

## 開放問題

1. 通知的連結怎麼表示？存 route id ＋ 參數，讓前端透過 `routes/external.ts` 解析？
2. 通知偏好（哪些類型要寄信）要放在 `core/preference` 嗎？

## 歸檔去向

- `docs/architecture/backend/NN-notification.md`、`frontend/NN-notification.md`
