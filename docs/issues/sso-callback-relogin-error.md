# SSO 回呼頁的「重新登入」失敗時沒有任何反應

## 現況

`apps/backstage/src/features/auth/pages/SsoCallback/page.tsx` 第 62–70 行：

```tsx
onClick={() => void startSsoLogin(pending?.returnTo)}
```

`startSsoLogin`（`features/auth/sso.ts` 第 12–15 行）先 `fetchCurrentTenantQuery` 查租戶代碼再跳轉。查詢失敗（api 暫時不通、網路斷線）時 promise 被 `void` 丟掉：沒有錯誤訊息、按鈕也沒有載入中狀態，使用者只看到按了沒反應。

同一個函式在登入頁（`pages/Login/page.tsx` 第 32、46 行）有 `.catch((error) => setFailure({ error }))`。

## 影響

登入失敗後的唯一出口失效時，使用者不知道要等、重試還是回報。

嚴重度低：只在 api 不通時發生，重新整理即可恢復。

## 修正方式

- 加一個 `retrying` 狀態給按鈕的 `loading`，`startSsoLogin(...).catch((error) => setExchangeFailure({ message: toMessage(error) }))`、`finally` 收回載入中（成功時頁面已跳走）。
- 失敗訊息沿用頁面上方的 `description`，與兌換失敗同一個位置。

## 驗證方式

- `SsoCallback` 頁面測試補：讓 `fetchCurrentTenantQuery` 的請求失敗，按 `sso-callback-retry` 後顯示錯誤訊息、按鈕可再按；成功時呼叫跳轉。

（2026-10-10 backstage 各功能的優化分析發現。）
