# ADR-0017 — 郵件寄送：SMTP（nodemailer）＋ React Email 範本，開發用 Mailpit

- 狀態：**採用**
- 日期：2026-09-29
- 相關：[`../architecture/backend/11-mail.md`](../architecture/backend/11-mail.md)、[ADR-0016](./0016-background-jobs.md)、
  [`../architecture/backend/04-auth.md`](../architecture/backend/04-auth.md) §5、[`../rbac/06-approval.md`](../rbac/06-approval.md) §1

## 背景

啟用與重設密碼的連結目前寫進伺服器日誌，由維運人員轉交（`auth-token.service.ts` 的 `issue()`）；
審批結果也因為沒有郵件而不通知申請人。部署是 docker compose 自架，物件儲存採「S3 相容、換服務只改 env」。

## 決定

### 寄送方式

| 方案 | 結論 |
| --- | --- |
| **A. SMTP（nodemailer）** | **採用** |
| B. 服務商的 HTTP API／SDK（SES、Postmark、Resend） | 不採用：綁定單一服務商；它們多出來的退信 webhook、開信追蹤都在「不做」範圍 |
| C. 自架 MTA（Postfix） | 不採用：IP 信譽、送達率、反垃圾信設定都要自己顧 |

### 範本

| 方案 | 結論 |
| --- | --- |
| **A. React Email** | **採用** |
| B. MJML | 不採用：響應式排版成熟，但第一版只有三封信用不到；props 沒有型別檢查 |
| C. 手寫 HTML ＋ 字串替換 | 不採用：各家信箱的 CSS 相容性要自己處理 |

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | `core/mail` 定義 `MailTransport`，env `MAIL_TRANSPORT` 選 `smtp` 或 `console` | 與 `core/storage` 同構；換服務商只改 env |
| D2 | 正式環境：在 AWS 用 SES，否則 Postmark／Resend，一律經 SMTP | 交易信需要好的送達率；都支援 SMTP，不影響 D1 |
| D3 | 寄件網域設好 SPF、DKIM、DMARC，寫進部署文件 | 否則信會進垃圾信匣 |
| D4 | 寄信一律經 [ADR-0016](./0016-background-jobs.md) 的佇列，入列在業務交易內 | 寄送失敗要重試；HTTP 請求不等 SMTP |
| D5 | 範本用 React Email，放在後端；api 加 `react` 並開啟 JSX（swc） | 範本 props（連結、名稱、審批結果）有型別檢查；有本機預覽 |
| D6 | 語系依收件人偏好選 zh-TW／en-US，字串放後端自己的語系檔 | 前端語系包隨 feature 載入，後端不該依賴它 |
| D7 | 只有 `MAIL_TRANSPORT=console` 時把連結印到日誌；`smtp` 時完全不記 | 正式環境日誌不該出現能拿來登入的 token |
| D8 | 稽核只記「寄了哪種信給誰」與 job id，不記內文與 token | 稽核不可變，不能留下可用的憑證 |
| D9 | 開發環境在 compose 加 Mailpit（SMTP `:1025`、網頁 `:8025`），本機走 `smtp` | 開發時看得到真正的信；與正式環境走同一條程式路徑 |
| D10 | E2E 經 Mailpit 的 API 取出啟用／重設連結 | 測到「從信箱點連結」的完整流程，不再依賴伺服器日誌 |
| D11 | `console` 只給單元與整合測試用 | 不必起 SMTP 伺服器 |

## 實作時的調整

| 項目 | 提案 | 實作 | 原因 |
| --- | --- | --- | --- |
| token 何時簽發 | 未定（mailer 提案的開放問題） | 寄信的工作在 **寄出當下** 簽發；工作資料只有 `userId` | 資料庫只存雜湊；入列時簽發就得把原文放進工作資料，而 `job:read` 看得到工作資料。重試會簽新的、舊的作廢 |
| 範本位置 | `core/mail/templates/` | `modules/<name>/mails/*.mail.tsx`；`core/mail` 只有外框與傳輸層 | 範本含業務名詞，`core/` 不認識 `modules/` |
| 語系檔 | 後端語系檔 | 文案依語系寫在範本檔內（`satisfies Record<MailLocale, …>`） | 每封信的文案只有幾句；放在一起改範本時不會漏改 |
| D7 的範圍 | 只管寄信本身 | 另外遮蔽 HTTP 請求日誌裡的 `token`（網址、`query`、`Referer`）與回應的 `set-cookie` | 實作時發現 pino-http 會記下 `/auth/setup/verify?token=…` 與 refresh cookie；不遮的話 D7 不成立 |
| `MAIL_TRANSPORT` 預設值 | 本機走 `smtp` | 預設 `console`；`.env.example` 設 `smtp`，`docker-compose.prod.yml` 寫死 `smtp` | 測試與 CI 沒有 SMTP，預設 `smtp` 會讓工作一直重試 |
| 忘記密碼的節流 | — | 同帳號 60 秒內只入列一封 | 避免重複按洗信箱；順帶修正 `JobQueue` 的節流選項（單獨的 `singletonKey` 在 pg-boss 的 standard 佇列不起作用） |

## 取捨

| 代價 | 評估 |
| --- | --- |
| SMTP 拿不到服務商的即時回應細節（退信原因、訊息 id 格式不一） | 第一版不追蹤退信；需要時再加服務商專屬的 transport |
| api 多了 `react` 相依與 JSX 設定 | 只在 `*.mail.tsx` 使用；不影響其他模組 |
| compose 多一個 Mailpit 服務 | 只在開發與 E2E；正式環境不部署 |
