# 資安檢查

> 掃描日期：2026-09-30 ・ 前提：企業多租戶、1000 人同時在線 ・ 範圍：`apps/api`（`main.ts`、`app.module.ts`、`common/`（guards、access-token verifier、rate-limit）、`core/`（tenant、http、config、crypto、cache、logger、errors、storage、mail 的 console transport）、`modules/`（auth、oidc-provider、identity-provider、user、permission、file 的 service／controller／DTO、realtime gateway 與 rooms、tenant、platform-admin、job、approval 的註冊審批）、`db/provision.ts`、`db/drop-tenant.ts`）、`apps/file-storage`（路徑解析、Dockerfile）、`apps/backstage` 與 `apps/auth` 的 `core/auth/sso.ts`、SSO callback 頁與 token 存放、`deploy/nginx.conf`、`deploy/nginx.auth.conf`、`docker-compose.prod.yml`、各 Dockerfile、`.env.example`、`apps/api/package.json`；文件 `CLAUDE.md`、`docs/architecture/04-sso.md`、`05-tenancy.md`、`backend/04-auth.md`、`docs/rbac/02-permission-catalog.md`。未逐行讀：role／resource-grant／file-folder／approval 的其餘 service、前端各 feature 頁面、`apps/file-storage` 的 SigV4 實作。

## 摘要

| ID | 嚴重度 | 標題 | 位置 |
| --- | --- | --- | --- |
| SEC-01 | P0 | 外部 IdP 以 email 自動連結既有帳號，不限網域也不排除特權帳號：持 `identityProvider:*` 的 admin 可接管 super-admin | `modules/auth/external-login.service.ts:238-276` |
| SEC-02 | P1 | 上傳檔案以使用者自訂的 Content-Type 在租戶同源 `/storage` inline 提供：同源 HTML／SVG 可竊取 session、做同網域釣魚 | `modules/file/file.service.ts:460-480`、`dto/create-file-upload.dto.ts:17-22`、`deploy/nginx.conf:43-55` |
| SEC-03 | P1 | 租戶帳號鎖定永不自動解除，任何人輸錯 5 次就能鎖住任意帳號（含 super-admin）；狀態檢查早於密碼驗證，可列舉帳號 | `modules/auth/auth.service.ts:111-118、144-154、391-395` |
| SEC-04 | P2 | nginx 不清除 `X-Forwarded-Host`，api 在 `TRUST_PROXY=uniquelocal` 下採信它：用標頭就能切換租戶 | `core/http/request-host.ts:16-22`、`deploy/nginx.conf:58-66` |
| SEC-05 | P2 | 租戶查詢快取沒有上限，每個新的 Host 都查一次平台 DB：記憶體與 DB 可被灌爆 | `core/tenant/tenant-directory.service.ts:38-40、97-119` |
| SEC-06 | P2 | 速率限制只以 IP 計、在記憶體、數值不適合企業 NAT；分散式暴力破解只剩鎖定擋 | `common/rate-limit.ts:17-39`、`app.module.ts:57-62` |
| SEC-07 | P2 | 權限較低的管理者可以停用、刪除 super-admin，或拿掉他的角色（只要不是最後一位） | `modules/user/user.service.ts:131-137、184-188、225-240` |
| SEC-08 | P2 | 自助註冊不驗證 email 所有權，核准後直接用申請人設定的密碼啟用 | `modules/auth/auth.service.ts:377-387`、`modules/user/user-registration.approval.ts:79-99` |
| SEC-09 | P2 | 正式部署以 Postgres 超級使用者執行 api（平台 DB、預設租戶 DB、佈建） | `docker-compose.prod.yml:31-33、56-59` |
| SEC-10 | P2 | production 不擋已知的範例金鑰與危險預設值；所有租戶共用一把 HS256 金鑰 | `core/config/env.schema.ts:47、176、253-267`、`.env.example:23、69-70` |
| SEC-11 | P3 | 外部 IdP 的 issuer 可指向內網 https 位址（SSRF）；discovery 快取以明文 secret 當 key、沒有上限 | `modules/identity-provider/external-oidc.client.ts:91-111` |
| SEC-12 | P3 | 一次性憑證的「檢查 → 消耗」不是原子操作（授權碼、重設／啟用 token、外部登入 ticket） | `modules/oidc-provider/oidc-provider.service.ts:324-339`、`modules/auth/auth-token.service.ts:64-79` |
| SEC-13 | P3 | 安全標頭不完整：沒有 HSTS、CSP 沒有 `form-action`、`style-src 'unsafe-inline'`、`X-Powered-By` 與 nginx 版本外露 | `deploy/nginx.conf:10-13`、`deploy/nginx.auth.conf:12-15`、`main.ts` |
| SEC-14 | P3 | 常見密碼字典只有 9 筆；帳號不存在時的 dummy hash 不用設定的 argon2 參數 | `modules/auth/password.ts:26-51` |
| SEC-15 | P3 | 日誌會記下外部 IdP 的 `code`／`state` 與 `complete` 的 `ticket` | `core/logger/redact.ts:2`、`modules/auth/sso-interaction.controller.ts:54-67、135-152` |
| SEC-16 | P3 | session 沒有絕對上限；授權撤銷後 presigned／影像網址仍有效到過期 | `modules/auth/refresh-rotation.ts:80-87`、`modules/file/file-image.service.ts:98-121` |
| SEC-17 | P3 | `safeReturnTo` 沒擋 `/\`；backstage 的 redirect URI 接受 `http:`，而且比對時可以不看 port | `apps/backstage/src/core/auth/sso.ts:48-50`、`modules/oidc-provider/oidc-provider.service.ts:195-200` |
| SEC-18 | P3 | 平台端點在任何不屬於租戶的網域都能用，不只 apps/auth 的網域 | `common/auth/access-token.verifier.ts:78-82`、`common/guards/permissions.guard.ts:102` |
| SEC-19 | P3 | 前端 nginx 容器以 root 執行 | `apps/backstage/Dockerfile:29`、`apps/auth/Dockerfile:29` |

數量：P0 × 1、P1 × 2、P2 × 7、P3 × 9。

## 詳細

### SEC-01 外部 IdP 以 email 自動連結既有帳號，不限網域也不排除特權帳號：持 `identityProvider:*` 的 admin 可接管 super-admin

- **嚴重度**：P0（租戶內權限提升與帳號接管）
- **位置**：[`external-login.service.ts:238-276`](../../apps/api/src/modules/auth/external-login.service.ts)、[`external-login.service.ts:87-119`](../../apps/api/src/modules/auth/external-login.service.ts)、[`identity-provider.controller.ts:45-67`](../../apps/api/src/modules/identity-provider/identity-provider.controller.ts)、[`identity-provider.service.ts:100-173`](../../apps/api/src/modules/identity-provider/identity-provider.service.ts)、[`02-permission-catalog.md:183-186`](../rbac/02-permission-catalog.md)
- **現況**：
  - `resolveAccount()` 的第 2 步只要外部 IdP 宣稱 `email_verified === true`，就把這個身分連到 **同 email 的任何既有帳號**（`findAccountByEmail(email)` → `linkIdentity`），**不檢查** email 網域是否登記在這個連線底下（網域檢查只出現在第 3 步 `auto_create`），也不排除 super-admin。
  - `start()` 接受互動頁傳來的任何 `providerId`（只要是這個租戶已啟用的連線），不必和 email 網域相符。
  - 建立與修改連線（issuer、client id／secret、網域）只要 `identityProvider:create`／`update`，而系統角色 `admin` 就有這兩個權限。issuer 可以是任意 https 網址，修改 issuer 時也不會清掉已連結的 `user_identities`。
- **利用情境**：租戶的 `admin`（或任何被授予 `identityProvider:create` 的自訂角色）自架一個 OIDC IdP（或把現有連線的 issuer 改成它），讓它對 `superadmin@corp.com` 簽出 `email_verified: true` 的 ID token。接著在登入互動頁直接呼叫 `POST /oidc-interaction/:uid/external { providerId: <自架連線> }` 走完流程，系統就把這個外部身分連結到 super-admin，並以 super-admin 身分發 session。之後這個連結永久有效（第 1 步），改密碼也擋不住。反提權規則（`assertRolesAssignable`）完全被繞過。同一招也能接管租戶內任何一位使用者。
- **建議**：
  1. 以 email 連結既有帳號時，email 網域必須登記在 **這個** 連線的 `identity_provider_domains` 底下；不符就回 `AUTH_SSO_ACCOUNT_NOT_FOUND`。
  2. 持有 super-admin 角色（或權限集合不是操作者子集合）的帳號不自動連結，要由本人登入後手動連結，或由 super-admin 核准。
  3. 把 `identityProvider:create`／`update` 視為「等同全集」的敏感權限：只給 super-admin，或要求操作者的權限集合 ⊇ 租戶內任何可能被連結帳號的權限（最簡單是限 super-admin），並寫進 `02-permission-catalog.md` 的反提權說明。
  4. 修改 `issuer`（或 `clientId`）時清除這個連線既有的 `user_identities`，並寫高嚴重度稽核。
  5. `start()` 檢查 `providerId` 與 `discover(email)` 的結果一致（互動頁已輸入 email 時）。
- **驗收**：`sso-external.spec.ts` 加上三個案例：假 IdP 對「不在連線網域內」的既有帳號 email 回 `email_verified=true` → `AUTH_SSO_ACCOUNT_NOT_FOUND`；對 super-admin 的 email → 不連結；`admin` 呼叫 `POST /identity-providers` → 403（或依新規則處理）。修改 issuer 後，舊的 subject 不能再登入。

### SEC-02 上傳檔案以使用者自訂的 Content-Type 在租戶同源 `/storage` inline 提供：同源 HTML／SVG 可竊取 session、做同網域釣魚

- **嚴重度**：P1
- **位置**：[`create-file-upload.dto.ts:17-22`](../../apps/api/src/modules/file/dto/create-file-upload.dto.ts)、[`file.service.ts:460-480`](../../apps/api/src/modules/file/file.service.ts)、[`s3-object-storage.ts:291-306`](../../apps/api/src/core/storage/s3-object-storage.ts)、[`nginx.conf:10、43-55`](../../deploy/nginx.conf)、[`docker-compose.prod.yml:74`](../../docker-compose.prod.yml)
- **現況**：`contentType` 只檢查 MIME 格式，`text/html`、`image/svg+xml`、`application/javascript` 都能上傳；簽上傳網址時把它簽進 `content-type`，物件就以這個類型存下。`toDto()` 對每個檔案都發 `disposition: 'inline'` 的 presigned 網址（`url`），而 `FILE_STORAGE_PUBLIC_ENDPOINT='{tenantOrigin}/storage'` 讓這個網址與 backstage **同源**。`/storage/` 繼承 server 層的 CSP（`default-src 'self'`，沒有 `sandbox`、沒有 `form-action`）。
- **利用情境**（部分待驗證：需在瀏覽器確認 CSP 下 `<script src>` 指向同源 presigned 網址能執行）：只有 `file:create`（或某個資料夾 `contributor`）的使用者先上傳一個 `application/javascript` 檔，取得它的 inline 網址（有效 15 分鐘）；再上傳一個 `text/html` 檔，內容是 `<script src="/storage/<bucket>/<js 的 presigned 路徑>">`。因為 `script-src` 落在 `'self'`，腳本在租戶網域上執行，可以帶自訂標頭呼叫 `POST /api/auth/refresh`（refresh cookie 的 path 是 `/api/auth`，同源會自動帶上），拿到受害者的 access token，以他的身分（例如 super-admin）操作 API。把 HTML 的 inline 網址傳給管理員即可觸發。就算腳本被擋，同源 HTML 也能放假的登入表單（CSP 沒有 `form-action`）在真正的公司網域上釣帳密。
- **建議**：
  1. 下載一律 `attachment`；只對白名單類型（`image/png|jpeg|gif|webp|avif`、`application/pdf`、`text/plain`、影音）發 inline 網址，其餘類型不給 `url`。
  2. presign 下載時以 `ResponseContentType` 覆寫：非白名單一律 `application/octet-stream`；SVG 若要預覽，改用後端轉成點陣圖（已有 sharp 變體流程）。
  3. nginx 的 `/storage/` location 另設 `Content-Security-Policy: default-src 'none'; sandbox; frame-ancestors 'none'` 與 `X-Content-Type-Options: nosniff`（在 location 裡寫 `add_header` 要把其他安全標頭一併重寫）。
  4. 長期：把物件儲存放在獨立的 cookieless 網域（例如 `files-<tenant>.example-usercontent.com`）。
- **驗收**：上傳 `text/html`、`image/svg+xml` 後，`url` 是 null 或回應標頭是 `attachment`／`application/octet-stream`；`curl -I` 下載網址看得到 `sandbox` CSP。E2E：以瀏覽器開上傳的 HTML，腳本不執行。

### SEC-03 租戶帳號鎖定永不自動解除，任何人輸錯 5 次就能鎖住任意帳號（含 super-admin）；狀態檢查早於密碼驗證，可列舉帳號

- **嚴重度**：P1
- **位置**：[`auth.service.ts:111-118`](../../apps/api/src/modules/auth/auth.service.ts)、[`auth.service.ts:144-154`](../../apps/api/src/modules/auth/auth.service.ts)、[`auth.service.ts:391-395`](../../apps/api/src/modules/auth/auth.service.ts)、[`external-login.service.ts:314`](../../apps/api/src/modules/auth/external-login.service.ts)、對照 [`platform-admin.service.ts:42-65`](../../apps/api/src/modules/platform-admin/platform-admin.service.ts)
- **現況**：
  - 第 5 次失敗時把 `status` 設為 `'locked'`、`lockedUntil = now + 900s`。`lockedUntil` 過期後，第 111 行不再擋，但第 118 行 `if (user.status !== 'active') throw AUTH_ACCOUNT_DISABLED` 仍然擋下，而且這發生在密碼驗證之前，所以帳號 **永遠不會自動解鎖**。文件 `04-auth.md` §3.3 說「等 15 分鐘自動過期」，實作與文件不符。平台管理者版本（`platform-admin.service.ts`）有正確處理。
  - `forgotPassword` 只對 `status === 'active'` 寄信，被鎖的人不能自助重設；外部 IdP 登入也回 `AUTH_ACCOUNT_LOCKED`；`findAccount` 要求 `active`，所以 IdP session 也跟著失效。
  - `pending`／`locked`／`inactive` 的判斷在驗證密碼 **之前**，不必知道密碼就能得到可區分的錯誤碼。文件 §3.2 的前提「能走到那些分支代表密碼已經驗過」並不成立。
- **利用情境**：只要知道 email（企業 email 通常可推測），攻擊者對 super-admin、所有 admin 各送 5 次錯誤密碼（每 IP 每分鐘 10 次就夠），這些帳號便永久無法登入，直到有另一位持 `user:update` 的人手動解鎖。如果管理者全部被鎖，整個租戶只能改資料庫。同一個手法也能列舉帳號：對任一 email 錯 5 次後，存在的帳號回 `AUTH_ACCOUNT_LOCKED`，不存在的回 `AUTH_INVALID_CREDENTIALS`。
- **建議**：
  1. 照平台版本修：`lockedUntil` 過期就視為未鎖定，驗證成功時把 `status` 改回 `active`、`failedLoginCount` 歸零；鎖定到期後 `failedLoginCount` 也歸零（兩個版本都要），否則到期後再錯一次就會立刻重鎖。
  2. 把 `pending`／`inactive`／鎖定的判斷移到密碼驗證 **之後**（鎖定期間照樣跑一次 argon2，回同一個錯誤碼），不知道密碼的人一律只看到 `AUTH_INVALID_CREDENTIALS`。
  3. 鎖定改用「帳號 × 來源 IP」計數，或採漸進延遲，不做硬鎖；另加上帳號層級的全域速率（見 SEC-06）。
  4. 被鎖的帳號也能收到重設密碼信（重設本來就會解鎖）。
- **驗收**：新增 `auth.service` 單元測試與整合測試：錯 5 次 → 鎖定 → 時間前進 15 分鐘 → 正確密碼可以登入且 `status=active`；對不存在與已鎖定的 email，錯誤碼與耗時都相同；鎖定中的帳號可以用「忘記密碼」。

### SEC-04 nginx 不清除 `X-Forwarded-Host`，api 在 `TRUST_PROXY=uniquelocal` 下採信它：用標頭就能切換租戶

- **嚴重度**：P2（部署環境待驗證：前面若有 LB 覆寫這個標頭，影響會變小）
- **位置**：[`request-host.ts:16-22`](../../apps/api/src/core/http/request-host.ts)、[`tenant.middleware.ts:47-56`](../../apps/api/src/core/tenant/tenant.middleware.ts)、[`nginx.conf:27-35、58-66`](../../deploy/nginx.conf)、[`nginx.auth.conf:34-42`](../../deploy/nginx.auth.conf)、[`docker-compose.prod.yml:66`](../../docker-compose.prod.yml)
- **現況**：只要直接上一跳是受信任的代理，`requestHost()` 就採用 `X-Forwarded-Host`。compose 設 `TRUST_PROXY: uniquelocal`，nginx 在 docker 私有網段，所以被信任；但 nginx 只設了 `Host`、`X-Forwarded-For`、`X-Forwarded-Proto`，**沒有覆寫或清空** `X-Forwarded-Host`，客戶端送來的值會原樣轉給 api。`05-tenancy.md` §2 宣稱「不能靠標頭換租戶」，實際上可以。
- **利用情境**：對任一網域（包括只開放公網 IP 直連的 nginx）送 `X-Forwarded-Host: beta.example.com`，請求就在租戶 beta 的脈絡裡處理。因為 access token 綁定 `tid`，這一步本身拿不到別的租戶的資料，但會：① 繞過以網域為單位的網路控制（例如只對內網或 WAF 白名單開放的租戶網域）；② 送 `X-Forwarded-Host: <apps/auth 的 host>` 加上 `X-Tenant`，從任何網域觸發 apps/auth 專屬的行為；③ 讓稽核、日誌的租戶判斷不可信；④ 配合 SEC-05 灌爆快取。
- **建議**：兩份 nginx 設定的每個 `proxy_pass` location 都加 `proxy_set_header X-Forwarded-Host $http_host;`（或清空）。api 端改成只信任明確的代理位址（例如 nginx 的固定 IP 或子網），並考慮 production 完全不讀 `X-Forwarded-Host`（nginx 已原樣轉發 `Host`）。
- **驗收**：部署後 `curl -H 'Host: acme.example.com' -H 'X-Forwarded-Host: beta.example.com' https://.../api/tenant/current` 回 acme；在 `tenancy.spec.ts` 加上「受信任代理＋偽造 XFH」的案例，並把 nginx 設定的檢查列入部署清單。

### SEC-05 租戶查詢快取沒有上限，每個新的 Host 都查一次平台 DB：記憶體與 DB 可被灌爆

- **嚴重度**：P2
- **位置**：[`tenant-directory.service.ts:38-40、97-119、169-171`](../../apps/api/src/core/tenant/tenant-directory.service.ts)、[`tenant.middleware.ts:51-55`](../../apps/api/src/core/tenant/tenant.middleware.ts)
- **現況**：`byHost`、`byCode`、`byId` 是沒有上限的 `Map`；「找不到」的結果也會存。`fresh()` 過期時不刪除 entry，只有 `invalidate()` 才會清空。每個沒看過的 Host（或 apps/auth 上的 `X-Tenant` 代碼、`/tenants/lookup?code=`）都會觸發一次 `findByDomains`／`findByCode` 查平台 DB。
- **利用情境**：攻擊者以隨機 Host（nginx 是 `server_name _`）或隨機 `X-Tenant` 大量發請求，每個請求多一筆常駐記憶體的 entry 和一次平台 DB 查詢，最後耗盡 api 記憶體，並拖慢所有租戶都依賴的平台 DB（單一執行個體，1000 人同時在線時影響全部租戶）。
- **建議**：換成有上限的 LRU（如同 `UserCacheService` 的 `MAX_ENTRIES`），負向快取另設小上限與短 TTL；先以 host 格式與長度（`HOST_PATTERN`）過濾，再決定要不要查 DB；nginx 對未知網域直接回 444（明列 wildcard 網域與 apps/auth 網域，不用 `server_name _`）。
- **驗收**：單元測試以 20,000 個不同 host 呼叫 `resolveHost`，Map 大小不超過上限；壓測時平台 DB 的 QPS 不隨隨機 Host 線性成長。

### SEC-06 速率限制只以 IP 計、在記憶體、數值不適合企業 NAT；分散式暴力破解只剩鎖定擋

- **嚴重度**：P2（可用性，以及暴力破解防護）
- **位置**：[`rate-limit.ts:17-39`](../../apps/api/src/common/rate-limit.ts)、[`app.module.ts:57-62、87`](../../apps/api/src/app.module.ts)、[`auth.controller.ts:59、78、169-172`](../../apps/api/src/modules/auth/auth.controller.ts)、[`env.schema.ts:75-76`](../../apps/api/src/core/config/env.schema.ts)
- **現況**：`ThrottlerGuard` 以 `req.ip` 計數、存在程序記憶體；登入與 `sso/callback` 每 IP 每分鐘 10 次、refresh 30 次、全域 120 次。沒有以帳號（email）或租戶為單位的限制。
- **利用情境**：① 企業客戶 1000 人通常共用少數幾個 NAT 出口 IP；access token 5 分鐘就要續期，1000 人每分鐘約 200 次 refresh，遠超過 30/分，早上同時登入也會撞 `sso/callback` 的 10/分，結果是大量 429，等於自己 DoS 自己。② 攻擊者用大量 IP 做 password spraying（每個帳號試 4 次，停在鎖定門檻之下），IP 限制完全無效。
- **建議**：登入類端點以「email（正規化）＋租戶」為主鍵計數，IP 為輔；refresh 與 `sso/callback` 改以 refresh family 或 session 為單位，或大幅放寬；限流狀態放到共用儲存（Postgres／Redis），之後擴成多執行個體才一致；提供每租戶可調整的上限與企業 IP 白名單。
- **驗收**：壓測模擬同一個 IP 下 1000 個 session 的正常續期，不出現 429；同一個 email 從 100 個 IP 各試 1 次，會被帳號層級的限制擋下。

### SEC-07 權限較低的管理者可以停用、刪除 super-admin，或拿掉他的角色（只要不是最後一位）

- **嚴重度**：P2
- **位置**：[`user.service.ts:131-137`](../../apps/api/src/modules/user/user.service.ts)、[`user.service.ts:184-188`](../../apps/api/src/modules/user/user.service.ts)、[`user.service.ts:225-240`](../../apps/api/src/modules/user/user.service.ts)、[`user.service.ts:297-310`](../../apps/api/src/modules/user/user.service.ts)
- **現況**：`update`（狀態）、`remove`、`replaceRoles`、`unlock`、`resetPassword` 只檢查「不是自己」與「不是最後一位 super-admin」。`replaceRoles` 的反提權只檢查 **新** 角色集合，不檢查 **目標使用者** 目前持有的權限是否在操作者能力範圍內。
- **利用情境**：持 `user:update`／`user:delete`／`user:assignRole` 的 `admin`（或自訂角色）可以停用、刪除其他 super-admin，或把對方的角色換成 `member`（只要系統裡還剩一位 super-admin）。惡意或帳號被盜的 admin 可以藉此排除上級、阻止事件處理，再配合 SEC-03 鎖住最後一位 super-admin。
- **建議**：對「目標使用者」加反提權規則：目標的有效權限集合必須 ⊆ 操作者的權限集合（super-admin 例外），不符回 `AUTHZ_ESCALATION`；super-admin 只能由 super-admin 停用、刪除或降級。記進 `docs/rbac/01-domain-model.md` 的不變式。
- **驗收**：`rbac-lifecycle.spec.ts` 新增：admin 對 super-admin 做 PATCH status／DELETE／PUT roles 都回 403 `AUTHZ_ESCALATION`；super-admin 對 super-admin 可以做。

### SEC-08 自助註冊不驗證 email 所有權，核准後直接用申請人設定的密碼啟用

- **嚴重度**：P2
- **位置**：[`auth.service.ts:377-387`](../../apps/api/src/modules/auth/auth.service.ts)、[`user-registration.approval.ts:79-99`](../../apps/api/src/modules/user/user-registration.approval.ts)
- **現況**：`POST /auth/register` 收 email ＋ 密碼後就建立審批；核准時以申請人的密碼雜湊建立 `status: 'active'` 的帳號，整個流程沒有寄驗證信給那個 email。也不檢查 email 網域是否是「只允許 SSO」。
- **利用情境**：攻擊者以 `cfo@customer.com` 申請帳號並自己設定密碼；審核者看到熟悉的名字就核准（甚至指派角色），攻擊者便以 CFO 的身分登入，稽核紀錄上也是 CFO 的 email。之後真正的 CFO 經外部 IdP 登入時，第 2 步（SEC-01）會把他的外部身分連到攻擊者建立的這個帳號，攻擊者仍握有密碼。
- **建議**：送出申請前先寄驗證信（或核准後改成寄啟用信讓本人設定密碼、丟掉申請時的密碼）；只允許 SSO 的網域不接受註冊；審批頁明確標示「email 尚未驗證」。
- **驗收**：`approval-lifecycle.spec.ts`：核准後帳號是 `pending`，必須透過信中的 token 才能 `active`；SSO-only 網域的註冊不會產生審批。

### SEC-09 正式部署以 Postgres 超級使用者執行 api（平台 DB、預設租戶 DB、佈建）

- **嚴重度**：P2（縱深防禦：一旦出現 SQL injection 或 RCE，就沒有跨租戶的最後一道牆）
- **位置**：[`docker-compose.prod.yml:31-33、56-59`](../../docker-compose.prod.yml)、[`tenant-provisioner.ts:55-57`](../../apps/api/src/modules/tenant/tenant-provisioner.ts)
- **現況**：`PLATFORM_DATABASE_URL`、`DEFAULT_TENANT_DATABASE_URL` 都用 `POSTGRES_USER`（postgres 映像的超級使用者）；`TENANT_PROVISIONING_DATABASE_URL` 留空時也退回同一組。預設租戶的連線池因此是 superuser，api 程序整天握著 superuser 的密碼。ADR-0020 D4 的「每個租戶有自己的 DB 角色，只能連自己的 database」對預設租戶不成立。
- **利用情境**：任何一處 SQL injection（目前沒發現，但這是多人長期維護的專案）或 api 的 RCE，就能讀寫所有租戶的 database、平台 DB（包括加密的連線字串與 `oidc_payloads`），甚至透過 `COPY ... PROGRAM` 在 DB 容器上執行指令。
- **建議**：建立三個角色：平台 DB 的應用角色（只有 DML）、佈建角色（`CREATEDB CREATEROLE`、`NOSUPERUSER`，只在佈建時使用，最好由獨立的 worker 容器持有）、預設租戶也改走佈建流程產生的專屬角色。compose 範例與 `05-tenancy.md` §7 同步更新。
- **驗收**：`SELECT rolsuper FROM pg_roles WHERE rolname = current_user` 在 api 的每個連線池都是 false；預設租戶的角色連不上其他租戶的 database。

### SEC-10 production 不擋已知的範例金鑰與危險預設值；所有租戶共用一把 HS256 金鑰

- **嚴重度**：P2
- **位置**：[`env.schema.ts:47、176、253-267`](../../apps/api/src/core/config/env.schema.ts)、[`.env.example:23、69-70`](../../.env.example)、[`auth.service.ts:204-217`](../../apps/api/src/modules/auth/auth.service.ts)、[`access-token.verifier.ts:67-82`](../../apps/api/src/common/auth/access-token.verifier.ts)
- **現況**：
  - `JWT_SECRET` 只要求 32 個字元以上；`.env.example` 的 `change-me-in-production-min-32-chars` 剛好通過，`ProductionEnvSchema` 也沒有拒絕它。`FILE_STORAGE_*` 的範例金鑰同樣沒被擋。
  - `MAIL_TRANSPORT` 預設 `console`，會把含啟用或重設 token 的連結寫進日誌（`console-mail-transport.ts:19`），production 也沒有擋。
  - 所有租戶、平台管理者、影像網址簽章（`deriveImageUrlKey`）共用同一把 `JWT_SECRET`（HS256）。
- **利用情境**：營運人員複製 `.env.example` 上線，攻擊者就能用公開的密鑰偽造任何租戶的 access token：JWT payload 本身可讀，一般使用者從自己的 token 就拿得到 `tid`，super-admin 的 `sub` 從使用者列表取得，`ver` 是小整數可以直接猜，結果是直接取得 super-admin。忘了設 `MAIL_TRANSPORT` 則會讓日誌系統的讀者都能重設任何人的密碼。
- **建議**：production 下拒絕 `.env.example` 裡的所有範例值與低熵字串（至少要求 base64 解碼後 32 bytes 以上的隨機值）；production 下 `MAIL_TRANSPORT` 必須是 `smtp`；access token 改用非對稱簽章（每個租戶一個 `kid`，或至少把 `tid` 加進 HKDF 的 info，讓每個租戶用各自衍生的金鑰），也讓金鑰輪替有 `kid` 可以依循。
- **驗收**：`env.schema` 單元測試：`NODE_ENV=production` 配上範例 `JWT_SECRET` 或 `MAIL_TRANSPORT=console`，啟動應該失敗。

### SEC-11 外部 IdP 的 issuer 可指向內網 https 位址（SSRF）；discovery 快取以明文 secret 當 key、沒有上限

- **嚴重度**：P3
- **位置**：[`external-oidc.client.ts:91-111`](../../apps/api/src/modules/identity-provider/external-oidc.client.ts)、[`identity-provider.dto.ts:64、80`](../../apps/api/src/modules/identity-provider/dto/identity-provider.dto.ts)、[`identity-provider.module.ts:23-24`](../../apps/api/src/modules/identity-provider/identity-provider.module.ts)
- **現況**：issuer 只驗 URL 格式；production 不接受 http（`allowInsecureRequests` 只在非 production 開），但沒有擋私有位址、loopback 或內部 DNS 名稱。discovery 回應裡的 `token_endpoint`、`userinfo_endpoint`、`jwks_uri` 也會被伺服器端請求。`configs` Map 以 `issuer\nclientId\nclientSecret` 為 key，沒有上限，secret 輪替後舊的 entry 永遠留在記憶體。
- **利用情境**：租戶 admin 把 issuer 設成 `https://10.0.0.5/`、`https://internal-admin.corp/`，在登入時觸發 api 對內網的 https 請求（回應雖然不會直接回給攻擊者，仍可用來探測內網與時間差）。開發或 staging 環境（非 production）連 http 的 metadata 端點都打得到。
- **建議**：解析 issuer 與 discovery 端點的 DNS 後拒絕私有、loopback、link-local 位址（包括重新導向之後）；設逾時；discovery 快取改用 LRU、key 用 `providerId + updatedAt`，不放明文 secret。
- **驗收**：單元測試：issuer 解析到 `10.x`／`127.x`／`169.254.x` 時回 `AUTH_SSO_PROVIDER_UNAVAILABLE`，並且沒有發出請求。

### SEC-12 一次性憑證的「檢查 → 消耗」不是原子操作（授權碼、重設／啟用 token、外部登入 ticket）

- **嚴重度**：P3
- **位置**：[`oidc-provider.service.ts:324-339`](../../apps/api/src/modules/oidc-provider/oidc-provider.service.ts)、[`oidc-adapter.ts:39-41`](../../apps/api/src/modules/oidc-provider/oidc-adapter.ts)、[`auth-token.service.ts:64-79`](../../apps/api/src/modules/auth/auth-token.service.ts)、[`auth.service.ts:407-437、458-482`](../../apps/api/src/modules/auth/auth.service.ts)、[`external-login.service.ts:212-217`](../../apps/api/src/modules/auth/external-login.service.ts)
- **現況**：`AuthorizationCode.find` → 各項檢查 → `code.consume()`；`consume` 是無條件的 `UPDATE ... SET consumed_at`。`findUsable` → `markUsed` 也是無條件更新。兩個併發請求可以同時通過檢查。
- **利用情境**：已經取得授權碼與 verifier（或重設 token）的人，以併發請求換到兩條 session，或讓重設 token 被用兩次。前提是憑證已經外洩，所以影響有限，但「重放時撤銷整個 grant」的保護會失效。
- **建議**：消耗時以條件式更新（`WHERE consumed_at IS NULL RETURNING`／`WHERE used_at IS NULL`）判斷有沒有搶到，沒搶到就視為重放。
- **驗收**：整合測試以 `Promise.all` 同時兌換同一個授權碼或重設 token，只有一個成功。

### SEC-13 安全標頭不完整：沒有 HSTS、CSP 沒有 `form-action`、`style-src 'unsafe-inline'`、`X-Powered-By` 與 nginx 版本外露

- **嚴重度**：P3
- **位置**：[`nginx.conf:10-13`](../../deploy/nginx.conf)、[`nginx.auth.conf:12-15`](../../deploy/nginx.auth.conf)、[`main.ts:16-24`](../../apps/api/src/main.ts)
- **現況**：兩份 nginx 設定都沒有 `Strict-Transport-Security`（TLS 在前面的 LB 終結，文件也沒要求 LB 加）；CSP 沒有 `form-action`、`object-src`；`style-src 'unsafe-inline'`；沒有 `server_tokens off`；api 沒關 `x-powered-by`，也沒有 helmet（直連 api 的環境就沒有任何安全標頭）。另外 `REFRESH_COOKIE_DOMAIN` 定義了卻沒用到，容易誤導。
- **利用情境**：第一次以 http 連線時可能被降級或 SSL strip；配合 SEC-02 可以用表單把資料送到外部；版本資訊方便攻擊者挑已知漏洞。
- **建議**：LB 或 nginx 加上 `Strict-Transport-Security: max-age=31536000; includeSubDomains`（wildcard 租戶網域要評估 preload）；CSP 加 `form-action 'self'; object-src 'none'`；`server_tokens off;`；`app.disable('x-powered-by')`，或在 api 加 helmet 作為第二道防線；移除沒用的環境變數。
- **驗收**：部署後以 `curl -I` 檢查 `/`、`/api/health`、`/storage/...` 的回應標頭。

### SEC-14 常見密碼字典只有 9 筆；帳號不存在時的 dummy hash 不用設定的 argon2 參數

- **嚴重度**：P3
- **位置**：[`password.ts:26-51`](../../apps/api/src/modules/auth/password.ts)
- **現況**：`COMMON_PASSWORDS` 只有 9 個字串，文件 `04-auth.md` §4.2 寫的是 top-10k。`getDummyHash()` 用 `DEFAULT_ARGON2_OPTIONS`，真正的雜湊用 `ARGON2_MEMORY_COST`／`ARGON2_TIME_COST`；兩者不同時，「帳號不存在」與「密碼錯」的耗時就不一樣。
- **利用情境**：使用者可以設定 `Password12345`、`Company2026!!` 之類的弱密碼，搭配 SEC-06 做 password spraying；調過 argon2 參數的部署可以用時間差列舉帳號。
- **建議**：載入 top-10k（或 HIBP k-anonymity 離線清單），並加入租戶名稱、email 本地部分等情境字；dummy hash 用設定值產生。
- **驗收**：單元測試：清單中的密碼被拒；調整 `ARGON2_*` 後，兩條路徑的耗時差在誤差範圍內。

### SEC-15 日誌會記下外部 IdP 的 `code`／`state` 與 `complete` 的 `ticket`

- **嚴重度**：P3
- **位置**：[`redact.ts:2`](../../apps/api/src/core/logger/redact.ts)、[`sso-interaction.controller.ts:54-67、135-152`](../../apps/api/src/modules/auth/sso-interaction.controller.ts)、[`logger.module.ts:25-31`](../../apps/api/src/core/logger/logger.module.ts)
- **現況**：`redactUrl` 只遮 `token=`。`GET /oidc-interaction/external/callback?code=…&state=…` 與 `…/external/complete?ticket=<state>` 的完整網址會進 pino 與 nginx 的存取日誌。
- **利用情境**：能讀日誌的人拿到 ticket 與外部授權碼。ticket 還要搭配互動 cookie 才能用，外部授權碼也有 PKCE，所以風險低，但這違反「日誌不記憑證」的規範。
- **建議**：`SENSITIVE_QUERY_PARAM` 加上 `code`、`state`、`ticket`、`code_verifier`、`id_token_hint`；nginx 的 `log_format` 改成不記錄 query string，或另外遮罩。
- **驗收**：`redact` 的單元測試涵蓋這些參數。

### SEC-16 session 沒有絕對上限；授權撤銷後 presigned／影像網址仍有效到過期

- **嚴重度**：P3
- **位置**：[`refresh-rotation.ts:80-87`](../../apps/api/src/modules/auth/refresh-rotation.ts)、[`auth.service.ts:221-253`](../../apps/api/src/modules/auth/auth.service.ts)、[`file-image.service.ts:98-121`](../../apps/api/src/modules/file/file-image.service.ts)、[`env.schema.ts:128`](../../apps/api/src/core/config/env.schema.ts)
- **現況**：每次輪替都以完整的 `REFRESH_TOKEN_TTL` 發下一張，家族沒有建立時間上限，所以只要持續使用，session 可以一直延續下去。檔案的 presigned 網址與影像簽章網址在 `FILE_URL_TTL`（預設 15 分鐘，最長可設 7 天）內有效，資料夾授權撤銷後也不會失效。
- **利用情境**：被偷的 refresh cookie 只要定期續期就不會過期；離職或被撤銷授權的人，在網址有效期內仍能下載檔案。
- **建議**：家族記下 `created_at`，超過絕對上限（例如 30 天，或企業可設定）就要重新登入；`FILE_URL_TTL` 上限收斂到 1 小時以內，並在文件中說明撤銷的延遲。
- **驗收**：refresh 整合測試：家族超過上限後回 `AUTH_REFRESH_EXPIRED`。

### SEC-17 `safeReturnTo` 沒擋 `/\`；backstage 的 redirect URI 接受 `http:`，而且比對時可以不看 port

- **嚴重度**：P3
- **位置**：[`apps/backstage/src/core/auth/sso.ts:48-50`](../../apps/backstage/src/core/auth/sso.ts)、[`apps/auth/src/core/auth/sso.ts:48-50`](../../apps/auth/src/core/auth/sso.ts)、[`oidc-provider.service.ts:195-200、231-235`](../../apps/api/src/modules/oidc-provider/oidc-provider.service.ts)、[`tenant-directory.service.ts:73-76`](../../apps/api/src/core/tenant/tenant-directory.service.ts)
- **現況**：`safeReturnTo('/\\evil.com')` 會通過檢查（瀏覽器把 `/\` 當成 `//`）。目前用的是 `router.history.replace`（`replaceState` 遇到跨 origin 會拋錯），所以 **不能** 用來跳到外部網站，但只要日後改成 `location.assign` 就會變成 open redirect。`onTenantDomain` 接受 `http:`；`tenantIdOfHost` 在 `host:port` 找不到時退回只比 hostname，所以同一台主機上的其他 port 也會被當成合法的 redirect URI。
- **利用情境**：目前沒有直接可利用的路徑；主要是降低未來改動時出錯的機會，並避免授權碼經明文 http 傳送。
- **建議**：`safeReturnTo` 以 `new URL(value, location.origin).origin === location.origin` 判斷；production 下 redirect URI 只接受 `https:`，比對時要求 port 完全相符（沒寫 port 就等於預設 port）。
- **驗收**：前端單元測試涵蓋 `/\\evil.com`、`/%5Cevil.com`；`sso.spec.ts` 加上「http 的 redirect URI → invalid_request」。

### SEC-18 平台端點在任何不屬於租戶的網域都能用，不只 apps/auth 的網域

- **嚴重度**：P3
- **位置**：[`access-token.verifier.ts:78-82`](../../apps/api/src/common/auth/access-token.verifier.ts)、[`permissions.guard.ts:102`](../../apps/api/src/common/guards/permissions.guard.ts)、[`jwt-auth.guard.ts:35-42`](../../apps/api/src/common/guards/jwt-auth.guard.ts)
- **現況**：判斷條件是「沒有租戶脈絡」，而不是「Host 等於 `AUTH_APP_URL` 的 host」。直接用 IP 連 nginx、或任何沒有登記的網域，都能呼叫 `/platform/*`（包括 `sso/callback`、`refresh`），並在那個網域上設 cookie。
- **利用情境**：需要平台管理者的 token 或授權碼才有實際影響，但這擴大了平台管理介面的暴露面，也讓「只在 apps/auth 網域的 WAF 或 IP 白名單保護平台」這類部署措施失效（配合 SEC-04 更明顯）。
- **建議**：`TenantMiddleware` 標記 `isAuthHost`；平台端點與平台 token 只在 auth host 有效，其他沒有租戶的網域一律 404。
- **驗收**：`platform-admin.spec.ts`：以未登記的 Host 呼叫 `/platform/admins` 回 404。

### SEC-19 前端 nginx 容器以 root 執行

- **嚴重度**：P3
- **位置**：[`apps/backstage/Dockerfile:29-31`](../../apps/backstage/Dockerfile)、[`apps/auth/Dockerfile:29-31`](../../apps/auth/Dockerfile)
- **現況**：`nginx:1.27-alpine` 的 master process 以 root 執行（api 與 file-storage 都已經有 `USER app`）。
- **利用情境**：nginx 或它的模組出現漏洞時，容器內會直接拿到 root。
- **建議**：改用 `nginxinc/nginx-unprivileged`（listen 8080），或自行調整 pid、cache 路徑後加上 `USER nginx`；compose 加 `read_only: true`、`cap_drop: [ALL]`、`security_opt: [no-new-privileges:true]`（所有服務）。
- **驗收**：`docker compose exec backstage id` 不是 uid 0。

## 已做得好的地方

- **預設拒絕的授權宣告**：`route-audit.ts` 讓沒有宣告授權的路由無法啟動，`test/route-audit.spec.ts` 把每個路由的權限與 `02-permission-catalog.md` 逐條對照；WebSocket gateway 也用 class 層級的 `@UseGuards` 補上全域 guard 不作用的缺口。
- **租戶隔離的主幹設計正確**：access token 帶 `tid`，驗證時與網域的租戶比對，平台 token 只在沒有租戶的網域有效；`UserCacheService`／`PermissionCacheService`、realtime 的 room 名稱都以租戶為前綴；BFF 再檢查一次「授權碼的帳號屬於這個網域的租戶」；背景工作的信封帶 `tenantId`，平台 DB 的查詢也以它過濾；每個租戶有自己的 DB 角色，佈建時執行 `REVOKE ALL ... FROM PUBLIC`。
- **Token 處理**：access token 只放在記憶體；refresh token 只存 SHA-256 雜湊、每次使用就輪替、重用偵測會撤銷整個家族並寫高嚴重度稽核；cookie 設 `HttpOnly`＋`SameSite=Lax`＋收窄的 `Path`、production 設 `Secure`；`/auth/refresh` 要求自訂標頭，而且 API 沒開 CORS；改密碼、重設、停用都會遞增 `token_version` 並撤銷 session。
- **啟用與重設 token**：32 bytes 隨機值，只存雜湊，在寄信工作「寄出當下」才簽發，所以原文不會進入工作資料；發新的會作廢舊的；有期限；忘記密碼永遠回 200，而且只入列、不在請求中寄信。
- **OIDC Provider**：強制 PKCE（S256）；授權碼 60 秒、重放時撤銷整個 grant；協定錯誤不導回產品；`tenant` 參數與 redirect URI 的網域交叉檢查；換租戶時會拆掉舊身分（`detachIdentity`）；production 必須設定 JWKS 與 cookie keys。
- **外部 IdP 的 RP**：使用 `openid-client`，驗 state、nonce、PKCE 與 ID token；只有 `email_verified === true` 才用 email 對應帳號；client secret 以 AES-256-GCM 加密，不回傳、不進稽核。
- **注入防護**：Drizzle 查詢都參數化，`LIKE` 的使用者輸入有跳脫；DDL 的識別字與密碼都先用白名單正規表示式驗證；檔名禁止路徑分隔與控制字元，Content-Disposition 有 RFC 5987 編碼；物件的 key 由伺服器產生（UUID），file-storage 以 key 的雜湊存檔，沒有路徑穿越。
- **檔案授權**：每個檔案操作都經 `FileAccessContext`，看不到的檔案回 404（不洩漏存在）；別人的 pending 上傳視為不存在；資料夾授權有反提權檢查；影像 API 以 HMAC 簽章、`timingSafeEqual` 比對；sharp 設了 `limitInputPixels` 與輸入大小上限。
- **設定與部署**：環境變數以 zod 驗證，production 缺金鑰就啟動失敗；Swagger 在 production 不開；未知錯誤只回 `requestId`，不回堆疊；pino 遮罩 `authorization`、`cookie`、`set-cookie` 與網址裡的 token；api 與 file-storage 容器以非 root 執行；compose 把網路切成 edge、data、storage 三段；WebSocket 檢查 Origin、每 IP 的 handshake 次數、每條連線的訊息速率，token 放在 `handshake.auth` 而不是 query string。
- **相依套件**：`apps/api/package.json` 的主要套件（NestJS 11、oidc-provider 9、openid-client 6、jose 6、socket.io 4.8、sharp 0.35、nodemailer 10）都是目前的主版本，沒有看到明顯過舊的高風險版本（未上網查 CVE）。
