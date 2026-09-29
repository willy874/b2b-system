# 11 — 郵件

啟用信、重設密碼信、審核結果通知。選型理由見 [ADR-0017](../../adr/0017-mail-delivery.md)：
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

modules/auth/
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

## 2. 傳輸層

| `MAIL_TRANSPORT` | 行為 | 用在 |
| --- | --- | --- |
| `smtp` | nodemailer 連到 `MAIL_SMTP_URL`，寄件人 `MAIL_FROM` | 正式環境、本機開發（寄到 Mailpit）、E2E |
| `console`（預設） | 不寄出；收件人、主旨與純文字內容寫進日誌 | 單元／整合測試、沒有收信工具的環境 |

- 只講 SMTP、不綁服務商 SDK：SES、Postmark、Resend、自架 relay 都只是換 `MAIL_SMTP_URL`。
- **正式環境一律 `smtp`**（`docker-compose.prod.yml` 寫死）：`console` 會把能登入的連結寫進日誌。
- 寄件網域要設好 SPF、DKIM、DMARC，否則信會進垃圾信匣。
- 預設 `console` 是為了讓沒有 SMTP 的環境（測試、CI）不會因為連不上而讓工作一直重試。

## 3. 範本

```tsx
// modules/auth/mails/account-link.mail.tsx
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
| 連結一律 `MailService.link(path, query)`（產品頁面，`APP_PUBLIC_URL` 開頭）或 `accountLink(path, query)`（帳號流程：啟用、重設密碼、接受邀請，`AUTH_APP_URL` 開頭，[ADR-0019](../../adr/0019-sso-identity-platform.md) D1） | 查詢字串正確編碼 |
| 按鈕旁附上純文字網址 | 按鈕在部分收信端無法點 |
| `MailService.send()` 同時產生 HTML 與純文字版 | 純文字版給不支援 HTML 的收信端，也是 `console` 傳輸寫進日誌的內容 |

## 4. 寄送流程

寄信 **一律入列**，不在 HTTP 請求裡寄：SMTP 慢或暫時失敗都不影響使用者的操作，失敗由佇列重試。

| 工作 | 入列的地方 | 資料 | 寄出前的檢查 |
| --- | --- | --- | --- |
| `auth.activationMail` | `UserService.create`（建立帳號的交易內） | `{ userId }` | 使用者仍是 `pending` |
| `auth.passwordResetMail` | `AuthService.forgotPassword`（節流：同帳號 60 秒一封）、`UserService.resetPassword`（與稽核同一交易） | `{ userId }` | 使用者存在 |
| `approval.resultMail` | `ApprovalService.approve` / `reject`（審核的交易內） | `{ approvalId }` | 請求已審核、找得到收件人 |

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
  `metadata` 只有 `{ template, jobId, messageId }`。**不記內容與 token**（ADR-0017 D8）。
  寄信發生在背景工作裡，操作者是 `system`。
- 工作的 `output` 是 `{ messageId }` 或 `{ skipped }`，在背景工作頁看得到。
- **日誌不出現 token**：`smtp` 傳輸只記「已寄出」與 messageId；HTTP 請求日誌的網址、`query`、`Referer`
  裡的 `token` 參數遮成 `[Redacted]`，回應的 `set-cookie` 也遮掉（`core/logger/redact.ts`）。
  只有 `console` 傳輸會把連結寫進日誌。

## 6. 本機與 E2E

- `pnpm dev` 會一起啟動 Mailpit（`docker-compose.yml`）：SMTP `:1025`，網頁 <http://localhost:8025>。
  本機 `.env` 設 `MAIL_TRANSPORT=smtp` 就能在 Mailpit 看到信（見 `.env.example`）。
- `pnpm dev:e2e` 以 `MAIL_TRANSPORT=smtp` 啟動 api；E2E 經 Mailpit 的 API 取出連結
  （`apps/e2e/helpers/mailpit.ts`），走完「從信箱點連結」的完整流程。每個測試用獨一無二的收件地址，
  不必清空信箱。

## 7. 設定

| 環境變數 | 預設 | 說明 |
| --- | --- | --- |
| `MAIL_TRANSPORT` | `console` | `smtp` 或 `console` |
| `MAIL_SMTP_URL` | `smtp://localhost:1025` | 例：`smtps://user:pass@smtp.example.com:465` |
| `MAIL_FROM` | `B2B System <no-reply@localhost>` | 寄件人 |
| `APP_PUBLIC_URL` | `http://localhost:5173` | 信裡連到產品的連結開頭（例：審批結果） |
| `AUTH_APP_URL` | `http://localhost:5175` | 帳號流程的連結開頭（apps/auth 的 `/setup`、`/reset-password`） |

## 8. 測試

| 測試 | 內容 |
| --- | --- |
| `test/mail.spec.ts` | 真 Postgres ＋ worker ＋ 記錄用的傳輸層：建立帳號 → 啟用信 → 用連結設定密碼 → 登入；稽核不含 token；忘記密碼的節流與重設；不存在的 email 不寄；註冊被駁回 → 申請人收到意見 |
| `src/modules/auth/__tests__/auth-mail.jobs.spec.ts` | 寄出當下簽發、狀態不符不寄、依語系、寄送失敗拋出且不寫稽核 |
| `src/modules/approval/__tests__/approval.service.spec.ts` | 核准／駁回時在交易內入列，搶輸時不入列 |
| `src/core/mail/__tests__/mail.service.spec.ts` | 連結編碼、HTML 與純文字 |
| `src/core/logger/__tests__/redact.spec.ts` | 網址與 Referer 的 token 遮蔽 |
| `apps/e2e/tests/mail.spec.ts` | 經 Mailpit：從信箱點啟用連結 → 設定密碼 → 登入；用過的連結顯示失效 |
