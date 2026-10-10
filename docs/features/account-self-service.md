# 個人帳號的自助

- 優先度：P3
- 狀態：提案
- 依賴：認證與 refresh token 家族（[`backend/04-auth.md`](../architecture/backend/04-auth.md) §1、§2、§7）；SSO 與單一登出（[`04-sso.md`](../architecture/04-sso.md) §1.1、§3.3.4、§3.4、§12.6 D11）；
  共用 packages（[`frontend/17-shared-packages.md`](../architecture/frontend/17-shared-packages.md) §2、§3）
- 相關：[`settings-navigation.md`](./settings-navigation.md)（頁內目錄元件 `PageToc` 共用）；[`a11y-mobile.md`](./a11y-mobile.md)（長頁面在窄螢幕的排版）；
  [`platform-security-policy.md`](./platform-security-policy.md)（平台管理者的 session 政策）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

員工對「自己的帳號」能看、能做的事很少，遇到問題只能找管理員：

| 情境 | 現況 | 問題 |
| --- | --- | --- |
| 「我是用公司的 Entra 登入的嗎？連的是哪個帳號？」 | 外部身分只在使用者詳情（`features/user/pages/UserDetail/components/UserIdentitySection.tsx`），`GET /users/:userId/identities` 要 `user:read`（`apps/api/src/modules/identity-provider/user-identity.controller.ts:22-23`） | 一般員工沒有 `user:read`，看不到自己的連結 |
| 手機遺失、在網咖登入忘了登出 | 只能改密碼（`token_version` + 1，**所有** 裝置都登出，[`backend/04-auth.md`](../architecture/backend/04-auth.md) §4.3），或請管理員強制登出 | 沒有「我在哪些裝置登入中」，也不能只登出其中一台；SSO 登入、沒有密碼的人連改密碼這條路都沒有 |
| 個人資料頁 | `features/account/pages/Profile/page.tsx`（169 行）由上往下：頭像、基本資料、變更密碼、MFA、角色與權限、API token | 長頁面沒有分段導覽；MFA 與 API token 在最下面 |

後端其實已有 session 清單需要的資料：`refresh_tokens`（`apps/api/src/db/schema/refresh-tokens.ts`）每一列有 `family_id`（一次登入）、`family_created_at`、`user_agent`、`ip_address`、`client_id`、`idp_session_uid`、`revoked_at`，
以及只索引未撤銷列的 `refresh_tokens_user_active_idx`。登出本來就是「撤銷這個家族、不動 `token_version`」（§7），單一登出以 `idp_session_uid` 撤銷同一個瀏覽器底下所有產品的家族（[`04-sso.md`](../architecture/04-sso.md) §3.4）。

apps/platform 有對應的個人頁（`apps/platform/src/features/account/pages/Profile/page.tsx`，117 行：基本資料、變更密碼、MFA、權限），平台管理者的 session 在平台 DB 的 `platform_refresh_tokens`；
平台管理者 **不開放外部 IdP**（[`04-sso.md`](../architecture/04-sso.md) §12.6 前言），所以外部身分只在 backstage。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 「登入中的裝置」：列出自己未撤銷、未過期的家族（裝置、IP、登入時間、最後活動、產品），標出目前這一台；兩個 app 都有 | 地理位置（IP 轉城市需要外部資料庫） |
| 登出某一台、「登出其他所有裝置」 | 新裝置登入時寄信或通知（開放問題 4） |
| 員工檢視自己連結的外部身分（backstage） | 自己連結新的外部身分（連結由登入時的帳號對應產生，[`04-sso.md`](../architecture/04-sso.md) §3.3） |
| 個人資料頁的分段導覽（頁內目錄或分頁籤），兩個 app 一致 | 社群登入、LDAP（[`04-sso.md`](../architecture/04-sso.md) §12.6 D13 不做） |
| | 管理員檢視他人的 session 清單（開放問題 5） |

## 使用者故事

**作為員工，我希望看到自己在哪些裝置登入中，並登出遺失的那一台，以便不必改密碼也不影響其他裝置。**

- **Given** 我在公司電腦與手機都登入了 backstage
- **When** 我在個人頁的「登入中的裝置」對「iPhone・Safari」按「登出」
- **Then** 那一台的家族被撤銷，最晚在 access token 到期（5 分鐘）後被登出；公司電腦不受影響；稽核記一筆 `auth.sessionRevoke`

**作為以 SSO 登入的員工，我希望確認自己連結的是哪個外部帳號，以便回報登錯人的問題。**

- **Given** 租戶啟用了 `identityProvider`，我以 Entra 登入過
- **When** 我打開個人頁
- **Then** 看到「Entra（OIDC）・alice@corp.example・最後登入 10/09」；沒有解除的按鈕（開放問題 2）

## 初步構想

### 1. 後端

- **登入中的裝置**（`modules/auth`：`auth.controller.ts` 與 `platform-auth.controller.ts` 各一組同形狀的端點）：
  - `GET /auth/sessions`（`@Authenticated()`）：以 `refresh_tokens_user_active_idx` 取自己未撤銷、未過期的列，依 `family_id` 分組，取每個家族最新一列的 `user_agent`、`ip_address`、`created_at`（＝最後續期，當作最後活動）與 `family_created_at`；
    回 `{ id: familyId, current, device, ip, signedInAt, lastActiveAt, client }`。`current` 依請求的 refresh cookie 判斷（cookie 路徑 `/api/auth` 只在續期時送，開放問題 3）。
  - `DELETE /auth/sessions/:familyId`：撤銷那個家族（`revoked_reason = 'user_revoked'`，新的 `RevokedReason`）；家族有 `idp_session_uid` 時比照單一登出，一併銷毀 IdP session 與同一 session 底下其他產品的家族。
  - `POST /auth/sessions/revoke-others`：除了目前的家族以外全部撤銷。
  - 已發出的 access token 仍有效到過期（≤ 5 分鐘，`token_version` 不動，與登出相同，§7）。要立即生效就要另一個機制（開放問題 1）。
  - 推播：撤銷後對那個人推 `session.revoked`（指定家族），讓那台裝置的 `SessionWatcher` 立刻結束；稽核 `auth.sessionRevoke`（`metadata.familyIds`、`scope: 'one' | 'others'`）。
- **自己的外部身分**（`modules/identity-provider`）：`GET /me/identities`（`@Authenticated()`、`@RequireFeature('identityProvider')`），沿用 `IdentityProviderService.listOfUser(actor.id)`；只讀。
- `user_agent` 的解析（瀏覽器、作業系統）放後端回傳結構化欄位，還是前端解析：傾向後端以小型的解析函式產生 `device`，前端只顯示。

### 2. 前端：兩個 app 共用

- `SessionListSection` 放 `packages/web-core/src/components/`（與 `ChangePasswordSection` 同層），以參數接 API，與 `MfaSecuritySection api={mfaSelfApi}` 相同的形式；
  兩個 app 各自在 `features/account/hooks/sessionSelfApi.ts` 包自己的 SDK 呼叫（backstage 打 `/auth/sessions`，platform 打 `/platform/auth/sessions`）。web-core 不呼叫 app 的 API（CLAUDE.md 前端規則 1）。
- `UserIdentitySection` 留在 backstage：個人頁用的唯讀版本放 `features/account/pages/Profile/components/ProfileIdentitySection.tsx`，不跨 feature import `features/user` 的元件；
  共用的只有協定名稱的語系 key，搬到 `app/locales` 的共用區或兩邊各一份（量很小）。
- 個人頁的分段：採頁內目錄（`@b2b-system/ui` 的 `PageToc`，與 [`settings-navigation.md`](./settings-navigation.md) 共用），區段為「個人資料、登入與安全（密碼、MFA、裝置、外部身分）、權限、API token」。
  分頁籤的方案見開放問題 6。
- 語系：兩個 app 的 `locale.ts` 各補裝置、產品名稱（`client_id` → 「後台」「平台」）、撤銷確認的文案；錯誤碼 `AUTH_SESSION_NOT_FOUND` 走 `packages/error-codes` ＋ web-core 的 `ERROR_MESSAGE_KEY`。

### 3. 權限

- 不新增權限鍵：都是自己的資料，`@Authenticated()`。

## 開放問題

1. 撤銷其他裝置後，那台手上的 access token 還能用最多 5 分鐘。可以接受（與登出一致），還是要在 access token 加 `fid`（家族 id）並讓 `AccessTokenVerifier` 檢查撤銷名單（多一次快取查詢）？
2. 員工能否自己解除外部身分的連結？解除後下次登入以 email 重新對應，風險不高；但 super-admin 的反提權規則（§3.3.4）與「只允許 SSO 的網域」要一併考慮。傾向這一版只讀。
3. 「目前這一台」怎麼判斷？refresh cookie 的 path 是 `/api/auth`，`GET /api/auth/sessions` 會帶上 cookie，可以比對雜湊；但 apps/platform 的 path 是 `/api/platform/auth`，端點要放在它底下。
4. 新裝置登入時要不要通知（站內通知或信）？需要定義「新裝置」（user agent ＋ IP 的指紋），誤報多。
5. 管理員要不要看到某人的裝置清單並逐台撤銷？現在只有整個人的強制登出（`token_version`）；做的話權限跟 `user:update`。
6. 個人頁用頁內目錄還是分頁籤？分頁籤可以讓網址記住位置（`?tab=security`），但「變更密碼」的未存變更守衛（`useUnsavedChangesGuard`）要跨分頁處理。

## 設計決策

## 歸檔去向

完成後預計寫成：

- [`backend/04-auth.md`](../architecture/backend/04-auth.md)：新增「登入中的裝置」一節（端點、撤銷、推播、稽核）與 `RevokedReason`
- [`04-sso.md`](../architecture/04-sso.md) §3.3.4 補上 `GET /me/identities`；§6.1、§6.2 的 `account` 說明
- [`frontend/17-shared-packages.md`](../architecture/frontend/17-shared-packages.md) §2 的 web-core 元件清單
