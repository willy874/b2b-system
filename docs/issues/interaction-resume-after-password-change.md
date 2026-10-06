# 密碼步驟已完成、尚未 resume 的登入互動，在改密碼後仍可換到有效 session

## 現況

登入互動是多步驟的：互動頁 `POST /oidc-interaction/:uid/login` 驗完密碼後呼叫 `finishInteraction`，回傳一個 resume 網址，由瀏覽器頂層跳轉回 provider，provider 才帶授權碼跳回產品（[`04-sso.md`](../architecture/04-sso.md) §3.1–§3.2）。密碼步驟與 resume 之間可以隔一段時間（互動 TTL 1 小時，`apps/api/src/modules/oidc-provider/oidc-provider.constants.ts` 的 `OIDC_TTL.Interaction`）。

改密碼／重設密碼會遞增 `token_version`、撤銷 refresh token、發 `SESSIONS_REVOKED` 銷毀 **既有** 的 IdP session（`apps/api/src/modules/auth/auth.service.ts` 的 `changePassword()` L385–418、`resetPassword()` L495–545），但 **不會** 作廢一個「密碼步驟已完成、還沒 resume」的互動。

resume 時重新解析帳號的 `findAccount()`（`apps/api/src/modules/oidc-provider/oidc-provider.service.ts` L487–514）只檢查 `deletedAt` 與 `status === 'active'`，**不檢查 `token_version`**：

```ts
const user = await this.tenancy.run(tenant.id, () => this.users.findAccountById(account.userId));
if (!user || user.deletedAt || user.status !== 'active') return undefined;   // 沒有比對 token_version
```

改密碼只動 `token_version`，不改 `status`／`deletedAt`，所以 resume 照常鑄出授權碼。BFF `SsoService.callback()`（`apps/api/src/modules/auth/sso.service.ts` L126–148）重新讀使用者、檢查 `status === 'active'` 後即發 session，簽出的 access token 帶的是 **當前（改後）** 的 `token_version`，因此有效。

對照：如果授權碼在改密碼 **前** 就已經鑄出（例如已有 IdP session 時的 silent authorize），改密碼銷毀 session 時那個碼一起失效，`redeemAuthorizationCode` 會回 `AUTH_SSO_CODE_INVALID`。差別就在「互動登入結果」是在 resume 時才鑄碼，而 resume 不重驗 `token_version`。

重現：

1. 持（外洩的）舊密碼者在互動頁完成密碼步驟（`POST /oidc-interaction/:uid/login`），取得 resume 網址但先不跟隨。
2. 帳號本人變更密碼（`token_version` +1、撤銷 refresh、銷毀既有 IdP session）。
3. 持有者在互動 TTL（≤1 小時）內跟隨 resume → provider 重新鑄授權碼 → BFF 兌換 → 取得帶新 `token_version` 的全新 app session（新的 refresh 家族）。

## 影響

- 前提：攻擊者已握有舊密碼，並在本人改密碼 **之前** 完成互動的密碼步驟、握著 resume 網址（或互動 cookie）。
- 結果：「變更密碼使其他裝置全部登出、作為憑證外洩的補救」在有預先開啟互動的情況下不可靠，最長留下約一小時的空窗。
- 平台管理者的互動流程相同（互動頁同一套），同樣受影響。

## 修正方式

擇一或並用：

1. **resume 比對 `token_version`**（建議）：互動建立時記下當下的 `token_version`，`findAccount()`／resume 鑄碼前比對，不符即視為互動失效、要求重新登入。平台管理者的 `findAccount()` 分支（L489–491）也要比對。
2. **作廢未完成的互動**：`SESSIONS_REVOKED`（`userIds` 與 `platformAdminIds`）時，一併作廢該帳號未完成的 `Interaction` payload（`oidc_payloads`）。

## 驗證方式

`apps/api/test/sso.spec.ts`：補一個案例——完成互動的密碼步驟但 **不** 跟隨 resume → 本人改密碼 → 再跟隨 resume（並送 BFF）→ 應回 `AUTH_SSO_CODE_INVALID` 或互動失效，而不是 200 拿到 session。

相關規格：[`backend/04-auth.md`](../architecture/backend/04-auth.md) §4.3、[`04-sso.md`](../architecture/04-sso.md) §3.5、§12.2 D17。
