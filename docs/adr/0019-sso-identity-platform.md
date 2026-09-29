# ADR-0019 — SSO：`apps/api` 當 OIDC Provider、`apps/auth` 當身分與租戶入口

- 狀態：**採用**（D1、D9、D12、D13 被 [ADR-0020](./0020-physical-tenant-isolation.md) 修改：帳號分屬各租戶 DB、外部 IdP 屬於租戶、授權帶 `tenant`、租戶管理之外的工作區頁面移除）
- 日期：2026-09-29
- 相關：[ADR-0004](./0004-jwt-with-rotating-refresh-token.md)（app session 不變）、[ADR-0005](./0005-permission-resolved-server-side.md)、
  [ADR-0018](./0018-workspace-tenancy.md)（工作區不進身分，D8）、[`../architecture/04-sso.md`](../architecture/04-sso.md)（做出來的樣子）

## 背景

帳號、登入與租戶管理都在 `apps/backstage` 裡，session 是 backstage 同源的 refresh cookie。
接下來會有多個前端產品（遊戲編輯器等）共用同一套帳號與工作區，也有客戶要求用自己的 Google Workspace／Azure AD 登入。

要決定的事：

1. 「單一登入」用什麼協定：自訂的跳轉票證、共用 cookie，還是標準的 OIDC？
2. 身分服務放在哪：新的後端服務，還是 `apps/api` 的模組？登入與租戶管理的畫面放在哪？
3. 產品拿到身分之後，session 怎麼表示：直接用 IdP 發的 token，還是沿用 ADR-0004 的 app session？
4. 外部 IdP（Google、Azure AD）怎麼接進來？

已確認的前提（提案階段的開放問題）：我們自己當 IdP，也要能接外部 IdP；
`apps/auth` 只有前端，後端在 `apps/api`；`apps/auth` 先複製 backstage 需要的程式碼，不抽 package。

## 決定

### 單一登入的協定

| 方案 | 結論 |
| --- | --- |
| A. 共用 cookie：所有產品放在同一個 origin 的子路徑共用 refresh cookie，或以 `Domain=.example.com` 讓子網域共用 | 不採用：產品之間的 session 無法分開撤銷；每個產品都得和 backstage 同源部署；非同源的服務（或將來的 CLI、第三方）完全接不上 |
| B. 自訂跳轉票證：登入頁發一次性票證，產品拿票證換 session | 不採用：等於自己設計一套協定，安全細節（重放、redirect URI 驗證、PKCE）都要自己想；外部服務沒有現成的 client 可用 |
| **C. OIDC Authorization Code ＋ PKCE，`apps/api` 當 Provider** | **採用**：標準協定，任何語言都有 client；redirect URI 白名單、PKCE、`state`／`nonce`、end-session 都是規格的一部分 |

### Provider 的實作

| 方案 | 結論 |
| --- | --- |
| A. 自己實作 `/authorize`、`/token`、JWKS、end-session | 不採用：規格細節多（錯誤回應、`prompt`、`max_age`、金鑰輪替），自己寫容易出安全漏洞 |
| **B. [`oidc-provider`](https://github.com/panva/node-oidc-provider)（OpenID Certified）掛在 NestJS 的 `/oidc`** | **採用**：互動（登入、同意）交給我們自己的畫面；儲存以 adapter 接 Postgres |
| C. 外部 IdP 產品（Keycloak、Auth0、Ory） | 不採用：多一個要維運的服務與一套帳號資料，帳號、角色、稽核會分散在兩個地方；「每個請求都要查 `token_version` 與權限」仍得回到 `apps/api` |

### 具體決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **新增 `apps/auth`**：全平台共用、不分工作區的前端（Vite ＋ React，架構比照 backstage）。它負責 OIDC 的互動頁（登入、同意、外部 IdP 的選擇與網域導向）、帳號流程（啟用、重設密碼、接受邀請），以及平台層級的管理（租戶、外部 IdP 連線） | 登入與租戶都屬於平台，不屬於任何一個產品；放在 backstage 會讓其他產品依賴 backstage |
| D2 | **後端不拆**：OIDC Provider（`modules/oidc-provider`）與外部 IdP（`modules/identity-provider`）都是 `apps/api` 的模組；`apps/auth` 經自己 origin 的 `/api` 反向代理呼叫 | 延續 `01-system.md` §4.3：每個請求都要驗 token 與權限，拆服務就是每個請求多一跳；帳號、角色、稽核留在同一個資料庫與交易裡 |
| D3 | **產品的 session 仍是 ADR-0004 的 app session（BFF）**：第一方產品是 public client ＋ PKCE（S256，必填）。產品把授權碼與 PKCE verifier 交給自己 origin 的 `/api/auth/sso/callback`，api **在本程序內** 兌換授權碼（檢查與 token 端點相同的條件：存在、未用過、未過期、client 與 redirect URI 相符、PKCE；重放時撤銷同一個 grant），再發 5 分鐘 JWT ＋ 該 origin 的 httpOnly refresh cookie。verifier 只存在發起登入的分頁的 sessionStorage | refresh token 不落到 SPA 的 JavaScript 手上（ADR-0004 理由 1）；`JwtAuthGuard`、`token_version`、權限快取、推播全部不必改。IdP 與 BFF 在同一個程序，走 HTTP 呼叫自己的 token 端點只多一跳，也讓整合測試無法在不監聽 port 的情況下執行；第三方 RP 仍用標準的 token 端點 |
| D4 | **IdP session 與 app session 分開**：IdP session 是 `apps/auth` origin 上的 cookie（由 `oidc-provider` 管理），代表「在這台瀏覽器登入過平台」；每個產品各有自己的 refresh 家族。`refresh_tokens` 加 `client_id` 與 `idp_session_uid` | 產品之間可以分開撤銷；知道一條 refresh 家族屬於哪個 IdP session，單一登出才找得到要撤銷誰 |
| D5 | **單一登出（伺服器端）**：任一產品登出（`POST /auth/logout`，帶自己 origin 的 refresh cookie）→ api 以該家族的 `idp_session_uid` **銷毀 IdP session**、撤銷它底下所有產品的 refresh 家族，並推播 `SESSIONS_REVOKED { idpSessionUids }`。經 SSO 發的 access token 帶 `sid`（IdP session），即時連線依它加入 `sid:{uid}` 的 room，推播只到同一個 IdP session 的分頁。**不** 遞增 `token_version`。登出後產品停在「已登出」頁、**不自動跳回 IdP** | 全部在伺服器端完成，不必碰其他 origin 的 cookie，也不需要 IdP 的登出確認頁（apps/auth 上的 session cookie 之後指向不存在的 session）。`token_version` 會連其他裝置一起登出。登出後若立刻自動跳去 IdP，頁面卸載會取消還在路上的登出請求，使用者會被尚未銷毀的 IdP session 直接登回來。第三方 RP 走 provider 的 end-session 時，同樣撤銷該 IdP session 的 app session |
| D6 | **不使用跨域 cookie，服務之間只以頂層跳轉溝通**：每個 cookie 都是 host-only（**不設 `Domain`**），只由設定它的 origin 讀取——IdP session cookie 只在 `apps/auth` 的 origin，各產品的 refresh cookie 只在各自的 origin。身分只經由頂層跳轉帶的一次性授權碼傳遞；**不用 iframe、不做 `prompt=none` 的靜默續期、不以 `postMessage` 傳 token**。`apps/auth` 有自己的 origin（例：`auth.example.com`），issuer 是 `https://auth.example.com/api/oidc` | 瀏覽器的第三方 cookie 封鎖只影響 iframe 與跨站子請求，不影響頂層導覽；host-only cookie 讓任何一個 origin 被 XSS 時都拿不到別的 origin 的憑證。因為不依賴共享 cookie，產品也不必和 `apps/auth` 同站，不同 registrable domain 一樣能用 |
| D7 | **第一方 client 由設定產生**（`backstage` ← `APP_PUBLIC_URL`、`auth` ← `AUTH_APP_URL`），跳過同意頁（第一次授權時直接建立 grant）；redirect URI 與 post-logout URI 以白名單比對，不接受萬用字元。這一版 **沒有** `oidc_clients` 表，第三方 client 出現時再加。協定錯誤（例：未登記的 redirect URI）轉到 apps/auth 的 `/error`，絕不導回 | 自己的產品不需要問使用者「是否允許」；redirect URI 只由部署設定決定，少一張要同步的表。白名單是 OIDC 防止授權碼外流的基本要求 |
| D8 | **外部 IdP 是登入互動裡的一種登入方式**：api 以 [`openid-client`](https://github.com/panva/openid-client) 當 RP（Authorization Code ＋ PKCE）。外部身分以 `(provider_id, subject)` 存在 `user_identities`；第一次登入時，只以 IdP 回報 `email_verified = true` 的 email 對應既有帳號（ID token 沒有 email 時查 userinfo）。外部 IdP 的 redirect URI **固定** 是 `…/api/oidc-interaction/external/callback`；callback 兌換、對應帳號之後，跳到互動路徑底下的 `…/:uid/external/complete?ticket=` 完成互動（那裡帶得到互動 cookie）。state、nonce、PKCE verifier 與互動 id 存在 `oidc_payloads`（10 分鐘），ticket 只能用一次 | `subject` 才是外部 IdP 的穩定識別碼（email 會變）；未驗證的 email 能被拿來冒用別人的帳號。大多數外部 IdP 要求 redirect URI 完全相符，不能帶互動 id；互動 cookie 的 path 是互動網址，固定的 callback 帶不到它，所以要再跳一次 |
| D9 | **外部 IdP 連線屬於平台、綁 email 網域**（`identity_provider_domains`）。登入頁先問 email，網域有連線就導向該 IdP（home realm discovery）；網域可設為「只允許 SSO」，這時密碼登入與忘記密碼對該網域無效 | 帳號是平台層級的，一個人可以在多個工作區，所以登入方式不能由工作區決定 |
| D10 | **沒有對應帳號時**，依連線設定：`reject`（預設）／`auto_create`（建立沒有任何角色的已啟用帳號，**只限這個連線登記的網域**）。`approval`（走既有的 `user.register` 審批）這一版不做：現有審批以密碼建立帳號，SSO 帳號沒有密碼 | 預設拒絕最安全；自動建立不帶角色，不會因此取得任何權限。限定網域：否則任何能在該 IdP 登入的人（例：Google 的一般帳號）都能在平台建立帳號 |
| D11 | **機密的存放**：外部 IdP 的 client secret 存資料庫，以 env 的主金鑰（AES-GCM）加密；OIDC Provider 的簽章金鑰（JWKS）放 env，輪替時新舊金鑰並存一個 access token TTL | 連線要能在管理頁新增，所以不能只放 env；主金鑰與簽章金鑰不進資料庫，資料庫外洩時仍無法偽造 token 或解出 secret |
| D12 | **工作區不進 IdP 的 token**：IdP 只回答「你是誰」；工作區仍由路由前綴帶（ADR-0018 D8） | 同一個人可以在兩個分頁開不同的工作區；身分與租戶是兩件事 |
| D13 | **租戶管理搬進 `apps/auth`**：平台的工作區管理頁（ADR-0018 D5 的範圍）與外部 IdP 連線管理都在 `apps/auth`；backstage 只保留工作區 **內** 的頁面（成員、檔案…） | 平台管理員不必進入任何產品；工作區內的頁面仍屬於產品 |
| D14 | **`apps/auth` 先複製 backstage 需要的 `core/`、`components/`、`shared/`、`themes/`**，不抽 package。README 列出每個複製來源；兩邊修同一個問題時要一起改 | 抽 package 牽動 backstage 的 309 個檔案與所有 import，現在只有兩個前端，還看不出真正共用的邊界。出現第三個前端時再評估抽成 `packages/` |
| D15 | **MFA 預留**：登入互動是多步驟的（`oidc-provider` 的 interaction），密碼或外部 IdP 通過之後可以插入第二步，這一版不實作 | 之後做 [`mfa.md`](../features/mfa.md) 時只加一個互動步驟，不改協定 |
| D16 | **互動網址先經過 api**：provider 把互動 cookie 的 path 設成互動網址的路徑，所以互動網址是 `/api/oidc-interaction/:uid`（api 302 到 apps/auth 的 `/interaction/:uid`），頁面之後呼叫同一路徑底下的端點（查詢、登入、取消）。登入成功回傳 resume 網址，由頁面 **頂層跳轉**，不用 fetch 跟隨。provider 掛在本程序的 `/oidc`，依 `OIDC_ISSUER` 還原反向代理去掉的前綴與 Host，產生的網址與 cookie path 才是瀏覽器看到的 | 互動 cookie 就是互動的憑證（`@Public()` 端點靠它），path 對不上就送不出去；fetch 跟隨跳轉時 IdP session cookie 設不起來 |
| D17 | **帳號停用、刪除、憑證失效時結束這些人的 IdP session**（訂閱 `SESSIONS_REVOKED { userIds }`）；provider 查不到 IdP session 的帳號時清掉 session 上的帳號、改走登入互動 | 否則 IdP 上留著指向不能用的帳號的 session，下一次授權時 provider 拋錯而不是要求登入 |

## 流程

```
使用者          backstage（RP）            apps/auth（互動頁）         apps/api
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

## 代價

| 代價 | 評估 |
| --- | --- |
| 多一個前端要建置、部署、維護（nginx、Docker、E2E） | 是這次要付的主要成本；換來「登入與租戶只有一套」 |
| 複製的 `core/`、`components/` 會各自演進（D14） | README 列出複製來源；出現第三個前端時抽 package |
| 登入多了幾次跳轉（產品 → IdP → 產品 → callback） | 已有 IdP session 時是幾百毫秒的 302；比每個產品各自登入省事 |
| `oidc-provider` 是新的大型相依，版本升級要跟著它的安全公告 | 它是 OpenID Certified、維護活躍；比自己實作規格安全 |
| 每個 api 請求的驗證方式不變，但登入路徑多了 IdP 的狀態（interaction、grant、session） | 存在 `oidc_payloads`，過期的列由背景工作 `oidc.cleanup`（`OIDC_CLEANUP_CRON`）清除 |
| 不做靜默續期（D6）：app session 的 refresh token 過期（7 天）後，要再跳轉一次 IdP | IdP session 還在時是一次無感的 302；比起 iframe 靜默續期，不受第三方 cookie 封鎖影響 |
| 其他產品的分頁收到單一登出，靠推播；離線的分頁要等下一次續期失敗才發現 | refresh 家族已在伺服器端撤銷，access token 最多再活 5 分鐘（ADR-0004 的既有空窗） |

## 替代方案

| 方案 | 不採用的理由 |
| --- | --- |
| 產品直接用 IdP 發的 access／refresh token（純 SPA public client） | refresh token 會落在 SPA 的 JavaScript 可及範圍（ADR-0004 理由 1 被推翻）；`JwtAuthGuard` 要改成驗 IdP 的 token 並另外處理 `token_version` |
| 後端拆出獨立身分服務（`apps/auth` 帶自己的 NestJS） | 帳號、角色、稽核分散到兩個服務；每個請求都要跨服務查 `token_version` 與權限（`01-system.md` §4.3） |
| 只接外部 IdP、不自己當 IdP（原 `sso-oidc.md`） | 產品之間仍然各自登入；多產品共用帳號的問題沒有解決 |

### 實作時改掉的做法

| 原本的構想 | 改成 | 理由 |
| --- | --- | --- |
| `oidc_clients` 表管理 client | 第一方 client 由設定產生（D7） | 只有自己的產品時，redirect URI 由部署設定決定即可，少一張要同步的表 |
| BFF 以 HTTP 呼叫 provider 的 token 端點 | 本程序內兌換授權碼（D3） | 多一跳，也讓整合測試必須監聽 port |
| 單一登出走 end-session 的跳轉鏈 | 伺服器端銷毀 IdP session ＋ 撤銷家族（D5） | 不必碰其他 origin 的 cookie；跳轉鏈任一環斷掉就登出不完整 |
| 登出後自動跳回 IdP 的登入頁 | 停在「已登出」頁（D5） | 頁面卸載會取消還在路上的登出請求，使用者被尚未銷毀的 IdP session 登回來 |
| 互動網址直接是 apps/auth 的 `/interaction/:uid` | 先經過 api 的 `/api/oidc-interaction/:uid`（D16） | provider 把互動 cookie 的 path 設成互動網址，否則端點收不到 cookie |
| 外部 IdP 的 redirect URI 帶互動 id | 固定的 callback ＋ 互動路徑下的 `complete`（D8） | 外部 IdP 大多要求 redirect URI 完全相符 |
| 找不到帳號時可「走審批」 | 這一版只有 `reject`／`auto_create`（D10） | 現有審批以密碼建立帳號，SSO 帳號沒有密碼 |
| `identity_provider_domains` 有驗證狀態 | 沒有網域驗證，由平台管理員確認 | DNS TXT 驗證需要背景工作與重試，這一版的連線只由平台管理員建立 |
