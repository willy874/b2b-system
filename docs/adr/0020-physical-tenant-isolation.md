# ADR-0020 — 租戶實體隔離：每個租戶一個 database 與網域，平台與租戶分成兩份身分

- 狀態：**採用**（2026-09-30 完成實作）
- 日期：2026-09-29
- 相關：取代 [ADR-0018](./0018-workspace-tenancy.md)（全部）；修改 [ADR-0019](./0019-sso-identity-platform.md) D1、D9、D12、D13；
  延續 [ADR-0004](./0004-jwt-with-rotating-refresh-token.md)（app session 不變）、[ADR-0006](./0006-flat-permission-scope.md)（租戶內回到扁平權限）；
  正式文件見 [`../architecture/05-tenancy.md`](../architecture/05-tenancy.md)

## 背景

ADR-0018 以「共用資料表 ＋ `workspace_id`、應用層強制」做工作區，ADR-0019 讓帳號跨工作區共用、工作區由路由前綴帶。
實際的產品要求改變了：

1. **租戶要實體硬切分**：每個租戶有自己的資料庫與網域；一個查詢忘了帶條件就跨租戶，這種風險不能接受。
2. **backstage 不該看見租戶的切分**：backstage 是「某個租戶的後台」，仍以「使用者」為核心；沒有成員、沒有 `/w/:slug`、沒有切換器。
3. **平台管理者與租戶管理者是兩份資料**：`apps/auth` 的管理者管租戶；backstage 的管理者只存在於各自的租戶。
4. **租戶的進出由 `apps/auth` 負責**：從 backstage 登入時帶著租戶到 auth；在 auth 以租戶登入後，自動登入該租戶的 backstage。

ADR-0018 的 D2–D5、D8–D18 都建立在「同一個資料庫、同一份帳號」上，所以這份 ADR 整份取代它，而不是修改。

## 決定

### 隔離層級

| 方案 | 結論 |
| --- | --- |
| A. 共用資料表 ＋ `workspace_id`（ADR-0018） | 不採用：隔離靠應用層與測試；不符合「硬切分」 |
| B. 每租戶一個 schema，以 `search_path` 切換 | 不採用：同一個 database 內權限與連線共用，`search_path` 設錯一次就讀到別人的表；備份、還原、刪除都無法單獨對一個租戶做 |
| **C. 同一個 Postgres 叢集、每租戶一個 database，api 依網域路由到對應的連線池** | **採用**：database 之間在 Postgres 層級無法互相查詢；可以單獨備份、還原、搬到別的叢集、`DROP DATABASE`；api 仍是單一程序 |
| D. 每租戶一整套部署（api ＋ DB） | 延後：維運成本隨租戶數線性成長。C 的設計讓單一租戶之後可以被搬出去（換掉連線設定即可） |

### 身分

| 方案 | 結論 |
| --- | --- |
| A. 帳號集中在平台 DB，租戶 DB 只存使用者資料與角色 | 不採用：身分資料不在租戶的 database 裡，就不是硬切分；租戶刪除時帳號還留在平台 |
| **B. 帳號存在各租戶 DB；平台 DB 只有平台管理者** | **採用**：同一個 email 在兩個租戶是兩個互不相干的帳號（各自的密碼、狀態、外部身分連結） |

### 具體決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **兩種資料庫**：**平台 DB**（一個）存平台管理者、平台角色、租戶登記、平台稽核、IdP 的協定狀態（`oidc_payloads`）、背景工作佇列；**租戶 DB**（每租戶一個）存現在除了這些以外的所有表（`users`、`roles`、`files`、`audit_logs`、`approval_requests`、`refresh_tokens`、`identity_providers`…）。兩者是 **兩套 Drizzle schema、兩條 migration 線**（平台：`db/platform/`；租戶沿用 `db/schema/`、`db/migrations/`） | 平台 DB 只有「租戶之外」的東西；租戶 DB 是完整的一份業務資料，可以單獨搬走 |
| D2 | **租戶由網域決定**：每個租戶登記一到多個 backstage 網域（`tenants.domains`，例：`acme.backstage.example.com`，或客戶自己的網域）。api 以反向代理傳來的 Host 查租戶登記（快取），放進 `AsyncLocalStorage` 的請求脈絡；找不到租戶的 Host，需要租戶的路由一律 404（`TENANT_NOT_FOUND`），健康檢查等不需要租戶的路由照常。apps/auth 的網域不屬於任何租戶 | 網域就是租戶的邊界，backstage 前端完全不必知道租戶；cookie 本來就是 host-only（ADR-0019 D6），不同租戶的 app session 天然分開 |
| D3 | **連線池依租戶建立**：`Tenancy` 在第一次需要時為該租戶建立小型連線池（`max` 小、閒置連線關閉）；repository 注入的 `TENANT_DB` 是一個 Proxy，每次存取都轉到 **目前租戶** 的 `db`，沒有租戶脈絡時拋 `TENANT_NOT_FOUND`（不會退回任何預設 DB）。平台的 repository 注入另一個 token `PLATFORM_DB` | 不用 Nest 的 REQUEST scope（整條 DI 鏈每個請求重建）；沒有脈絡就拋錯，比「靜默用錯 DB」安全。連線數過多時再加 PgBouncer |
| D4 | **每個租戶有自己的 DB 角色與密碼**：租戶的 **完整連線字串** 以主金鑰（沿用 ADR-0019 D11 的 AES-GCM，另一把 `TENANT_SECRET_KEY`）加密存在 `tenants.database_url_encrypted`；租戶的 DB 角色只能連自己的 database。建立 database 用另一個有 `CREATEDB` 的佈建角色，只在佈建時使用 | 連線字串外洩只影響一個租戶；api 平常持有的連線沒有能力碰別的租戶 |
| D5 | **平台管理者與租戶使用者是兩份資料**：平台 DB 的 `platform_admins`（加上平台自己的角色與權限，範圍很小：`tenant:*`、`platformAdmin:*`、`platformAuditLog:read`、`job:*`）；租戶 DB 的 `users`／`roles`／`permissions` 回到 ADR-0006 的扁平模型，**沒有 `scope`、沒有成員表** | 兩邊的權限目錄不重疊，就不需要 ADR-0018 D2 的範圍檢查與 route-audit 規則。super-admin 也分兩種：平台的 super-admin 看不到任何租戶的內容（要看就得在該租戶有帳號） |
| D6 | **OIDC 仍是單一 issuer**（`apps/auth` origin 的 `/api/oidc`），`accountId` 帶上身分所屬：租戶帳號是 `t:{tenantId}:{userId}`、平台管理者是 `p:{adminId}`；ID token 與授權碼帶 `tenant` claim | 一個 issuer 就只有一組 JWKS、一個互動頁；帳號 id 帶前綴就不會把 A 租戶的 user id 誤當成 B 租戶的 |
| D7 | **authorize 請求帶租戶**：backstage 從自己的網域知道租戶，跳轉時帶額外參數 `tenant={code}`；provider 檢查 `redirect_uri` 的 origin 屬於這個租戶的網域（不一致回協定錯誤）。沒有 `tenant` 參數的授權只給 client `auth`，身分是平台管理者 | 使用者要求「從 backstage 跳到 auth 時攜帶租戶資訊」；只信參數會讓人把 A 的授權碼導到 B 的網域，所以以 redirect URI 交叉驗證 |
| D8 | **登入互動依租戶選資料來源**：互動頁顯示租戶名稱；密碼、外部 IdP、只允許 SSO 的網域都查 **該租戶的 DB**。沒有租戶時對平台 DB 驗證平台管理者 | 符合「沒有帶租戶就用 auth 管理者的資訊」 |
| D9 | **IdP session 一次只屬於一個身分**：session 的帳號租戶與這次授權要求的租戶不同時，強制重新登入（自訂互動 policy）；登入後 session 換成新的身分。各租戶 backstage 的 app session 是各自網域的 cookie，所以 **同時開兩個租戶的 backstage 仍然可以**，只是第二個要再登入一次 | 不能讓 A 租戶的 IdP session 直接換到 B 租戶的授權碼；「同一個人」在兩個租戶本來就是兩個帳號（身分 B） |
| D10 | **BFF 兌換時再檢查一次租戶**：`/api/auth/sso/callback` 以 Host 解出的租戶，必須等於授權碼上帳號的租戶，否則 `AUTH_SSO_CODE_INVALID`。**access token 帶 `tid`**，驗證時必須等於請求網域的租戶 | 第二道防線：即使 provider 的檢查有漏洞，授權碼也換不到別的租戶的 session；A 租戶簽的 token 拿到 B 租戶的網域也用不了 |
| D11 | **在 auth 切換租戶 = 前往該租戶的 backstage 登入**：auth 的「進入租戶」頁讓使用者輸入租戶代碼（或從 `?tenant=` 帶入），查到租戶後頂層跳轉到該租戶網域的 `/auth/login`，之後走一般的授權流程（D7–D10），完成後落在該租戶的 backstage。auth **不列出** 一個人屬於哪些租戶 | 使用者要求「跳轉工作區必須在 auth 中」且以租戶代碼選擇；帳號分散在各租戶 DB，列出所屬租戶需要跨租戶掃描或在平台留索引，兩者都破壞硬切分 |
| D12 | **租戶佈建**：平台管理者在 auth 建立租戶（代碼、名稱、網域、第一位管理員的 email）→ api 建立 DB 角色與 database、跑租戶 migration、seed 權限目錄與系統角色、建立第一位管理員（寄啟用信，連結帶租戶）→ 租戶狀態 `provisioning` → `active`；失敗停在 `failed`，可重試。佈建是背景工作 | 建立 database 不能包在一般交易裡，且可能耗時；狀態機讓失敗可以重試、可以看見 |
| D13 | **停用與刪除**：停用 = 該租戶的網域回 503、撤銷所有 session；刪除 = 標記刪除並停用，`DROP DATABASE` 是另一個需要確認的手動動作（腳本），不在管理頁一鍵完成 | 硬切分的好處之一是可以真的刪乾淨，但不可逆的動作不該是一個按鈕 |
| D14 | **migration 一律跑遍所有租戶**：`pnpm db:migrate` 先跑平台，再依序跑每個 `active` 租戶；單一租戶失敗不影響其他租戶，結束時列出失敗的租戶並以非零結束。應用程式啟動時檢查每個租戶的 migration 版本，落後的租戶標成不可用（503），不阻止整個程序啟動 | 一個租戶壞掉不該讓所有租戶停擺；但也不能讓舊 schema 的租戶收到新程式的請求 |
| D15 | **背景工作佇列在平台 DB**，資料是信封 `{ tenantId, payload }`，handler 在該租戶的脈絡裡執行；payload 只放 id，不放租戶的個人資料。排程觸發的租戶工作沒有 `tenantId`，worker 收到時 **展開** 成每個 `active` 租戶一筆；只碰平台 DB 的工作（`oidc.cleanup`）宣告成 `scope: 'platform'`。**交易內的入列寫租戶 DB 的 `job_outbox`**，提交後立刻搬進佇列，定期的 `jobs.outboxSweep`（預設每 10 分鐘）補搬程序當掉時沒搬成的；outbox 的 id 就是工作 id，重搬也只有一筆 | 每個租戶一套 pg-boss 等於 N 組輪詢；payload 只放 id 則平台 DB 不會存到租戶的內容。平台 DB 的佇列不能和租戶 DB 的業務寫入在同一個交易，outbox 保住 ADR-0016 D2「資料與工作一起提交或一起回滾」 |
| D16 | **物件儲存每租戶一個 bucket**（`tenants.storage_bucket`，佈建時建立），`ObjectStorage` 依目前租戶選 bucket；沒有租戶脈絡時拋錯，不退回共用的 bucket | 與 database 同一個隔離層級；刪除租戶時整個 bucket 可以清掉 |
| D17 | **快取與推播加上租戶前綴**：權限快取、使用者快取的 key 是 `{tenantId}:{userId}`；Socket.io 的連線從租戶網域進來、屬於那個租戶，權限的 room 名稱是 `t:{tenantId}:perm:{key}`（租戶取自目前的脈絡）；使用者與 IdP session 的 room 用全域唯一的 id，不另外帶租戶 | 單一程序服務所有租戶時，記憶體裡的東西仍是共用的 |
| D18 | **外部 IdP 連線屬於租戶**：`identity_providers`、`identity_provider_domains`、`user_identities` 在租戶 DB；home realm discovery 只在該租戶內進行。外部 IdP 的固定 callback 以 `state` 找回登入狀態（在平台 DB 的 `oidc_payloads`），裡面帶租戶 | 客戶用自己的 Azure AD 是租戶層級的設定；一個網域在不同租戶可以對應不同連線 |
| D19 | **稽核分兩處**：租戶內的動作寫該租戶的 `audit_logs`；平台管理者的動作（租戶建立、停用、佈建結果、平台管理者登入）寫平台 DB 的 `platform_audit_logs`。平台管理者看不到租戶的稽核 | 租戶的稽核是租戶的資料；平台只記錄自己做過什麼 |
| D20 | **既有的工作區實作整個移除**，不遷移成租戶：現有資料（Phase 0 的開發資料）做成第一個租戶 `default` 的 database，migration 線重新起一個基準點（平台、租戶各一個 baseline） | 工作區的表、`scope`、成員、邀請在新模型裡都沒有對應；還沒有正式環境資料，寫反向 migration 沒有價值 |
| D21 | **migration 重新建立基準點**：平台與租戶各一條 migration 線，各自從 baseline 起算；已有需要保留的環境時，寫一支一次性的搬移腳本，而不是保留舊的 migration 線 | 還沒有正式環境資料；舊線上充滿工作區的欄位與表，保留只會讓每個新租戶多跑一段沒有意義的歷史 |
| D22 | **外部 IdP 連線由租戶的管理者在自己的 backstage 設定**（資料在租戶 DB）；平台管理者只能開關「是否允許這個租戶使用外部 IdP」（`tenants.allow_external_idp`；後由 [ADR-0029](./0029-toggleable-platform-features.md) D2 併進 `tenants.features` 的 `identityProvider`） | 連線的細節（client secret、網域）是租戶的資料，平台看不到；平台保留的是「能不能用」這個層級的決定 |
| D23 | **背景工作的監控**：apps/auth 有全平台的監控頁（所有租戶與平台自己的工作，`platformJob:*`）；backstage 的 `/job` 只看自己租戶的工作 | 佇列在平台 DB，全平台的樣子只有平台該看；租戶的管理者仍需要看自己的寄信、匯出是否卡住（見「實作時改掉的做法」） |
| D24 | **租戶的網域**：`tenant_domains` 支援多個網域，第一個是主要網域；建立時產生 `{code}.<TENANT_BASE_DOMAIN>`，客戶自己的網域由平台管理者加入（DNS 與 TLS 由部署處理） | 預設網域讓建立租戶不必等 DNS；自訂網域是少數客戶的需求，手動處理就夠 |
| D25 | **平台管理者的 app session** 在 apps/auth 的 origin，結構同租戶的 `refresh_tokens`（平台 DB 的 `platform_refresh_tokens`），輪替規則共用 | 同一套已驗證過的規則（ADR-0004），只是資料在平台 DB |
| D26 | **apps/auth 的帳號流程以網址參數 `?tenant=` 指定租戶**，頁面以 `X-Tenant` 標頭送給 api（只在 apps/auth 的網域有效）；token 在租戶 DB，以參數選 DB，查不到一律視為無效。沒有 `?tenant=` 的 `/setup`、`/reset-password` 是平台管理者的帳號 | 帳號流程的頁面只有一份（apps/auth），不必在每個租戶網域上各放一份；不區分「租戶不存在」與「token 無效」，不洩漏租戶是否存在 |

## 流程

### 從 backstage 登入

```
使用者        acme.backstage（RP）             apps/auth                   apps/api
  │ 打開 acme 網域 │                             │                           │ Host → tenant acme
  │─────────────▶│ 沒有 session                  │                           │
  │              │── 302 /api/oidc/auth?client_id=backstage&tenant=acme&redirect_uri=https://acme…/auth/callback ─▶│
  │              │                             │                           │ redirect_uri ∈ acme 的網域？
  │              │                             │◀── 互動頁（顯示「Acme」） │ IdP session 是別的租戶 → 要求登入
  │  email／密碼（查 acme 的 DB）               │── POST …/login ─────────▶│
  │ 頂層跳轉 resume → 303 https://acme…/auth/callback?code ─────────────────────────────│
  │              │── POST /api/auth/sso/callback（Host = acme）─────────────────────────▶│ code 的租戶 == acme？
  │              │◀── access token ＋ acme 網域的 refresh cookie ──────────────────────│
```

### 在 auth 進入租戶

```
auth /tenant?tenant=acme（或手動輸入代碼）
  └─ GET /api/tenants/lookup?code=acme → { name, loginUrl: https://acme…/auth/login }（公開，只回登入入口）
  └─ 頂層跳轉 → acme 的 /auth/login → 同上的授權流程 → 落在 acme 的 backstage
```

### 平台管理者

```
auth /login（沒有 tenant）→ 授權（client auth、無 tenant 參數）→ 互動頁查平台 DB → auth 的管理頁（租戶、平台管理者、背景工作）
```

## 代價

| 代價 | 評估 |
| --- | --- |
| 每個租戶一組連線池，租戶多時連線數上升 | 池子小且閒置關閉；超過數十個活躍租戶時前面加 PgBouncer（transaction mode） |
| migration 要跑 N 次、會出現「部分租戶升級失敗」 | D14：逐一執行、失敗的租戶單獨標成不可用並可重跑 |
| 同一個人在多個租戶要記多組密碼、登入多次 | 硬切分的直接結果；客戶可以用外部 IdP（D18）讓它變成一次點擊 |
| 平台管理者無法直接協助租戶內的問題 | 刻意的設計；需要時由租戶管理者建立帳號給支援人員，並留下該租戶的稽核 |
| 跨租戶的報表、搜尋做不到 | 需要時另建資料倉儲，從各租戶匯出；不在線上系統做 |
| 開發環境要處理多個網域 | 用 `*.localhost`（瀏覽器與 Node 都解析到 loopback），seed 建兩個租戶 |
| 已經完成的工作區實作（ADR-0018 第一批與邀請）要移除 | 沉沒成本；繼續留著會讓兩套隔離模型並存 |

## 實作時改掉的做法

| 原本的構想 | 改成 | 理由 |
| --- | --- | --- |
| `TenantDb` 服務，repository 呼叫 `tenantDb.current()` 取 db（D3） | `TENANT_DB` 是 Proxy，repository 照常把它當 `Database` 用 | 29 個 repository／service 只換注入的 token；Proxy 對 DI 與生命週期 hook 的探測（`then`、`onModuleInit`…）直接回 undefined，其餘存取一律要有租戶脈絡 |
| 連線池有 LRU 上限（D3） | 不回收連線池物件，閒置的連線由 postgres.js 的 `idle_timeout` 關閉 | 回收正在被使用的連線池會讓執行中的查詢失敗；連線池物件本身很便宜，佔資源的是連線 |
| `tenants` 存 DB 角色與加密的密碼（D4） | 存加密的完整連線字串 | 換叢集、換主機、換角色都只改一欄；佈建時仍為每個租戶建立自己的角色（第 4 步） |
| 快取與推播的租戶前綴在第 5 步做（D17） | 第 2 步就做，並加上 access token 的 `tid`（D10） | 整合測試發現：A 租戶簽的 token 拿到 B 租戶的網域時，以 userId 為 key 的快取會拿 A 的使用者與權限判斷 B 的請求（跨租戶提權） |
| 佇列在平台 DB，交易內入列照舊（D15） | 交易內入列改寫租戶 DB 的 outbox | 平台 DB 與租戶 DB 不能在同一個交易 |
| IdP session 換身分時「登入後 session 換成新的身分」（D9） | 在 `realm_mismatch` check 裡先把舊身分從 session 拿掉（清帳號與 grant、換新的 `uid`）再要求登入 | oidc-provider 在「已登入的 session 換成另一個帳號」時會先把舊 session 登出（`end_session_confirm`），觸發單一登出、連帶登出另一個租戶開著的 backstage；而且 `uid` 不變，兩個租戶的 app session 會綁在同一個 IdP session 上 |
| 平台管理者有自己的權限目錄與角色（D5） | 第 3 步只有登入與個人資料；權限目錄隨第 4 步的租戶管理一起加入 | 第 3 步還沒有任何需要權限的平台端點 |
| 版本不符的租戶標成不可用（D14） | 只有 **落後** 的租戶不可用；DB 比程式新照常服務。落後的租戶每 30 秒重新檢查 | 滾動部署時舊的執行個體會看到較新的 DB；要求 migration 對上一版程式相容（`02-database.md` §5.1）比讓舊執行個體全部 503 合理。重新檢查讓補跑 `db:migrate` 之後不必重啟 |
| 平台自己的角色與權限（D5） | 權限目錄在程式碼、角色固定三種（`platform_admins.role`：`super-admin`／`operator`／`auditor`），不建角色表、不提供自訂角色 | 平台的權限只有十個以內、管理者只有少數幾位；自訂角色的表、畫面與反提權規則換不到實際的好處。需要時再加表，端點的宣告（`@RequirePlatformPermissions`）不必改 |
| 佈建的每一步都在背景工作裡（D12） | database 與 DB 角色的名稱是 `tenant_{code}_{8 位隨機}`；密碼在登記時產生、存在加密的連線字串裡；佈建工作不自動重試，失敗停在 `failed` 由平台管理者重試 | 代碼可以在刪除後重用，而刪除時 database 還沒清掉，名稱不能只用代碼；重試時沿用同一組連線字串，每一步都冪等（角色存在就把密碼改回來、database 存在就沿用） |
| 佈建完成 = 所有步驟都成功 | database、migration、seed、第一位管理員完成就改成 `active`；之後在租戶脈絡裡確認 bucket、寄啟用信，失敗只記在 `provision_error` | 啟用信的背景工作要在租戶脈絡裡執行，而只有 `active` 的租戶能進入；bucket 在第一次上傳前還會再確認一次 |
| 停用時撤銷所有 session（D13） | 先撤銷再停用；租戶的 DB 連不上時不擋停用 | 停用後租戶就不能進入，撤銷得在那之前；停用後網域一律 503，session 本來就用不了 |
| 背景工作監控頁搬到 auth（D23） | apps/auth 加上 **全平台** 的監控（`/platform/jobs`，看得到每個租戶與平台工作）；backstage 的 `/job` 保留，只看自己租戶的 | 租戶的管理者仍需要看自己的匯出、寄信是否卡住；佇列查詢本來就以 `tenantId` 過濾，保留不會洩漏別的租戶。拿掉租戶的 `job:*` 要另寫 migration 清權限，好處不大 |
| 平台管理者由其他平台管理者建立（D5） | 建立成 `pending`、寄啟用信（`platform_auth_tokens`、平台工作 `platformAdmin.accountMail`）；忘記密碼沒有自助流程，由其他平台管理者「寄設定密碼的連結」 | 平台管理者人數少、權限大；自助的忘記密碼等於多一個對外的入口。連結不帶 `?tenant=`，apps/auth 的 `/setup`、`/reset-password` 據此走平台的端點 |
| 平台管理者開關外部 IdP（D22） | `tenants.allow_external_idp`，隨租戶脈絡帶著走：關掉時租戶不能新增或啟用連線，登入時當作沒有連線（包括「只允許 SSO」的網域回到密碼登入）；既有連線保留 | 關掉的理由通常是暫停而不是刪除；登入時不走連線才是真的關掉。只靠外部 IdP 登入、沒有密碼的帳號要用重設密碼 |
| 停用 = 網域回 503、撤銷所有 session（D13） | 停用與刪除都 **先改狀態再收尾**：撤銷 app session（`Tenancy.runForMaintenance`，不看狀態進入）、刪除帳號 id 是 `t:{tenantId}:*` 的 IdP session／grant／授權碼、斷掉 `t:{tenantId}` room 的即時連線、關掉連線池。排隊中的工作：租戶已刪除或停用時略過；migration 落後或 DB 連不上（`TENANT_UNAVAILABLE` 的 `details.reason = maintenance`）時交給 pg-boss 重試 | 只撤銷 refresh token 的話，重新啟用後使用者會靠還留著的 IdP session 直接登回來；先撤銷再停用則留下一個空窗，期間新發的 token 撤銷不到。暫時性的故障不該把寄信之類的工作丟掉 |
| 租戶的狀態改變立即生效（D2 的快取） | 只在本程序立即生效（`TenantDirectory.invalidate()`）；其他執行個體最多晚 `TENANT_CACHE_TTL` 秒 | 目前只部署一個 api 執行個體（WebSocket 也是單機的 adapter）。擴成多個執行個體時，改用平台 DB 的 `LISTEN/NOTIFY` 廣播失效，與 Socket.io 的 adapter 一起處理 |
| 每個租戶一份的初始資料在啟動時準備（`forEachActive`） | 另外發佈 `DomainEvent.TENANT_ACTIVATED`（佈建完成、重新啟用時，在那個租戶的脈絡裡），檔案模組據此建立系統資料夾 | 新佈建的租戶不必等程序重啟才有共用資料夾與私人根目錄 |
| `db:seed` 在每個租戶跑一樣的 seed | `SUPER_ADMIN_EMAIL` 的 super-admin 只建在 `SEED_TENANT`（預設 `default`）；其他租戶（含停用中的）只補權限目錄與系統角色 | 營運方共用的帳密不能出現在客戶的租戶；停用中的租戶也要補新增的權限，重新啟用時才不會缺 |
| refresh 輪替的規則寫在租戶的 `AuthService` | 抽成 `rotateRefreshToken`，租戶與平台各提供自己的 token 表 | 平台管理者的 session 用同一套規則（一次性使用、重用偵測、併發只有一個成功），安全相關的邏輯只有一份 |

## 替代方案

| 方案 | 不採用的理由 |
| --- | --- |
| 保留 ADR-0018，再加 Postgres RLS | 仍是同一個 database 與同一份帳號；不滿足「獨立的資料庫與網域」與「兩份管理者資料」 |
| 每個租戶一個 issuer（每租戶一個 `oidc-provider` 實例） | 每個租戶一組 JWKS、一個互動路徑；單一 issuer 加上帶租戶的 `accountId` 與 D7、D10 的檢查已經足夠隔離 |
| auth 登入後列出「你屬於的租戶」 | 需要跨租戶以 email 掃描，或在平台 DB 保留 email → 租戶的索引；兩者都讓平台知道租戶的使用者名單 |
