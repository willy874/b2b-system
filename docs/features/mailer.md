# 郵件寄送

- 優先度：P1
- 狀態：規劃中
- 依賴：背景工作（已完成，[`backend/10-jobs.md`](../architecture/backend/10-jobs.md)；寄送失敗要重試）
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

- 介面與 `core/storage` 同構：`MailTransport` 抽象，env（`MAIL_TRANSPORT`）決定用哪個實作
  - `smtp`：nodemailer。正式環境與本機開發都走這個
  - `console`：只寫日誌，給單元與整合測試用
- 對外只講 SMTP，不綁服務商的 HTTP SDK——與物件儲存「S3 相容、換服務只改 env」同一個思路。
  SES、Postmark、Resend、Mailgun、自架 relay 都提供 SMTP；部署在 AWS 用 SES，否則 Postmark／Resend。
  服務商的退信 webhook、開信追蹤屬於「不做」，用不到它們的 SDK
- 寄件網域要設好 SPF、DKIM、DMARC（部署文件要寫）
- 寄信一律入列（[`backend/10-jobs.md`](../architecture/backend/10-jobs.md)），入列在業務交易 **內**，不在 HTTP 請求內同步寄
- 工作資料不放 token 與信件內容（`job:read` 看得到 `data`，10-jobs §4）：只放範本種類與 id，
  handler 執行時再產生連結。token 只存雜湊時，要改成入列當下產生、由 handler 以一次性方式取得，實作時決定
- 選型見 [ADR-0017](../adr/0017-mail-delivery.md)
- 範本放在後端（React Email，見開放問題 1），連結的 base URL 從 env 取；
  語系依收件人偏好選 zh-TW／en-US，字串放後端自己的語系檔，不共用前端的 locale 檔
- 寄出的內容不寫進稽核（含 token）；只記「寄了哪一種信給誰」與 job id
- 開發環境：`pnpm dev` 的 compose 加 **Mailpit**（SMTP `:1025`、網頁 `:8025`），本機用 `smtp` 寄給它。
  E2E 透過 Mailpit 的 API 取出啟用／重設連結，走完「從信箱點連結」的完整流程，不再翻伺服器日誌
- 改動的既有模組：`auth-token.service.ts` 的 `issue()` 從「寫日誌」改成「入列寄信」；審批結果通知（`rbac/06-approval.md` §1）

## 開放問題

1. 範本技術：React Email（能共用前端的 TS 型別）或 MJML？

   **結論**：React Email。整個 monorepo 都是 TS，範本 props（連結、使用者名稱、審批結果）有型別檢查；
   附本機預覽伺服器。代價是 api 要加 `react` 並開啟 JSX（swc 支援，要調 `tsconfig`）。
   第一版只有三封信，MJML 的響應式排版優勢用不太到。

2. 日誌裡的 token 在正式環境要不要完全移除，只保留在開發模式？

   **結論**：只有 `MAIL_TRANSPORT=console` 時才把連結印到日誌；`smtp` 時完全不記。
   正式環境日誌不該出現能拿來登入的 token。

3. 寄送走 SMTP 還是服務商的 HTTP API？（新增）

   **結論**：SMTP（nodemailer），理由見「初步構想」。

## 歸檔去向

- `docs/architecture/backend/NN-mail.md`；更新 `04-auth.md` §5、`rbac/06-approval.md` §1
