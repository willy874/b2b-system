# 啟用連結檢查與改密碼端點沒有套用登入類的速率限制

## 現況

規則：

- `apps/api/src/common/rate-limit.ts`（L16–22）說明 `auth` 類別涵蓋「登入、SSO 回呼、帳號流程的 token 端點、租戶代碼查詢」。
- [`backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §8 的表也把「啟用／重設」列進 `@RateLimit('auth')`。

沒有標 `@RateLimit` 的帳號端點：

1. `GET /auth/setup/verify`：`apps/api/src/modules/auth/auth.controller.ts` 的 `verifySetup()`（L185–189）。
   - 只有 `@Public()`，落在匿名的 IP 桶（`ANONYMOUS_RATE_LIMIT`，預設每分鐘 3000 次）。
   - 平台的同一個端點有標 `@RateLimit('auth')`（`platform-auth.controller.ts` L98–104）。
2. `POST /auth/change-password`：`auth.controller.ts` L122–131，`@Authenticated()`，沒有 `@RateLimit`。
   - `auth.service.ts` 的 `changePassword()`（L385–390）會驗證 `currentPassword`：

     ```ts
     const ok = await verifyPassword(user.passwordHash, dto.currentPassword);
     if (!ok) throw new AppException('AUTH_PASSWORD_MISMATCH');
     ```

   - 錯了只回 `AUTH_PASSWORD_MISMATCH`：不計失敗次數、不寫稽核、不鎖定。
3. `POST /platform/auth/change-password`：`platform-auth.controller.ts` L146–156，情形相同。
   - `platform-account.service.ts` 的 `changePassword()`（L108–117）同樣不計失敗次數、不寫失敗的稽核。

2.、3. 只受已登入使用者的預設桶限制：`DEFAULT_RATE_LIMIT`，每人每分鐘 600 次，所有端點合計。

就算標上 `@RateLimit('auth')`，目前也只會套到 IP 桶：

- 「帳號桶」以 body 的 `email` 計（`rate-limit.ts` 的 `accountOf()`，L135–142）。
- 改密碼的 body 沒有 email。
- `common/guards/rate-limit.guard.ts` 的 `subjectOf()`（L93–111）在 `auth` 類別只取 IP 與 email，不取已登入的身分。
- 結果只剩每個 IP 每分鐘 300 次（`AUTH_IP_RATE_LIMIT`）。

## 影響

- `setup/verify`：token 是 256 位元的隨機值（`credential/auth-token.service.ts` L44），猜不到。這一項是規則不一致與縱深防禦。
- `change-password`：拿得到某人有效 access token 的人，可以每分鐘試 600 次目前的密碼。
  - 例如 backstage 上的 XSS：可以靠同源的續期一直拿到新的 access token。
  - 猜中之後就知道這個人的密碼。密碼常在別的服務重用，攻擊者也能直接改掉它、把本人鎖在外面。
  - 失敗不留稽核，事後查不到有人在試。
- 每次嘗試都跑一次 argon2（19 MiB、t=2）。
  - 一個帳號就能讓 api 每秒做約 10 次 argon2，佔用 libuv 的執行緒池（`UV_THREADPOOL_SIZE=16`）。
  - 其他人的登入也會跟著變慢。
- 平台管理者的帳號權限大，`/platform/auth/change-password` 的風險更高。

## 修正方式

1. `GET /auth/setup/verify` 加 `@RateLimit('auth')`，與平台端一致。
2. 兩個 `change-password` 加 `@RateLimit('auth')`，並補上以帳號計的桶。擇一，建議 a：
   - a. `RateLimitGuard.subjectOf()` 在 `auth`、`authMail` 類別也取 `principal`。`rateLimitBucketsOf()` 在沒有 email 但有 principal 時，以 principal 當帳號桶的 key，上限是 `AUTH_RATE_LIMIT`（預設每分鐘 10 次）。
   - b. 另開一個 `credential` 類別：每人每分鐘 `AUTH_RATE_LIMIT` 次，加上 IP 桶。
3. 密碼不符時寫一筆失敗稽核，例如 `auth.password_change` 加上 `result: 'failure'`、`errorCode: 'AUTH_PASSWORD_MISMATCH'`；平台端同樣處理。
   - 要不要也計入登入的失敗次數與鎖定，由 [`backend/04-auth.md`](../architecture/backend/04-auth.md) 決定。
4. [`backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §8 的表把改密碼列進 `auth`。

## 驗證方式

- `apps/api/src/common/__tests__/rate-limit.spec.ts`：`auth` 類別帶 principal、沒有 email 時，有帳號桶（採 2.a 時）。
- 補一個 metadata 檢查，確認下列路由的 `RATE_LIMIT_POLICY` 是 `auth`。可以放在 `apps/api/test/route-audit.spec.ts`，或另開一個檔案：
  - `GET /auth/setup/verify`；
  - `POST /auth/change-password`；
  - `POST /platform/auth/change-password`。
- `apps/api/test/account-security.spec.ts`：
  - 調低 `AUTH_RATE_LIMIT`，連續送錯的 `currentPassword`，超過上限之後回 429；
  - 密碼不符會留下一筆失敗的稽核。
