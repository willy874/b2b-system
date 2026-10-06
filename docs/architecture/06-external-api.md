# 對外 API（給外部系統的獨立入口）

決定與理由見 §9（D9～D19）。這份文件描述做出來的樣子：程序與部署、
請求怎麼找到租戶與認人、路由的分界、限流、文件。token 的建立與管理見 [`backend/04-auth.md`](./backend/04-auth.md) §8.2。

## 1. 全貌

```
  整合方（CI、建置流程、外部系統）
      │  Authorization: Bearer b2bt_<租戶代碼>_<tokenId>_<secret>
      ▼
  api.example.com ─▶ external-gateway（nginx :8082）─▶ external-api（:3001，main.external.ts）
                     network: external                    │  networks: external, data, storage
                                                          ├─▶ 平台 DB（租戶登記、廣播）
                                                          └─▶ 租戶 DB（由 token 的租戶代碼決定）

  租戶網域 ─▶ backstage（nginx）─▶ api（:3000，main.ts）     ← 內部 api，與上面互不接受對方的憑證
```

- **同一份程式、另一個程序**：`apps/api` 的第二個進入點 `src/main.external.ts`，根模組 `src/external-api.module.ts`。
  業務邏輯、稽核、權限檢查與內部 api 是同一份 service。
- **只認 API token**（D10）：不讀 cookie、不接受 JWT access token；內部 api 也一律拒絕 `b2bt_` 開頭的 token
  （`AccessTokenVerifier.verifyClaims`）。
- **沒有** Socket.io、OIDC Provider、refresh cookie、CSRF；不 import `RealtimeModule`、`AuthModule`。
  領域事件以 `EventsModule.sendOnly()` 組裝：自己的寫入照樣轉送給內部 api 推播，但不收內部 api 轉來的（沒有推播，[`backend/08-realtime.md`](backend/08-realtime.md) §7.6）。
- **只入列、不執行背景工作**（D19）：`src/external-process-env.ts` 在任何模組讀設定之前把 `JOBS_WORKER_ENABLED` 設成 `false`。
- **跨程序的一致性**：這個程序寫入的資料，快取失效與推播都經平台 DB 的廣播送到內部 api（[`01-system.md`](./01-system.md) §4.4）。

## 2. 一個請求的流程

| 順序 | 元件 | 做什麼 |
| --- | --- | --- |
| 1 | `RequestIdMiddleware` | 與內部 api 相同 |
| 2 | `TokenTenantMiddleware` | 解析 token 的租戶代碼 → `TenantDirectory.findByCode` → `Tenancy.enter`。不看網域：全平台只有一個對外網域（D9）。代碼只是「去哪裡找」的提示，改代碼換不到別的租戶 |
| 3 | `SurfaceGuard` | 內部的路由回 `404 NOT_FOUND`（§3） |
| 4 | `ApiTokenAuthGuard` | `ApiTokenVerifier`：格式 → 租戶相符 → 以 id 找（快取 10 秒）→ 比對 `SHA-256(secret)`（定長比較）→ 未撤銷、未過期 → 帳號有效且 `token_version` 沒變（使用者快取）。成功時把 token 寫進請求脈絡、記下使用（§5）；失敗以 IP 計數（§4） |
| 5 | `ExternalRateLimitGuard` | 以 token 計數（§4） |
| 6 | `FeatureGuard`、`PermissionsGuard` | 與內部 api 相同 |

**錯誤**：沒帶、格式不對、找不到、雜湊不符、已撤銷都回 `401 AUTH_TOKEN_INVALID`（不透露 token id 是否存在）；
過期 `401 AUTH_API_TOKEN_EXPIRED`；帳號的 `token_version` 變了 `401 AUTH_TOKEN_STALE`；帳號停用 `403 AUTH_ACCOUNT_DISABLED`。
錯誤信封與內部 api 相同（`{ error: { code, message, details? } }`）。

**權限**（D3）：token 的 `scopes` 寫進請求脈絡（`setContextApiToken`）。`PermissionService.getPermissionSet` 問的是 token 的擁有者時，
回傳 **帳號的權限 ∩ scopes 的閉包**（super-admin 也只剩 scopes），所以 guard 與 service 裡的權限判斷都套得到。
快取存的是帳號本身的權限，同一個人在內部 api 的請求不受影響。資料夾等資源上的能力跟著帳號，不在 scope 裡。

以關係圖解析資源授權的地方（檔案的 `FileAccessService.contextFor`）另外處理：資源模型會從租戶節點繼承（資料夾的 `can_*` ←
租戶的 `file:*`），只限縮權限鍵的話，帳號經角色持有的 `file:delete` 仍會從這條路回來。`PermissionSet.tokenScoped` 時，
`AuthzService.checkerFor` 的租戶層邊改成 **只有** 限縮後的權限鍵（`TenantRelationsOverride`，以一個只存在於這個判斷器的角色持有）；
資料夾上的授權照舊。

## 3. 路由的分界（`@ExternalApi()`、`SurfaceGuard`）

兩個程序都會註冊 import 進來的模組的 **全部** controller（Nest 的 controller 跟著 module），以 metadata 分開：

| 標記 | 路徑 | 宣告 | 在哪個程序 |
| --- | --- | --- | --- |
| 沒標（`internal`） | 不能在 `/v<n>/` 底下 | 任何 | 內部 api |
| `@ExternalApi()`（class） | 一律在 `/v<n>/` 底下 | `@Authenticated` 或 `@RequirePermissions`（不能 `@Public`、不能是平台端點） | 對外 API |
| `@Surface('both')` | — | 只能 `@Public` | 兩邊（目前只有 `/health`） |

規則由 `common/route-audit.ts` 在啟動時檢查（違反就啟動失敗），清單在 `test/route-audit.spec.ts`。
對外的 controller 與 DTO 放在 `modules/<name>/external/`；DTO 與內部的分開，內部改欄位不會改到對外契約。

**目前的對外端點**（權限宣告與內部 api 對應的端點相同，`docs/architecture/backend/05-rbac.md` §9）：

| 端點 | 說明 |
| --- | --- |
| `GET /v1/me` | 這把 token 的帳號、token 的資訊、實際取得的權限 |
| `GET /v1/folders` | 看得到內容的資料夾（扁平，以 `parentId` 組樹）與能不能上傳；鎖住的資料夾不列 |
| `GET /v1/files` | 檔案列表：依建立時間由新到舊，`limit` ＋ `nextCursor`（不提供 offset）；`folderId`（`root`）、`keyword` |
| `GET /v1/files/:id` | 檔案資訊與下載網址（`url`、`downloadUrl`、`urlExpiresAt`；過期再取一次） |
| `POST /v1/files` → PUT → `POST /v1/files/:id/complete` | 上傳：單次（`upload`）或分塊（`multipart` → `POST /v1/files/:id/parts` → 各自 PUT → complete 帶 ETag）；`DELETE /v1/files/:id/upload` 放棄 |
| `GET /v1/users`、`GET /v1/users/:id` | 使用者唯讀（只有人）；`offset`／`limit`、`keyword`、`status` |
| `GET /health`、`GET /health/ready` | 兩邊都有 |

- 對外的 controller 與 DTO 在 `modules/file/external/`、`modules/user/external/`：`*.external.service.ts` 呼叫模組原本的 service，
  只把內部的 DTO 換成 `External*` 的契約（不含內部的影像網址、`capabilities`、`version`、使用者的偏好與登入細節）。
- 直傳與下載的網址是 **租戶網域** 的 `/storage`（對外 API 的租戶由 token 決定、沒有租戶網域可依據，presigned URL 以租戶的 **主要網域** 簽章；[`backend/09-file.md`](./backend/09-file.md) §3）：整合方的網路要連得到租戶網域。
- 對外程序 import 的業務模組：`ApiTokenModule`、`FileModule`、`UserModule`、`HealthModule`，以及 `RoleModule`、`GroupModule`
  ——回收桶在啟動時要求每一種類型都有 handler。這些模組內部的路由一律由 `SurfaceGuard` 擋下。

## 4. 速率限制（D13）

| 桶 | key | 上限（次／分） |
| --- | --- | --- |
| 每把 token | `x:{tenantId}:token:{tokenId}` | `EXTERNAL_RATE_LIMIT`（預設 600） |
| 每個 IP 的驗證失敗 | `externalAuthFailure:{ip}` | `EXTERNAL_AUTH_FAILURE_RATE_LIMIT`（預設 30）；超過之後的失敗回 `429`，成功的請求不計 |
| 沒有 token 的請求（健康檢查） | IP | `ANONYMOUS_RATE_LIMIT` |

每個整合有自己的額度，不和本人的瀏覽器、也不和同一個 NAT 後面的其他整合共用。計數在程序的記憶體（共享計數見
[`../features/multi-instance.md`](../features/multi-instance.md)）。

## 5. 快取與最後使用時間

- **token 的驗證快取**（`ApiTokenCacheService`，D17）：以「租戶 × token id」快取 10 秒。撤銷在內部 api 發生，交易後失效並經頻道
  `api_token_cache` 廣播，對外 API 立即拒絕；漏掉廣播時最多 10 秒。帳號的停用與 `token_version` 由使用者快取負責（`user_cache`）。
- **`last_used_at`**（`ApiTokenUsageService`，D8）：記在記憶體，每分鐘依租戶批次更新一次；程序結束前再寫一次。

## 6. 部署與開發

| | 開發 | Production（`docker-compose.prod.yml`） |
| --- | --- | --- |
| 啟動 | `pnpm dev:external-api`（`node --watch` ＋ swc，不跑第二個 `nest --watch`） | 服務 `external-api`：同一個映像，`node dist/src/main.external.js` |
| port | `EXTERNAL_API_PORT`（預設 3001） | 容器內 3001；閘道 `external-gateway`（nginx，`deploy/nginx.external-api.conf`）對外 8082 |
| 網路 | — | `external`（閘道 ＋ external-api）、`data`、`storage`；閘道碰不到內部 api |
| 環境變數 | 與 api 共用 `.env` | 沿用 api 的 environment（YAML merge），另外覆寫連線池（`EXTERNAL_TENANT_POOL_MAX`、`EXTERNAL_PLATFORM_POOL_MAX`）、heap、限流 |
| 健康檢查 | `GET /health` | compose 的 healthcheck 打 `:3001/health`（映像的 HEALTHCHECK 是 api 的 :3000） |

- 連線預算：每個程序都有自己的平台池與租戶池，公式要把這個程序算進去（[`backend/02-database.md`](./backend/02-database.md) §6.2）。
- nginx 閘道：只有一個 `location /`，`client_max_body_size 1m`（檔案以 presigned URL 直傳租戶網域的 `/storage`），
  `Cache-Control: no-store`、HSTS、`nosniff`。`sh deploy/check-nginx.sh` 一併檢查它。

## 7. 文件（OpenAPI）

`pnpm --filter @b2b-system/api openapi:generate` 從同一個 app 產生兩份（`src/swagger.ts`，以路徑分開）：

| 檔案 | 內容 | 用途 |
| --- | --- | --- |
| `apps/api/openapi.json` | `/v<n>/` 以外的路由；拿掉只有對外路由引用的 schema | 產生前端 SDK（`pnpm sdk:generate`） |
| `apps/api/openapi.external.json` | `/v<n>/*` 與 `/health*`；只留引用得到的 schema | 給整合方 |

非 production 時，兩個程序都在 `/docs` 提供自己的文件。

**契約的版本**（D12）：v1 之內只能 **加** 欄位與端點；改名、刪除、改語意要開 v2，與 v1 並存至少 6 個月。

## 8. 測試

| 層 | 涵蓋 |
| --- | --- |
| 單元 | token 格式（`common/auth/__tests__/api-token.format.spec.ts`） |
| 整合 | `test/external-api-v1.spec.ts`：檔案的單次與分塊上傳、列表、資訊、放棄、在內部 api 看得到；**限縮成 `file:read` 的 token 不能上傳**（帳號有全域 `file:create`）；使用者唯讀只列人 |
| 整合 | `test/external-api.spec.ts`：同一個測試程序裡起內部 api 與對外 API 兩個 app。`/v1/me`、各種無效 token、JWT 與 API token 互不通用、`SurfaceGuard` 的兩個方向、scope 的交集、在內部 api 撤銷或停用後對外 API 立即拒絕、過期、`last_used_at`、驗證失敗的 429 |
| 路由稽核 | `test/route-audit.spec.ts`：三種寫錯的入口宣告會讓啟動失敗；對外路由的清單 |
| E2E | `apps/e2e/tests/api-token.spec.ts`：在 backstage 建服務帳號、發 token（只顯示一次）→ 打對外 API → 撤銷、停用後立即拒絕；scopes 收窄；個人 token；token 打不進內部 API、對外 API 沒有內部的路由 |

## 9. 設計決策：服務帳號、API token 與對外 API

> 原 ADR-0027，2026-10-01 決定。T0～T5 全部合併 main；原本的提案（`features/api-tokens.md`）已依實作結果改寫成本文件與 [`backend/04-auth.md`](./backend/04-auth.md) §8.2 後刪除。

### 9.1 背景

API 只接受 5 分鐘的 access token（JWT），程式要取得它只能用 `POST /auth/login` 送真人的 email 與密碼。
這帶來幾個問題：CI、美術工具、遊戲建置流程手上拿的是真人的密碼；權限等於那個人的全部權限；稽核分不出是人還是程式；
那個人離職，整合就跟著壞；之後做 MFA，這條路會直接斷掉。

另一個問題是：現在的 api **只服務內部**，對象是 backstage 與 apps/platform。路由、DTO、錯誤碼跟著前端一起改，SDK 由 `openapi.json` 產生、
同一個 commit 內同步。這份契約不適合直接交給外部系統：

- 外部整合需要 **穩定、有版本** 的契約；內部 API 改一個欄位名稱，應該只影響同一個 repo 裡的前端。
- 內部 API 帶著瀏覽器的整套機制：refresh cookie、CSRF、Socket.io、OIDC Provider、依 Host 決定租戶。外部呼叫者一樣都用不到，卻全部都在攻擊面上。
- 整合方的大量請求（批次上傳、輪詢）和 1000 名線上使用者共用同一個 event loop 與連線池。

所以這份決定包含兩件事：**程式的身分**（服務帳號與 token），以及 **它從哪裡進來**（獨立的對外 API 服務）。

相關的規格：[`backend/04-auth.md`](./backend/04-auth.md) §8.2、[`01-system.md`](./01-system.md) §4、[`05-tenancy.md`](./05-tenancy.md) §2、[`backend/05-rbac.md`](./backend/05-rbac.md) §4.1、§5.1、[`backend/03-api-conventions.md`](./backend/03-api-conventions.md) §7、§8、[`../rbac/01-domain-model.md`](../rbac/01-domain-model.md) §7。沿用 [`backend/04-auth.md`](backend/04-auth.md) §10（`token_version` 是唯一的撤銷機制）、[`architecture/05-tenancy.md`](05-tenancy.md) §10（每個租戶一個 DB 與網域）、[`rbac/01-domain-model.md`](../rbac/01-domain-model.md) §9（關係圖與一般化的反提權）；之後依賴這份決定的有 Webhook（[`backend/17-webhook.md`](backend/17-webhook.md) §9）、[`../features/mfa.md`](../features/mfa.md)、[`../features/multi-instance.md`](../features/multi-instance.md)（T0 已做掉其中一部分）。

### 9.2 決定

**身分與 token**

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **服務帳號是 `users` 的一種**：加 `kind`（`human` ｜ `service`，預設 `human`）（提案開放問題 1）。服務帳號沒有密碼，不能走登入互動，不能連結外部身分，不收信。`email` 仍然必填，產生不可投遞的 `svc-<id>@service.invalid`（RFC 2606 保留的 TLD），寄信端另外以 `kind` 擋下。<br>**要排除服務帳號的地方**：backstage 的使用者列表與人數、「最後一位 super-admin」（I8）、登入、忘記密碼、外部 IdP 的自動連結、`approval.pending` 這類以 `approval:review` 找收件人的通知。<br>`rbac/01-domain-model.md` §7 預留的「`service_accounts` 表 ＋ 新的主體型別」不採用 | 角色（`role:r#holder@user:s`）、群組成員、資料夾授權、權限快取（`{tenantId}:{userId}`）、稽核的 `actor_id`、說明（`rbac/09-explain.md`）、反提權全部原樣沿用。<br>另開主體型別的話，關係圖模型、閉包、說明、快取 key 都要多一種主體，等於重做一次 G4a。<br>要排除的地方是有限的，而且都已經有 `status`、`deleted_at` 這一類過濾可以加條件 |
| D2 | **token 有兩種擁有者，同一張表**：個人 token（`user_id` = 本人）與服務帳號的 token（`user_id` = 服務帳號）。<br>租戶 DB 的 `api_tokens` 表：`id`、`user_id`、`name`、`prefix`、`secret_hash`、`scopes text[]`（null = 跟著帳號）、`account_version`、`expires_at`（必填）、`last_used_at`、`revoked_at`、`created_by`、`created_at` | 兩種 token 的驗證、撤銷、限流完全相同，差別只在擁有者是誰 |
| D3 | **權限可以縮小，不能放大**（提案開放問題 2）。有效權限 = 帳號的權限集合 ∩ `scopes`。<br>`scopes` 只限制 **租戶層的權限鍵**；資料夾等資源上的能力仍然跟著帳號走。要限制到「只能動某幾個資料夾」，做法是建一個服務帳號，只授權那幾個資料夾 | 最小權限。<br>如果把資源層的能力也放進 scope，就要在關係圖的判斷器裡多一個交集，所有 `can_*` 都得改。服務帳號 ＋ 資料夾授權已經能表達同樣的事 |
| D4 | **建立 token 時的反提權**：token 取得的有效權限（帳號權限 ∩ scopes）必須 ⊆ 操作者目前的權限。這條也適用於替服務帳號建 token，以 [`rbac/01-domain-model.md`](../rbac/01-domain-model.md) §9 一般化的反提權判斷（`backend/05-rbac.md` §4.1）。<br>服務帳號的角色、群組、資料夾授權照既有的 `assertGrantable` | 否則只有 `serviceAccount:update` 的人，可以替一個權限很大的服務帳號簽一把 token 帶走 |
| D5 | **撤銷沿用 `token_version`**：token 記下建立當時帳號的 `token_version`（`account_version`），驗證時兩者不相等就失效。<br>因此本人改密碼、被重設密碼、被強制登出、被停用時，個人 token 一律作廢。服務帳號沒有密碼，它的 `token_version` 只在停用或「撤銷全部 token」時遞增。<br>另外每把 token 可以單獨撤銷（`revoked_at`） | `token_version` 是唯一的撤銷機制（[`backend/04-auth.md`](backend/04-auth.md) §10、`04-auth.md` §1.2）。帳號被盜時，管理者重設密碼或強制登出，攻擊者建立的 token 也跟著失效，不必另外記得去撤銷。<br>代價：使用者改密碼後要重建個人 token（見代價） |
| D6 | **服務帳號屬於租戶，不屬於建立者**（提案開放問題 4）。`created_by` 只是紀錄，建立者被停用或刪除，服務帳號與它的 token 都不受影響。<br>個人 token 跟著本人：本人停用、刪除、`token_version` 遞增時失效（D5） | CI 不應該因為某個人離職就停擺。誰能管理服務帳號由權限決定（D14），不由建立者決定 |
| D7 | **token 格式**：`b2bt_<租戶代碼>_<tokenId>_<secret>`。<br>`tokenId` 是 `api_tokens.id`（uuid，以 base62 編碼），`secret` 是 32 bytes 隨機值（base62）。以前三個 `_` 切開（租戶代碼的格式 `[a-z][a-z0-9-]` 不含 `_`）。<br>資料庫只存 `SHA-256(secret)`，以定長比較驗證；`prefix` 存前 12 碼供管理頁顯示。<br>token 只在建立時顯示一次 | 開頭固定，GitHub 等平台的 secret scanning 可以登記這個格式，外流時被掃到。<br>前綴帶租戶代碼，對外 API 才知道要去哪個租戶 DB 查（D9）。代碼由客戶端提供，但只是「去哪裡找」的提示：secret 要在那個租戶 DB 比對成功才算數，改代碼不會換到別的租戶。<br>secret 是 256 位元的隨機值，不需要 argon2 這種慢雜湊 |
| D8 | **到期時間必填，有上限**：個人 token 最長 90 天，服務帳號 token 最長 365 天（租戶設定 `apiToken.maxLifetimeDays` 只能設得更短，不能超過平台的上限）。**不提供不過期的 token**。<br>`last_used_at` 不在每次請求寫入：記在記憶體，每分鐘批次更新 | 沒有期限的 token 遲早會變成沒人知道是誰在用的 token。<br>每次請求都寫一次 `last_used_at` 會讓唯讀的請求也變成寫入 |

**對外 API 服務**

| # | 決定 | 理由 |
| --- | --- | --- |
| D9 | **獨立的程序、port 與網域**：同一個 codebase（`apps/api`），另一個進入點 `src/main.external.ts` 與根模組 `ExternalApiAppModule`。<br>production 是另一個 compose 服務 `external-api`（與 api 同一個映像，不同的 command），開發時是 `:3001`（`EXTERNAL_API_PORT`）。<br>對外只有一個網域 `EXTERNAL_API_PUBLIC_URL`（例：`https://api.example.com`），不分租戶，也不開放租戶登記自訂的對外網域，**租戶從 token 的前綴決定**（D7），不看 Host | 獨立程序帶來故障與容量隔離：整合方塞爆的是自己的 event loop 與連線池。<br>網域獨立，WAF、IP 白名單、存取日誌、限流都可以只套在對外的流量上。<br>共用 codebase，對外端點呼叫的是 **同一個 service**，業務規則、稽核、權限檢查只有一份。<br>單一網域讓整合方只要設定一個 base URL。依 Host 分租戶的話，每個租戶要多一個子網域、多一張憑證，客戶自訂網域時更麻煩 |
| D10 | **兩個入口互不接受對方的憑證**：<br>• 對外 API 只接受 `b2bt_` token，不讀 cookie，不接受 JWT access token。<br>• 內部 api 不接受 `b2bt_` token，因為 JWT 驗簽會直接失敗，這裡再明確地拒絕一次並回 `AUTH_TOKEN_INVALID`。<br>對外 API 沒有 Socket.io、OIDC Provider、refresh cookie、CSRF | 兩邊的攻擊面分開。<br>瀏覽器的 session 被偷，拿不去打對外 API；token 外流，也碰不到 backstage 的內部端點 |
| D11 | **路由分「面」（surface），預設拒絕**：對外的 controller 標 `@ExternalApi()`（class 層級）。<br>每個程序有自己的 `SurfaceGuard`：對外的程序遇到沒有標的路由回 404，內部的程序遇到有標的路由也回 404。<br>`route-audit.ts` 多一條檢查：對外路由只能宣告 `@RequirePermissions()`，不能是 `@Public()` 或只宣告 `@Authenticated()`（健康檢查例外）。<br>對外的 controller 與 DTO 放在 `modules/<name>/external/` | Nest 的 controller 會跟著 module 被 import 進來。對外的根模組 import `FileModule` 拿 `FileService`，內部的 `FileController` 也會一起註冊。把每個模組拆成「service 模組」與「controller 模組」要動所有模組，所以由 guard 擋下另一面的路由，再由啟動時的稽核保證每條路由都有歸屬。<br>對外的 DTO 跟內部的分開，內部改欄位才不會意外改到對外契約 |
| D12 | **對外契約有版本**：路徑是 `/v1/...`。另有一份 OpenAPI `apps/api/openapi.external.json`（對外文件用，不產生內部 SDK），錯誤信封沿用 `{ error: { code, message, details? } }`。<br>v1 之內只能 **加** 欄位與端點；改名、刪除、改語意要開 v2，並與 v1 並存至少 6 個月 | 內部 API 可以隨前端一起改，對外的不行。版本放在路徑裡，最容易在 nginx、日誌、指標中區分 |
| D13 | **限流與稽核**：<br>• 限流以 token 計數，主體是 `x:{tenantId}:token:{tokenId}`，額度用另一組環境變數（`EXTERNAL_RATE_LIMIT_*`）。token 無效的請求以 IP 計。<br>• 稽核的 `actor_id` 是帳號（本人或服務帳號），`metadata` 帶 `tokenId` 與 `via: 'external'`；稽核表 **不加** `actor_type` 欄（提案開放問題 3）。<br>• 建立、撤銷 token 寫 `apiToken.create`、`apiToken.revoke`。服務帳號的建立、停用、刪除照使用者的稽核，`metadata.kind = 'service'` | 每個整合有自己的額度，不和本人的瀏覽器搶，也不會因為同一間公司共用 NAT 出口而互相拖累。<br>`kind` 可以從 `actor_id` join `users` 得到，`tokenId` 在 metadata 裡就夠查了。加 `actor_type` 欄要動熱表、冷表與封存函式，換不到新的資訊 |
| D14 | **權限鍵**：<br>• `serviceAccount:read`、`serviceAccount:create`、`serviceAccount:update`（含建立與撤銷它的 token）、`serviceAccount:delete`。<br>• 個人 token：本人以 `@Authenticated()` 管理自己的。管理者查看或撤銷別人的個人 token 用 `user:update`。<br>• 管理端點全部在 **內部 api**，由 backstage 呼叫。對外 API 只有業務端點，加上 `GET /v1/me`（這把 token 是誰、有效權限、到期時間） | 管理 token 是人在 backstage 做的事，不需要對外開放。對外 API 若能建立 token，外流一把 token 就能自己續命 |
| D15 | **`POST /auth/login` 在 production 關閉**（提案開放問題 5）：環境變數 `DIRECT_LOGIN_ENABLED`，production 預設 `false`、其他環境預設 `true`，開發與 E2E 照舊。關閉時回 404 | 有了 token 之後，這條路在 production 只剩風險：繞過 MFA、繞過外部 IdP 的強制登入 |

**兩個程序之間的一致性**

| # | 決定 | 理由 |
| --- | --- | --- |
| D16 | **跨程序的快取失效（T0，先做）**：以下快取都接上 `core/broadcast` 的 `LISTEN/NOTIFY`。<br>• 使用者快取（狀態、`token_version`）<br>• `TenantDirectory`<br>• `FileFolderTree`<br>• 系統設定<br>• 新的 token 快取（D17）<br>權限快取已經接上了（`AuthzRevision`） | 現在這些快取只在本程序失效（`multi-instance.md` 的表）。分成兩個程序之後：<br>• 在 backstage 停用的服務帳號，對外 API 最多還能用 30 秒。<br>• 對外 API 建的資料夾，backstage 的資料夾樹看不到。<br>這和 api 多實例是同一件事，做完也一併完成 `multi-instance.md` 的對應項目 |
| D17 | **token 的驗證快取**：以 `tokenId` 為 key，快取驗證結果 10 秒。撤銷、帳號停用時，在交易後廣播失效（D16） | 每個請求都查一次 `api_tokens` 雖然只是主鍵查詢，但這張表在租戶 DB，加上帳號狀態就是兩次查詢。<br>廣播是 best-effort，10 秒是最壞情況下的上限 |
| D18 | **領域事件跨程序轉送（T0）**：對外程序的 `DomainEventBus` 把 `RESOURCE_CHANGED`、`SESSIONS_REVOKED` 經 `core/broadcast` 轉給內部 api，內部 api 收到後在本機重新發佈，交給 realtime 推播。<br>payload 只帶 id（`NOTIFY` 上限 8000 bytes），超過時退化成「這個租戶的這個來源全部失效」。轉送來的事件做標記，不會再轉回去 | 整合方透過對外 API 上傳了檔案，正在 backstage 看那個資料夾的人要即時看到。<br>推播本來就只送訊號（[`backend/08-realtime.md`](backend/08-realtime.md) §15），丟一次只是畫面晚一點更新，和現在的 `DomainEventBus` 保證程度相同 |
| D19 | **對外程序只入列、不執行背景工作**：`JOBS_WORKER_ENABLED=false`，不跑排程。<br>連線池另外設定：`EXTERNAL_TENANT_POOL_MAX`（預設比 api 小），連線預算公式（`backend/02-database.md` §6.2）加上這個程序 | 背景工作留在 api（之後拆成 worker），對外程序只處理請求。<br>每個程序都有自己的租戶連線池，不重新算預算的話，postgres 的 `max_connections` 會先用完 |

### 9.3 分階段

| 階段 | 內容 | 相容性 |
| --- | --- | --- |
| T0 跨程序一致性（branch `feat/cross-process-broadcast`） | D16 的快取接上 `core/broadcast`；D18 的事件轉送。用兩個 api 程序跑 E2E 驗收 | 純加法。單一程序時，廣播只是收到自己發的訊息 |
| T1 身分與 token（內部 api） | migration：`users.kind`、`api_tokens`。排除服務帳號的查詢（D1）。服務帳號與 token 的管理 API（D14）、反提權（D4）、權限鍵 seed、稽核。`DIRECT_LOGIN_ENABLED`（D15） | 加欄位有預設值，舊程式不受影響 |
| T2 對外 API 骨架 | `main.external.ts`、`ExternalApiAppModule`、`@ExternalApi()` 與 `SurfaceGuard`、route audit 的擴充（D11）、`ApiTokenGuard` 與從 token 決定租戶（D7、D9）、token 快取（D17）、限流（D13）、`GET /v1/me`、`/health`。`openapi.external.json`、`pnpm dev:external-api`、compose 服務、`deploy/nginx.external-api.conf` | 新服務，不影響既有部署 |
| T3 第一批 v1 端點 | 檔案與資料夾：資料夾列表、上傳（presign → complete）、下載連結、檔案資訊。使用者：唯讀（見「確認紀錄」1） | 純加法 |
| T4 backstage 畫面 | `features/service-account`（列表、建立、角色、token 管理）、帳號設定的「個人存取 token」、使用者詳情頁看與撤銷別人的 token | 純加法 |
| T5 歸檔 | 新規格 `docs/architecture/06-external-api.md`、`backend/04-auth.md` 新章節、`rbac/01-domain-model.md` §7、`02-permission-catalog.md`、`01-system.md` §4、`05-tenancy.md` §2；刪提案 | — |

### 9.4 不做

- OAuth2 client credentials 與第三方應用程式的授權同意畫面。
- token 的 IP 白名單（之後可以在 `api_tokens` 加欄位，也可以在對外網域的 WAF 做）。
- 平台管理者（apps/platform）的 token，以及平台層級的對外 API。
- 對外的 WebSocket，以及內部 api 接受 API token。
- scope 限制到資源層的能力（D3）。

### 9.5 代價

| 代價 | 緩解 |
| --- | --- |
| 多一個程序要部署、監控，連線預算要重算 | 同一個映像；連線池分開設定（D19）；T0 讓「多個程序」從現在起就是常態，之後擴 api 實例不必再改一次 |
| 每個要對外的功能多寫一組 controller 與 DTO | 業務邏輯共用 service；對外的 DTO 是穩定契約，本來就不該跟內部共用 |
| 對外的程序裡也註冊了內部的 controller，只是被 `SurfaceGuard` 擋下 | 啟動時的 route audit 保證每條路由都有歸屬；E2E 驗證另一面的路由一律 404 |
| 使用者改密碼後，個人 token 全部失效（D5） | 改密碼的畫面提示「個人存取 token 將會失效」；CI 這種長期整合本來就該用服務帳號 |
| 使用者相關的查詢要記得排除服務帳號（D1） | 在 repository 收斂成共用的條件（類似 `notDeleted()`），並為 D1 列出的每個地方補測試 |
| 推播的轉送不保證送達（D18） | 與現在的 `DomainEventBus` 同一個等級；前端在重新連線時本來就會重抓 |

### 9.6 評估過的方案

| 方案 | 不採用的理由 |
| --- | --- |
| 另開 `service_accounts` 表與 `serviceAccount` 主體型別（`rbac/01-domain-model.md` §7 原本的預留） | 關係圖、閉包、說明、快取 key、反提權都要多一種主體；D1 的排除清單比這個小得多 |
| 內部 api 依 token 前綴分流，同時接受 JWT 與 API token（提案原本的構想） | 契約與攻擊面混在一起；整合方的流量和使用者搶同一個程序；內部 API 改欄位會直接打壞外部整合 |
| 獨立的 app（`apps/external-api`），以 HTTP 呼叫內部 api | 每個請求多一跳，要另外設計程序之間的身分；稽核記到的會是 gateway，不是真正的呼叫者；權限要檢查兩次 |
| 獨立的 app，直接 import `apps/api` 的模組 | 跨 app import 會破壞 workspace 的邊界；兩個 app 的建置、設定、migration 會互相牽扯 |
| 依 Host 分租戶（`{code}.api.example.com`） | 要第二張 wildcard 憑證；客戶自訂網域時要再多一組 DNS 與憑證；租戶已經寫在 token 裡了 |
| 把每個模組拆成「service 模組」與「controller 模組」，讓兩個根模組各自只 import 自己的 controller | 要動所有業務模組，且模組之間的 import 也要跟著拆；`SurfaceGuard` 加上 route audit 可以達到同樣的保證 |
| 稽核表加 `actor_type` 欄 | 要動熱表、冷表與封存函式；`users.kind` 與 `metadata.tokenId` 已經足夠 |
| 個人 token 不跟著 `token_version`（像 GitHub 的 PAT，改密碼不失效） | 帳號被盜時，攻擊者建立的 token 在重設密碼後仍然有效，管理者得另外記得去撤銷 |

### 9.7 確認紀錄

2026-10-01 確認以下四點，都採用草稿中的建議：

1. **第一批 v1 端點**（T3）：
   - 檔案與資料夾：資料夾列表、上傳（presign → complete）、下載連結、檔案資訊。
   - 使用者：唯讀。

   presigned URL 指向租戶網域的 `/storage`，整合方的網路要連得到租戶網域，這點寫進對外文件。
2. **對外網域**：全平台共用一個（`EXTERNAL_API_PUBLIC_URL`），不開放租戶登記自訂的對外網域（D9）。
3. **token 期限的上限**：個人 token 90 天，服務帳號 token 365 天。不提供「不過期」（D8）。
4. **T0 獨立先做**：開 branch `feat/cross-process-broadcast`，做完再開 `feat/api-tokens` 做 T1～T5。

### 9.8 實作紀錄

與上面的決定不同、或決定沒寫到而實作時定下來的地方：

| 階段 | 項目 | 實作 |
| --- | --- | --- |
| T0 | 自己送的廣播（D16） | `BroadcastService.channel()`：訊息包上送出的程序 id，自己送的不交給訂閱者（本機在送出前已失效過；再收一次會讓進行中的載入白做）。`authz_revision` 維持原本以 revision 判斷 |
| T0 | 使用者快取的廣播量（D16） | 同一輪事件迴圈的失效先累積，合併成一則（每則最多 150 個 id）；回收桶一次清掉多個人時不會送出同樣多則 |
| T0 | 權限快取的單人失效（D16） | `PermissionService.invalidateUser`（停用、刪除時）不另外廣播：其他程序的使用者快取已經失效，那個人在驗證身分時就被擋下，權限快取只剩 60 秒 TTL 內的殘留，不會被用到 |
| T0 | 轉送哪些事件（D18） | 除了 `resource.changed`、`sessions.revoked`，`tenant.featuresChanged` 也轉送（它同樣是推播）。`permissions.changed` 不轉送（`AuthzRevision` 已廣播）、`tenant.activated` 不轉送（訂閱者寫資料庫，做一次就夠） |
| T0 | 轉送的事件給誰（D18） | `DomainEventBus.subscribe(type, handler, { remote: true })` 才收得到其他程序轉送來的事件，預設不收：撤銷 OIDC session、補個人資料夾這類「整個系統做一次」的訂閱者不必改 |
| T0 | 放不進一則 `NOTIFY` 的事件（D18） | 資源變更拿掉個別 id，退化成整個來源失效；受影響的人、撤銷連線的名單每 150 個一則 |
| T0 | 推播的跨節點（D18） | 事件轉送讓每個程序推給自己的連線，因此 **不再** 規劃裝 `@socket.io/postgres-adapter` 的跨節點 emit（會重複推）；跨裝置中繼（`channel.relay`）仍只在本節點，留在 `multi-instance.md` |
| T0 | 驗收 | `apps/api/test/cross-process.spec.ts`：同一個測試程序裡兩個 Nest app 共用一個 Postgres。A 停用使用者 → B 立即拒絕他的 token、他連在 B 的連線收到 `session.revoked`；A 建立角色 → 連在 B 的管理者收到推播；A 改設定 → B 立即讀到。關掉廣播時四項都失敗 |
| T1 | 服務帳號的稽核（D13） | 動作是 `serviceAccount.create`／`update`／`assignRole`／`delete`、`resourceType = 'serviceAccount'`，不沿用 `user.*` 加 `metadata.kind`：稽核頁以 `resourceType` 連到資源，服務帳號的 id 在 `/users/:id` 會是 404 |
| T1 | 刪除的服務帳號（D1） | 不在回收桶列出、不能還原（`UserRepository.listDeleted`、`findDeletedById` 只看人）；保留期滿後 `trash.purge` 照樣清除（`findExpired` 不分種類），`api_tokens` 隨 FK 刪除 |
| T1 | 反提權只比對租戶層的權限鍵（D4） | `assertCanGrant` 只比對租戶上的能力；服務帳號在資料夾上的等級（直接授權或經群組）不在檢查內。有 `serviceAccount:update` 的人替服務帳號建 token，等於取得它在資料夾上的存取。目前只有 admin 預設持有這個鍵；要補的話在檔案模組提供「這個主體在哪些資料夾有什麼等級」並以 `file:share` 的規則比對 |
| T1 | 人與服務帳號的分界 | `isHumanUser()`（`db/schema/users.ts`）：使用者的列表、詳情、版本、email 查詢（登入、忘記密碼、註冊、外部 IdP 自動連結）、最後一位 super-admin 的計數、個人資料夾、`findActiveUserIdsWithPermission`（審批的收件人）。角色的持有者、群組成員、資料夾授權的對象 **包含** 服務帳號 |
| T1 | 推播 | 服務帳號的建立、修改、刪除還沒有自己的 `ChangeSource`（T4 已加，見下方 T4 的推播）；角色變動推 `role` 的 `resource.changed`，讓角色頁的持有者更新 |
| T1 | 系統設定的 key | `auth.personalTokenMaxDays`、`auth.serviceAccountTokenMaxDays`（D8 寫的 `apiToken.maxLifetimeDays` 拆成兩個，放在既有的 `auth` 分類） |
| T1 | 有效 token 數上限 | 一個帳號同時有效（未撤銷、未過期）的 token 最多 50 把，`409 API_TOKEN_LIMIT_REACHED` |
| T1 | 既有租戶的系統角色 | 手寫 migration 0023：admin 補 `serviceAccount:*`、auditor 補 `serviceAccount:read`（seed 只在角色新建立時寫入權限） |
| T2 | 對外路由的宣告（D11） | 除了 `@RequirePermissions`，也允許 `@Authenticated`：`GET /v1/me` 是「這把 token 是誰」，不需要權限鍵。仍不能 `@Public`（健康檢查以 `@Surface('both')` 例外） |
| T2 | scopes 怎麼套到權限（D3） | token 寫進請求脈絡（`setContextApiToken`），`PermissionService.getPermissionSet` 問的是擁有者時回傳交集；guard 與 service 裡的判斷都套得到，快取仍存帳號本身的權限 |
| T2 | 對外程序的設定（D19） | `JOBS_WORKER_ENABLED` 由 `src/external-process-env.ts` 在程序裡固定；連線池不另開 env，compose 的 `external-api` 覆寫 `TENANT_POOL_MAX`、`PLATFORM_POOL_MAX`（來源是 `EXTERNAL_TENANT_POOL_MAX`、`EXTERNAL_PLATFORM_POOL_MAX`） |
| T2 | 限流（D13） | 認證之後以 token 計（`EXTERNAL_RATE_LIMIT`）；認證失敗另以 IP 計（`EXTERNAL_AUTH_FAILURE_RATE_LIMIT`，超過回 429），成功的請求不計，NAT 後面的其他整合不受影響 |
| T2 | 錯誤碼 | 新增 `401 AUTH_API_TOKEN_EXPIRED`（整合方要知道是過期、該換 token）；找不到、雜湊不符、已撤銷不細分，都是 `AUTH_TOKEN_INVALID` |
| T2 | 文件 | `openapi.external.json` 與 `openapi.json` 從同一個 app 以路徑分開；內部文件拿掉只有對外路由引用的 schema，前端 SDK 不出現對外的型別 |
| T2 | 部署 | `external-gateway`（nginx）與 `external-api` 在自己的 `external` 網路；閘道碰不到內部 api。`AccessTokenModule` 需要一個 `JwtService`：對外程序註冊不帶金鑰的 `JwtModule`（從不驗 JWT） |
| T3 | scopes 與資源模型的繼承（D3） | T2 只在 `PermissionService` 取交集，但檔案的判斷走關係圖：資料夾的 `can_*` 從租戶的 `file:*` 繼承，帳號經角色持有的全域權限會繞過 scopes（限縮成 `file:read` 的 token 仍能上傳、刪除）。改為 `PermissionSet.tokenScoped` 時，`checkerFor` 的租戶層邊只有限縮後的權限鍵（`TenantRelationsOverride`）；資料夾上的授權照舊 |
| T3 | 第一批端點 | `/v1/folders`、`/v1/files`（列表、資訊、上傳三步、放棄）、`/v1/users`（唯讀）。對外的 controller 與 service 在 `modules/<name>/external/`，service 只做 DTO 的轉換 |
| T3 | 檔案列表的分頁 | 只提供游標（`nextCursor`），依建立時間由新到舊；使用者沿用 offset（列表沒有游標，offset 上限 10000） |
| T3 | 影像網址 | 對外的檔案不含 `image`（內部的簽章影像網址指向內部 api 的端點）；下載網址是租戶網域的 `/storage` |
| T3 | 對外程序 import 的模組 | 除了檔案與使用者，也 import `RoleModule`、`GroupModule`：回收桶在啟動時要求每一種類型都有 handler |
| T4 | 推播 | 新增 `ChangeSource` 的 `serviceAccount`（受眾 `serviceAccount:read`）與 `apiToken`（受眾 `serviceAccount:read`、`user:update`；個人 token 另以 `affectedUserIds` 推給本人）。服務帳號的 token 帶 `refs.serviceAccount`，前端只失效那個帳號的 token 列表 |
| T4 | 畫面 | `features/service-account`：列表（`/service-account`）、建立對話框（`/service-account/create`，獨立的 page key）、詳情（`/service-account/$serviceAccountId`：基本資料、角色、token）。帳號設定（`/profile`）的「個人存取 token」；使用者詳情頁的 token 區塊在 `user:update` 時顯示 |
| T4 | token 的共用元件 | 三處的列表與建立對話框相同，放在 `core/components/ApiToken/`（只接收資料與 callback，不呼叫 API）；明文只在建立成功的對話框顯示一次，關閉後無法再取得 |
| T4 | token 的 scopes 選項 | 選項是操作者自己持有的權限鍵（反提權，D4；不選代表「全部」），以權限鍵本身當名稱：權限目錄要 `permission:read` 才讀得到。超出的由後端擋下，生效時仍與帳號的權限取交集（D3） |
| T5 | 歸檔 | 正式規格是 `architecture/06-external-api.md`（對外 API）與 `backend/04-auth.md` §8.2（服務帳號與 token 的管理）；其餘章節在 T1～T4 時已同步更新。刪除提案 `features/api-tokens.md`，`webhooks`、`mfa` 的連結改指正式文件 |
