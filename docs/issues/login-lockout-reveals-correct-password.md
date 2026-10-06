# 帳號鎖定期間登入仍會洩漏「密碼正確與否」，而且鎖定不會真的擋住猜密碼

## 現況

`apps/api/src/modules/auth/auth.service.ts` 的 `verifyCredentials()`（L116–155）；平台管理者的 `apps/api/src/modules/platform-admin/platform-admin.service.ts` 的 `verifyCredentials()`（L28–79）是同一套邏輯。

鎖定期間（`locked_until` 未到期）：

```ts
if (!ok) {
  if (lockedUntil) await this.recordLockedAttempt(user);   // 錯誤密碼：不計數、不延長鎖定
  else await this.registerFailedAttempt(user);
  throw new AppException('AUTH_INVALID_CREDENTIALS');
}
if (lockedUntil) {                                         // 正確密碼：回不同的碼
  throw new AppException('AUTH_ACCOUNT_LOCKED', { retryAfterSeconds: ... });
}
```

- 鎖定中，錯誤密碼回 `AUTH_INVALID_CREDENTIALS`、正確密碼回 `AUTH_ACCOUNT_LOCKED`——兩者可區分，形成一個「猜中了沒」的 oracle。
- 鎖定中的錯誤密碼不計數、不延長鎖定（這是刻意的，避免知道 email 的人把人一直鎖死）。因此鎖定一旦觸發，就 **不再** 阻止繼續猜，只是換了回應碼。
- 真正節流猜測的是速率限制（`common/rate-limit.ts` 的 `auth` 政策）：登入以「帳號＋IP」（預設 `AUTH_RATE_LIMIT`=10 次/分）與每 IP（`AUTH_IP_RATE_LIMIT`）兩個桶計。`RateLimitGuard` 與 `failed_login_count` 是兩套，速率限制在鎖定期間照常計數——但它是每 IP 一個桶，鎖定本身對猜測沒有加成。

這與規格自相矛盾：[`backend/04-auth.md`](../architecture/backend/04-auth.md) §3.2 把「帳號鎖定（密碼正確）」列為 **刻意可區分**；§3.3 又說「鎖定是擋猜密碼」。實際上鎖定只改回應碼、不擋猜測，擋猜測的是速率限制；可區分的回應反而把「猜中」透露出去。

另外，密碼 **正確** 但帳號不可登入的三個分支（L149 鎖定、L154 `pending`、L155 停用）直接 throw，**都沒有寫稽核**。只有「密碼錯誤」（`registerFailedAttempt`／`recordLockedAttempt`）與「登入成功」（L165）會留稽核。

## 影響

- 監控面：帳號被鎖定或停用後，若有人持續以 **正確** 密碼嘗試登入（這是憑證外洩的高訊號事件），系統沒有任何稽核可供告警。違反 §9 檢查清單「所有認證事件都寫入稽核」。
- 猜密碼面：鎖定給人「已擋住猜測」的印象，但實際上一旦觸發就不再阻止嘗試，唯一節流是速率限制。可區分的回應讓攻擊者在鎖定視窗內確認「哪個候選密碼是對的」。
- 量級：兩個速率限制的桶都以 IP 計（「帳號＋IP」與「每 IP」），沒有不分 IP 的帳號上限。攻擊者分散到 N 個來源 IP，對同一個帳號的猜測速率就是約 N × 10 次/分；
  鎖定若真的生效，不論來源 IP 多少，同一個帳號每 15 分鐘只能試 5 次（預設值）。也就是說，鎖定原本該提供的「每帳號上限」在分散式攻擊下完全不存在，
  而高權限帳號（admin、平台 super-admin）正是會被針對的對象。

## 修正方式

1. **補稽核**（必做）：在 `verifyCredentials()` 的鎖定／`pending`／停用三個「密碼正確但不可登入」分支補 `audit.recordSafely`（`result: 'failure'`、帶 `reason`），平台版同步。
2. **移除 oracle**，擇一：
   - （建議）鎖定期間對正確密碼也回 `AUTH_INVALID_CREDENTIALS`：不透露「鎖定」就不會洩漏「猜中」。這 **不會** 重新開啟帳號列舉——未知帳號本來就在密碼檢查前以 dummy hash 回 `AUTH_INVALID_CREDENTIALS`（L124–135），這個分支只在密碼正確時才會走到。代價是合法使用者在鎖定期間看不到「已鎖定、請稍後」的提示，但真正的猜測節流本來就靠速率限制。
   - 或保留可區分的回應，但在 [`backend/04-auth.md`](../architecture/backend/04-auth.md) §3.3 把鎖定重新定位成「輔助 UX，不是猜測防線」，明確寫出猜測由速率限制承擔，並確認速率限制的帳號桶在鎖定期間照常計數（目前已成立）。

`POST /auth/change-password` 驗證 `currentPassword` 卻沒有速率限制這一點，由 [`auth-endpoints-missing-rate-limit.md`](./auth-endpoints-missing-rate-limit.md) 另行處理。

## 驗證方式

`apps/api/test/account-security.spec.ts`（平台部分在 `apps/api/test/platform-admin.spec.ts`）：

- 補案例：帳號鎖定、停用、`pending` 狀態下以 **正確** 密碼呼叫登入，斷言寫入一筆 `auth.login.failure` 稽核（帶對應 `reason`）。
- 若採建議方案：補案例斷言鎖定期間以正確密碼呼叫回 `AUTH_INVALID_CREDENTIALS`，而不是 `AUTH_ACCOUNT_LOCKED`。
