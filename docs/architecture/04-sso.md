# SSO 與身分平台（`apps/platform`）

決定與理由見 §12；身分分屬租戶與平台的部分見
[`architecture/05-tenancy.md`](05-tenancy.md) §10.2 D5–D11（[`05-tenancy.md`](./05-tenancy.md)）。app session 本身（5 分鐘 JWT ＋ 輪替式 refresh cookie）不變，
見 [`backend/04-auth.md`](backend/04-auth.md) §10 與 [`backend/04-auth.md`](./backend/04-auth.md)。
`apps/platform` 前端的內部結構與從 backstage 複製的程式碼見 [`apps/platform/README.md`](../../apps/platform/README.md)。

## 1. 全貌

```
                 頂層跳轉（授權碼、end-session）；沒有跨域 cookie、iframe、postMessage
   ┌────────────────────────┐        ┌───────────────────────────────────────────┐        ┌──────────────────┐
   │ backstage（每個租戶一個網域）│◀──▶│ apps/platform :5175（IdP 的 origin，不屬於租戶）│◀──────▶│ 外部 IdP          │
   │ （RP：public client）   │        │  /interaction/:uid  登入互動頁              │        │ OIDC：Google、    │
   │ cookie：refresh（本 origin）│    │  /  平台管理者；帳號流程 ?tenant=           │        │ Entra、Okta…      │
   │                        │        │  通行金鑰（WebAuthn，RP ID = 這個網域）     │        │ SAML 2.0：ADFS…   │
   └──────────┬─────────────┘        │ cookie：IdP session、互動、refresh（本 origin）│       └──────────────────┘
              │ /api                  └──────────────────┬────────────────────────┘
              ▼                                          │ /api
   ┌────────────────────────────────────────────────────▼──────────────────────────────────────┐
   │ apps/api（同一個程序）                                                                        │
   │  modules/oidc-provider   oidc-provider 掛在 /oidc（issuer = apps/platform origin 的 /api/oidc）    │
   │  modules/auth            登入互動端點、BFF（/auth/sso/callback）、外部 IdP 登入（ExternalLoginService）│
   │  modules/identity-provider  外部 IdP 連線、openid-client（OIDC RP）、node-saml（SAML SP）、帳號 ↔ 外部身分 │
   └───────────────────────────────────────────────────────────────────────────────────────────┘
```

- **我們自己當 IdP**：`apps/api` 是 OIDC Provider（[`oidc-provider`](https://github.com/panva/node-oidc-provider)），
  `apps/platform` 提供互動頁。每個產品（backstage、之後建在骨架上的其他前端）都是它的 client。
- **外部 IdP 是登入互動裡的一種登入方式**：產品只認識我們的 IdP，不直接接 Google／Azure AD。外部 IdP 可以是 OIDC（含 Google、Entra、Okta、Keycloak 的範本）
  或 SAML 2.0（§3.3）；登入互動裡另有以通行金鑰取代密碼的登入（§3.6）。決定與理由見 §12.6。
- **身分分屬租戶與平台**（[`architecture/05-tenancy.md`](05-tenancy.md) §10.2 D5–D9）：同一個 email 在每個租戶、在平台都是不同的帳號。
  backstage 的使用者在各租戶 DB；apps/platform 只給平台管理者登入（平台 DB 的 `platform_admins`）。見 §1.1。
- **只拆前端**：`apps/platform` 沒有自己的後端（§12.2 D2）。

### 1.1 身分範圍（[`architecture/05-tenancy.md`](05-tenancy.md) §10.2 D6–D10）

| | 租戶的使用者 | 平台管理者 |
| --- | --- | --- |
| 從哪裡登入 | 租戶網域的 backstage：authorize 帶 `tenant=<代碼>` | apps/platform：client `auth`，不帶 `tenant` |
| 互動頁驗證 | 那個租戶的 DB（`AuthService.verifyCredentials`；外部 IdP 也在那個租戶） | 平台 DB（`PlatformAdminService.verifyCredentials`；沒有外部 IdP） |
| IdP 帳號 id（session、授權碼、`sub`） | `t:{tenantId}:{userId}`；ID token 另有 `tenant` claim（代碼） | `p:{adminId}` |
| BFF | 租戶網域的 `/auth/sso/callback`：授權碼的帳號必須屬於這個網域的租戶 | apps/platform 的 `/platform/auth/sso/callback`：必須是 `p:` |
| access token | 帶 `tid`；只在那個租戶的網域有效 | 帶 `realm: 'platform'`；只在不屬於任何租戶的網域（apps/platform）有效 |
| refresh 家族 | 租戶 DB 的 `refresh_tokens`（cookie path `/api/auth`） | 平台 DB 的 `platform_refresh_tokens`（`/api/platform/auth`） |

- **authorize 的 `tenant`**：backstage 必須帶，而且 redirect URI 的網域要屬於這個租戶（`validateTenantParam`）；
  apps/platform 不能帶。backstage 的 redirect URI 是「任何租戶網域的 `/auth/callback`」（`allowTenantRedirects`，讀網域快照）。
- **換身分要重新登入**：IdP session 的帳號與這次要求的租戶（或平台）不同時，互動 policy 的 `realm_mismatch` 要求登入，
  並把舊身分從 session 拿掉（清帳號與 grant、換新的 `uid`）。舊身分的 app session 仍綁在舊的 uid 上，
  所以同時開兩個租戶的 backstage 可以，各自登出互不影響。
- **租戶的公開資訊**：`GET /tenant/current`（這個網域的租戶，backstage 登入前取得代碼）、
  `GET /tenants/lookup?code=`（租戶的登入入口，帳號流程完成後回去登入）。

## 2. Origin 與 cookie（§12.2 D6）

| Cookie | 設定者 | 所在 origin | Path | 用途 |
| --- | --- | --- | --- | --- |
| `_session`（oidc-provider） | api | apps/platform | `/` | IdP session：「這台瀏覽器登入過平台」 |
| `_interaction`、`_interaction_resume` | api | apps/platform | `/api/oidc-interaction/:uid`、`/api/oidc/auth/:uid` | 一次登入互動的憑證 |
| `refresh_token` | api | 每個產品各一份 | `/api/auth` | 租戶使用者的 app session（[`backend/04-auth.md`](backend/04-auth.md) §10） |
| `refresh_token` | api | apps/platform | `/api/platform/auth` | 平台管理者的 app session |

- 全部 **host-only**（不設 `Domain`），只有設定它的 origin 讀得到；`SameSite=Lax`、`HttpOnly`、production `Secure`。
- 身分只經由頂層跳轉帶的一次性授權碼傳遞。**不用 iframe、不做 `prompt=none` 靜默續期、不以 `postMessage` 傳 token**。
  產品不必和 apps/platform 同站。
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
       provider：沒有 IdP session → 303 /api/oidc-interaction/:uid（設互動 cookie）→ 302 apps/platform /interaction/:uid
       （登入互動，§3.2／§3.3）
       provider：303 redirect_uri?code&state
backstage /auth/callback
  └─ readPendingLogin(state) 取回 verifier → POST /api/auth/sso/callback { code, codeVerifier, clientId, redirectUri }
       api：本程序內兌換授權碼（存在、未用過、未過期、client 與 redirect URI 相符、PKCE；重放時撤銷整個 grant）
            → 帳號的租戶必須是這個網域的租戶（[`architecture/05-tenancy.md`](05-tenancy.md) §10.2 D10）
            → 發 access token（帶 tid、sid）＋ 本 origin 的 refresh cookie（refresh_tokens 記 client_id、idp_session_uid）
  └─ router.history.replace(returnTo)
```

- 已有 IdP session 時，provider 直接帶授權碼跳回，使用者看不到任何頁面（跨產品免登入）。
- 第一方 client 不出現同意頁：第一次授權時直接建立 grant（D7）。
- `POST /auth/login`（直接以帳密發 app session）保留給 API 測試與腳本；瀏覽器的登入一律走上面的流程。

### 3.2 登入互動：密碼

`apps/platform` 的 `/interaction/:uid` 呼叫同一路徑底下的端點（互動 cookie 就是憑證，端點是 `@Public()`）：

1. `GET /oidc-interaction/:uid/details`：client 名稱、`login_hint`、`uiLocales`、`tenant`（`{ code, name }`；平台管理者的登入是 `null`）
   （互動無效 → `AUTH_SSO_INTERACTION_INVALID`）。頁面顯示租戶名稱；有租戶時才有「忘記密碼」「申請帳號」（連結帶 `?tenant=`）。
   `uiLocales` 是 authorize 帶的 OIDC `ui_locales`：backstage 導來登入時帶自己目前的介面語系，互動頁取第一個支援的語系切換
   （並記在 apps/platform 這個瀏覽器）——兩個網域的 localStorage 不共用，不帶的話登入頁永遠用 apps/platform 自己的設定。
2. `POST …/:uid/login { email, password }`：有租戶時在那個租戶裡以 `AuthService.checkCredentials`（`UserLoginService`）檢查
   （鎖定、帳號狀態、只允許 SSO 的網域、稽核）；沒有租戶時以 `PlatformAdminService.verifyPassword`（寫平台稽核）。
   通過後交給 MFA 判斷（[`backend/21-mfa.md`](./backend/21-mfa.md) §4.1）：不需要第二步時完成互動、回傳 resume 網址；
   需要時回傳下一步 `{ next: 'mfa', factors, recoveryAvailable }` 或 `{ next: 'mfaEnroll', methods }`（回應是 `SsoLoginResult` union），
   密碼通過時 **不** 寫 `result.login`。「登入成功」的副作用（失敗計數歸零、記住來源、成功的稽核）在第二步也通過之後才寫。被限流（`429 RATE_LIMITED`，`details.retryAfterSeconds`）時，頁面倒數到可以再試為止：
   送出鈕停用並顯示剩餘秒數、錯誤訊息跟著更新，數完就收起（`useCountdown`，`@b2b-system/web-shared/hooks`）。
3. 第二步（[`backend/21-mfa.md`](./backend/21-mfa.md) §4）：狀態存 `oidc_payloads` 的 `MfaPending`（id 是互動 uid、10 分鐘），
   端點同樣在 `/oidc-interaction/:uid/` 底下、`@Public()`：

   | 端點 | 用途 |
   | --- | --- |
   | `POST …/:uid/mfa/challenge { factorId }` | 請伺服器發出驗證碼（Email 之類 `challenge = 'server'` 的方式） |
   | `POST …/:uid/mfa/verify { factorId \| 'recovery', challengeId?, payload }` | 驗證碼或備用碼；成功時完成互動（`amr = ['pwd', 'mfa', <方式>]`），回傳 resume 網址 |
   | `POST …/:uid/mfa/enroll { method }`、`…/enroll/:factorId/challenge`、`…/enroll/:factorId/confirm` | 必須啟用而還沒設定：在互動中設定；確認後回傳備用碼與 resume 網址 |

   錯誤併入帳號的鎖定與漸進延遲；同一個互動錯 5 次作廢（`AUTH_MFA_TOO_MANY_ATTEMPTS`），要從密碼重新開始。
4. 頁面 **頂層跳轉** 到 resume 網址（fetch 跟隨跳轉時 IdP session cookie 設不起來）。
5. `POST …/:uid/abort`：取消，產品收到 `error=access_denied`。

### 3.3 登入互動：外部 IdP（D8–D10、§12.6）

```
apps/platform /interaction/:uid
  └─ email 欄 blur → GET /oidc-interaction/:uid/discover?email=  → { provider: {id,name} | null, ssoOnly }
  └─ 「使用 X 登入」→ POST …/:uid/external { providerId } → { redirectTo }
       api：state、nonce、PKCE verifier、互動 id、租戶 id、綁定 cookie 的雜湊存 oidc_payloads（type ExternalLogin，10 分鐘）；
            回應設定綁定 cookie（ext_login_<state 雜湊>，HttpOnly、SameSite=Lax、path 只到固定的 callback）
  └─ 頂層跳轉 → 外部 IdP 的授權端點（redirect_uri = 固定的 …/api/oidc-interaction/external/callback）
外部 IdP → GET /oidc-interaction/external/callback?code&state
  api：以 state 找回登入狀態 → 比對綁定 cookie（不是發起登入的瀏覽器就拒絕，不兌換授權碼）→ 進入它記下的租戶
       → openid-client 兌換、驗 ID token（email 不在 ID token 時查 userinfo）→ 對應帳號
       成功 → 作廢 state，另發一張隨機 ticket（只存雜湊）→ 302 …/api/oidc-interaction/:uid/external/complete?ticket=<ticket>
       失敗 → 302 apps/platform /interaction/:uid?error=<錯誤碼>（找不到登入狀態 → /error?error=AUTH_SSO_EXTERNAL_FAILED）
GET …/:uid/external/complete?ticket=   （這個路徑帶得到互動 cookie）
  api：消耗 ticket（只能用一次、互動 id 要相符）→ 完成互動（amr = ['ext']）→ 303 resume，之後同 §3.1
```

- 外部 IdP 大多要求 redirect URI 完全相符，所以 callback 是固定網址、不帶互動 id；互動 cookie 的 path 是互動網址，
  固定的 callback 帶不到它，因此多跳一次 `complete`。
- callback **不拋例外**：任何錯誤都變成跳回互動頁並帶錯誤碼，稽核 `auth.login.failure`（`metadata.method = 'sso'`、`reason`）。

**帳號對應**（`ExternalLoginService.resolveAccount`）：

| 順序 | 條件 | 結果 |
| --- | --- | --- |
| 1 | `(provider_id, subject)` 已連結 | 那個帳號（之後 email 變了、沒有 email 都一樣）；連結指向已刪除的帳號時刪掉舊連結，往下走 |
| 2 | 外部 IdP 回報 `email_verified = true` 的 email 對上既有帳號 | email 網域是 **這個** 連線登記的網域、且帳號沒有 `member` 以外的系統角色 → 連結後登入，稽核 `userIdentity.link`；否則 `AUTH_SSO_LINK_NOT_ALLOWED` |
| 3 | 連線是 `auto_create`，且 email 網域是這個連線登記的網域 | 建立 **沒有任何角色** 的已啟用帳號並連結 |
| 4 | 其他 | `AUTH_SSO_ACCOUNT_NOT_FOUND` |

第 2 步的限制：持 `identityProvider:create`／`update` 的人可以自架 IdP（或把連線的 issuer
改成它），對任何 email 簽出 `email_verified = true`。不限網域的話，就能把自己的外部身分連到租戶裡任何人（包括 super-admin）的帳號。
所以 email 網域必須屬於這個連線；持有 super-admin、admin、auditor 的帳號即使網域相符也不自動連結，要由本人以密碼登入（或由管理員處理）。
「持有」含經由群組（含巢狀）持有的角色（[`iam/07-groups.md`](iam/07-groups.md) §1），以權限解析的主體閉包判斷。
修改連線的 `issuer` 或 `client_id` 會在同一個交易內刪除它所有的連結（稽核 `metadata.identitiesCleared`、`severity: high`）：
新的 IdP 發的 `subject` 不代表同一個人。刪除帳號時也一併刪除它的連結（帳號是軟刪除，不會觸發 cascade），同 email 重建的帳號才能再連結。

帳號是 `pending`／停用時回對應的 `AUTH_ACCOUNT_*`；登入失敗的自動鎖定（`locked_until`）不擋外部 IdP 登入。

production 下對外部 IdP 的每個請求（discovery、token、userinfo、JWKS）都以 `pinnedFetch`（`core/http/outbound.ts`）送出：
連線時解析主機名稱，解析到私有、loopback、link-local（含雲端 metadata）位址就拒絕（`AUTH_SSO_PROVIDER_UNAVAILABLE`），
並以通過檢查的位址建立連線，查詢與連線之間沒有 DNS rebinding 的空窗；逾時 10 秒。
openid-client 只接受 fetch，所以用 undici 的 `fetch` ＋ 帶 `connect.lookup` 的 `Agent`（與 webhook 投遞的 `pinnedLookup` 是同一個檢查）。

**網域**（`identity_provider_domains`）：一個網域只屬於一個連線。設為「只允許 SSO」時，互動頁不顯示密碼欄，
`verifyCredentials` 在查帳號 **之前** 回 `AUTH_SSO_REQUIRED`（不洩漏帳號是否存在），`forgotPassword` 不寄信（回應不變）。

### 3.3.1 OIDC 的範本（§12.6 D2、D3）

連線的 `preset` 只改兩件事：**issuer 必須長什麼樣子**、**email 怎樣才算已驗證**（`modules/identity-provider/oidc-presets.ts`）。授權網址、兌換、簽章驗證都是同一份 openid-client 的流程。

| 範本 | issuer | email 已驗證 |
| --- | --- | --- |
| `generic`（預設） | 不限 | `email_verified === true` |
| `google`（Google Workspace） | `https://accounts.google.com` | `email_verified` 而且 `hd`（託管網域）等於 email 的網域：一般的 Gmail 帳號不算 |
| `microsoft`（Entra ID） | `https://login.microsoftonline.com/<目錄 GUID>/v2.0`（`common`／`organizations` 不接受：會收任何目錄的帳號） | `email_verified`，或選用 claim `xms_edov`（email 的網域已由目錄驗證）是 true；要在 Entra 的應用程式註冊加上這個 claim |
| `okta` | `https://<org>.okta.com`（或自訂授權伺服器 `…/oauth2/<id>`） | `email_verified === true` |
| `keycloak` | `<base>/realms/<realm>` | `email_verified === true` |

- issuer 不符範本時建立、更新回 `400 IDENTITY_PROVIDER_ISSUER_INVALID`（`details.preset`）；backstage 的表單依範本給欄位（Google 固定、Entra 只填目錄 ID）。
- 判斷用的 claim 在 ID token：email 只在 userinfo 的 IdP，合併時 **ID token 優先**（userinfo 不能蓋掉 `hd`）。
- 範本只影響「以 email 對應既有帳號、自動建立」；已連結的身分照舊以 `(provider, subject)` 登入。

### 3.3.2 SAML 2.0（§12.6 D4–D8）

```
apps/platform /interaction/:uid
  └─ 「使用 X 登入」→ POST …/:uid/external { providerId }（與 OIDC 同一個端點）
       api：產生 AuthnRequest（HTTP-Redirect binding、不簽章），ID 存進 ExternalLogin（samlRequestId），RelayState = state
            綁定 cookie：SameSite=None; Secure; path 只到 ACS
       → { redirectTo: <IdP 的 SSO 網址>?SAMLRequest=…&RelayState=… }
  └─ 頂層跳轉 → IdP 登入
IdP 讓瀏覽器 POST /oidc-interaction/external/saml/acs（SAMLResponse、RelayState）            ← 跨站的表單 POST
  api：以 RelayState 找回登入狀態（協定必須是 saml）→ 比對綁定 cookie → 進入它的租戶
       → node-saml 驗證：assertion 必須簽章（只簽外層 Response 不算）、簽章憑證是連線登記的其中一張、
         Issuer = 連線的 entity ID、Audience = 我們的 SP entity ID、時間（容許 2 分鐘誤差）、InResponseTo = 這次的 request ID
       → 對應帳號（同 OIDC）→ 303 …/:uid/external/complete?ticket=   （303：跨站 POST 之後以 GET 跳轉，Lax 的互動 cookie 才帶得上）
```

| 項目 | 做法 |
| --- | --- |
| 我們這一端（SP） | entity ID ＝ SP metadata 的網址 `…/api/oidc-interaction/external/saml/metadata/<租戶 id>/<連線 id>`（公開，IdP 可以直接匯入）；ACS 所有連線共用一個 `…/api/oidc-interaction/external/saml/acs` |
| 連線的設定 | `issuer` 欄存 IdP 的 entity ID（換掉時與 OIDC 換 issuer 一樣作廢所有連結）；`config` 存 SSO 網址、簽章憑證（PEM，最多 3 張：輪替時新舊並存）、NameID 格式、email 與名稱屬性。管理頁可以貼上 IdP 的 metadata 自動填入（瀏覽器解析，不送到伺服器） |
| subject | NameID（建議 `persistent`；email 格式的 NameID 在使用者改 email 之後就對應不到） |
| email | 指定的屬性；沒指定時依序找 `…/claims/emailaddress`、`urn:oid:0.9.2342.19200300.100.1.3`、`email`、`mail`；都沒有而 NameID 是 email 格式時用 NameID。SAML 沒有 `email_verified`：IdP 簽章斷言的 email 一律視為已驗證，防線是 §3.3 的「網域必須屬於這個連線、管理角色不自動連結」（D5） |
| 防重放 | RelayState 的登入狀態用過即作廢（成功或失敗），`InResponseTo` 只認那一次的 request：同一份回應送兩次，第二次找不到登入狀態。不另存 assertion ID |
| 只支援 SP 發起 | IdP 主動發起（沒有 `InResponseTo`）的回應一律拒絕：沒有我們發的 state，等於登入 CSRF（D6） |
| 不支援 | AuthnRequest 簽章、assertion 加密、SAML 的單一登出（SLO）；HTTP-POST binding 的 AuthnRequest（metadata 只有 POST binding 的 IdP 不能用） |

- node-saml 的 `idpIssuer` 只檢查登出訊息，登入的 assertion 由 `NodeSamlExternalClient` 自己比對 Issuer：同一張簽章憑證可能用在 IdP 的多個 entity（例：ADFS 所有的 relying party 共用一張）。
- ACS 不走 `ZodValidationPipe`：這是 IdP 讓瀏覽器送來的表單，任何錯誤都跳回登入頁而不是回 JSON。
- 綁定 cookie 只有 SAML 是 `SameSite=None`（一定要 `Secure`；`http://localhost` 也接受）：跨站的 POST 帶不上 Lax 的 cookie。path 只到 ACS，其他請求都不帶它。

### 3.3.3 兩種協定共用的部分

`ExternalLoginService` 以協定分成兩段：取得外部身分（OIDC 兌換授權碼、SAML 驗證回應），之後的「綁定 cookie、對應帳號、稽核、ticket、complete」完全相同（`handleReturn`）。
`ExternalOidcClient`、`ExternalSamlClient` 都是抽象類別兼 DI token，整合測試可以換掉；SAML 的整合測試用 `scripts/mock-saml-idp.ts` 產生真的簽章。
稽核的 `auth.login.*` 在 `metadata` 多記 `protocol`。

### 3.3.4 帳號的外部身分：檢視與解除（§12.6 D11）

| 端點 | 權限 | 說明 |
| --- | --- | --- |
| `GET /users/:userId/identities` | `user:read` | 連結的外部身分：連線名稱、協定、連線是否已刪除、subject、連結當下的 email、最後登入 |
| `DELETE /users/:userId/identities/:identityId` | `user:update` | 解除連結（連錯了人、員工換了 IdP 帳號）；稽核 `userIdentity.unlink`。這個外部身分之後登入時重新走帳號對應 |

- 兩個端點都要租戶啟用 `identityProvider`（否則 404，與連線管理相同）。
- **反提權**：目標持有 super-admin（含經由群組）時，操作者也必須持有，否則 `403 AUTHZ_ESCALATION`。super-admin 不會被自動連結（§3.3），
  解除之後只能以密碼登入；只允許 SSO 的網域等於被鎖在門外（與 MFA 重設相同的規則，[`backend/21-mfa.md`](./backend/21-mfa.md) §8）。
- backstage：使用者詳情的「外部身分」區塊（`features/user`）。

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
  apps/platform 的 `/platform/auth/logout` 撤銷平台的。
- 不自動跳回 IdP：頁面卸載會取消還在路上的登出請求，使用者會被尚未銷毀的 IdP session 直接登回來。
  前端的 `SessionWatcher` 只在「這個分頁曾經有 session」時才在 session 消失後導向登入頁。
- 離線的分頁要等下一次續期失敗才發現；已發出的 access token 最多再活 5 分鐘。
- **登出失敗時要讓使用者知道**（web-core 的 `signOut`）：前端照樣登出，但伺服器端沒有撤銷（撤銷的請求失敗，或續期失敗後改以
  refresh cookie 撤銷也失敗）時，已登出頁帶 `?logout=incomplete`，顯示警示「伺服器端的登出沒有完成…在共用電腦上請關閉瀏覽器」與「重試登出」。
  - 續期失敗、拿不到 access token 時，`POST /auth/logout`（apps/platform 是 `/platform/auth/logout`）不帶 bearer、改帶 `x-refresh-request: 1`，
    後端以 refresh cookie 找家族並結束 IdP session；「重試登出」走同一條。登出的請求帶 `keepalive`，按完立刻關分頁也會送完。
  - 重試仍失敗（例：refresh cookie 已失效，後端認不出家族）時，「重試登出」旁提供 IdP 的 end-session 連結（`endSessionUrlOf`，
    `/session/end?client_id=…&post_logout_redirect_uri=<登入頁>`）：使用者在 IdP 的確認頁按下登出，IdP session 與它底下的 app session 一起結束。
    這是使用者手動按的退路；D5 排除的只是「自動」跳回 IdP。

### 3.5 帳號停用、刪除、憑證失效（D17）

`SESSIONS_REVOKED` 時，這些人的 IdP session，以及 **密碼步驟已完成、還沒 resume 的互動**（`result.login.accountId`）一起銷毀：

- `userIds`：事件在租戶的脈絡裡發佈，帳號 id 是 `t:{tenantId}:{userId}`（停用、刪除、改密碼、重設密碼）。
- `platformAdminIds`：平台管理者沒有租戶脈絡，帳號 id 是 `p:{adminId}`（停用、改密碼、重設密碼）。

只銷毀 session 不夠：互動的密碼步驟與 resume 之間可以隔一段時間（互動 TTL 1 小時），握著 resume 網址的人在本人改密碼之後
仍能換到授權碼；所以未完成的互動一起作廢。provider 的 `findAccount` 找不到可用的帳號時，
清掉 session 上的帳號、改走登入互動（否則 provider 會在沒有帳號的情況下檢查同意而拋錯）。

### 3.6 登入互動：通行金鑰（§12.6 D9、D10）

以已註冊的 WebAuthn 因子（通行金鑰）**取代密碼與第二步**。憑證本來就是 MFA 的因子（[`backend/21-mfa.md`](./backend/21-mfa.md) §9.3），這裡沒有新的註冊流程：
平台參數開啟之後，同一把金鑰既是第二步，也可以直接登入。

```
apps/platform /interaction/:uid（details.passkeyLogin = true 時多一個「使用通行金鑰登入」）
  └─ POST …/:uid/passkey/options
       api：方式可用（平台開關 ∩ 租戶政策）且 passwordless 開啟（WebAuthn 的參數 passkeyLogin = enabled）
            → 不帶 allowCredentials 的 authentication options（userVerification: required），狀態存 oidc_payloads 的 PasskeyLogin（5 分鐘）
       → { publicData: { options } }
  └─ 瀏覽器列出這個網域的通行金鑰 → 使用者以指紋、臉部或 PIN 確認
  └─ POST …/:uid/passkey/login { payload: { response } }
       api：取出並消耗 PasskeyLogin（同一個 challenge 只能驗證一次，失敗也算）
            → 以回應的憑證 id 找 active 的 WebAuthn 因子（最多 5 筆），只認 user handle 與帳號相符的那一個
            → 存成一筆 login 的 challenge，交給框架的 verifyFactor（簽章、計數、重放照舊）
            → 只允許 SSO 的網域：AUTH_SSO_REQUIRED
            → completeLogin（amr ['hwk', 'mfa']）→ finishInteraction → { redirectTo }
```

- **要求使用者驗證**：狀態帶 `userVerification: 'required'`，不看平台參數的 `userVerification`。只有「持有 ＋ 生物辨識或 PIN」才能取代「密碼 ＋ 第二因素」。
- **找帳號**：還不知道是誰之前就發 challenge（discoverable credential）。憑證 id 由驗證器決定，惡意的軟體驗證器可以造一個與別人相同的 id，
  所以同時比對回應的 user handle（註冊時給的 SHA-256(`t:{tenantId}:{userId}`)）：只會找到自己的因子，也不會因此擋住別人。
  查詢以 `(config ->> 'credentialId')` 的部分索引（`method = 'webauthn'`），租戶與平台兩個 DB 各一個。
- **失敗不累計鎖定**：拿得到別人的憑證 id 不代表能猜，卻能藉此把人鎖住；只寫 `auth.login.failure`（`step: 'passkey'`）。速率限制照 `auth`。
  鎖定中的帳號可以用通行金鑰登入（鎖定是擋猜密碼，與外部 IdP 相同）；停用、待啟用的不行。
- **不接受的情況**：產品要求新增驗證方式的登入（`mfa_enroll`，[`backend/21-mfa.md`](./backend/21-mfa.md) §7.1）要先以密碼重新驗證，回 `AUTH_PASSKEY_UNAVAILABLE`；
  只允許 SSO 的網域（企業的 IdP 管理離職停用，要立即生效）。
- 平台管理者一樣可以用（`PLATFORM_MFA_METHODS` 含 `webauthn`、參數開啟時）。
- 錯誤一律 `AUTH_PASSKEY_INVALID`（不細分不認得的憑證、簽章不對、challenge 過期）；不能用時 `AUTH_PASSKEY_UNAVAILABLE`。

## 4. 端點

| Method | Path（瀏覽器看到的前綴 `/api`） | 宣告 | 說明 |
| --- | --- | --- | --- |
| * | `/oidc/*` | （oidc-provider，middleware） | discovery、`/auth`、`/token`、JWKS、end-session |
| POST | `/auth/sso/callback` | `@Public` | 租戶網域的 BFF：授權碼 ＋ PKCE 換 app session |
| POST | `/platform/auth/sso/callback` | `@Public` | apps/platform 的 BFF（平台管理者）；`/platform/auth/refresh`、`logout`、`profile` 同 `/auth/*`。租戶網域上回 `PLATFORM_ONLY` |
| PATCH | `/platform/auth/profile` | `@Authenticated` | 平台管理者改自己的顯示名稱（只有 `displayName`：語系、時區、主題只存在瀏覽器）；寫平台稽核 `platformAdmin.profileUpdate` |
| POST | `/platform/auth/change-password` | `@Authenticated` | 以目前的密碼換新密碼（`AUTH_PASSWORD_MISMATCH`、與目前相同 `AUTH_PASSWORD_WEAK`）；結束這個人的所有 session、斷掉即時連線；寫平台稽核 `platformAdmin.passwordChange` |
| GET | `/tenant/current` | `@Public` | 這個網域的租戶（代碼、名稱） |
| GET | `/tenants/lookup?code=` | `@Public` | 租戶的登入入口（`loginUrl`）；找不到或停用一律 `TENANT_NOT_FOUND` |
| GET | `/oidc-interaction/:uid` | `@Public` | 設互動 cookie 的路徑，302 到 apps/platform |
| GET | `/oidc-interaction/:uid/details` | `@Public` | 互動資訊 |
| POST | `/oidc-interaction/:uid/login` | `@Public` | 密碼登入 |
| POST | `/oidc-interaction/:uid/abort` | `@Public` | 取消 |
| GET | `/oidc-interaction/:uid/discover` | `@Public` | email 網域 → 外部 IdP 連線 |
| POST | `/oidc-interaction/:uid/external` | `@Public` | 發起外部 IdP 登入 |
| GET | `/oidc-interaction/external/callback` | `@Public` | 外部 IdP 跳回（固定網址） |
| GET | `/oidc-interaction/:uid/external/complete` | `@Public` | 以 ticket 完成互動 |
| POST | `/oidc-interaction/external/saml/acs` | `@Public` | SAML 的 ACS（固定網址，表單 POST）；303 到 complete（§3.3.2） |
| GET | `/oidc-interaction/external/saml/metadata/:tenantId/:providerId` | `@Public` | SAML 連線的 SP metadata（網址就是 SP 的 entity ID） |
| POST | `/oidc-interaction/:uid/passkey/options`、`…/passkey/login` | `@Public` | 通行金鑰登入（§3.6） |
| GET／DELETE | `/users/:userId/identities`（`/:identityId`） | `user:read`／`user:update` | 帳號的外部身分（§3.3.4） |
| GET／POST／PATCH／DELETE | `/identity-providers`（`/:id`） | `identityProvider:read／create／update／delete` | 外部 IdP 連線管理（租戶網域，backstage）。建立時連線數不能超過租戶的參數 `identityProvider.maxProviders`（預設 10，`409 IDENTITY_PROVIDER_LIMIT_REACHED`，[`05-tenancy.md`](./05-tenancy.md) §5.3） |

權限見 [`iam/02-permission-catalog.md`](iam/02-permission-catalog.md) §2.11；完整端點表見 [`backend/05-rbac.md`](./backend/05-rbac.md) §9。

## 5. 資料模型

| 表 | 內容 |
| --- | --- |
| `oidc_payloads`（平台 DB） | oidc-provider 的通用儲存（`Session`、`Interaction`、`Grant`、`AuthorizationCode`…）與外部登入的暫存（`ExternalLogin`：OIDC 的 PKCE、nonce，SAML 的 request ID）、通行金鑰的 challenge（`PasskeyLogin`）；`expires_at`、`consumed_at`，過期的列由背景工作 `oidc.cleanup`（`OIDC_CLEANUP_CRON`）清除 |
| `refresh_tokens.client_id`、`idp_session_uid` | 這條家族屬於哪個產品、哪個 IdP session（單一登出用） |
| `platform_admins`、`platform_refresh_tokens`、`platform_audit_logs`（平台 DB） | 平台管理者、他們的 app session 與稽核（[`architecture/05-tenancy.md`](05-tenancy.md) §10.2 D5、D19）；第一位由 `db:seed` 依 `PLATFORM_ADMIN_EMAIL` 建立 |
| `identity_providers`（租戶 DB，以下同） | 外部 IdP 連線：`name`（未刪除者唯一）、`protocol`（`oidc`／`saml`）、`preset`（OIDC 的範本）、`issuer`（SAML 是 IdP 的 entity ID）、`client_id`、`client_secret_encrypted`（只有 OIDC，CHECK）、`scopes`、`config`（SAML 的 SSO 網址、憑證、NameID 格式、屬性）、`enabled`、`unmatched_policy`（`reject`／`auto_create`）；軟刪除。租戶 migration 0051 |
| `identity_provider_domains` | `domain`（citext，主鍵）→ `provider_id`、`sso_only` |
| `user_identities` | 帳號 ↔ 外部身分：`(provider_id, subject)` 唯一；連結當下的 `email`、`last_login_at` |
| `mfa_factors`、`platform_admin_mfa_factors` 的 `credential_idx` | `(config ->> 'credentialId') WHERE method = 'webauthn'`：通行金鑰登入以憑證 id 找因子（§3.6；租戶 0051、平台 0026） |

沒有 `oidc_clients` 表：第一方 client 由設定產生（D7，§8）。

## 6. 前端

### 6.1 產品端（backstage；之後的產品照抄）

| 位置 | 內容 |
| --- | --- |
| `@b2b-system/web-core/auth`（`sso.ts`） | `createAuthorizationUrl`（state、PKCE S256）、`readPendingLogin`／`discardPendingLogin`（verifier 以 state 為鍵存本分頁 sessionStorage）、`safeReturnTo`（只接受同源相對路徑；以瀏覽器的解析結果判斷，正規化後以 `//` 開頭的——例如 `/.//外站`、`/\外站`——一律退回 `/`） |
| `features/auth/pages/Login` | `/auth/login`：取得這個網域的租戶代碼（`GET /tenant/current`）後跳到 IdP；`?signedOut=true` 時不自動跳，顯示「再次登入」；跳轉前失敗（租戶停用、網址打錯）顯示原因並可重試 |
| `features/identity-provider` | `/identity-provider`：這個租戶的外部 IdP 連線（`identityProvider:*`，[`architecture/05-tenancy.md`](05-tenancy.md) §10.2 D18）：OIDC（範本）或 SAML（可貼上 IdP 的 metadata 匯入）；顯示要登記在外部 IdP 的 redirect URI 與 SAML 的 ACS、SP entity ID |
| `features/user`（使用者詳情） | 「外部身分」區塊：檢視與解除連結（§3.3.4） |
| `features/auth/pages/SsoCallback` | `/auth/callback`：換 session 後 `router.history.replace(returnTo)`；`error=access_denied` 顯示「已取消」；失敗後的「登入」帶上原本的 `returnTo` |
| `SessionWatcher`（`@b2b-system/web-core/shell`，`app/App.tsx` 掛上） | 單一登出或續期失敗時導向 `/auth/login?signedOut=true` |

### 6.2 apps/platform

| Feature | 路由 | 說明 |
| --- | --- | --- |
| `login` | `/interaction/:uid`、`/error`、`/login`、`/callback`、`/forgot-password`、`/reset-password`、`/setup`、`/register`、`/enter` | IdP 的互動頁（租戶或平台，§1.1；「使用通行金鑰登入」見 §3.6，瀏覽器 API 經 `web-core/mfa` 的 `authenticatePasskey`）；provider 的協定錯誤頁；apps/platform 自己的頁面經 SSO 登入（client `auth`，平台管理者）；帳號流程；進入租戶（[`architecture/05-tenancy.md`](05-tenancy.md) §10.2 D11） |
| `home` | `/` | 目前登入的平台管理者（角色、權限數）；有 `tenant:read` 時加上各狀態的租戶數 |
| `account` | `/profile`、`/preference` | 個人資料（改名、角色與權限、變更密碼）與偏好設定（語系、時區、主題、頂列工具；只存在瀏覽器） |
| `notification` | `/notification` | 平台的站內通知；頂列的鈴鐺（[`backend/15-notification.md`](./backend/15-notification.md) §6.2） |
| `tenant`、`platform-admin`、`audit-log`、`job`、`feature-flag` | `/tenant`（詳情 `/tenant/$id?tab=overview\|features\|flags`）、`/admin`、`/audit-log`、`/job`、`/feature-flag` | 平台管理：租戶、平台管理者、平台稽核、所有租戶的背景工作、試行開關（權限是平台的目錄，[`iam/02-permission-catalog.md`](iam/02-permission-catalog.md) §8） |

平台管理的頁面套用與 backstage 相同的外框（web-core 的 `DashboardShell`，由 `app/layouts/DashboardLayout` 傳入選單與品牌：可收合的分組側欄、窄螢幕抽屜、頂列工具、帳號選單）
與頁面寫法（列表用 `RichTable` 的搜尋、篩選、欄位設定與分頁；詳情用麵包屑與分頁）。登入、帳號流程與進入租戶的頁面不套外框。

帳號流程的信中連結以 `PLATFORM_APP_URL` 開頭並帶 `?tenant=<代碼>`（`MailService.accountLink`，[`backend/11-mail.md`](./backend/11-mail.md)）。
頁面以 `X-Tenant` 標頭把租戶送給 api（這個標頭只在 apps/platform 的網域有效，租戶網域上以網域為準），完成後以 `GET /tenants/lookup`
回到那個租戶的 backstage 登入。**平台管理者** 的啟用與重設密碼連結不帶 `?tenant=`：`/setup`、`/reset-password` 沒有租戶時改打
`/platform/auth/setup`、`/platform/auth/reset-password`，完成後留在 apps/platform 登入。平台管理者沒有「忘記密碼」與「申請帳號」
（由其他平台管理者新增與寄重設連結），所以 `/forgot-password`、`/register` 沒有 `?tenant=` 時仍顯示「請從租戶的登入頁或信中的連結進入」。
backstage 已經沒有這些頁面：SSO 之前寄出、指向 backstage `/auth/setup` 等的舊連結會是找不到頁面，要請管理員重寄。
apps/platform 的平台管理者也有即時推播：連 apps/platform 網域上的 `/api/socket.io`，收平台資源的變更與自己的通知
（[`backend/08-realtime.md`](./backend/08-realtime.md) §3.6）；頂列顯示連線狀態。
IdP 互動過期（`AUTH_SSO_INTERACTION_INVALID`）與 `/error` 協定錯誤頁提供「重新開始登入」：知道租戶時到 `/enter?tenant=<代碼>`
（自動前往那個租戶的登入），不知道時給「進入租戶」與平台管理者登入。apps/platform 的 `SessionWatcher` 在 session 中途結束時導向
`/login?signedOut=true&reason=<原因>&redirect=<路徑＋查詢字串>`，登入頁依原因說明（逾時、帳號停用、憑證重用…；自己登出與單一登出顯示「已登出」）。

## 7. 設定與部署

| 變數 | 用途 | production |
| --- | --- | --- |
| `PLATFORM_APP_URL` | apps/platform 的 origin：互動頁、錯誤頁、帳號流程連結；第一方 client `auth` 的 redirect URI 開頭 | 必填（compose 由 `PLATFORM_PUBLIC_ORIGIN` 產生）；https、不能是 localhost |
| `APP_PUBLIC_URL` | 預設租戶的 backstage origin；信中連結的協定（各租戶的網域在平台 DB 的 `tenant_domains`） | 必填（`PUBLIC_ORIGIN`）；同上 |
| `PLATFORM_REFRESH_COOKIE_PATH` | 平台管理者的 refresh cookie path | 預設 `/api/platform/auth` |
| `PLATFORM_ADMIN_EMAIL`、`PLATFORM_ADMIN_PASSWORD` | 第一位平台管理者（`db:seed`）；密碼留空時 production 建成 `pending`，印出一次性的設定連結（[`iam/05-bootstrap.md`](iam/05-bootstrap.md) §5.1） | compose 的 migrate 必填 email |
| `OIDC_ISSUER` | `{PLATFORM_APP_URL}/api/oidc` | 必填；與 `PLATFORM_APP_URL` 同源 |
| `OIDC_JWKS` | 簽 ID token 的私鑰（JWKS JSON）；輪替時新舊並存一個 access token TTL | 必填，至少一把含私鑰（沒設時啟動時產生臨時金鑰，只給開發用） |
| `OIDC_COOKIE_KEYS` | 簽 IdP cookie 的金鑰，逗號分隔，第一把用來簽 | 必填，每一把至少 32 字元的隨機值 |
| `IDP_SECRET_KEY` | AES-256-GCM 加密外部 IdP 的 client secret（32 bytes，base64） | 必填，拒絕低熵的值（沒設時由 `JWT_SECRET` 以 HKDF 推導，只給開發用） |
| `TENANT_SECRET_KEY`、`WEBHOOK_SECRET_KEY` | 加密租戶連線字串、Webhook 簽章密鑰（同上的形狀；[`05-tenancy.md`](./05-tenancy.md) §7、[`backend/17-webhook.md`](./backend/17-webhook.md) §9.2 D14） | 必填（同上） |
| `OIDC_CLEANUP_CRON` | 清除過期 `oidc_payloads` | 預設 `45 3 * * *` |
| `VITE_OIDC_ISSUER`、`VITE_PLATFORM_APP_URL` | 前端（backstage、apps/platform）**建置時** 寫進產物 | Dockerfile 的 build arg |

- `docker-compose.prod.yml`：`platform` 服務（`apps/platform/Dockerfile`，`deploy/nginx.platform.conf`）是獨立的 origin（預設 `:8081`），
  同樣以 `/api/*` 反向代理到 api；沒有 `/api/socket.io/` 與 `/storage/`。CSP 有 `frame-ancestors 'none'`（登入頁防點擊劫持）。
- 金鑰產生的例子：`OIDC_COOKIE_KEYS`、`IDP_SECRET_KEY`、`TENANT_SECRET_KEY`、`WEBHOOK_SECRET_KEY` 用 `openssl rand -base64 32`；`OIDC_JWKS` 用
  `node -e "import('jose').then(async j=>{const k=await j.generateKeyPair('RS256',{extractable:true});const jwk=await j.exportJWK(k.privateKey);console.log(JSON.stringify({keys:[{...jwk,alg:'RS256',use:'sig',kid:crypto.randomUUID()}]}))})"`（在 `apps/api` 目錄執行）。
- **換 `IDP_SECRET_KEY` 會讓既有連線的 secret 解不開**：換之前在管理頁重新輸入每個連線的 secret。
- SAML 不需要新的環境變數：SP 的 entity ID 與 ACS 由 `OIDC_ISSUER` 推導；AuthnRequest 不簽章，所以沒有 SP 的金鑰。ACS 是跨站的表單 POST，
  反向代理不能擋 `/api/oidc-interaction/external/saml/acs` 的 POST，也不能改寫它的 `Set-Cookie` 的 `SameSite`。
- 通行金鑰登入沒有環境變數：在 apps/platform 的「MFA 方式」頁，WebAuthn 的參數 `passkeyLogin` 改成 `enabled`（[`backend/21-mfa.md`](./backend/21-mfa.md) §9.3）。

## 8. 新增一個產品（第一方 client）

1. api：`oidc-provider.constants.ts` 的 `OIDC_CLIENT`、`OIDC_CLIENT_PATHS` 加一列；`OidcProviderService.clients()` 的 origin 對照加上它的 env。
2. 產品前端：複製 backstage 的 §6.1（`sso.ts` 改 client id），`/auth/callback` 的路徑與 `OIDC_CLIENT_PATHS` 一致。
3. 部署：產品自己的 origin 以 `/api` 反向代理到 api；refresh cookie 是它自己的 host-only cookie，不需要和 apps/platform 同站。
4. 互動頁的 client 名稱：apps/platform `features/login/constants.ts` 的 `CLIENT_NAME_KEY` 與語系檔。

第三方 client（非本平台）要有同意頁與 `oidc_clients` 表，這一版不支援。

## 9. 錯誤

| 情境 | 使用者看到 |
| --- | --- |
| 協定錯誤（未登記的 redirect URI、不認識的 client） | apps/platform 的 `/error?error=<OIDC 錯誤>`，**絕不導回**（D7） |
| 互動過期、沒有互動 cookie | 互動頁顯示 `AUTH_SSO_INTERACTION_INVALID` |
| 授權碼失效、重放、PKCE 不符 | 產品的 callback 頁顯示 `AUTH_SSO_CODE_INVALID`，可重新登入 |
| 在互動頁按取消 | 產品的 callback 頁顯示「已取消」 |
| 外部 IdP 失敗、找不到帳號、不能自動連結、連線停用 | 回到互動頁並顯示 `AUTH_SSO_EXTERNAL_FAILED`／`AUTH_SSO_ACCOUNT_NOT_FOUND`／`AUTH_SSO_LINK_NOT_ALLOWED`／`AUTH_SSO_PROVIDER_UNAVAILABLE` |
| 只允許 SSO 的網域用密碼或通行金鑰登入 | `AUTH_SSO_REQUIRED` |
| SAML 回應驗證失敗（簽章、Issuer、Audience、時間、`InResponseTo`）、不是發起登入的瀏覽器 | 回到互動頁並顯示 `AUTH_SSO_EXTERNAL_FAILED`（稽核的 `reason`：`saml_validation_failed`、`browser_mismatch`） |
| 通行金鑰不能用（平台沒開、政策不允許、`mfa_enroll` 的登入）／驗證失敗 | `AUTH_PASSKEY_UNAVAILABLE`／`AUTH_PASSKEY_INVALID` |
| 連線的 issuer 不符範本、SAML 憑證不是 X.509、更新時換協定 | `400 IDENTITY_PROVIDER_ISSUER_INVALID`／`IDENTITY_PROVIDER_CERTIFICATE_INVALID`（`details.position`）／`IDENTITY_PROVIDER_PROTOCOL_MISMATCH` |
| 解除外部身分：不存在／目標是 super-admin 而操作者不是 | `404 USER_IDENTITY_NOT_FOUND`／`403 AUTHZ_ESCALATION` |
| backstage 的 authorize 沒帶 `tenant`、租戶不存在、或與 redirect URI 的網域不符 | 帶 `invalid_request` 導回那個 backstage 的 callback |
| 平台的端點在租戶網域上呼叫 | `PLATFORM_ONLY` |
| 外部 IdP 連線的管理（`/identity-providers`） | 不存在 `404 IDENTITY_PROVIDER_NOT_FOUND`；名稱重複 `409 IDENTITY_PROVIDER_NAME_DUPLICATE`；網域已屬於另一個連線 `409 IDENTITY_PROVIDER_DOMAIN_TAKEN` |
| 平台管理者的管理（apps/platform） | 不存在或已刪除 `404 PLATFORM_ADMIN_NOT_FOUND` |

## 10. 測試

| 層 | 檔案 |
| --- | --- |
| api 整合 | `apps/api/test/sso.spec.ts`（授權碼流程、重放、單一登出、帳號停用；[`architecture/05-tenancy.md`](05-tenancy.md) §10：tenant 參數、換租戶重新登入、BFF 的租戶檢查、平台管理者、X-Tenant、租戶公開端點）、`sso-external.spec.ts`（以假的 `ExternalOidcClient` 覆寫 provider：帳號對應、只允許 SSO、連線管理）、`sso-methods.spec.ts`（OIDC 範本、SAML 的完整流程與每一道驗證——以 `scripts/mock-saml-idp.ts` 產生真的簽章、帳號的外部身分、通行金鑰登入——以 `test/soft-authenticator.ts` 做出真的 WebAuthn 回應） |
| api 單元 | `external-saml.client.spec.ts`（簽章、Issuer、Audience、過期、InResponseTo、竄改、憑證輪替）、`oidc-presets.spec.ts`、`external-login.service.spec.ts`（SAML 的 ACS）、`mfa-login.passkey.spec.ts`、`webauthn.method.spec.ts`（passwordless） |
| 前端 | 兩個 app 的 `SsoCallback`、`Login` 頁；apps/platform 的 `Interaction`（含外部 IdP、租戶連結）、`usePasskeyLogin` 與 `ForgotPassword`；backstage 的 `IdentityProviderList`（三個權限案例；表單的範本、SAML、metadata 匯入；`adapter`、`samlMetadata`）、使用者詳情的 `UserIdentitySection` |
| E2E | `apps/e2e/tests/auth.spec.ts`（登入、租戶帳號進 apps/platform 要以平台管理者重新登入、從 backstage 登出）、`sso.spec.ts`（取消、協定錯誤、平台的登入頁登不進租戶帳號、平台管理者登出、外部 IdP 頁的權限）、`sso-external.spec.ts`（模擬外部 IdP 的完整登入）、`mail.spec.ts`（帳號流程） |

`pnpm dev:mock-idp` 啟動模擬的外部 IdP（`http://localhost:4455`，client `b2b-mock`／`mock-secret`；登入頁輸入任何 email 都算登入成功，
`email_verified = true`）；Playwright 設定會自動啟動它。
`pnpm dev:mock-saml-idp` 啟動模擬的 SAML IdP（`http://127.0.0.1:4477`；metadata 在 `/metadata`，金鑰與憑證每次啟動重新產生）：
以 127.0.0.1 對外，與 apps/platform（localhost）是不同的站，ACS 收到的是真正的跨站 POST。

## 11. 已知限制

- 找不到帳號時「走審批」沒有做：註冊審批核准後要從啟用信設定密碼才能登入，外部 IdP 登入的人不需要密碼，流程接不上（§12.2 D10）。
- 網域所有權沒有驗證（DNS TXT）：由平台管理員自行確認。
- 外部 IdP 的群組不對應到角色或群組：權限圖 G4 的群組只有手動成員，IdP 群組對應另開提案、與 SCIM 一起評估（[`iam/01-model.md`](iam/01-model.md) §9.3 D15）。
- Entra ID 要在應用程式註冊加上選用 claim `xms_edov`，才能以 email 連結既有帳號（§3.3.1）；沒有加時只能靠 `auto_create` 或已連結的身分。
- SAML：只支援 SP 發起；AuthnRequest 不簽章、assertion 不加密、沒有單一登出（SLO）；IdP 只提供 HTTP-POST 的 SSO 網址時不能用（§3.3.2）。
- 平台管理者不能用外部 IdP 登入（連線屬於租戶；要開放時平台 DB 要另一套連線，§12.6 D12）。
- 社群登入（GitHub、Apple、LINE 登入）沒有做：GitHub 沒有 ID token、Apple 用 `form_post` 與 JWT 形式的 client secret，等有實際需求再加（§12.6 D13）。
- 通行金鑰登入不能與「重新登入並新增」（`mfa_enroll`）並用；沒有瀏覽器自動填入的 conditional UI（§3.6）。

## 12. 設計決策：SSO 與身分平台

> 原 ADR-0019，2026-09-29 決定。D1、D9、D12、D13 後來被 [`architecture/05-tenancy.md`](05-tenancy.md) §10 修改：帳號分屬各租戶 DB、外部 IdP 屬於租戶、授權帶 `tenant`、租戶管理之外的工作區頁面移除（見 [`05-tenancy.md`](./05-tenancy.md)）。

### 12.1 背景

帳號、登入與租戶管理原本都在 `apps/backstage` 裡，session 是 backstage 同源的 refresh cookie。
接下來會有多個前端產品共用同一套帳號與工作區，也有客戶要求用自己的 Google Workspace／Azure AD 登入。
app session 沿用 [`backend/04-auth.md`](backend/04-auth.md) §10；權限仍在伺服器端解析（[`backend/05-rbac.md`](backend/05-rbac.md) §11）；工作區不進身分（[`architecture/05-tenancy.md`](05-tenancy.md) §10.7，D12）。

要決定的事：

1. 「單一登入」用什麼協定：自訂的跳轉票證、共用 cookie，還是標準的 OIDC？
2. 身分服務放在哪：新的後端服務，還是 `apps/api` 的模組？登入與租戶管理的畫面放在哪？
3. 產品拿到身分之後，session 怎麼表示：直接用 IdP 發的 token，還是沿用 [`backend/04-auth.md`](backend/04-auth.md) §10 的 app session？
4. 外部 IdP（Google、Azure AD）怎麼接進來？

已確認的前提（提案階段的開放問題）：我們自己當 IdP，也要能接外部 IdP；
`apps/platform` 只有前端，後端在 `apps/api`；`apps/platform` 先複製 backstage 需要的程式碼，不抽 package（後來全部抽成 `packages/`，見 D14）。

### 12.2 決定

**單一登入的協定**

| 方案 | 結論 |
| --- | --- |
| A. 共用 cookie：所有產品放在同一個 origin 的子路徑共用 refresh cookie，或以 `Domain=.example.com` 讓子網域共用 | 不採用：產品之間的 session 無法分開撤銷；每個產品都得和 backstage 同源部署；非同源的服務（或將來的 CLI、第三方）完全接不上 |
| B. 自訂跳轉票證：登入頁發一次性票證，產品拿票證換 session | 不採用：等於自己設計一套協定，安全細節（重放、redirect URI 驗證、PKCE）都要自己想；外部服務沒有現成的 client 可用 |
| **C. OIDC Authorization Code ＋ PKCE，`apps/api` 當 Provider** | **採用**：標準協定，任何語言都有 client；redirect URI 白名單、PKCE、`state`／`nonce`、end-session 都是規格的一部分 |

**Provider 的實作**

| 方案 | 結論 |
| --- | --- |
| A. 自己實作 `/authorize`、`/token`、JWKS、end-session | 不採用：規格細節多（錯誤回應、`prompt`、`max_age`、金鑰輪替），自己寫容易出安全漏洞 |
| **B. [`oidc-provider`](https://github.com/panva/node-oidc-provider)（OpenID Certified）掛在 NestJS 的 `/oidc`** | **採用**：互動（登入、同意）交給我們自己的畫面；儲存以 adapter 接 Postgres |
| C. 外部 IdP 產品（Keycloak、Auth0、Ory） | 不採用：多一個要維運的服務與一套帳號資料，帳號、角色、稽核會分散在兩個地方；「每個請求都要查 `token_version` 與權限」仍得回到 `apps/api` |

**具體決定**

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **新增 `apps/platform`**：全平台共用、不分工作區的前端（Vite ＋ React，架構比照 backstage）。它負責 OIDC 的互動頁（登入、同意、外部 IdP 的選擇與網域導向）、帳號流程（啟用、重設密碼、接受邀請），以及平台層級的管理（租戶、外部 IdP 連線） | 登入與租戶都屬於平台，不屬於任何一個產品；放在 backstage 會讓其他產品依賴 backstage |
| D2 | **後端不拆**：OIDC Provider（`modules/oidc-provider`）與外部 IdP（`modules/identity-provider`）都是 `apps/api` 的模組；`apps/platform` 經自己 origin 的 `/api` 反向代理呼叫 | 延續 `01-system.md` §4.3：每個請求都要驗 token 與權限，拆服務就是每個請求多一跳；帳號、角色、稽核留在同一個資料庫與交易裡 |
| D3 | **產品的 session 仍是 [`backend/04-auth.md`](backend/04-auth.md) §10 的 app session（BFF）**：第一方產品是 public client ＋ PKCE（S256，必填）。產品把授權碼與 PKCE verifier 交給自己 origin 的 `/api/auth/sso/callback`，api **在本程序內** 兌換授權碼（檢查與 token 端點相同的條件：存在、未用過、未過期、client 與 redirect URI 相符、PKCE；重放時撤銷同一個 grant），再發 5 分鐘 JWT ＋ 該 origin 的 httpOnly refresh cookie。verifier 只存在發起登入的分頁的 sessionStorage | refresh token 不落到 SPA 的 JavaScript 手上（[`backend/04-auth.md`](backend/04-auth.md) §10 理由 1）；`JwtAuthGuard`、`token_version`、權限快取、推播全部不必改。IdP 與 BFF 在同一個程序，走 HTTP 呼叫自己的 token 端點只多一跳，也讓整合測試無法在不監聽 port 的情況下執行；第三方 RP 仍用標準的 token 端點 |
| D4 | **IdP session 與 app session 分開**：IdP session 是 `apps/platform` origin 上的 cookie（由 `oidc-provider` 管理），代表「在這台瀏覽器登入過平台」；每個產品各有自己的 refresh 家族。`refresh_tokens` 加 `client_id` 與 `idp_session_uid` | 產品之間可以分開撤銷；知道一條 refresh 家族屬於哪個 IdP session，單一登出才找得到要撤銷誰 |
| D5 | **單一登出（伺服器端）**：任一產品登出（`POST /auth/logout`，帶自己 origin 的 refresh cookie）→ api 以該家族的 `idp_session_uid` **銷毀 IdP session**、撤銷它底下所有產品的 refresh 家族，並推播 `SESSIONS_REVOKED { idpSessionUids }`。經 SSO 發的 access token 帶 `sid`（IdP session），即時連線依它加入 `sid:{uid}` 的 room，推播只到同一個 IdP session 的分頁。**不** 遞增 `token_version`。登出後產品停在「已登出」頁、**不自動跳回 IdP** | 全部在伺服器端完成，不必碰其他 origin 的 cookie，也不需要 IdP 的登出確認頁（apps/platform 上的 session cookie 之後指向不存在的 session）。`token_version` 會連其他裝置一起登出。登出後若立刻自動跳去 IdP，頁面卸載會取消還在路上的登出請求，使用者會被尚未銷毀的 IdP session 直接登回來。第三方 RP 走 provider 的 end-session 時，同樣撤銷該 IdP session 的 app session |
| D6 | **不使用跨域 cookie，服務之間只以頂層跳轉溝通**：每個 cookie 都是 host-only（**不設 `Domain`**），只由設定它的 origin 讀取——IdP session cookie 只在 `apps/platform` 的 origin，各產品的 refresh cookie 只在各自的 origin。身分只經由頂層跳轉帶的一次性授權碼傳遞；**不用 iframe、不做 `prompt=none` 的靜默續期、不以 `postMessage` 傳 token**。`apps/platform` 有自己的 origin（例：`auth.example.com`），issuer 是 `https://auth.example.com/api/oidc` | 瀏覽器的第三方 cookie 封鎖只影響 iframe 與跨站子請求，不影響頂層導覽；host-only cookie 讓任何一個 origin 被 XSS 時都拿不到別的 origin 的憑證。因為不依賴共享 cookie，產品也不必和 `apps/platform` 同站，不同 registrable domain 一樣能用 |
| D7 | **第一方 client 由設定產生**（`backstage` ← `APP_PUBLIC_URL`、`auth` ← `PLATFORM_APP_URL`），跳過同意頁（第一次授權時直接建立 grant）；redirect URI 與 post-logout URI 以白名單比對，不接受萬用字元。這一版 **沒有** `oidc_clients` 表，第三方 client 出現時再加。協定錯誤（例：未登記的 redirect URI）轉到 apps/platform 的 `/error`，絕不導回 | 自己的產品不需要問使用者「是否允許」；redirect URI 只由部署設定決定，少一張要同步的表。白名單是 OIDC 防止授權碼外流的基本要求 |
| D8 | **外部 IdP 是登入互動裡的一種登入方式**：api 以 [`openid-client`](https://github.com/panva/openid-client) 當 RP（Authorization Code ＋ PKCE）。外部身分以 `(provider_id, subject)` 存在 `user_identities`；第一次登入時，只以 IdP 回報 `email_verified = true` 的 email 對應既有帳號（ID token 沒有 email 時查 userinfo）。外部 IdP 的 redirect URI **固定** 是 `…/api/oidc-interaction/external/callback`；callback 兌換、對應帳號之後，跳到互動路徑底下的 `…/:uid/external/complete?ticket=` 完成互動（那裡帶得到互動 cookie）。state、nonce、PKCE verifier 與互動 id 存在 `oidc_payloads`（10 分鐘），ticket 只能用一次。**state 綁定發起登入的瀏覽器**：發起時設一個只送往固定 callback 的綁定 cookie，callback 在兌換之前比對；完成互動的 ticket 是 callback 之後另發的隨機值，不是 state | `subject` 才是外部 IdP 的穩定識別碼（email 會變）；未驗證的 email 能被拿來冒用別人的帳號。大多數外部 IdP 要求 redirect URI 完全相符，不能帶互動 id；互動 cookie 的 path 是互動網址，固定的 callback 帶不到它，所以要再跳一次。state 不綁定瀏覽器時，發起者可以讓別人在外部 IdP 驗證、再以已知的 state 完成自己的互動，拿到別人的 session（RFC 9700 §4.7） |
| D9 | **外部 IdP 連線屬於平台、綁 email 網域**（`identity_provider_domains`）。登入頁先問 email，網域有連線就導向該 IdP（home realm discovery）；網域可設為「只允許 SSO」，這時密碼登入與忘記密碼對該網域無效 | 帳號是平台層級的，一個人可以在多個工作區，所以登入方式不能由工作區決定 |
| D10 | **沒有對應帳號時**，依連線設定：`reject`（預設）／`auto_create`（建立沒有任何角色的已啟用帳號，**只限這個連線登記的網域**）。`approval`（走既有的 `user.register` 審批）這一版不做：現有審批以密碼建立帳號，SSO 帳號沒有密碼 | 預設拒絕最安全；自動建立不帶角色，不會因此取得任何權限。限定網域：否則任何能在該 IdP 登入的人（例：Google 的一般帳號）都能在平台建立帳號 |
| D11 | **機密的存放**：外部 IdP 的 client secret 存資料庫，以 env 的主金鑰（AES-GCM）加密；OIDC Provider 的簽章金鑰（JWKS）放 env，輪替時新舊金鑰並存一個 access token TTL | 連線要能在管理頁新增，所以不能只放 env；主金鑰與簽章金鑰不進資料庫，資料庫外洩時仍無法偽造 token 或解出 secret |
| D12 | **工作區不進 IdP 的 token**：IdP 只回答「你是誰」；工作區仍由路由前綴帶（[`architecture/05-tenancy.md`](05-tenancy.md) §10.7 D8） | 同一個人可以在兩個分頁開不同的工作區；身分與租戶是兩件事 |
| D13 | **租戶管理搬進 `apps/platform`**：平台的工作區管理頁（[`architecture/05-tenancy.md`](05-tenancy.md) §10.7 D5 的範圍）與外部 IdP 連線管理都在 `apps/platform`；backstage 只保留工作區 **內** 的頁面（成員、檔案…） | 平台管理員不必進入任何產品；工作區內的頁面仍屬於產品 |
| D14 | **`apps/platform` 先複製 backstage 需要的 `core/`、`components/`、`shared/`、`themes/`**，不抽 package。README 列出每個複製來源；兩邊修同一個問題時要一起改 | 抽 package 牽動 backstage 的 309 個檔案與所有 import，現在只有兩個前端，還看不出真正共用的邊界。出現第三個前端時再評估抽成 `packages/`。**更新（2026-10-05）**：兩邊零差異的層先抽出——`shared/` → `@b2b-system/web-shared`，`components/`、`themes/`、`assets/icons/` → `@b2b-system/ui`；錯誤碼清單 → `@b2b-system/error-codes`（api 與前端共用，`ERROR_MESSAGE_KEY` 少一個碼就編譯失敗）。`core/`、`plugins/`、`apis/auth/`、`app/` 的外框仍是複製，待抽成 `@b2b-system/web-core`；卡住的是各 app 自己的權限目錄（`core/permission/{enums,constants}.ts`）與放在 app 語系檔裡的 `core/` 翻譯鍵。**更新（2026-10-05，同日）**：`@b2b-system/web-core` 也已抽出，複製的做法整個取代——`core/` 兩邊共用的模組、`core/components` 的四個元件、`plugins/{fetcher,app}`、`app/` 的 providers 與頂列工具、測試輔助都搬進 package。權限目錄以 module augmentation（`PermissionRegister`）由 app 登記；`core/` 的翻譯鍵搬到 package 的語系檔，與 app 的深層合併。仍各自一份的是行為或端點本來就不同的部分：權限目錄、`apis/auth/*`（apps/platform 打 `/platform/auth/*`）、`app/` 的外框（選單、品牌、`SessionWatcher`、`sessionRedirect`）、各自的 feature 與 `shared/` 的收斂點；backstage 才有的 `core/{feature,file,permission-graph,trash}` 留在 backstage（[`apps/platform/README.md`](../../apps/platform/README.md)）。現行規格見 [`frontend/17-shared-packages.md`](./frontend/17-shared-packages.md) |
| D15 | **MFA 預留**：登入互動是多步驟的（`oidc-provider` 的 interaction），密碼或外部 IdP 通過之後可以插入第二步，這一版不實作 | 已實作（[`backend/21-mfa.md`](./backend/21-mfa.md) §4）：只加了一個互動步驟，沒有改協定 |
| D16 | **互動網址先經過 api**：provider 把互動 cookie 的 path 設成互動網址的路徑，所以互動網址是 `/api/oidc-interaction/:uid`（api 302 到 apps/platform 的 `/interaction/:uid`），頁面之後呼叫同一路徑底下的端點（查詢、登入、取消）。登入成功回傳 resume 網址，由頁面 **頂層跳轉**，不用 fetch 跟隨。provider 掛在本程序的 `/oidc`，依 `OIDC_ISSUER` 還原反向代理去掉的前綴與 Host，產生的網址與 cookie path 才是瀏覽器看到的 | 互動 cookie 就是互動的憑證（`@Public()` 端點靠它），path 對不上就送不出去；fetch 跟隨跳轉時 IdP session cookie 設不起來 |
| D17 | **帳號停用、刪除、憑證失效時結束這些人的 IdP session**（訂閱 `SESSIONS_REVOKED { userIds }`）；provider 查不到 IdP session 的帳號時清掉 session 上的帳號、改走登入互動 | 否則 IdP 上留著指向不能用的帳號的 session，下一次授權時 provider 拋錯而不是要求登入 |

決定當時的流程（現行流程見 §3）：

```
使用者          backstage（RP）            apps/platform（互動頁）         apps/api
  │ 打開 backstage   │                          │                         │
  │─────────────────▶│ 沒有 session              │                         │
  │                  │── 302 /api/oidc/auth?client_id&redirect_uri&code_challenge&state ──▶│
  │                  │                          │◀── 303 /api/oidc-interaction/:uid → 302 /interaction/:uid │
  │  輸入 email／密碼（或導向外部 IdP）          │                         │
  │─────────────────────────────────────────────▶│── POST /api/oidc-interaction/:uid/login ▶│
  │                  │                          │                         │ 驗密碼、鎖定、稽核
  │ 頁面頂層跳轉到 resume 網址 → provider 303 redirect_uri?code&state ─────────────────────────│
  │                  │── POST /api/auth/sso/callback { code, codeVerifier } ──────────────▶│
  │                  │                          │                         │ 本程序內兌換授權碼（驗 PKCE）
  │                  │◀── { accessToken } ＋ Set-Cookie: refresh（backstage origin）───────│
  │ 打開編輯器（已有 IdP session）→ /api/oidc/auth 直接帶 code 導回，不出現登入頁           │
```

### 12.3 代價

| 代價 | 評估 |
| --- | --- |
| 多一個前端要建置、部署、維護（nginx、Docker、E2E） | 是這次要付的主要成本；換來「登入與租戶只有一套」 |
| 兩個前端共用 `@b2b-system/web-core`／`ui`／`web-shared`（D14 的更新） | 改 package 會同時影響兩個 app，兩邊都要跑測試與 build；package 不能認識任何 app，app 專屬的東西以參數或 module augmentation 傳入 |
| 登入多了幾次跳轉（產品 → IdP → 產品 → callback） | 已有 IdP session 時是幾百毫秒的 302；比每個產品各自登入省事 |
| `oidc-provider` 是新的大型相依，版本升級要跟著它的安全公告 | 它是 OpenID Certified、維護活躍；比自己實作規格安全 |
| 每個 api 請求的驗證方式不變，但登入路徑多了 IdP 的狀態（interaction、grant、session） | 存在 `oidc_payloads`，過期的列由背景工作 `oidc.cleanup`（`OIDC_CLEANUP_CRON`）清除 |
| 不做靜默續期（D6）：app session 的 refresh token 過期（7 天）後，要再跳轉一次 IdP | IdP session 還在時是一次無感的 302；比起 iframe 靜默續期，不受第三方 cookie 封鎖影響 |
| 其他產品的分頁收到單一登出，靠推播；離線的分頁要等下一次續期失敗才發現 | refresh 家族已在伺服器端撤銷，access token 最多再活 5 分鐘（[`backend/04-auth.md`](backend/04-auth.md) §10 的既有空窗） |

### 12.4 替代方案

| 方案 | 不採用的理由 |
| --- | --- |
| 產品直接用 IdP 發的 access／refresh token（純 SPA public client） | refresh token 會落在 SPA 的 JavaScript 可及範圍（[`backend/04-auth.md`](backend/04-auth.md) §10 理由 1 被推翻）；`JwtAuthGuard` 要改成驗 IdP 的 token 並另外處理 `token_version` |
| 後端拆出獨立身分服務（`apps/platform` 帶自己的 NestJS） | 帳號、角色、稽核分散到兩個服務；每個請求都要跨服務查 `token_version` 與權限（`01-system.md` §4.3） |
| 只接外部 IdP、不自己當 IdP（原 `sso-oidc.md`） | 產品之間仍然各自登入；多產品共用帳號的問題沒有解決 |

### 12.5 實作紀錄：實作時改掉的做法

| 原本的構想 | 改成 | 理由 |
| --- | --- | --- |
| `oidc_clients` 表管理 client | 第一方 client 由設定產生（D7） | 只有自己的產品時，redirect URI 由部署設定決定即可，少一張要同步的表 |
| BFF 以 HTTP 呼叫 provider 的 token 端點 | 本程序內兌換授權碼（D3） | 多一跳，也讓整合測試必須監聽 port |
| 單一登出走 end-session 的跳轉鏈 | 伺服器端銷毀 IdP session ＋ 撤銷家族（D5） | 不必碰其他 origin 的 cookie；跳轉鏈任一環斷掉就登出不完整 |
| 登出後自動跳回 IdP 的登入頁 | 停在「已登出」頁（D5） | 頁面卸載會取消還在路上的登出請求，使用者被尚未銷毀的 IdP session 登回來 |
| 互動網址直接是 apps/platform 的 `/interaction/:uid` | 先經過 api 的 `/api/oidc-interaction/:uid`（D16） | provider 把互動 cookie 的 path 設成互動網址，否則端點收不到 cookie |
| 外部 IdP 的 redirect URI 帶互動 id | 固定的 callback ＋ 互動路徑下的 `complete`（D8） | 外部 IdP 大多要求 redirect URI 完全相符 |
| 找不到帳號時可「走審批」 | 這一版只有 `reject`／`auto_create`（D10） | 現有審批以密碼建立帳號，SSO 帳號沒有密碼 |
| `identity_provider_domains` 有驗證狀態 | 沒有網域驗證，由平台管理員確認 | DNS TXT 驗證需要背景工作與重試，這一版的連線只由平台管理員建立 |

### 12.6 設計決策：更多的登入方式（2026-10-09）

> 使用者要求「增加更多 SSO 的登入方式」，評估後依建議分三期做完：S1 協定抽象、OIDC 範本、外部身分的檢視與解除；S2 SAML 2.0（只支援 SP 發起）；
> S3 以通行金鑰取代密碼（建在 MFA 的 WebAuthn 之上，修改 [`backend/21-mfa.md`](./backend/21-mfa.md) D20）。規劃時的四個問題依建議回答：平台管理者不開放外部 IdP、SAML 不支援 IdP 發起、不做社群登入。

#### 12.6.1 背景

外部 IdP 原本只有通用的 OIDC（D8）：Entra 不回 `email_verified`，以 email 連結既有帳號永遠不成立；Google 的一般 Gmail 帳號也帶 `email_verified`；
企業客戶的 ADFS、Okta 常常只開放 SAML；管理員沒有地方看或解除連錯的外部身分。MFA 第二版已經有 WebAuthn（只當第二步，D20），
同一把金鑰取代密碼只差「還不知道是誰」的那一段。

#### 12.6.2 D 表

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **`identity_providers` 加 `protocol`、`preset`、`config jsonb`**，不是每種協定一張表；`client_id`、`client_secret_encrypted` 改成可為 null，由 CHECK 保證 OIDC 一定有 | 網域、帳號對應、連結、稽核、刪除都與協定無關；SAML 的 entity ID 放 `issuer` 欄，「換 issuer 就作廢連結」的規則自然涵蓋兩種協定 |
| D2 | **OIDC 的範本只改 issuer 格式與「email 已驗證」的判斷**，不是另一種協定 | 授權、兌換、簽章驗證是同一份 openid-client；範本的差異集中在一個純函式檔，加一家只是一列 |
| D3 | **Entra 以 `xms_edov` 判斷、Google 要求 `hd` 等於 email 的網域；Entra 不接受 `common`／`organizations`** | Entra 的 `email` 是使用者可以改的屬性，`xms_edov` 才代表目錄驗證過網域；Google 的 `email_verified` 對一般帳號也是 true，`hd` 才代表組織管理。多租戶端點會讓任何目錄的帳號通過 issuer 檢查 |
| D4 | **SAML 以 `@node-saml/node-saml` 實作 SP**，assertion 必須簽章、自己再比對 assertion 的 Issuer | 不自己處理 XML 簽章（signature wrapping 等攻擊）；node-saml 的 `idpIssuer` 只檢查登出訊息，同一張憑證可能用在 IdP 的多個 entity |
| D5 | **SAML 的 email 一律視為已驗證**，防線是既有的「網域屬於這個連線、管理角色不自動連結」 | SAML 沒有 `email_verified`；企業 IdP 斷言的是目錄裡的 email。§3.3 的兩條限制本來就是為了「連線管理者可以自架 IdP」而設，對 SAML 同樣成立 |
| D6 | **只支援 SP 發起**；RelayState 當 state、`InResponseTo` 只認那一次的 request、登入狀態用過即作廢，不另存 assertion ID | IdP 發起的回應沒有我們發的 state，等於登入 CSRF；state 綁瀏覽器（綁定 cookie）＋一次性就已經擋住重放 |
| D7 | **SAML 的綁定 cookie 是 `SameSite=None; Secure`，path 只到 ACS；ACS 以 303 跳到 complete** | IdP 以跨站的表單 POST 送回，Lax 的 cookie 帶不上；path 限縮讓 None 的影響只在 ACS。303 讓下一步一定是頂層 GET，Lax 的互動 cookie 才帶得上 |
| D8 | **SP 的 entity ID 是含租戶 id 與連線 id 的 metadata 網址** | IdP 可以直接匯入；固定的端點不在租戶網域上，要從路徑知道租戶；entity ID 上線後不能改，用不會改名的 id 而不是租戶代碼 |
| D9 | **通行金鑰取代密碼是 `MfaMethod` 的選用能力 `passwordless`**（`begin`、`locate`、`accountHandle`），驗證仍走 `verify` 與框架的 `verifyFactor` | 計數、重放、稽核都在框架（[`backend/21-mfa.md`](./backend/21-mfa.md) D2）；方式只多「不知道帳號時的 challenge」與「從回應找因子」。框架不認識 WebAuthn |
| D10 | **由 WebAuthn 的平台參數 `passkeyLogin` 開關（預設 disabled、不是必填），要求使用者驗證，以 user handle 比對帳號；失敗不累計鎖定；只允許 SSO 的網域與 `mfa_enroll` 的登入不接受** | 取代密碼是比第二步更大的決定，要明確開啟；不是必填才不會讓既有的參數變成「沒填齊」而關掉方式。沒有使用者驗證的金鑰只是一個因子。憑證 id 可以被複製，user handle 才能分出帳號。鎖定是擋猜密碼 |
| D11 | **外部身分的檢視與解除放在 `modules/identity-provider`、路徑掛在 `/users/:userId/identities`，解除要 `user:update` 並套反提權** | 表與規則屬於外部 IdP 模組；不新增權限鍵（與停用、撤銷 token 同一個層級）。解除 super-admin 的連結可能把人鎖在門外，比照 MFA 重設 |
| D12 | **平台管理者不開放外部 IdP** | 平台管理者只有幾位、權限最大；連線屬於租戶，平台要另一套連線表與管理頁，等有需求再做 |
| D13 | **不做社群登入、LDAP 直連** | B2B 後台的價值低；GitHub 沒有 ID token、Apple 的 `form_post` 與 JWT client secret 要另寫；LDAP 要從外部連進客戶內網且密碼會經過我們，請客戶改用 ADFS／Entra 的 SAML 或 OIDC |

#### 12.6.3 評估過的方案

| 方案 | 不選的理由 |
| --- | --- |
| 協定做成註冊表（像 `MfaMethodRegistry`），每種協定一個模組 | 只有兩種協定，而且 callback 的形狀根本不同（GET 帶 code vs 跨站的表單 POST）；兩個 DI 抽象類別加上共用的 `handleReturn` 已經足夠，第三種協定出現時再抽 |
| SAML 用 `samlify` | node-saml 是 passport-saml 的核心、維護活躍；需要的只有 SP 的 Redirect binding 與回應驗證 |
| IdP metadata 在伺服器解析（貼網址由 api 抓） | api 代抓網址是另一個 SSRF 面；metadata 只在建立時用一次，瀏覽器的 `DOMParser` 就夠，伺服器只收拆好的欄位並自己檢查憑證 |
| 通行金鑰另開一張 `passkeys` 表 | 憑證本來就是 MFA 的因子（公鑰、計數、RP ID 都在 `mfa_factors`）；分兩張表會讓「同一把金鑰」在第二步與登入各存一份 |
| 通行金鑰登入之後仍要求第二步 | 有使用者驗證的通行金鑰本身就是兩個因子（持有 ＋ 生物辨識或 PIN），再要一次只會讓人不用它 |

#### 12.6.4 實作紀錄

1. **`protocol` 沒帶時是 OIDC**：建立與更新的 schema 是 `z.union`（OIDC 在前、`protocol` 有預設值），不是 `discriminatedUnion`（判別欄位必填）；既有的呼叫端不必改。更新用 `strict()`，SAML 的欄位不會被當成 OIDC 的請求默默丟掉。
2. **SAML 的屬性名稱空字串轉 null 在 service**：OpenAPI 產生器不接受 zod 的 `transform`。
3. **`PasskeyLogin` 重存前先刪**：`oidc_payloads` 的 upsert 不清 `consumed_at`，同一個互動重試時舊的已消耗標記會留著。
4. **憑證 id 的查詢以字面量放進 SQL**（`identifierLiteral`）：部分索引的條件與運算式是字面量，參數化的查詢用不上它。
5. **使用者詳情的「外部身分」以 `Resource.USER` 的 entity 失效**：解除以使用者的 update 宣告，不另加資源種類。

