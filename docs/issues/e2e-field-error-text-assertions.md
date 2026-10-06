# E2E 以錯誤訊息的文字斷言（表單欄位錯誤沒有 testid）

## 現況

規範要求 E2E 一律用 `data-testid`，不依文字（[`../conventions/04-testing.md`](../conventions/04-testing.md) §2、
[`../architecture/frontend/10-testing.md`](../architecture/frontend/10-testing.md) §4.4）。但 `@b2b-system/ui` 的 `Field`
顯示的欄位錯誤沒有 testid，有兩處只能比對文字：

- `apps/e2e/tests/account.spec.ts`「目前的密碼打錯」：`profile-password-form` 以 `/密碼不正確|incorrect/i` 比對 `AUTH_PASSWORD_MISMATCH` 的訊息。
- `apps/e2e/tests/auth.spec.ts`「連續 5 次錯誤密碼」：`login-error` 以 `/鎖定|locked/i` 分辨是「鎖定」還是一般的帳密錯誤。

## 影響

改語系檔的措辭，E2E 就會靜默地壞掉；兩個語系以外的語言也比對不到。

## 修正方式

- `Field` 的錯誤訊息加預設的 `data-testid="field-error"`（可由 `testIds` 覆寫），並帶 `data-value` 為錯誤碼——
  前端顯示伺服器錯誤時已經有錯誤碼可用（`reportServerError`）。
- 登入互動頁的 `login-error` 同樣帶 `data-value={錯誤碼}`（例：`AUTH_ACCOUNT_LOCKED`）。
- 兩個 spec 改成 `getByTestIdAndValue(page, 'field-error', 'AUTH_PASSWORD_MISMATCH')` 這類斷言。

## 驗證方式

把兩個語系檔的對應訊息暫時改掉，兩個案例仍然通過；`packages/ui` 的 `Field` 測試涵蓋新的 testid。
