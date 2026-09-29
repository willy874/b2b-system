# 郵件寄送

- 優先度：P1
- 狀態：提案
- 依賴：[`job-queue.md`](./job-queue.md)（寄送失敗要重試）
- 相關：[`notification-center.md`](./notification-center.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

啟用與重設密碼的連結目前寫進伺服器日誌，由維運人員轉交
（`apps/api/src/modules/auth/auth-token.service.ts` 的 `issue()`）。
審批也寫明「通知申請人審核結果」因為沒有郵件基礎設施而不做（[`rbac/06-approval.md`](../rbac/06-approval.md) §1）。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| `core/mail`：寄送介面，SMTP 與 console（開發用）兩種實作 | 行銷信、退訂管理 |
| 範本：依使用者語系選 zh-TW / en-US | 所見即所得的範本編輯器 |
| 啟用信、重設密碼信、審批結果通知 | 追蹤開信率 |
| 開發環境用 Mailpit 之類的本機收信工具 | |

## 初步構想

- 介面與 `core/storage` 同構：`MailTransport` 抽象，env 決定用哪個實作
- 寄信一律入列（[`job-queue.md`](./job-queue.md)），不在 HTTP 請求內同步寄
- 範本放在後端（React Email 或 MJML），連結的 base URL 從 env 取
- 寄出的內容不寫進稽核（含 token）；只記「寄了哪一種信給誰」

## 開放問題

1. 範本技術：React Email（能共用前端的 TS 型別）或 MJML？
2. 日誌裡的 token 在正式環境要不要完全移除，只保留在開發模式？

## 歸檔去向

- `docs/architecture/backend/NN-mail.md`；更新 `04-auth.md` §5、`rbac/06-approval.md` §1
