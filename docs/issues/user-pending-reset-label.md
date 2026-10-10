# 使用者列表的「重設密碼」對未啟用的帳號實際寄的是啟用信

## 現況

`apps/api/src/modules/user/user.service.ts` 590–615 行的 `resetPassword()`：`status === 'pending'` 時改入列
`ACTIVATION_MAIL_JOB`、稽核寫 `user.activation_resent`（註解：啟用信過期或寄送失敗後這是唯一的重寄路徑；
[`backend/13-trash.md`](../architecture/backend/13-trash.md) 的「啟用／重設連結」一列也這樣寫）。

前端不分狀態，一律用重設密碼的文字：

- `apps/backstage/src/features/user/pages/UserList/components/UserTable.tsx` 187–208 行：tooltip 與 `aria-label` 是
  `user.resetPassword.action`，確認框是 `user.resetPassword.title`／`confirm`／`submit`。
- `apps/backstage/src/features/user/locales/zh_TW.json` 42–48 行（`en_US.json` 同位置）：「重設密碼」「會寄送重設密碼的連結到 {{email}}」
  「寄出重設連結」；成功的 toast（`features/user/hooks/useUserMutations.ts` 217 行）是「重設連結已寄出。」

## 影響

- 管理者要幫還沒啟用的人重寄啟用信時，畫面上找不到「重寄啟用信」，只能猜到要按「重設密碼」。
- 按下去之後，確認框與 toast 說寄了重設連結，收件人收到的卻是啟用信；稽核紀錄寫的是 `user.activation_resent`，三者說法不一。

嚴重度低：後端行為正確、與規格一致，只是畫面文字誤導。

## 修正方式

1. `UserTable` 依 `row.original.status === 'pending'` 切換文字：tooltip／`aria-label`「重寄啟用信」、確認框
   「會重新寄送啟用連結到 {{email}}…」、按鈕「寄出啟用信」、toast「啟用信已寄出。」（新增 `user.resendActivation.*`，兩個語系檔）。
   `useUserResetPasswordMutation` 的 `onSuccess` 從 `variables` 帶入狀態，或由呼叫端傳入成功訊息。
2. 圖示可以改成信封（`mail`），讓兩種動作一眼可分。
3. 若使用者詳情頁之後也有這個動作，用同一組文字。

## 驗證方式

`UserTable` 的元件測試：`pending` 的列 → tooltip、確認框與 toast 是啟用信的文字；`active` 的列維持重設密碼的文字。
`features/user/locales/` 的兩個語系檔都有新鍵、鍵一致。

（2026-10-10 backstage 各功能的優化分析發現。）
