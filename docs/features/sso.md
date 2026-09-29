# SSO 與身分平台（`apps/auth`）

- 優先度：P1
- 狀態：規劃中
- 依賴：工作區（[`workspace.md`](./workspace.md)，租戶管理搬進 `apps/auth` 需要它先合併歸檔）
- 相關：[ADR-0019](../adr/0019-sso-identity-platform.md)（本功能的決定，待確認）、[ADR-0004](../adr/0004-jwt-with-rotating-refresh-token.md)、
  [ADR-0018](../adr/0018-workspace-tenancy.md)、[`mfa.md`](./mfa.md)、[`user-groups.md`](./user-groups.md)、
  [`system-settings.md`](./system-settings.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。
> 本提案取代原本的 `sso-oidc.md`（只談「接外部 IdP 登入」），原提案的範圍與開放問題已併入下方。

## 背景

帳號、登入與租戶目前都綁在 `apps/backstage` 裡：

- 登入頁、啟用、重設密碼、接受工作區邀請都是 `apps/backstage/src/features/auth` 的頁面，
  session 是 backstage 自己的（[ADR-0004](../adr/0004-jwt-with-rotating-refresh-token.md)：5 分鐘 JWT ＋ 輪替式 refresh cookie，
  `Path=/api/auth`，同源）。
- 平台管理員的工作區（租戶）管理是 backstage 的一頁（`features/workspace/pages/WorkspaceAdminList`）。

接下來會有第二個、第三個前端產品（遊戲編輯器等）共用同一套帳號與工作區。如果每個產品各做一套登入頁與 session：

- 使用者在每個產品都要重新輸入密碼，停用帳號、改密碼、MFA 也要在每個產品各實作一次。
- 公司客戶會要求用自己的 Google Workspace／Azure AD 登入（原 `sso-oidc.md` 的需求），要接在「每一個」產品上。
- 租戶管理（建立工作區、指定管理員、租戶的登入方式）屬於平台，不屬於任何一個產品。

[`01-system.md`](../architecture/01-system.md) §4.3 把「auth 獨立服務」的前提寫成「有第二個需要同一套帳號的產品」——
現在就是這個時間點。但每個請求都要驗 token 與權限，後端拆服務的理由仍不成立，所以這一版 **只拆前端**：
新增 `apps/auth`，後端仍在 `apps/api`。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 新增 `apps/auth`：全平台共用的前端，不分工作區（Vite ＋ React，架構比照 `apps/backstage`） | `apps/auth` 自己的後端或獨立的身分服務（後端仍是 `apps/api`） |
| **我們自己當 IdP**：`apps/api` 提供 OIDC Provider，`apps/auth` 提供登入、同意等互動頁；backstage 改成透過它登入 | SAML、LDAP、SCIM 自動佈建 |
| **接外部 IdP**：以 OIDC（Authorization Code ＋ PKCE）用 Google／Azure AD 等帳號登入；帳號以已驗證的 email 對應 | 外部 IdP 的群組對應到角色（等 [`user-groups.md`](./user-groups.md)） |
| 依 email 網域導向對應的外部 IdP（home realm discovery）；可設定「這個網域只允許 SSO」 | 第三方（非本平台）應用程式的自助註冊與同意管理 |
| 租戶管理搬進 `apps/auth`：工作區的建立、改名、刪除、指定管理員（backstage 保留工作區 **內** 的頁面） | 依工作區計費、配額 |
| 外部 IdP 連線的管理頁（平台管理員） | MFA（[`mfa.md`](./mfa.md)，但登入流程要預留第二步） |
| 單一登出：在任一產品登出會結束所有產品的 session（跳轉鏈 ＋ 伺服器端撤銷） | 跨域 cookie（`Domain=` 共用、第三方 cookie）、iframe 靜默續期、以 `postMessage` 傳遞身分 |
| 帳號流程（啟用、重設密碼、接受邀請）搬到 `apps/auth`，信中連結改指向它 | |

## 使用者故事

**作為使用者，我希望在 backstage 登入後打開編輯器不必再輸入密碼，以便在產品之間切換。**

- **Given** 我已在 backstage 登入（`apps/auth` 上有 IdP session）
- **When** 我打開編輯器
- **Then** 編輯器導向 `apps/auth` 授權，立即導回，我不需要再輸入任何東西

**作為公司客戶的員工，我希望用公司的 Azure AD 登入。**

- **Given** 平台管理員為 `acme.com` 設定了 Azure AD 連線，且設為「只允許 SSO」
- **When** 我在 `apps/auth` 輸入 `alice@acme.com`
- **Then** 我被導到 Azure AD；回來後以對應的帳號登入，密碼登入對這個網域不可用

**作為平台管理員，我希望在同一個地方管理所有租戶，以便不必進入任何產品。**

- **Given** 我持有 `workspace:*`
- **When** 我在 `apps/auth` 打開「工作區」
- **Then** 看得到所有工作區的名稱、成員數與管理員，可以建立工作區、指定管理員；看不到工作區裡的內容（ADR-0018 D5）

**作為使用者，我希望登出一次就離開所有產品。**

- **Given** 我同時開著 backstage 與編輯器
- **When** 我在任一個產品按登出
- **Then** 兩個產品的 session 都結束，回到 `apps/auth` 的登入頁

## 初步構想

決定與理由見 [ADR-0019](../adr/0019-sso-identity-platform.md)；這裡只列會動到的地方。

- **部署**：`apps/auth` 有自己的 origin（例：`auth.example.com`，dev `localhost:5175`），同樣以 `/api` 反向代理到 `apps/api`。
  OIDC 的 issuer 是 `https://auth.example.com/api/oidc`。
- **不使用跨域 cookie**（ADR-0019 D6）：每個 cookie 都是 host-only、只由自己的 origin 讀；服務之間只以頂層跳轉（授權碼、end-session）溝通，
  不用 iframe、靜默續期或 `postMessage`。所以產品不必和 `apps/auth` 同站。
- **後端（`apps/api`）**
  - `modules/oidc-provider`：以 [`oidc-provider`](https://github.com/panva/node-oidc-provider)（OpenID Certified）掛在 `/oidc`；
    儲存以 Drizzle adapter 寫進 Postgres；互動（登入、同意）導到 `apps/auth` 的 `/interaction/:uid`。
  - `modules/identity-provider`：外部 IdP 連線的管理與登入（以 [`openid-client`](https://github.com/panva/openid-client) 當 RP）、帳號對應。
  - `modules/auth`：新增「以 IdP 授權碼換 app session」的端點（BFF：code 由 api 在伺服器端換，app session 仍照 ADR-0004）；
    密碼驗證與鎖定規則改由 IdP 的登入互動呼叫。
  - `modules/workspace`：API 不變，只是呼叫端從 backstage 換成 `apps/auth`。
- **資料模型**（草案）
  - `oidc_payloads`：`oidc-provider` 的通用儲存（session、grant、authorization code、interaction…，含 `expires_at`、`consumed_at`）。
  - ~~`oidc_clients`~~：這一版不建表，第一方 client 由設定產生（ADR-0019 D7）。
  - `identity_providers`：外部 IdP 連線（issuer、client id、**加密** 的 client secret、scopes、啟用）。
  - `identity_provider_domains`：email 網域 → 連線、是否「只允許 SSO」、驗證狀態。
  - `user_identities`：帳號 ↔ 外部身分（`provider_id`、`subject`，唯一）。
  - `refresh_tokens` 加 `client_id` 與 `idp_session_uid`：知道一條 refresh 家族屬於哪個產品、哪個 IdP session（單一登出用）。
- **前端（`apps/auth`）**
  - 架構比照 backstage：`main.tsx` 的 plugin chain、`app/`、`core/`、`features/`、`apis/`、`components/`、`shared/`、`themes/`。
  - **先複製需要的部分**（`core/app`、`auth`、`cache`、`client`、`errors`、`locales`、`notify`、`permission`、`router`、`store`、`theme`；
    用到的 `components/`、`shared/`、`themes/`），不抽 package；複製清單與「兩邊要同步的檔案」寫進 `apps/auth` 的 README。
  - features：`login`（密碼、外部 IdP、網域導向）、`interaction`（同意頁；第一方 client 不出現）、`account-flow`（啟用、重設密碼、接受邀請）、
    `workspace-admin`（從 backstage 搬過來）、`identity-provider`（外部 IdP 連線管理）。
  - `apps/backstage`：移除 `features/auth` 的登入相關頁面，改成「導向 `apps/auth` 授權 → callback 換 session」；
    平台的工作區管理頁移除，選單改連到 `apps/auth`。
- **權限**（草案，platform 範圍）：`identityProvider:read`、`identityProvider:create`、`identityProvider:update`、`identityProvider:delete`；
  租戶管理沿用 `workspace:*`；`oidc_clients` 這一版只由 seed 管理，不開權限。
- **稽核**：`auth.sso_login`（含 IdP 與 client）、`identityProvider.create/update/delete`、`userIdentity.link/unlink`、`auth.logout`（標註是否為單一登出）。
- **推播**：`ChangeSource.IDENTITY_PROVIDER`（管理頁）；單一登出沿用既有的 `SESSIONS_REVOKED`。
- **交付順序**：
  1. ADR 定案、`apps/auth` 骨架（複製的 core／components、dev／build／test／Docker、nginx）——✅ 骨架已建立：
     `/login`（暫時直接呼叫既有的 `POST /auth/login`）、`/`（目前的身分）、平台外框；複製清單見 `apps/auth/README.md`
  2. IdP：`oidc-provider`、密碼登入互動、backstage 改走 SSO、單一登出——✅ 已完成：
     - api：`modules/oidc-provider`（provider、`oidc_payloads` adapter、`oidc.cleanup` 排程）、`AuthModule` 的互動端點
       （`/oidc-interaction/:uid`、`…/details`、`…/login`、`…/abort`）與 BFF（`POST /auth/sso/callback`）；migration 0018
       （`oidc_payloads`；`refresh_tokens.client_id`、`idp_session_uid`）；access token 帶 `sid`，即時連線加入 `sid:{uid}` room
     - apps/auth：`/interaction/:uid`（密碼登入）、`/error`；自己的頁面也經 SSO 登入（`/login` → `/callback`）
     - backstage：`/auth/login` 只負責跳到 IdP、新增 `/auth/callback`；登出後停在「已登出」頁
     - 與原構想不同（ADR-0019 已修訂）：沒有 `oidc_clients` 表（D7）、授權碼在本程序內兌換（D3）、單一登出在伺服器端完成（D5）；
       新增 D16（互動網址先經過 api）、D17（帳號停用時結束 IdP session）
     - 已知缺口：已在交付順序 3a 補上（IdP 登入頁的連結、帳號流程搬到 apps/auth）。`POST /auth/login` 保留給 API 測試與腳本
  3. 帳號流程與租戶管理搬進 `apps/auth`
     - ✅ 帳號流程（3a）：忘記密碼、重設密碼、啟用、申請帳號、接受工作區邀請都在 apps/auth
       （`/forgot-password`、`/reset-password`、`/setup`、`/register`、`/invitation`）；IdP 登入頁有「忘記密碼」「申請帳號」連結；
       啟用、重設密碼、邀請信的連結以 `AUTH_APP_URL` 開頭（`MailService.accountLink`）。接受邀請的回應帶 `workspaceUrl`，
       apps/auth 接受後頂層跳轉到產品的工作區，由 IdP 登入（新帳號不再在頁面上直接以密碼登入）。backstage 的舊網址
       （`/auth/setup` 等）保留一版，連同查詢字串轉到 apps/auth。
     - ✅ 租戶管理（3b）：平台的工作區管理頁搬到 apps/auth 的 `/workspaces`（`features/workspace-admin`，`workspace:*`）；
       apps/auth 的頂列依頁面權限顯示「首頁／工作區」。backstage 刪除該頁與專用的 hook／API，側邊選單的「工作區」改為連到
       apps/auth 的一般連結（仍依 `workspace:read` 顯示），舊網址 `/workspace` 保留一版轉過去。外部 IdP 連線管理在交付順序 4
  4. 外部 IdP：連線管理、登入、帳號對應、網域導向——✅ 已完成：
     - api：`modules/identity-provider`（連線的增刪改、client secret 以 `IDP_SECRET_KEY` 做 AES-256-GCM 加密且不回傳、
       `openid-client` 的 RP）；migration 0019（`identity_providers`、`identity_provider_domains`、`user_identities`、
       `identityProvider:*` 權限）；互動端點 `…/:uid/discover`、`…/:uid/external`、`external/callback`、`…/:uid/external/complete`
       （ADR-0019 D8 修訂）。只允許 SSO 的網域：`POST /auth/login`、互動頁的密碼登入回 `AUTH_SSO_REQUIRED`，忘記密碼不寄信
     - 帳號對應（D8、D10）：已連結的 `subject` → 已驗證 email 對上既有帳號（連結，稽核 `userIdentity.link`）→ `auto_create` 且 email 網域
       屬於這個連線才建立 → 否則回到互動頁並帶 `?error=AUTH_SSO_ACCOUNT_NOT_FOUND`。登入稽核沿用 `auth.login.success/failure`（`metadata.method = 'sso'`）
     - apps/auth：互動頁離開 email 欄時查網域，有連線時多一個「使用 X 登入」，只允許 SSO 時不顯示密碼欄；管理頁 `/identity-providers`
       （`features/identity-provider`），顯示要登記在外部 IdP 的 redirect URI
     - 開發／E2E：`pnpm dev:mock-idp` 啟動模擬的外部 IdP（`http://localhost:4455`，client `b2b-mock`／`mock-secret`，輸入任何 email 都能登入）；
       `apps/e2e/tests/sso-external.spec.ts`
     - 這一版不做：`approval`（走審批，理由見 D10）、網域所有權驗證（DNS TXT；目前由平台管理員自行確認）、管理頁的推播
       （`ChangeSource.IDENTITY_PROVIDER`；apps/auth 沒有推播，靠分頁間的 BroadcastChannel）、`userIdentity.unlink`（解除連結的畫面）
  5. E2E、歸檔

## 開放問題

進入「規劃中」之前，每一條都要有結論（寫在該條下方，不要刪掉問題）。

1. `apps/auth` 在 SSO 裡扮演什麼角色：我們自己當 IdP、接外部 IdP，還是兩者？
   - **結論**：兩者都要。`apps/api` 當 OIDC Provider，`apps/auth` 提供互動頁；外部 IdP 是登入互動裡的一種登入方式。
2. `apps/auth` 要不要有自己的後端？
   - **結論**：不要。只有前端 SPA，後端 API 由 `apps/api` 提供（理由同 `01-system.md` §4.3）。
3. backstage 的 `core/`、`components/`、`shared/` 要抽成 package，還是複製？
   - **結論**：先複製 `apps/auth` 需要的部分。代價是兩份會各自演進；在 `apps/auth` 的 README 列出複製來源，
     之後出現第三個前端時再評估抽成 `packages/`。
4. 產品（backstage、編輯器）拿到 IdP 的授權碼之後，session 用誰的？
   - **結論**：BFF——授權碼交給產品自己 origin 的 `/api/auth/sso/callback`，由 api 在伺服器端向 IdP 換 token、驗 `id_token`，
     再發 ADR-0004 的 app session（refresh token 仍是該 origin 的 httpOnly cookie）。refresh token 不會落到 SPA 的 JavaScript 手上。
     見 ADR-0019 D3。（已確認）
5. 部署拓撲：`apps/auth` 用獨立子網域，還是和 backstage 同源的子路徑？
   - **結論**：獨立 origin（`auth.example.com`）。IdP session cookie 只屬於 IdP；各產品的 refresh cookie 各自獨立，全部 host-only。
     同源子路徑會讓 IdP session 與 backstage 的 cookie 混在一起，也和 backstage 既有的 `/auth/*` 路由衝突。
     **不使用跨域 cookie，服務之間只以頂層跳轉溝通**（ADR-0019 D6）。（已確認）
6. 外部 IdP 登入時，沒有對應到既有帳號的人：自動建立、走審批（`user.register`），還是拒絕？（原 `sso-oidc.md` 問題 1）
   - **結論**：依連線設定，預設 **拒絕**；可設為「自動建立（沒有任何角色）」或「走審批」。只以 IdP 回報 `email_verified = true` 的 email 對應。（已確認）
   - **實作時修訂**：「走審批」這一版不做；自動建立只限這個連線登記的網域（ADR-0019 D10）。
7. 外部 IdP 的連線屬於平台，還是屬於某個工作區（租戶）？
   - **結論**：屬於平台、綁 email 網域。帳號是平台層級的（一個人可以在多個工作區），所以登入方式不能由工作區決定；
     「某個工作區只允許 SSO 成員」留到下一版。（已確認）
8. 提供者設定放 env 還是資料庫／[`system-settings.md`](./system-settings.md)？（原 `sso-oidc.md` 問題 3）
   - **結論**：外部 IdP 連線放資料庫（要能在管理頁新增），client secret 以 env 的主金鑰加密；OIDC Provider 的簽章金鑰放 env（JWKS），
     輪替流程另寫 runbook。（已確認）
9. 單一登出怎麼做？
   - **結論**：IdP session 與各產品的 refresh 家族以 `idp_session_uid` 關聯。在任一產品登出 → api 銷毀 IdP session、撤銷它底下所有產品的
     refresh 家族，並以 `SESSIONS_REVOKED` 推播給同一個 IdP session 的分頁（伺服器端完成，不必跳到 IdP 的 end-session，見 ADR-0019 D5）。
     **不** 遞增 `token_version`：那會連其他裝置一起登出。已發出的 access token 最多再活 5 分鐘（ADR-0004 的既有空窗）。（已確認，實作時修訂）
10. backstage 既有的登入頁、帳號流程與剛做好的 `/auth/invitation` 何時移除？
    - **結論**：交付順序第 2 步 backstage 改走 SSO 時移除登入頁；第 3 步帳號流程搬家時，信中連結改指向 `apps/auth`，
      backstage 的舊路徑保留一版做轉址（已寄出的信還有效）。（已確認）
11. 一個工作區要怎麼知道使用者是從哪個產品進來的？工作區要不要進 IdP 的 token？
    - **結論**：不要。沿用 ADR-0018 D8，工作區是請求的屬性，不是身分；IdP 只負責「你是誰」。（已確認）

## 歸檔去向

- `docs/adr/0019-sso-identity-platform.md`：狀態改為「採用」
- `docs/architecture/01-system.md`：全貌與部署拓撲加上 `apps/auth` 與 OIDC 流程；§4.3 更新「auth 獨立服務」一列
- `docs/architecture/02-repository-structure.md`：新增 `apps/auth` 內部結構；`docs/conventions/07-layer-dependencies.md` §1 加一列
- `docs/architecture/backend/04-auth.md`：新增「SSO（IdP、外部 IdP、app session、單一登出）」章節
- `docs/architecture/auth/`（新分區，比照 `frontend/`）：`apps/auth` 的架構、與 backstage 共用程式碼的同步規則
- `docs/rbac/02-permission-catalog.md`：`identityProvider:*`
- `docs/overview/01-overview.md`、`03-roadmap.md`（「Phase 1 之後」第 5 項）、`CLAUDE.md`（常用指令、三處同步改成四處）
