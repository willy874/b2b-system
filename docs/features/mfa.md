# MFA（雙因素驗證）

- 優先度：P3
- 狀態：提案
- 依賴：—
- 相關：[ADR-0019](../adr/0019-sso-identity-platform.md) D15（MFA 預留）、[`../architecture/04-sso.md`](../architecture/04-sso.md) §3、§11、
  [`backend/04-auth.md`](../architecture/backend/04-auth.md)、[`api-tokens.md`](./api-tokens.md)、[`overview/03-roadmap.md`](../overview/03-roadmap.md)「Phase 1 之後」第 3 項

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

管理員帳號能改權限、平台管理者能建立與停用租戶，只靠密碼風險偏高。

登入已經改成 OIDC：backstage 沒有登入頁，所有人都在 apps/auth 的登入互動（`/interaction/:uid`）輸入密碼或選外部 IdP，
api 端由 `sso-interaction.controller` → `SsoService` 驗證之後呼叫 `finishInteraction`（[`../architecture/04-sso.md`](../architecture/04-sso.md) §3.1–§3.3）。
ADR-0019 D15 已預留：**MFA 是登入互動裡的第二步**，插在密碼通過之後、`finishInteraction` 之前，不改協定、不新增 token 類型。

現況：

| | 租戶的使用者 | 平台管理者 |
| --- | --- | --- |
| 帳號表 | 租戶 DB 的 `users`，`mfa_enabled` 已預留但沒有程式讀它 | 平台 DB 的 `platform_admins`，沒有 MFA 欄位 |
| 鎖定 | 門檻是租戶的系統設定（`auth.loginMaxAttempts`、`auth.loginLockoutSeconds`）；只寫 `locked_until`，既有 session 不受影響 | 門檻在 env；鎖定改 `status='locked'` |
| 其他登入路徑 | 外部 IdP（`amr=['ext']`，不受鎖定限制）；**直接 `POST /auth/login`**（保留給測試與腳本） | 無 |

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| TOTP（驗證器 App）：設定（QR code）、驗證、停用 | 簡訊 OTP |
| 一次性備用碼（只存雜湊） | 「記住這台裝置 N 天」 |
| 登入互動的第二步（apps/auth 的互動頁 ＋ api 的互動端點） | |
| 租戶可要求特定角色必須啟用（系統設定） | |
| 管理員重設他人的 MFA（寫稽核、撤銷該使用者的 session） | |
| 平台管理者一律必須啟用 | |
| 直接 `POST /auth/login` 對已啟用 MFA 的帳號拒絕 | |

## 初步構想

### 登入互動

- 密碼通過後，若帳號已啟用 MFA（或屬於必須啟用的角色但還沒設定），互動結果不 `finishInteraction`，而是把「已通過第一步的帳號」存進互動狀態
  （oidc-provider 的 interaction，本來就是多步驟的），回應 `{ next: 'mfa' }` 或 `{ next: 'mfaEnroll' }`。
- apps/auth 的 `features/login` 加 TOTP 輸入與首次設定的畫面；驗證通過才 `finishInteraction`，`amr` 帶 `['pwd', 'otp']`。
- 失敗次數併入既有的鎖定計數（租戶用租戶設定、平台用 env）。
- 外部 IdP 登入：信任外部 IdP 的 MFA，不再要求（見開放問題 2）。
- 直接 `POST /auth/login`：帳號啟用 MFA 就回錯誤；腳本改用 [API token](./api-tokens.md)。

### 資料模型

- 租戶 DB 的 `users`：沿用 `mfa_enabled`，另加 `mfa_secret_encrypted`、`mfa_enrolled_at`；`user_mfa_recovery_codes`（雜湊、使用時間）。
- 平台 DB 的 `platform_admins`：同樣的欄位與表。
- TOTP 密鑰用 `core/crypto` 加密存放（和租戶連線字串同一種做法，金鑰另外設定）。

### 設定與權限

- 租戶：`auth.mfaRequiredRoles`（系統設定；現在的設定只支援純量，要擴充成可以存 slug 陣列，或改成每個角色一個布林欄位）。
- 平台：固定要求，不提供設定。
- 設定自己的 MFA：`@Authenticated()`（backstage 的帳號設定頁，或 apps/auth 的帳號流程頁）。
- 重設他人的 MFA：`user:update`；寫稽核 `user.mfa.reset`，並撤銷那個人的 session（`token_version` 加一）。

## 開放問題

1. WebAuthn／Passkey 要不要一起做？互動頁是同一個，但註冊流程與資料表不同。
2. 外部 IdP 登入要不要另外要求我們的 MFA？信任外部 IdP 比較順，但無法確認對方有做 MFA（可以看 ID token 的 `amr`，各家不一致）。
3. 「特定角色必須啟用」放在角色欄位上，還是系統設定？前者要改角色的資料表與管理頁，後者要讓系統設定支援陣列。
4. MFA 的設定頁放 backstage 的帳號設定，還是 apps/auth？放 apps/auth 可以和平台管理者共用，但租戶使用者平常不會去 apps/auth。
5. 啟用或停用 MFA 時，要不要撤銷其他裝置的 session？

## 歸檔去向

- `docs/architecture/04-sso.md` §3（登入互動的第二步）、`docs/architecture/backend/04-auth.md` 新增章節
- 前端：`apps/auth/README.md`、backstage 的帳號設定
