# 請求日誌的 `query` 仍記下 code、state、ticket、id_token_hint 的原文

## 現況

api 的請求日誌設定：

- `apps/api/src/core/logger/logger.module.ts`（L38–44）：`redact` 只有 `req.query.token`；`serializers.req` 是 `redactRequest`。
- `apps/api/src/core/logger/redact.ts`：
  - `SENSITIVE_QUERY_PARAM`（L5–6）列了 `token|code|state|ticket|code_verifier|id_token_hint`；
  - `redactRequest()`（L24–29）只改寫 `req.url` 與 `referer` 這兩個字串。

為什麼漏掉：

- pino-http 先跑 pino-std-serializers 的 `reqSerializer`，結果才交給自訂的 serializer。
- `reqSerializer` 會帶上 Express 解析好的 `req.query` 物件（`pino-std-serializers/lib/req.js`：`if (req.query) _req.query = req.query`）。
- 所以網址遮了，`query` 物件裡還是原文。

實測：用同一份 `redact` 與 serializer 設定（express 5.2.1、pino-http 11.0.0）送出：

```
GET /oidc-interaction/external/callback?code=SECRETCODE123&state=SECRETSTATE456&token=TOK
```

日誌的內容：

```
url  : /oidc-interaction/external/callback?code=[Redacted]&state=[Redacted]&token=[Redacted]
query: {"code":"SECRETCODE123","state":"SECRETSTATE456","token":"[Redacted]"}
```

會留下原文的請求：

- 外部 IdP 的授權碼與 state：`GET /oidc-interaction/external/callback?code=…&state=…`（`apps/api/src/modules/auth/sso-interaction.controller.ts` L53）。
- 完成外部登入的 ticket：`GET /oidc-interaction/:uid/external/complete?ticket=…`（同一個檔案 L134）。
- RP 發起的登出：`GET /oidc/session/end?id_token_hint=…`（`oidc-provider.service.ts` L445 的 `rpInitiatedLogout`）。這是含 email 與 name 的 ID token。

測試與文件的狀況：

- `apps/api/src/core/logger/__tests__/redact.spec.ts` 只測 `redactUrl()` 與 `redactRequest()` 處理網址字串，沒有經過 pino-http，所以測不出來。
- [`features/hardening-followups.md`](../features/hardening-followups.md) 的「nginx 的 `log_format`」那一列寫「api 的日誌已遮掉 `code`／`state`／`ticket`」，與實際不符。

## 影響

- 看得到 api 日誌的人拿得到外部 IdP 的授權碼、state 與 ticket，以及 ID token 裡的個資。這包括維運人員與日誌平台的服務商。
- 直接拿來登入的機會不大：
  - 授權碼要搭配存在平台 DB 的 PKCE verifier；
  - ticket 要搭配那個瀏覽器的互動 cookie。state 沒有綁定瀏覽器的問題另見 [`external-idp-state-not-bound-to-browser.md`](./external-idp-state-not-bound-to-browser.md)。
- 主要問題有兩個：
  - 違反 [`conventions/03-backend.md`](../conventions/03-backend.md) §7「日誌不記 token」，也與上述文件的說法不符；
  - 個資進了日誌。
- 每一次外部 IdP 登入、每一次 RP 發起的登出，都會留下一筆。

## 修正方式

擇一，建議 1：

1. `redactRequest()` 也處理 `query`：換成遮好的淺拷貝，敏感的鍵改成 `[Redacted]`，其他參數照常保留，排查時看得到。
2. 在 `redact` 加上 `req.query.code`、`req.query.state`、`req.query.ticket`、`req.query.code_verifier`、`req.query.id_token_hint`。
   - 缺點是參數名單會有兩份，日後很容易只改一份。

不論哪一種，參數名單都只留一份：

- `redact.ts` 匯出 `SENSITIVE_QUERY_KEYS`；
- 網址用的 regex 與 `query` 的遮蔽都由它產生。

修好之後，hardening-followups.md 那一列的描述才成立。[`backend/11-mail.md`](../architecture/backend/11-mail.md) §5 可以順便列出完整的參數名單。

## 驗證方式

- 把 LoggerModule 裡 pino-http 的選項抽成一個函式（例：`pinoHttpOptions(nodeEnv)`），讓模組與測試共用。
- `apps/api/src/core/logger/__tests__/redact.spec.ts` 補一個端對端的案例：
  - 用上面的選項建立 pino-http，輸出接到記憶體裡的 stream；
  - 送出 `/x?code=a1&state=b2&ticket=c3&code_verifier=d4&id_token_hint=e5&token=f6&keyword=g7`；
  - 斷言輸出裡找不到 `a1`～`f6`，但 `g7` 還在。
