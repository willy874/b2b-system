# 改密碼後的登出原因可能被推播搶先

## 現況

個人資料頁改密碼成功後，前端以 `sessionStore.endSession('password_changed')` 結束 session，
登入頁據此顯示「密碼已變更，所有裝置都已登出。請用新密碼重新登入。」
（`apps/backstage/src/features/account/pages/Profile/page.tsx` 的 `submitPassword` → `onConfirm`）。

後端在同一個請求裡遞增 `token_version` 並撤銷所有 refresh token，推播 `session.revoked` 給這個使用者的每一條連線。
`RealtimeClient.handleSessionRevoked`（`packages/web-core/src/realtime/RealtimeClient.ts`）也會呼叫 `endSession(reason)`；
`endSession` 只觸發一次（`packages/web-core/src/auth/SessionStore.ts` 的 `endSession`），**先到的原因勝出**。
機器忙的時候推播比 HTTP 回應先被處理，本人會被導到 `/auth/login?signedOut=true&reason=AUTH_TOKEN_STALE`，
看到的是通用的「登入狀態已失效」而不是「密碼已變更」。同一個時間點還在飛的 API 請求收到 `401 AUTH_TOKEN_STALE` 也是同樣的結果。

## 影響

只影響本人那一個分頁的提示文字；登出本身是對的（所有裝置都登出、舊密碼失效）。
E2E（`apps/e2e/tests/account.spec.ts`）在全套並行、CPU 飽和時重現過一次，所以那個案例只斷言「已登出」，不斷言原因。

## 修正方式

送出改密碼前先在 `SessionStore` 標記「即將因改密碼結束」（例：`expectSessionEnd('password_changed')`），
之後不論是推播、HTTP 的 `AUTH_TOKEN_STALE` 還是 mutation 的 `onSuccess` 先到，都以這個原因結束；
請求失敗（密碼錯、太弱）時清掉標記。apps/platform 的個人資料頁若有同樣的流程，一併處理。

## 驗證方式

- web-core 的 `SessionStore` 單元測試：標記後以 `AUTH_TOKEN_STALE` 呼叫 `endSession`，登入頁的原因仍是 `password_changed`。
- 把 `account.spec.ts`「在個人資料頁改密碼」的斷言改回 `reason=password_changed`，以 `--repeat-each=10` 跑。
