# Webhook

- 優先度：P2
- 狀態：提案
- 依賴：[`job-queue.md`](./job-queue.md)（投遞與重試）
- 相關：[`api-tokens.md`](./api-tokens.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

`DomainEventBus` 已經在程序內發佈領域事件（推播就是訂閱者之一），
但外部系統（Slack、CI、遊戲伺服器）沒辦法得知「內容被發佈了」「使用者被停用了」。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 訂閱設定：URL、要收的事件類型、啟用／停用 | 事件內容的轉換範本 |
| HMAC 簽章、時間戳防重放 | 對外事件的長期保存與重播 |
| 失敗重試（指數退避）、連續失敗自動停用 | |
| 投遞紀錄頁：狀態碼、耗時、手動重送 | |

## 初步構想

- 對外事件的格式與內部領域事件 **分開定義**：內部事件可以改，對外格式要有版本
- 只送識別資訊與必要欄位，敏感欄位不出去；接收端需要細節時用 API token 回查
- 投遞時的網路請求要擋內網位址（SSRF）
- 權限：`webhook:read`、`webhook:create`、`webhook:update`、`webhook:delete`

## 開放問題

1. 哪些事件要對外公開？先列出第一批
2. 訂閱要不要受權限過濾（例如訂閱者自己看不到的資源，不送）？

## 歸檔去向

- `docs/architecture/backend/NN-webhook.md`、`rbac/02-permission-catalog.md`
