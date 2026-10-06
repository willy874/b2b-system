# 平台管理者的帳號流程沒有交易：稽核在提交之後才寫，一次性 token 可以重複使用

## 現況

租戶端的同一組流程是 `apps/api/src/modules/auth/auth.service.ts` 的 `resetPassword()`（L495 起）與 `setup()`（L554 起）。它們在一個交易內依序做三件事：條件式消耗 token → 寫入 → 稽核。交易提交後才失效快取、發事件。

平台端（`modules/platform-admin`）沒有這樣做：

- `platform-account.service.ts`：
  - `setup()`（L34–55）：`repo.update()`（L40）、`tokens.markUsed()`（L44）、`audit.record()`（L46）是三個獨立語句，沒有交易。
  - `resetPassword()`（L58–84）依序是：
    - `repo.updateAndEndSessions()`（L64）：由 repository 自己開交易。
    - `tokens.markUsed()`（L74）
    - `userCache.invalidate()`（L75）
    - `audit.record()`（L76）：沒有帶 `tx`。
  - `updateDisplayName()`（L87–102）、`changePassword()`（L108–139）：都是寫入、失效快取之後才寫稽核。
- `platform-admin-management.service.ts`：`create()`（L58–79）、`update()`（L81–149）、`sendPasswordLink()`（L152–163）同樣是寫入之後才 `audit.record()`，不帶 `tx`。
- `platform-auth-token.repository.ts` 的註解寫「規則同租戶的 `AuthTokenService`」（L17），但 `markUsed()`（L61–66）是無條件的 UPDATE，回傳 `void`：

```ts
async markUsed(id: string, tx?: PlatformDbOrTx): Promise<void> {
  await (tx ?? this.db)
    .update(platformAuthTokens)
    .set({ usedAt: new Date() })
    .where(eq(platformAuthTokens.id, id));
}
```

- 租戶端的做法可以當範本：
  - `AuthTokenService.markUsed()`（`modules/credential/auth-token.service.ts` L72–82）以 `WHERE used_at IS NULL AND expires_at > now() … RETURNING` 條件式消耗，回傳有沒有搶到。
  - `AuthService.consumeToken()`（L590）在交易內第一步就消耗；沒搶到就讓整個交易失敗。
- 停用管理者時（`update()` L112–113），已寄出、還沒用的啟用與重設 token 不會作廢。租戶端在停用與刪除的交易內呼叫 `AuthTokenService.revokeUnused()`（`user.service.ts` L220、L264）。
- `resetPassword()` 遞增了 `token_version`，卻沒有發 `SESSIONS_REVOKED`。這點已寫在 [`platform-admin-idp-session-survives-credential-change.md`](./platform-admin-idp-session-survives-credential-change.md)，這裡不重複。

`PlatformAuditService.record()`（`platform-audit.service.ts` L60）本來就接受 `tx`，`PlatformTenantService` 的寫入也都有帶（例：L248–250）。

重現（流程資安檢測者在 scratch 環境的並行測試）：

1. 拿同一個平台的重設密碼 token（或啟用 token），同時送兩次 `POST /platform/auth/reset-password`（或 `POST /platform/auth/setup`）。
2. 兩個請求都回 200。最後留下的密碼，取決於哪一次寫入比較晚。

## 影響

- 稽核可能遺失：稽核寫入失敗時，變更已經提交，請求卻回 500。這違反「稽核在交易內」（[`conventions/03-backend.md`](../conventions/03-backend.md) §1 第 6 條、[`backend/06-audit-log.md`](../architecture/backend/06-audit-log.md) §4.1）。
  - 這時 `create()` 也不會入列啟用信（L73），留下一位沒收到信的 `pending` 管理者。可以再按「寄設定密碼的連結」補救。
- 一次性 token 可以重複使用：同一個連結被雙擊或並行送出時，每一次都會成功。
- 並行的重設密碼會蓋掉停用：
  - `resetPassword()` 在 L61 檢查狀態，中間隔一次 argon2 雜湊，再在 L64–73 無條件寫入 `status: 'active'`。
  - super-admin 停用 B 的同時，B 正在用之前寄出的重設連結重設密碼，B 就會被改回 `active`。
  - 前提：重設連結已經寄出而且還沒過期。平台管理者沒有自助的忘記密碼，連結都由 super-admin 寄出。
- 以上都要並行或資料庫故障才會發生。但對象是權限最大的平台管理者，而「停用被蓋掉」會讓一個安全動作失效。

## 修正方式

以 `AuthService.setup()`／`resetPassword()` 為範本，改寫 `PlatformAccountService` 與 `PlatformAdminManagementService`：

1. `PlatformAuthTokenRepository.markUsed()` 改成條件式（`isNull(usedAt)`、`gt(expiresAt, now())`、`RETURNING`），回傳 `boolean`。另加 `revokeUnused(adminId, tx)`。
2. 每個流程都包在 `withTransaction(PLATFORM_DB, …)` 裡：
   1. 先消耗 token，沒搶到就回 `AUTH_SETUP_TOKEN_INVALID`。
   2. 寫入。
   3. `audit.record(…, tx)`。
   4. 交易提交後才 `userCache.invalidate()`、發事件、寫平台通知。
3. 狀態的寫入要加條件：
   - `resetPassword()` 只在 `status IN ('active', 'locked')` 時更新，否則讓交易失敗。
   - 停用時在同一個交易內呼叫 `revokeUnused()`。
4. `PlatformAdminRepository.updateAndEndSessions()`（L112–122）不要自己開交易。拆成三個接受 `tx` 的語句，由 service 編排。這一步與 [`platform-last-super-admin-race.md`](./platform-last-super-admin-race.md) 一起做。
5. 做完上面幾步，`platform-auth-token.repository.ts` L17 的註解才名實相符。

## 驗證方式

`apps/api/test/platform-admin.spec.ts` 補：

- 同一個重設連結用 `Promise.all` 送兩次：恰好一個 200，另一個 `400 AUTH_SETUP_TOKEN_INVALID`。啟用連結也補一個同樣的案例。
- 停用與重設並行：結束後狀態是 `inactive`。
- 停用之後，先前寄出的重設連結不能再用（`AUTH_SETUP_TOKEN_INVALID`），即使之後重新啟用。
- 稽核寫入失敗時（spy `PlatformAuditService.record` 拋錯），密碼與狀態都沒有改變。
