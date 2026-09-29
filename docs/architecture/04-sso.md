# SSO 與身分平台（`apps/auth`）

決定與理由見 [ADR-0019](../adr/0019-sso-identity-platform.md)；身分分屬租戶與平台的部分見
[ADR-0020](../adr/0020-physical-tenant-isolation.md) D5–D11（實作中，[`../features/tenant-isolation.md`](../features/tenant-isolation.md)）。app session 本身（5 分鐘 JWT ＋ 輪替式 refresh cookie）不變，
見 [ADR-0004](../adr/0004-jwt-with-rotating-refresh-token.md) 與 [`backend/04-auth.md`](./backend/04-auth.md)。
`apps/auth` 前端的內部結構與從 backstage 複製的程式碼見 [`apps/auth/README.md`](../../apps/auth/README.md)。

## 1. 全貌

```
                 頂層跳轉（授權碼、end-session）；沒有跨域 cookie、iframe、postMessage
   ┌────────────────────────┐        ┌───────────────────────────────────────────┐        ┌──────────────────┐
   │ backstage（每個租戶一個網域）│◀──▶│ apps/auth :5175（IdP 的 origin，不屬於租戶）│◀──────▶│ 外部 IdP          │
   │ （RP：public client）   │        │  /interaction/:uid  登入互動頁              │        │ Google／Azure AD │
   │ cookie：refresh（本 origin）│    │  /  平台管理者；帳號流程 ?tenant=           │        │ （OIDC）          │
   └──────────┬─────────────┘        │ cookie：IdP session、互動、refresh（本 origin）│       └──────────────────┘
              │ /api                  └──────────────────┬────────────────────────┘
              ▼                                          │ /api
   ┌────────────────────────────────────────────────────▼──────────────────────────────────────┐
   │ apps/api（同一個程序）                                                                        │
   │  modules/oidc-provider   oidc-provider 掛在 /oidc（issuer = apps/auth origin 的 /api/oidc）    │
   │  modules/auth            登入互動端點、BFF（/auth/sso/callback）、外部 IdP 登入（ExternalLoginService）│
   │  modules/identity-provider  外部 IdP 連線、openid-client（RP）、帳號 ↔ 外部身分                │
   └───────────────────────────────────────────────────────────────────────────────────────────┘
```

- **我們自己當 IdP**：`apps/api` 是 OIDC Provider（[`oidc-provider`](https://github.com/panva/node-oidc-provider)），
  `apps/auth` 提供互動頁。每個產品（backstage、之後的編輯器）都是它的 client。
- **外部 IdP 是登入互動裡的一種登入方式**：產品只認識我們的 IdP，不直接接 Google／Azure AD。
- **身分分屬租戶與平台**（ADR-0020 D5–D9）：同一個 email 在每個租戶、在平台都是不同的帳號。
  backstage 的使用者在各租戶 DB；apps/auth 只給平台管理者登入（平台 DB 的 `platform_admins`）。見 §1.1。
- **只拆前端**：`apps/auth` 沒有自己的後端（ADR-0019 D2）。

### 1.1 身分範圍（ADR-0020 D6–D10）

| | 租戶的使用者 | 平台管理者 |
| --- | --- | --- |
| 從哪裡登入 | 租戶網域的 backstage：authorize 帶 `tenant=<代碼>` | apps/auth：client `auth`，不帶 `tenant` |
| 互動頁驗證 | 那個租戶的 DB（`AuthService.verifyCredentials`；外部 IdP 也在那個租戶） | 平台 DB（`PlatformAdminService.verifyCredentials`；沒有外部 IdP） |
| IdP 帳號 id（session、授權碼、`sub`） | `t:{tenantId}:{userId}`；ID token 另有 `tenant` claim（代碼） | `p:{adminId}` |
| BFF | 租戶網域的 `/auth/sso/callback`：授權碼的帳號必須屬於這個網域的租戶 | apps/auth 的 `/platform/auth/sso/callback`：必須是 `p:` |
| access token | 帶 `tid`；只在那個租戶的網域有效 | 帶 `realm: 'platform'`；只在不屬於任何租戶的網域（apps/auth）有效 |
| refresh 家族 | 租戶 DB 的 `refresh_tokens`（cookie path `/api/auth`） | 平台 DB 的 `platform_refresh_tokens`（`/api/platform/auth`） |

- **authorize 的 `tenant`**：backstage 必須帶，而且 redirect URI 的網域要屬於這個租戶（`validateTenantParam`）；
  apps/auth 不能帶。backstage 的 redirect URI 是「任何租戶網域的 `/auth/callback`」（`allowTenantRedirects`，讀網域快照）。
- **換身分要重新登入**：IdP session 的帳號與這次要求的租戶（或平台）不同時，互動 policy 的 `realm_mismatch` 要求登入，
  並把舊身分從 session 拿掉（清帳號與 grant、換新的 `uid`）。舊身分的 app session 仍綁在舊的 uid 上，
  所以同時開兩個租戶的 backstage 可以，各自登出互不影響。
- **租戶的公開資訊**：`GET /tenant/current`（這個網域的租戶，backstage 登入前取得代碼）、
  `GET /tenants/lookup?code=`（租戶的登入入口，帳號流程完成後回去登入）。

## 2. Origin 與 cookie（ADR-0019 D6）

| Cookie | 設定者 | 所在 origin | Path | 用途 |
| --- | --- | --- | --- | --- |
| `_session`（oidc-provider） | api | apps/auth | `/` | IdP session：「這台瀏覽器登入過平台」 |
| `_interaction`、`_interaction_resume` | api | apps/auth | `/api/oidc-interaction/:uid`、`/api/oidc/auth/:uid` | 一次登入互動的憑證 |
| `refresh_token` | api | 每個產品各一份 | `/api/auth` | 租戶使用者的 app session（ADR-0004） |
| `refresh_token` | api | apps/auth | `/api/platform/auth` | 平台管理者的 app session |

- 全部 **host-only**（不設 `Domain`），只有設定它的 origin 讀得到；`SameSite=Lax`、`HttpOnly`、production `Secure`。
- 身分只經由頂層跳轉帶的一次性授權碼傳遞。**不用 iframe、不做 `prompt=none` 靜默續期、不以 `postMessage` 傳 token**。
  產品不必和 apps/auth 同站。
- 各 origin 都以自己的 `/api` 反向代理到同一個 api。oidc-provider 依 `OIDC_ISSUER` 還原被代理去掉的 `/api` 前綴與 Host，
  產生的網址與 cookie path 才是瀏覽器看到的（D16）。

## 3. 流程

### 3.1 產品登入（授權碼 ＋ PKCE ＋ BFF，D3）

```
backstage /auth/login
  └─ createAuthorizationUrl()：產生 state、PKCE verifier（存本分頁 sessionStorage，以 state 為鍵）
  └─ GET /api/tenant/current 取得這個網域的租戶代碼
  └─ 頂層跳轉 → {issuer}/auth?client_id=backstage&tenant=<代碼>&redirect_uri=…/auth/callback&code_challenge=…&state=…
       provider：redirect URI 是租戶網域、tenant 與它同一個租戶（否則帶 invalid_request 導回）
       provider：沒有 IdP session → 303 /api/oidc-interaction/:uid（設互動 cookie）→ 302 apps/auth /interaction/:uid
       （登入互動，§3.2／§3.3）
       provider：303 redirect_uri?code&state
backstage /auth/callback
  └─ readPendingLogin(state) 取回 verifier → POST /api/auth/sso/callback { code, codeVerifier, clientId, redirectUri }
       api：本程序內兌換授權碼（存在、未用過、未過期、client 與 redirect URI 相符、PKCE；重放時撤銷整個 grant）
            → 帳號的租戶必須是這個網域的租戶（ADR-0020 D10）
            → 發 access token（帶 tid、sid）＋ 本 origin 的 refresh cookie（refresh_tokens 記 client_id、idp_session_uid）
  └─ router.history.replace(returnTo)
```

- 已有 IdP session 時，provider 直接帶授權碼跳回，使用者看不到任何頁面（跨產品免登入）。
- 第一方 client 不出現同意頁：第一次授權時直接建立 grant（D7）。
- `POST /auth/login`（直接以帳密發 app session）保留給 API 測試與腳本；瀏覽器的登入一律走上面的流程。

### 3.2 登入互動：密碼

`apps/auth` 的 `/interaction/:uid` 呼叫同一路徑底下的端點（互動 cookie 就是憑證，端點是 `@Public()`）：

1. `GET /oidc-interaction/:uid/details`：client 名稱、`login_hint`、`tenant`（`{ code, name }`；平台管理者的登入是 `null`）
   （互動無效 → `AUTH_SSO_INTERACTION_INVALID`）。頁面顯示租戶名稱；有租戶時才有「忘記密碼」「申請帳號」（連結帶 `?tenant=`）。
2. `POST …/:uid/login { email, password }`：有租戶時在那個租戶裡以 `AuthService.verifyCredentials` 檢查
   （鎖定、帳號狀態、只允許 SSO 的網域、稽核）；沒有租戶時以 `PlatformAdminService.verifyCredentials`（寫平台稽核）。
   成功回傳 resume 網址。
3. 頁面 **頂層跳轉** 到 resume 網址（fetch 跟隨跳轉時 IdP session cookie 設不起來）。
4. `POST …/:uid/abort`：取消，產品收到 `error=access_denied`。

### 3.3 登入互動：外部 IdP（D8–D10）

```
apps/auth /interaction/:uid
  └─ email 欄 blur → GET /oidc-interaction/:uid/discover?email=  → { provider: {id,name} | null, ssoOnly }
  └─ 「使用 X 登入」→ POST …/:uid/external { providerId } → { redirectTo }
       api：state、nonce、PKCE verifier、互動 id、租戶 id 存 oidc_payloads（type ExternalLogin，10 分鐘）
  └─ 頂層跳轉 → 外部 IdP 的授權端點（redirect_uri = 固定的 …/api/oidc-interaction/external/callback）
外部 IdP → GET /oidc-interaction/external/callback?code&state
  api：以 state 找回登入狀態 → 進入它記下的租戶 → openid-client 兌換、驗 ID token（email 不在 ID token 時查 userinfo）→ 對應帳號
       成功 → 302 …/api/oidc-interaction/:uid/external/complete?ticket=<state>
       失敗 → 302 apps/auth /interaction/:uid?error=<錯誤碼>（找不到登入狀態 → /error?error=AUTH_SSO_EXTERNAL_FAILED）
GET …/:uid/external/complete?ticket=   （這個路徑帶得到互動 cookie）
  api：消耗 ticket（只能用一次、互動 id 要相符）→ 完成互動（amr = ['ext']）→ 303 resume，之後同 §3.1
```

- 外部 IdP 大多要求 redirect URI 完全相符，所以 callback 是固定網址、不帶互動 id；互動 cookie 的 path 是互動網址，
  固定的 callback 帶不到它，因此多跳一次 `complete`。
- callback **不拋例外**：任何錯誤都變成跳回互動頁並帶錯誤碼，稽核 `auth.login.failure`（`metadata.method = 'sso'`、`reason`）。

**帳號對應**（`ExternalLoginService.resolveAccount`）：

| 順序 | 條件 | 結果 |
| --- | --- | --- |
| 1 | `(provider_id, subject)` 已連結 | 那個帳號（之後 email 變了、沒有 email 都一樣） |
| 2 | 外部 IdP 回報 `email_verified = true` 的 email 對上既有帳號 | 連結後登入，稽核 `userIdentity.link` |
| 3 | 連線是 `auto_create`，且 email 網域是這個連線登記的網域 | 建立 **沒有任何角色** 的已啟用帳號並連結 |
| 4 | 其他 | `AUTH_SSO_ACCOUNT_NOT_FOUND` |

帳號是 `pending`／`locked`／停用時回對應的 `AUTH_ACCOUNT_*`。

**網域**（`identity_provider_domains`）：一個網域只屬於一個連線。設為「只允許 SSO」時，互動頁不顯示密碼欄，
`verifyCredentials` 在查帳號 **之前** 回 `AUTH_SSO_REQUIRED`（不洩漏帳號是否存在），`forgotPassword` 不寄信（回應不變）。

### 3.4 單一登出（D5）

```
任一產品 POST /api/auth/logout（帶本 origin 的 refresh cookie）
  api：撤銷這個家族；家族有 idp_session_uid 時
       ├─ 銷毀那個 IdP session（oidc_payloads）
       ├─ 撤銷同一個 IdP session 底下所有產品的家族（revoked_reason = sso_logout）
       └─ DomainEventBus → SESSIONS_REVOKED { idpSessionUids } → 推播到 room sid:{uid}
  產品：停在「已登出」頁（?signedOut=true），不自動跳回 IdP
```

- 全部在伺服器端完成，不必碰其他 origin 的 cookie；**不** 遞增 `token_version`（那會連其他裝置一起登出）。
- 一個 IdP session 只屬於一個身分（§1.1），撤銷的是那個身分所在的 DB 的家族：租戶網域的 `/auth/logout` 撤銷那個租戶的，
  apps/auth 的 `/platform/auth/logout` 撤銷平台的。
- 不自動跳回 IdP：頁面卸載會取消還在路上的登出請求，使用者會被尚未銷毀的 IdP session 直接登回來。
  前端的 `SessionWatcher` 只在「這個分頁曾經有 session」時才在 session 消失後導向登入頁。
- 離線的分頁要等下一次續期失敗才發現；已發出的 access token 最多再活 5 分鐘。

### 3.5 帳號停用、刪除、憑證失效（D17）

`SESSIONS_REVOKED { userIds }` 時（事件在租戶的脈絡裡發佈，帳號 id 是 `t:{tenantId}:{userId}`），這些人的 IdP session 一起銷毀。provider 的 `findAccount` 找不到可用的帳號時，
清掉 session 上的帳號、改走登入互動（否則 provider 會在沒有帳號的情況下檢查同意而拋錯）。

## 4. 端點

| Method | Path（瀏覽器看到的前綴 `/api`） | 宣告 | 說明 |
| --- | --- | --- | --- |
| * | `/oidc/*` | （oidc-provider，middleware） | discovery、`/auth`、`/token`、JWKS、end-session |
| POST | `/auth/sso/callback` | `@Public` | 租戶網域的 BFF：授權碼 ＋ PKCE 換 app session |
| POST | `/platform/auth/sso/callback` | `@Public` | apps/auth 的 BFF（平台管理者）；`/platform/auth/refresh`、`logout`、`profile` 同 `/auth/*`。租戶網域上回 `PLATFORM_ONLY` |
| GET | `/tenant/current` | `@Public` | 這個網域的租戶（代碼、名稱） |
| GET | `/tenants/lookup?code=` | `@Public` | 租戶的登入入口（`loginUrl`）；找不到或停用一律 `TENANT_NOT_FOUND` |
| GET | `/oidc-interaction/:uid` | `@Public` | 設互動 cookie 的路徑，302 到 apps/auth |
| GET | `/oidc-interaction/:uid/details` | `@Public` | 互動資訊 |
| POST | `/oidc-interaction/:uid/login` | `@Public` | 密碼登入 |
| POST | `/oidc-interaction/:uid/abort` | `@Public` | 取消 |
| GET | `/oidc-interaction/:uid/discover` | `@Public` | email 網域 → 外部 IdP 連線 |
| POST | `/oidc-interaction/:uid/external` | `@Public` | 發起外部 IdP 登入 |
| GET | `/oidc-interaction/external/callback` | `@Public` | 外部 IdP 跳回（固定網址） |
| GET | `/oidc-interaction/:uid/external/complete` | `@Public` | 以 ticket 完成互動 |
| GET／POST／PATCH／DELETE | `/identity-providers`（`/:id`） | `identityProvider:read／create／update／delete` | 外部 IdP 連線管理（租戶網域，backstage） |

權限見 [`../rbac/02-permission-catalog.md`](../rbac/02-permission-catalog.md) §2.11；完整端點表見 [`backend/05-rbac.md`](./backend/05-rbac.md) §9。

## 5. 資料模型

| 表 | 內容 |
| --- | --- |
| `oidc_payloads`（平台 DB） | oidc-provider 的通用儲存（`Session`、`Interaction`、`Grant`、`AuthorizationCode`…）與外部登入的暫存（`ExternalLogin`）；`expires_at`、`consumed_at`，過期的列由背景工作 `oidc.cleanup`（`OIDC_CLEANUP_CRON`）清除 |
| `refresh_tokens.client_id`、`idp_session_uid` | 這條家族屬於哪個產品、哪個 IdP session（單一登出用） |
| `platform_admins`、`platform_refresh_tokens`、`platform_audit_logs`（平台 DB） | 平台管理者、他們的 app session 與稽核（ADR-0020 D5、D19）；第一位由 `db:seed` 依 `PLATFORM_ADMIN_EMAIL` 建立 |
| `identity_providers`（租戶 DB，以下同） | 外部 IdP 連線：`name`（未刪除者唯一）、`issuer`、`client_id`、`client_secret_encrypted`、`scopes`、`enabled`、`unmatched_policy`（`reject`／`auto_create`）；軟刪除 |
| `identity_provider_domains` | `domain`（citext，主鍵）→ `provider_id`、`sso_only` |
| `user_identities` | 帳號 ↔ 外部身分：`(provider_id, subject)` 唯一；連結當下的 `email`、`last_login_at` |

沒有 `oidc_clients` 表：第一方 client 由設定產生（D7，§8）。

## 6. 前端

### 6.1 產品端（backstage；之後的產品照抄）

| 位置 | 內容 |
| --- | --- |
| `core/auth/sso.ts` | `createAuthorizationUrl`（state、PKCE S256）、`readPendingLogin`／`discardPendingLogin`（verifier 以 state 為鍵存本分頁 sessionStorage）、`safeReturnTo`（只接受同源相對路徑） |
| `features/auth/pages/Login` | `/auth/login`：取得這個網域的租戶代碼（`GET /tenant/current`）後跳到 IdP；`?signedOut=true` 時不自動跳，顯示「再次登入」 |
| `features/identity-provider` | `/identity-provider`：這個租戶的外部 IdP 連線（`identityProvider:*`，ADR-0020 D18）；顯示要登記在外部 IdP 的 redirect URI |
| `features/auth/pages/SsoCallback` | `/auth/callback`：換 session 後 `router.history.replace(returnTo)`；`error=access_denied` 顯示「已取消」 |
| `app/App.tsx` 的 `SessionWatcher` | 單一登出或續期失敗時導向 `/auth/login?signedOut=true` |

### 6.2 apps/auth

| Feature | 路由 | 說明 |
| --- | --- | --- |
| `login` | `/interaction/:uid`、`/error`、`/login`、`/callback`、`/forgot-password`、`/reset-password`、`/setup`、`/register` | IdP 的互動頁（租戶或平台，§1.1）；provider 的協定錯誤頁；apps/auth 自己的頁面經 SSO 登入（client `auth`，平台管理者）；帳號流程 |
| `home` | `/` | 目前登入的平台管理者 |

帳號流程的信中連結以 `AUTH_APP_URL` 開頭並帶 `?tenant=<代碼>`（`MailService.accountLink`，[`backend/11-mail.md`](./backend/11-mail.md)）。
頁面以 `X-Tenant` 標頭把租戶送給 api（這個標頭只在 apps/auth 的網域有效，租戶網域上以網域為準）；沒有 `?tenant=` 時顯示
「請從租戶的登入頁或信中的連結進入」。完成後以 `GET /tenants/lookup` 回到那個租戶的 backstage 登入。
backstage 已經沒有這些頁面：SSO 之前寄出、指向 backstage `/auth/setup` 等的舊連結會是找不到頁面，要請管理員重寄。
apps/auth 這一版沒有推播：寫入後的快取失效只在本分頁與其他分頁（BroadcastChannel）。

## 7. 設定與部署

| 變數 | 用途 | production |
| --- | --- | --- |
| `AUTH_APP_URL` | apps/auth 的 origin：互動頁、錯誤頁、帳號流程連結；第一方 client `auth` 的 redirect URI 開頭 | 必填（compose 由 `AUTH_PUBLIC_ORIGIN` 產生） |
| `APP_PUBLIC_URL` | 預設租戶的 backstage origin；信中連結的協定（各租戶的網域在平台 DB 的 `tenant_domains`） | 必填（`PUBLIC_ORIGIN`） |
| `PLATFORM_REFRESH_COOKIE_PATH` | 平台管理者的 refresh cookie path | 預設 `/api/platform/auth` |
| `PLATFORM_ADMIN_EMAIL`、`PLATFORM_ADMIN_PASSWORD` | 第一位平台管理者（`db:seed`） | compose 的 migrate 必填 email |
| `OIDC_ISSUER` | `{AUTH_APP_URL}/api/oidc` | 必填 |
| `OIDC_JWKS` | 簽 ID token 的私鑰（JWKS JSON）；輪替時新舊並存一個 access token TTL | 必填（沒設時啟動時產生臨時金鑰） |
| `OIDC_COOKIE_KEYS` | 簽 IdP cookie 的金鑰，逗號分隔，第一把用來簽 | 必填 |
| `IDP_SECRET_KEY` | AES-256-GCM 加密外部 IdP 的 client secret（32 bytes，base64） | 必填（沒設時由 `JWT_SECRET` 以 HKDF 推導，只給開發用） |
| `OIDC_CLEANUP_CRON` | 清除過期 `oidc_payloads` | 預設 `45 3 * * *` |
| `VITE_OIDC_ISSUER`、`VITE_AUTH_APP_URL` | 前端（backstage、apps/auth）**建置時** 寫進產物 | Dockerfile 的 build arg |

- `docker-compose.prod.yml`：`auth` 服務（`apps/auth/Dockerfile`，`deploy/nginx.auth.conf`）是獨立的 origin（預設 `:8081`），
  同樣以 `/api/*` 反向代理到 api；沒有 `/api/socket.io/` 與 `/storage/`。CSP 有 `frame-ancestors 'none'`（登入頁防點擊劫持）。
- 金鑰產生的例子：`OIDC_COOKIE_KEYS` 與 `IDP_SECRET_KEY` 用 `openssl rand -base64 32`；`OIDC_JWKS` 用
  `node -e "import('jose').then(async j=>{const k=await j.generateKeyPair('RS256',{extractable:true});const jwk=await j.exportJWK(k.privateKey);console.log(JSON.stringify({keys:[{...jwk,alg:'RS256',use:'sig',kid:crypto.randomUUID()}]}))})"`（在 `apps/api` 目錄執行）。
- **換 `IDP_SECRET_KEY` 會讓既有連線的 secret 解不開**：換之前在管理頁重新輸入每個連線的 secret。

## 8. 新增一個產品（第一方 client）

1. api：`oidc-provider.constants.ts` 的 `OIDC_CLIENT`、`OIDC_CLIENT_PATHS` 加一列；`OidcProviderService.clients()` 的 origin 對照加上它的 env。
2. 產品前端：複製 backstage 的 §6.1（`sso.ts` 改 client id），`/auth/callback` 的路徑與 `OIDC_CLIENT_PATHS` 一致。
3. 部署：產品自己的 origin 以 `/api` 反向代理到 api；refresh cookie 是它自己的 host-only cookie，不需要和 apps/auth 同站。
4. 互動頁的 client 名稱：apps/auth `features/login/constants.ts` 的 `CLIENT_NAME_KEY` 與語系檔。

第三方 client（非本平台）要有同意頁與 `oidc_clients` 表，這一版不支援。

## 9. 錯誤

| 情境 | 使用者看到 |
| --- | --- |
| 協定錯誤（未登記的 redirect URI、不認識的 client） | apps/auth 的 `/error?error=<OIDC 錯誤>`，**絕不導回**（D7） |
| 互動過期、沒有互動 cookie | 互動頁顯示 `AUTH_SSO_INTERACTION_INVALID` |
| 授權碼失效、重放、PKCE 不符 | 產品的 callback 頁顯示 `AUTH_SSO_CODE_INVALID`，可重新登入 |
| 在互動頁按取消 | 產品的 callback 頁顯示「已取消」 |
| 外部 IdP 失敗、找不到帳號、連線停用 | 回到互動頁並顯示 `AUTH_SSO_EXTERNAL_FAILED`／`AUTH_SSO_ACCOUNT_NOT_FOUND`／`AUTH_SSO_PROVIDER_UNAVAILABLE` |
| 只允許 SSO 的網域用密碼登入 | `AUTH_SSO_REQUIRED` |
| backstage 的 authorize 沒帶 `tenant`、租戶不存在、或與 redirect URI 的網域不符 | 帶 `invalid_request` 導回那個 backstage 的 callback |
| 平台的端點在租戶網域上呼叫 | `PLATFORM_ONLY` |

## 10. 測試

| 層 | 檔案 |
| --- | --- |
| api 整合 | `apps/api/test/sso.spec.ts`（授權碼流程、重放、單一登出、帳號停用；ADR-0020：tenant 參數、換租戶重新登入、BFF 的租戶檢查、平台管理者、X-Tenant、租戶公開端點）、`sso-external.spec.ts`（以假的 `ExternalOidcClient` 覆寫 provider：帳號對應、只允許 SSO、連線管理） |
| 前端 | 兩個 app 的 `SsoCallback`、`Login` 頁；apps/auth 的 `Interaction`（含外部 IdP、租戶連結）與 `ForgotPassword`；backstage 的 `IdentityProviderList`（三個權限案例） |
| E2E | `apps/e2e/tests/auth.spec.ts`（登入、租戶帳號進 apps/auth 要以平台管理者重新登入、從 backstage 登出）、`sso.spec.ts`（取消、協定錯誤、平台的登入頁登不進租戶帳號、平台管理者登出、外部 IdP 頁的權限）、`sso-external.spec.ts`（模擬外部 IdP 的完整登入）、`mail.spec.ts`（帳號流程） |

`pnpm dev:mock-idp` 啟動模擬的外部 IdP（`http://localhost:4455`，client `b2b-mock`／`mock-secret`；登入頁輸入任何 email 都算登入成功，
`email_verified = true`）；Playwright 設定會自動啟動它。

## 11. 已知限制

- 找不到帳號時「走審批」沒有做：現有審批以密碼建立帳號，SSO 帳號沒有密碼（ADR-0019 D10）。
- 網域所有權沒有驗證（DNS TXT）：由平台管理員自行確認。
- 外部 IdP 的群組不對應到角色（等 [`user-groups.md`](../features/user-groups.md)）；沒有解除外部身分連結的畫面。
- Azure AD 預設不回 `email_verified`：以 email 連結既有帳號不會成立，只能靠 `auto_create` 或已連結的身分。
- 登入互動預留了第二步（MFA，D15），這一版沒有實作。
