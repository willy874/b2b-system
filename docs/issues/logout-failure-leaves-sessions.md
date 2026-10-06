# 登出時後端撤銷失敗或沒送出都不會被發現，IdP session 留著，下一個人可直接以前一個人的身分登入

## 現況

兩個 app 的登出都在 `useLogoutMutation()`（L14–24，兩份內容相同）：

- `apps/backstage/src/features/auth/hooks/useLogoutMutation.ts`
- `apps/platform/src/features/login/hooks/useLogoutMutation.ts`

```ts
// 續期暫時失敗也要登出（使用者按了登出就是要離開）；只是後端無法撤銷
const accessToken = await sessionStore.ensureAccessToken().catch(() => undefined);
sessionStore.endSession(LOGOUT_REASON);
if (accessToken) await revoke({ accessToken });
```

- 續期失敗（離線、5xx、429、逾時）時 `accessToken` 是 `undefined`，**根本不送** `POST /auth/logout`。
- `revoke()` 失敗沒有任何處理：
  - 呼叫端只有 `logout.mutate()`：`apps/backstage/src/app/layouts/DashboardLayout.tsx`（L163）、`apps/platform/src/app/layouts/DashboardLayout.tsx`（L148）。
  - `endSession()` 先觸發 `SessionWatcher` 的 `queryClient.clear()`（`apps/backstage/src/app/App.tsx` L46、`apps/platform/src/app/App.tsx` L44），連 mutation 一起清出快取；`GlobalProvider` 也只處理 403。失敗不會出現在任何地方。
- 登出請求 `fetchLogoutMutation`（兩個 app 的 `apis/auth/logout/fetcher.ts` L13–20）沒有 `keepalive`，關分頁時會被取消。
  `packages/web-core/src/plugins/fetcher/retry.ts`（L12）只重試 GET／HEAD／OPTIONS，POST 失敗不重試。
- 不論後端有沒有撤銷，畫面都導到 `?signedOut=true`，顯示「你已登出。所有產品共用同一組登入，登出後其他產品也會一起登出。」
- 後端只有在 `POST /auth/logout` 成功時，才撤銷 refresh 家族並銷毀 IdP session：
  `apps/api/src/modules/auth/auth.service.ts` 的 `logout()`（L309–326）→ `endIdpSession()`（L333 起）。
  refresh cookie 也只在成功時清掉（`apps/api/src/modules/auth/auth.controller.ts` 的 `logout()`，L99）。
- IdP session 還在時，provider 不顯示登入頁，直接帶授權碼跳回產品（[`04-sso.md`](../architecture/04-sso.md) §3.1）。
  IdP session 的 TTL 是 7 天（`apps/api/src/modules/oidc-provider/oidc-provider.constants.ts` 的 `OIDC_TTL.Session`，L21）。
- `apps/backstage/src/features/auth/hooks/__tests__/useLogoutMutation.test.tsx`（L61–73）把「續期失敗時不撤銷、mutation 仍算成功」寫成預期行為。

重現步驟：

1. 共用電腦上，A 登入 backstage，閒置超過 4.5 分鐘。這時 access token 剩不到 30 秒，按登出會先續期。
2. 按「登出」時網路斷線。api 回 5xx、per-user 限流回 429，或 A 按完立刻關分頁，結果都一樣。
3. 畫面顯示「你已登出」，但伺服器端的 refresh 家族和 apps/platform 上的 IdP session（`_session`）都沒有撤銷。
4. B 打開同一個 backstage，或在已登出頁按「再次登入」，瀏覽器跳到 IdP。
5. IdP session 仍是 A 的，provider 直接帶授權碼跳回。B 不需要密碼，就以 A 的身分進入；其他產品也一樣。

[`frontend/09-state-and-storage.md`](../architecture/frontend/09-state-and-storage.md) §5.2 只規定登出的順序，沒有規定撤銷失敗時怎麼辦。

## 影響

- 情境：共用電腦、kiosk、交接班。使用者以為已經登出，下一個人在 IdP session 的 TTL（最長 7 天）內可以直接以他的身分登入所有產品，包括管理者帳號。
- 前提：登出當下發生暫時性失敗，或請求還沒送完分頁就被關掉。單次機率不高，但失敗時完全沒有提示，使用者無從補救。
- token 快到期時，續期與登出是先後兩個請求，任一個失敗都會落入這個情況。
- 已登入的請求每人每分鐘預設上限 600 次（`apps/api/src/core/config/env.schema.ts` L112 的 `DEFAULT_RATE_LIMIT`）。
  大批次操作十幾秒就可能用完額度（見 [`batch-invalidation-and-rate-limit.md`](./batch-invalidation-and-rate-limit.md)），這時馬上登出會拿到 429。

## 修正方式

1. **失敗時讓使用者知道。** `useLogoutMutation()` 在下面兩種情況要標記「登出未完成」，例如導向 `?signedOut=true&logout=incomplete`：
   - 續期失敗而沒有送出撤銷；
   - `revoke()` 失敗。

   已登出頁看到這個標記時顯示警示：「伺服器端登出未完成，請重試；在共用電腦上請關閉瀏覽器」，並提供「重試登出」。
   兩個 app 一起改，見 [`apps/platform/README.md`](../../apps/platform/README.md) 的「同步規則」。
2. **重試不必依賴 access token。** 後端提供只靠 refresh cookie 的登出，擇一（建議 a）：
   - a. `POST /auth/logout` 沒有 bearer 時，改以 refresh cookie 找家族；比照 `/auth/refresh` 要求 `x-refresh-request: 1`（CSRF 緩解）。
   - b. 另開一個 cookie 認證的登出端點。

   前端在 `ensureAccessToken()` 失敗時改走這條。apps/platform 的 `/platform/auth/logout` 同理。
3. **關分頁不取消請求。** 兩個 `fetchLogoutMutation` 加 `keepalive: true`。
4. （選做）重試仍失敗時，在「重試登出」旁提供前往 IdP end-session 的連結。[`04-sso.md`](../architecture/04-sso.md) §12.2 D5 只排除「自動」跳回 IdP。
5. 修正後在 04-sso.md §3.4 補一句：登出失敗時的提示與重試方式。

## 驗證方式

- 兩個 app 的 `useLogoutMutation.test.tsx`：
  - 改寫「續期暫時失敗時仍然登出」：斷言改走 cookie 登出，或標記登出未完成。
  - 新增：`revoke` 以 `NetworkError`、500、429 reject 時，標記登出未完成。
- fetcher 測試：`fetchLogoutMutation` 送出的 `init` 帶 `keepalive: true`。
- 兩個 app 的登入頁測試：帶 `logout=incomplete` 時顯示警示與「重試登出」。
- `apps/e2e/tests/auth.spec.ts`：
  1. 用 `page.route('**/api/auth/logout', (route) => route.abort())` 讓登出失敗，按登出後斷言出現警示。
  2. 重試成功後再按「再次登入」，斷言看到的是 IdP 的登入互動頁，而不是直接回到首頁。
