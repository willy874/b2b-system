# 平台管理者改密碼、重設密碼、停用後再啟用，IdP session 不會結束

## 現況

租戶使用者的憑證失效會連帶結束 IdP session（[`04-sso.md`](../architecture/04-sso.md) §3.5、§12.2 D17），但平台管理者這條路沒有接上。

- `apps/api/src/modules/oidc-provider/oidc-provider.service.ts` 的 `SESSIONS_REVOKED` 訂閱者（L149–155）只處理 `userIds`（租戶脈絡），**忽略 `platformAdminIds`**：

```ts
this.unsubscribe = this.events.subscribe(DomainEvent.SESSIONS_REVOKED, ({ userIds }) => {
  const tenant = currentTenant();
  if (!userIds?.length || !tenant) return;  // 平台管理者沒有租戶脈絡，直接 return
  void this.repo.destroySessionsOf(userIds.map((userId) => tenantAccountId(tenant.id, userId)))...
});
```

- `apps/api/src/modules/platform-admin/platform-account.service.ts`：
  - `changePassword()`（L108–137）遞增 `token_version`、撤銷 refresh token、推 `SESSIONS_REVOKED { platformAdminIds }`（L134–135），但如上，沒有任何訂閱者據此銷毀 IdP session。
  - `resetPassword()`（L58–83）連 `SESSIONS_REVOKED` 都沒有發佈，所以連即時連線（`realtime`）都不會被斷。
- `apps/api/src/modules/platform-admin/platform-admin-management.service.ts` 的停用（L113、L136–137）同樣只推 `platformAdminIds`。
- `oidc-provider.service.ts` 的 `findAccount()`（L489–491）對平台管理者只檢查 `status === 'active'`，不看 `token_version`。
- IdP session 的 TTL 是 7 天（`oidc-provider.constants.ts` 的 `OIDC_TTL.Session`）。

結果：平台管理者改密碼、被重設密碼、或被停用後再啟用時，`apps/platform` origin 上的 IdP session cookie 仍然有效。帶著它重新 authorize，provider 看到 session 的帳號仍 `active`，直接帶授權碼跳回，不需要再輸入密碼，就能換到新的 app session（帶改後的 `token_version`，因此有效）。

## 影響

- 前提：平台管理者的密碼外洩，持有者拿到 `apps/platform` 的 IdP session cookie。
- 本人改密碼、由其他平台管理者寄重設連結、或先停用再啟用，都無法切斷持有者：持有者在 IdP session TTL（最長 7 天）內可無聲地重新登入。
- 另外 `resetPassword()` 沒發 `SESSIONS_REVOKED`，重設密碼後其他裝置上的平台即時連線也不會斷。
- 影響的是權限最大的平台管理者，而所有常見的補救手段（改密碼、重設、停用）都踢不掉攻擊者。

## 修正方式

1. 訂閱者處理 `platformAdminIds`：對 `platformAccountId(adminId)`（`p:{adminId}`）銷毀 IdP session。平台事件沒有租戶脈絡，不能走 `currentTenant()` 的分支，要獨立處理（建議刪除該 accountId 的所有 `Session` 列，做法同 `destroySessionsOf`）。
2. `resetPassword()` 補發 `SESSIONS_REVOKED { platformAdminIds, reason }`，與 `changePassword()` 一致。
3. 縱深防禦：配合 [`interaction-resume-after-password-change.md`](./interaction-resume-after-password-change.md) 在 resume 時比對 `token_version`，`findAccount()` 對平台管理者也檢查 `token_version`。

## 驗證方式

`apps/api/test/sso.spec.ts` 的平台管理者區段，補三個案例：以同一個 cookie jar 登入後，分別

- 經 `/platform/auth/change-password` 改密碼、
- 由另一位 super-admin 寄重設連結並完成重設、
- 先停用再啟用，

之後不帶密碼再 `authorize(jar, AUTH_APP)` 都必須被導回登入頁（`/oidc-interaction/`），而不是直接拿到授權碼。

相關規格：[`04-sso.md`](../architecture/04-sso.md) §3.5、§12.2 D17；[`backend/04-auth.md`](../architecture/backend/04-auth.md) §4.3。
