# 11 — 郵件

啟用信、重設密碼信、審核結果通知。選型理由見 §9：
經 SMTP（nodemailer）寄出、範本用 React Email、一律經背景工作（[`10-jobs.md`](./10-jobs.md)）寄送。

---

## 1. 組成

```
core/mail/
├── mail-transport.ts        ★ MailTransport 抽象類別（同時是 DI token）
├── smtp-mail-transport.ts   實作：nodemailer，連到 MAIL_SMTP_URL
├── console-mail-transport.ts 實作：只寫日誌（含連結），測試與開發用
├── mail.service.ts          MailService：link()、send()（範本 → HTML ＋ 純文字 → 傳輸層）
├── mail-layout.tsx          所有信共用的外框
├── mail-locale.ts           信件語系、共用頁尾
└── mail.module.ts           @Global；依 MAIL_TRANSPORT 選實作

modules/credential/
├── auth-mail.constants.ts   工作：auth.activationMail、auth.passwordResetMail
├── auth-mail.jobs.ts        寄出（簽發 token → 產生信 → 寄 → 稽核）
└── mails/account-link.mail.tsx

modules/approval/
├── approval-mail.constants.ts  工作：approval.resultMail
├── approval-result-mail.job.ts
└── mails/approval-result.mail.tsx
```

- `core/mail` 不認識任何一封信；範本屬於擁有它的模組（`modules/<name>/mails/*.mail.tsx`），
  和業務一起演進。新增一封信 = 新增範本 ＋ 在該模組宣告並註冊一種工作。
- `api` 開啟 JSX（`tsconfig.json` 的 `"jsx": "react-jsx"`、`.swcrc` 的 automatic runtime），只有 `*.mail.tsx` 使用。
- 元件與 `render()` 一律從 `@b2b-system/mail-components`（`packages/mail-components`）匯入。它轉出 `react-email` 的元件，
  在建置時以 esbuild 打包成單一檔案（`dist/index.cjs`）：React Email 6 起把元件、轉換工具與預覽伺服器、CLI 併進同一個套件，
  直接依賴它會把 esbuild、babel、chokidar、prompts… 一起帶進正式映像；`@react-email/components` 與各別的 `@react-email/<元件>`
  已停止維護，不能拿來替代。`react-email` 只是那個 package 的 devDependency。
- 範本要用新的元件時加進 `packages/mail-components/src/index.ts`，再 `pnpm build:packages`。
- `react`、`react-dom` 由 api 提供（打包時排除）：`react-dom` 是 `render()` 在執行期載入的 `react-dom/server`，雖然沒有直接 import 也要保留。

## 2. 傳輸層

| `MAIL_TRANSPORT` | 行為 | 用在 |
| --- | --- | --- |
| `smtp` | nodemailer 連到 `MAIL_SMTP_URL`，寄件人 `MAIL_FROM` | 正式環境、本機開發（寄到 Mailpit）、E2E |
| `console`（預設） | 不寄出；收件人、主旨與純文字內容寫進日誌 | 單元／整合測試、沒有收信工具的環境 |

- 只講 SMTP、不綁服務商 SDK：SES、Postmark、Resend、自架 relay 都只是換 `MAIL_SMTP_URL`。
- **正式環境一律 `smtp`**（`docker-compose.prod.yml` 寫死；`NODE_ENV=production` 設成 `console` 會啟動失敗）：`console` 會把能登入的連結寫進日誌。
- 寄件網域要設好 SPF、DKIM、DMARC，否則信會進垃圾信匣。
- **連線池**：`smtp` 以 nodemailer 的 pool 模式連線（`MAIL_SMTP_POOL_SIZE`，預設 5 條），連續寄信時沿用已建立（含 TLS 握手）的連線。
  寄信工作共用 `MAIL_JOB_OPTIONS`（`core/mail`）：重試 8 次、間隔最多 1 小時，每個程序同時跑 5 筆（pg-boss 的 `localConcurrency`）。
- 預設 `console` 是為了讓沒有 SMTP 的環境（測試、CI）不會因為連不上而讓工作一直重試。

## 3. 範本

```tsx
// modules/credential/mails/account-link.mail.tsx
export function accountLinkMail({ purpose, locale, displayName, link, validHours }): MailContent {
  const copy = COPY[purpose][locale];
  return {
    subject: copy.subject,
    body: (
      <MailLayout locale={locale} preview={copy.preview} footer={MAIL_FOOTER[locale]}>
        <Text style={MAIL_STYLES.text}>{copy.greeting(displayName)}</Text>
        <Button href={link} style={MAIL_STYLES.button}>{copy.action}</Button>
        …
      </MailLayout>
    ),
  };
}
```

| 規則 | 理由 |
| --- | --- |
| 範本是回傳 `{ subject, body }` 的函式；文案依語系寫在同一個檔案（`satisfies Record<MailLocale, …>`） | 後端不共用前端的語系包；缺一個語系編譯失敗 |
| 語系用收件人的 `users.locale`（`toMailLocale()`），不認識的退回 `zh-TW` | 信是寄給對方看的，不是操作者 |
| 樣式寫成行內 style、色碼寫死 | 多數收信端不支援 `<style>`；這裡沒有 Design Token |
| `MailLayout` 的 `<Body>` 明確帶 `lang={locale}`；`<Hr>` 的顏色以整條 `borderTop` 覆寫 | `Body` 沒給 `lang` 會標成 `en`；`Hr` 預設的 `borderTop` 排在 `borderColor` 之後，只改 `borderColor` 會被蓋掉 |
| 連結一律 `MailService.link(path, query)`（產品頁面：目前租戶的主要網域，協定沿用 `APP_PUBLIC_URL`）或 `accountLink(path, query)`（帳號流程：啟用、重設密碼，`PLATFORM_APP_URL` 開頭並帶 `?tenant=<代碼>`，[`architecture/04-sso.md`](../04-sso.md) §12.2 D1、[`architecture/05-tenancy.md`](../05-tenancy.md) §10.2 D26） | 查詢字串正確編碼；每個租戶的連結指向自己的網域 |
| 按鈕旁附上純文字網址 | 按鈕在部分收信端無法點 |
| `MailService.send()` 同時產生 HTML 與純文字版 | 純文字版給不支援 HTML 的收信端，也是 `console` 傳輸寫進日誌的內容 |

## 4. 寄送流程

寄信 **一律入列**，不在 HTTP 請求裡寄：SMTP 慢或暫時失敗都不影響使用者的操作，失敗由佇列重試。

| 工作 | 入列的地方 | 資料 | 寄出前的檢查 |
| --- | --- | --- | --- |
| `auth.activationMail` | `UserService.create`（建立帳號的交易內） | `{ userId }` | 使用者仍是 `pending` |
| `auth.passwordResetMail` | `AuthService.forgotPassword`（節流：同帳號 60 秒一封）、`UserService.resetPassword`（與稽核同一交易） | `{ userId }` | 使用者存在 |
| `approval.resultMail` | `ApprovalService.approve` / `reject`（審核的交易內） | `{ approvalId }` | 請求已審核、找得到收件人 |
| `platformAdmin.accountMail`（平台工作） | `PlatformAdminManagementService.create`（新增平台管理者）、`sendPasswordLink`（代為寄設定密碼的連結） | `{ adminId, purpose }`（`activation`／`passwordReset`） | 管理者存在，且狀態符合用途（啟用信只寄給 `pending`）。連結到 apps/platform 的 `/setup`、`/reset-password`，不帶 `?tenant=` |

**token 在寄出當下才簽發。** 資料庫只存 token 的雜湊（[`04-auth.md`](./04-auth.md) §5.1），
若在入列時簽發，就得把原文放進工作資料——而持有 `job:read` 的人看得到工作資料。所以工作資料只有 `userId`，
handler 執行時才呼叫 `AuthTokenService.issue()`、把原文放進連結、寄出。重試會簽發新的 token
（舊的跟著作廢），信箱裡只有最後一封能用。

寄出前再檢查一次狀態：入列之後情況可能變了（使用者已經啟用、帳號已刪除），這時回傳 `{ skipped: … }`
當作完成，不寄、也不重試。

審核結果的收件人：申請人有帳號 → 帳號的 email 與語系；匿名申請（註冊）→ 申請時填的 email，
核准後帳號已建立就用新帳號的語系；申請人的帳號已刪除 → 不寄。

## 5. 稽核與日誌

- 寄出後記一筆 `mail.send`：`resourceType` 是 `user` 或 `approval`，`resourceName` 是收件人，
  `metadata` 只有 `{ template, jobId, messageId }`。**不記內容與 token**（§9.2 D8）。
  寄信發生在背景工作裡，操作者是 `system`。
- 工作的 `output` 是 `{ messageId }` 或 `{ skipped }`，在背景工作頁看得到。
- **日誌不出現 token**：`smtp` 傳輸只記「已寄出」與 messageId；HTTP 請求日誌的網址、解析好的 `query` 物件、`Referer`
  裡的憑證參數遮成 `[Redacted]`，請求的 `authorization`、`cookie` 與回應的 `set-cookie` 也遮掉（`core/logger/redact.ts`）。
  只有 `console` 傳輸會把連結寫進日誌。
  - 憑證參數的名單只有一份（`SENSITIVE_QUERY_KEYS`）：`token`（啟用、重設密碼）、`code` 與 `state`（外部 IdP 回來的授權碼）、
    `ticket`（完成外部登入）、`code_verifier`、`id_token_hint`（RP 發起的登出，含 email 與名稱的 ID token）。
  - pino-http 的 `req` 除了網址字串，還帶著 Express 解析好的 `query` 物件；兩者都由這份名單遮，不另外寫 `redact` 路徑。

## 6. 本機與 E2E

- `pnpm dev` 會一起啟動 Mailpit（`docker-compose.yml`）：SMTP `:1025`，網頁 <http://localhost:8025>。
  本機 `.env` 設 `MAIL_TRANSPORT=smtp` 就能在 Mailpit 看到信（見 `.env.example`）。
- `pnpm dev:e2e` 以 `MAIL_TRANSPORT=smtp` 啟動 api；E2E 經 Mailpit 的 API 取出連結
  （`apps/e2e/helpers/mailpit.ts`），走完「從信箱點連結」的完整流程。每個測試用獨一無二的收件地址，
  不必清空信箱。同一個地址會收到多封信時（例：核准註冊同時寄審核結果與啟用信），`waitForMail(to, subject)` 以主旨挑出要的那封。
- macOS 上 nodemailer 連 `localhost` 每次多約 3 秒，一封信要 15–20 秒，會撞上 `waitForMail` 的 20 秒上限；
  跑 E2E 的 api 把 `MAIL_SMTP_URL` 設成 `smtp://127.0.0.1:1025`。

## 7. 設定

| 環境變數 | 預設 | 說明 |
| --- | --- | --- |
| `MAIL_TRANSPORT` | `console` | `smtp` 或 `console` |
| `MAIL_SMTP_URL` | `smtp://localhost:1025` | 例：`smtps://user:pass@smtp.example.com:465` |
| `MAIL_FROM` | `B2B System <no-reply@localhost>` | 寄件人 |
| `APP_PUBLIC_URL` | `http://localhost:5173` | 信裡連到產品的連結開頭（例：審批結果） |
| `PLATFORM_APP_URL` | `http://localhost:5175` | 帳號流程的連結開頭（apps/platform 的 `/setup`、`/reset-password`） |

## 8. 測試

| 測試 | 內容 |
| --- | --- |
| `test/mail.spec.ts` | 真 Postgres ＋ worker ＋ 記錄用的傳輸層：建立帳號 → 啟用信 → 用連結設定密碼 → 登入；稽核不含 token；忘記密碼的節流與重設；不存在的 email 不寄；註冊被駁回 → 申請人收到意見 |
| `src/modules/credential/__tests__/auth-mail.jobs.spec.ts` | 寄出當下簽發、狀態不符不寄、依語系、寄送失敗拋出且不寫稽核 |
| `src/modules/approval/__tests__/approval.service.spec.ts` | 核准／駁回時在交易內入列，搶輸時不入列 |
| `src/core/mail/__tests__/mail.service.spec.ts` | 連結編碼、HTML 與純文字 |
| `src/core/logger/__tests__/redact.spec.ts` | 網址、`query` 物件與 Referer 的憑證參數遮蔽；經過 pino-http（`pinoHttpOptions()`）的存取日誌找不到原文 |
| `apps/e2e/tests/mail.spec.ts` | 經 Mailpit：從信箱點啟用連結 → 設定密碼 → 登入；用過的連結顯示失效 |
| `apps/e2e/tests/approval.spec.ts` | 經 Mailpit：註冊核准後從啟用信設定密碼 → 登入（[`../../rbac/06-approval.md`](../../rbac/06-approval.md) §5） |

## 9. 設計決策：SMTP（nodemailer）＋ React Email 範本，開發用 Mailpit

> 原 ADR-0017，2026-09-29 決定。

### 9.1 背景

決策當時，啟用與重設密碼的連結寫進伺服器日誌，由維運人員轉交（`auth-token.service.ts` 的 `issue()`；
流程見 [`04-auth.md`](./04-auth.md) §5）；審批結果也因為沒有郵件而不通知申請人（[`../../rbac/06-approval.md`](../../rbac/06-approval.md) §1）。
部署是 docker compose 自架，物件儲存採「S3 相容、換服務只改 env」。寄送經背景工作（[`10-jobs.md`](./10-jobs.md)；[`backend/10-jobs.md`](10-jobs.md) §9）。

### 9.2 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | `core/mail` 定義 `MailTransport`，env `MAIL_TRANSPORT` 選 `smtp` 或 `console` | 與 `core/storage` 同構；換服務商只改 env |
| D2 | 正式環境：在 AWS 用 SES，否則 Postmark／Resend，一律經 SMTP | 交易信需要好的送達率；都支援 SMTP，不影響 D1 |
| D3 | 寄件網域設好 SPF、DKIM、DMARC，寫進部署文件 | 否則信會進垃圾信匣 |
| D4 | 寄信一律經 [`backend/10-jobs.md`](10-jobs.md) §9 的佇列，入列在業務交易內 | 寄送失敗要重試；HTTP 請求不等 SMTP |
| D5 | 範本用 React Email，放在後端；api 加 `react` 並開啟 JSX（swc） | 範本 props（連結、名稱、審批結果）有型別檢查；有本機預覽 |
| D6 | 語系依收件人偏好選 zh-TW／en-US，字串放後端自己的語系檔 | 前端語系包隨 feature 載入，後端不該依賴它 |
| D7 | 只有 `MAIL_TRANSPORT=console` 時把連結印到日誌；`smtp` 時完全不記 | 正式環境日誌不該出現能拿來登入的 token |
| D8 | 稽核只記「寄了哪種信給誰」與 job id，不記內文與 token | 稽核不可變，不能留下可用的憑證 |
| D9 | 開發環境在 compose 加 Mailpit（SMTP `:1025`、網頁 `:8025`），本機走 `smtp` | 開發時看得到真正的信；與正式環境走同一條程式路徑 |
| D10 | E2E 經 Mailpit 的 API 取出啟用／重設連結 | 測到「從信箱點連結」的完整流程，不再依賴伺服器日誌 |
| D11 | `console` 只給單元與整合測試用 | 不必起 SMTP 伺服器 |

D6 的「語系檔」與 D9 的「本機走 `smtp`」實作時有調整，見 §9.5。

### 9.3 取捨

| 代價 | 評估 |
| --- | --- |
| SMTP 拿不到服務商的即時回應細節（退信原因、訊息 id 格式不一） | 第一版不追蹤退信；需要時再加服務商專屬的 transport |
| api 多了 `react` 相依與 JSX 設定 | 只在 `*.mail.tsx` 使用；不影響其他模組 |
| compose 多一個 Mailpit 服務 | 只在開發與 E2E；正式環境不部署 |

### 9.4 評估過的方案

寄送方式：

| 方案 | 結論 |
| --- | --- |
| **A. SMTP（nodemailer）** | **採用** |
| B. 服務商的 HTTP API／SDK（SES、Postmark、Resend） | 不採用：綁定單一服務商；它們多出來的退信 webhook、開信追蹤都在「不做」範圍 |
| C. 自架 MTA（Postfix） | 不採用：IP 信譽、送達率、反垃圾信設定都要自己顧 |

範本：

| 方案 | 結論 |
| --- | --- |
| **A. React Email** | **採用** |
| B. MJML | 不採用：響應式排版成熟，但第一版只有三封信用不到；props 沒有型別檢查 |
| C. 手寫 HTML ＋ 字串替換 | 不採用：各家信箱的 CSS 相容性要自己處理 |

### 9.5 實作紀錄

| 項目 | 提案 | 實作 | 原因 |
| --- | --- | --- | --- |
| token 何時簽發 | 未定（mailer 提案的開放問題） | 寄信的工作在 **寄出當下** 簽發；工作資料只有 `userId` | 資料庫只存雜湊；入列時簽發就得把原文放進工作資料，而 `job:read` 看得到工作資料。重試會簽新的、舊的作廢 |
| 範本位置 | `core/mail/templates/` | `modules/<name>/mails/*.mail.tsx`；`core/mail` 只有外框與傳輸層 | 範本含業務名詞，`core/` 不認識 `modules/` |
| 語系檔 | 後端語系檔 | 文案依語系寫在範本檔內（`satisfies Record<MailLocale, …>`） | 每封信的文案只有幾句；放在一起改範本時不會漏改 |
| D7 的範圍 | 只管寄信本身 | 另外遮蔽 HTTP 請求日誌裡的 `token`（網址、`query`、`Referer`）與回應的 `set-cookie` | 實作時發現 pino-http 會記下 `/auth/setup/verify?token=…` 與 refresh cookie；不遮的話 D7 不成立 |
| `MAIL_TRANSPORT` 預設值 | 本機走 `smtp` | 預設 `console`；`.env.example` 設 `smtp`，`docker-compose.prod.yml` 寫死 `smtp` | 測試與 CI 沒有 SMTP，預設 `smtp` 會讓工作一直重試 |
| 忘記密碼的節流 | — | 同帳號 60 秒內只入列一封 | 避免重複按洗信箱；順帶修正 `JobQueue` 的節流選項（單獨的 `singletonKey` 在 pg-boss 的 standard 佇列不起作用） |
