# 系統架構

## 1. 全貌

```
┌─────────────────────────────────────────────────────────────────────┐
│ Browser                                                             │
│                                                                     │
│  apps/backstage  (React 19 + Vite)                                        │
│  ┌───────────────────────────────────────────────────────────────┐  │
│  │ main.tsx — AppContext plugin chain                            │  │
│  │   cache → eventBus → i18n → httpContext → features → app      │  │
│  ├───────────────────────────────────────────────────────────────┤  │
│  │ app/      App Shell、Layout、route tree 組裝                   │  │
│  │ features/ auth · user · role · permission · account ·         │  │
│  │           audit-log · home                                     │  │
│  │ core/     permission registry · auth session · router · cache  │  │
│  │ apis/     fetcher + query/mutation（唯一對外通訊點）            │  │
│  │ components/ Base UI 封裝層                                     │  │
│  └───────────────────────────────────────────────────────────────┘  │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ HTTPS / JSON
                                 │ Authorization: Bearer <access token>
                                 │ Cookie: refresh_token (httpOnly, /auth)
                                 │ WebSocket /api/socket.io（handshake auth.token；伺服器推播）
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ apps/api  (NestJS 12)                                               │
│                                                                     │
│  ┌── 全域管線（每個請求都會經過） ─────────────────────────────────┐  │
│  │ RequestIdMiddleware → JwtAuthGuard → PermissionsGuard          │  │
│  │   → ZodValidationPipe → Controller → Service → Repository      │  │
│  │   → TransformInterceptor → AuditInterceptor                    │  │
│  │   → HttpExceptionFilter                                        │  │
│  └────────────────────────────────────────────────────────────────┘  │
│                                                                     │
│  modules/  auth · user · role · permission · audit-log · health     │
│            realtime（Socket.io gateway：推播、session 撤銷）         │
│  core/     database(Drizzle) · config · cache · authz · logger · …  │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ SQL (postgres-js / node-postgres)
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ PostgreSQL 17                                                       │
│   users · roles · permissions                                       │
│   relation_tuples（關係圖的邊：角色持有者、權限鍵、資料夾授權）     │
│   refresh_tokens · audit_logs                                       │
└─────────────────────────────────────────────────────────────────────┘
```

**登入不在 backstage**：`apps/platform` 是全平台共用、不屬於任何租戶的前端（獨立的 origin），`apps/api` 當 OIDC Provider。
backstage 以授權碼 ＋ PKCE 跳到 apps/platform 登入，再以自己 origin 的 `/api/auth/sso/callback` 換成上圖的 app session。
平台層級的頁面（外部 IdP 連線、帳號流程；之後的租戶管理，[`architecture/05-tenancy.md`](05-tenancy.md) §10）也在 apps/platform。見 [`04-sso.md`](./04-sso.md)。

---

## 2. 相依方向（不可違反）

### 前端

```
features/  ──▶  apis/  ──▶  @b2b-system/web-core/client
    │             │
    │             └──▶  packages/api-sdk
    ├──▶  core/                 （app 的：權限目錄的門面、backstage 才有的模組）
    ├──▶  @b2b-system/web-core  （兩個 app 共用的機制：permission · router · cache · errors · locales）
    ├──▶  @b2b-system/ui        ──▶  Base UI
    └──▶  @b2b-system/web-shared（純工具，不得反向依賴上面任何一層）

app/  ──▶  features/    （只組裝，不實作業務）
core/、web-core  ✗──▶ features/   （核心永遠不認識功能；web-core 也不認識任何 app）
features/A  ✗──▶ features/B  （跨 feature 只能經由 routes/external.ts 或事件）
```

### 後端

```
modules/<name>/controller  ──▶  service  ──▶  repository  ──▶  core/database
                  │                 │
                  └──▶ dto/schema   └──▶ 其他 module 的 service（僅限經由 module import）

core/  ✗──▶ modules/     （核心永遠不認識業務模組）
repository ✗──▶ service  （單向）
```

**跨模組呼叫的唯一合法路徑**是 NestJS 的 module import ＋ service 注入，
且被注入的 service 必須出現在對方 module 的 `exports`。不允許直接 import 別的
模組的 repository。

---

## 3. 端到端資料流

### 3.1 登入

```
[backstage] /auth/login → 頂層跳轉 → {apps/platform}/api/oidc/auth?client_id=backstage&code_challenge=…&state=…
  [api] oidc-provider：沒有 IdP session → apps/platform /interaction/:uid
[apps/platform] 互動頁 └─▶ POST /oidc-interaction/:uid/login { email, password }（或導向外部 IdP）
        [api] AuthService.verifyCredentials
                ├─ UserRepository.findByEmail          (citext 比對)
                ├─ argon2.verify(password_hash, pw)
                ├─ 檢查 status = 'active'、失敗次數 / 鎖定、只允許 SSO 的網域
                └─ 寫入 audit_logs (auth.login.success)
        ◀── { redirectTo }（頁面頂層跳轉 → provider 建立 IdP session → 303 backstage /auth/callback?code&state）
[backstage] /auth/callback
  └─▶ POST /auth/sso/callback { code, codeVerifier, clientId, redirectUri }
        [api] 本程序內兌換授權碼（PKCE）
                ├─ 簽發 access token  (JWT, 5 min, 僅含 sub/jti/ver/tid/sid)
                └─ 產生 refresh token (opaque 隨機 256-bit，雜湊後入庫，記 client_id、idp_session_uid)
        ◀── 200 { accessToken, expiresIn, tokenType }
            Set-Cookie: refresh_token=…; HttpOnly; Secure; SameSite=Lax; Path=/api/auth（backstage 的 host-only cookie）
  ◀─ SessionStore.setTokens()  （access token 只存在記憶體閉包）
  └─▶ GET /auth/profile
        ◀── 200 { user, roles[], permissions: PermissionKey[], features: TenantFeature[] }（features：租戶啟用的功能，[`frontend/02-plugin-system.md`](frontend/02-plugin-system.md) §9.2 D8）
  └─▶ usePermissionStore.setPermissions(permissions)   ← 權限集合水合完成
  └─▶ router.history.replace(returnTo)
```

已有 IdP session 時（例：先在 apps/platform 登入過），provider 直接帶授權碼跳回，不出現登入頁。細節見 [`04-sso.md`](./04-sso.md) §3。

### 3.2 一次受權限保護的寫入

```
[backstage] RoleDetailPage → 「儲存」
  └─▶ useMutation(getRoleUpdateMutationOptions())
        └─▶ fetchRoleUpdateMutation (apis/role/update-role/fetcher.ts)
              └─▶ defineAuthFetcher → HttpContext('main:auth')
                    ├─ SessionStore.ensureAccessToken()
                    │    └─ 若剩餘壽命 < 30s：先續期（跨分頁單飛）
                    └─ fetch PATCH /roles/:id  Authorization: Bearer …

        [api] JwtAuthGuard        驗簽 → 取出 sub → 載入 user（含 status 檢查）
              PermissionsGuard    讀 @RequirePermissions('role:update') metadata
                                  → PermissionService.getPermissionSet(userId)
                                    （關係圖解析、含權限依賴樹閉包、有快取；[`rbac/01-domain-model.md`](../rbac/01-domain-model.md) §9）
                                  → 集合是否包含 'role:update'？否 → 403
              ZodValidationPipe   body 驗證
              RolesController.update
                └─ RolesService.update
                     ├─ 系統角色保護檢查（is_system → 403）
                     ├─ 反提權檢查（若變更權限）
                     ├─ RoleRepository.update ＋ AuditService.record('role.update', diff)（交易內）
                     ├─ PermissionService.permissionsChanged()（交易後；僅權限／持有者變更，整個租戶失效並廣播）
                     └─ DomainEventBus.publish('resource.changed')（→ 其他人的畫面即時更新）
        ◀── 200 { data: Role }

  ◀─ onSuccess → invalidateResources([{ resource: 'role', kind: 'update', id }])
                 → 依賴圖換算出 ROLE_LIST、ROLE_DETAIL(id)…（frontend/05 §6.2）
                 → BroadcastChannel 通知其他分頁同步失效
```

### 3.3 權限變更如何傳到已登入的使用者

這是 RBAC 最容易出錯的地方，明確定義如下：

| 層           | 機制                                                                                            | 最壞延遲                      |
| ------------ | ----------------------------------------------------------------------------------------------- | ----------------------------- |
| 後端授權判斷 | `PermissionCacheService`（in-memory，TTL 60s）＋ 關係圖寫入後 **整個租戶主動失效**，經平台 DB 廣播到其他程序（`authz_revision`，[`backend/05-rbac.md`](./backend/05-rbac.md) §5.1） | 主動失效 < 1s；漏網情況 ≤ 60s |
| Access Token | **不內嵌權限**（只有 `sub`、`jti`、`ver`、`tid`）→ 不會有 token 內的陳舊權限                           | 不適用                        |
| 前端 UI      | 伺服器推 `resource.changed`（`userRole` / `role` / `rolePermission`）→ 依賴圖衍生失效 `PROFILE` → 重抓 `GET /auth/profile`；推播斷線時退回：登入後、window focus 時、每 5 分鐘重新取得 | 推播 < 1s；斷線時 ≤ 5 min |
| 強制登出     | 使用者被停用或刪除 → `users.token_version` +1 → 推 `session.revoked` 並斷線；既存 access token 驗簽時因 `ver` 不符而失效 | 推播 < 1s；否則下一次請求 |

推播的設計見 [`backend/08-realtime.md`](./backend/08-realtime.md)、[`frontend/11-realtime.md`](./frontend/11-realtime.md)。

> **關鍵取捨**：access token 不帶權限，代表每次請求都要解析權限集合。這是用
> 一次快取查詢換取「權限變更立即生效」。見
> [`backend/05-rbac.md`](backend/05-rbac.md) §11。

---

## 4. 部署拓撲

### 4.1 本機開發

```
pnpm dev
├─ docker compose up -d postgres        (localhost:5432)
├─ apps/api           nest start --watch       (localhost:3000)
├─ apps/file-storage  tsx watch                (localhost:9000，S3 相容)
├─ apps/backstage     vite                     (localhost:5173)
│                       ├─ proxy /api     → http://localhost:3000（ws: true，含 /api/socket.io）
│                       └─ proxy /storage → http://localhost:9000（不去前綴、不改 Host：presigned URL）
└─ apps/platform          vite                     (localhost:5175，IdP 的 origin)
                        └─ proxy /api     → http://localhost:3000
```

外部 IdP 登入的開發與 E2E 另外跑 `pnpm dev:mock-idp`（localhost:4455）；對外 API 另外跑 `pnpm dev:external-api`
（localhost:3001，以 API token 直接打，不經 Vite proxy；[`06-external-api.md`](./06-external-api.md)）。

前端一律透過 `/api` 前綴打到 Vite dev proxy，**不在程式碼裡寫死後端位址**，
production 由反向代理負責同源。這讓 refresh token cookie 可以是同源的
`httpOnly` cookie，不需要 CORS credentials 的複雜度。

### 4.2 Production（`docker-compose.prod.yml`）

```
                         ┌──────────────────────────────┐
  Internet ─────────────▶│ backstage（nginx）:8080→8080 │  network: edge
                         │  /               → 靜態檔     │
                         │  /api/socket.io/ → api（Upgrade）│
                         │  /api/*          → api（去掉前綴）│
                         │  /storage/*      → file-storage（保留前綴）│
                         └──────────────┬───────────────┘
                                        │ edge
                         ┌──────────────▼───────────────┐      ┌──────────────────────────┐
                         │ api（NestJS）  :3000          │─────▶│ file-storage :9000（volume）│ networks: edge, storage
                         │  REST ＋ Socket.io gateway    │ storage │  S3 相容物件儲存          │
                         └──────────────┬───────────────┘      └──────────────────────────┘
                                        │ data
  migrate（一次性）─────────────────────┤
   migration ＋ 冪等 seed               │
                         ┌──────────────▼───────────────┐
                         │ postgres 17  （volume）       │  network: data
                         └──────────────────────────────┘
```

| 服務       | 映像                          | 角色                                                 | 啟動條件                        |
| ---------- | ----------------------------- | ---------------------------------------------------- | ------------------------------- |
| `postgres` | `postgres:17-alpine`          | 唯一的狀態儲存：平台 DB ＋ 每個租戶一個 database     | —                               |
| `migrate`  | `b2b-system-api`（同 api）   | `migrate.js` ＋ `seeds/index.js`，跑完即結束         | postgres healthy                |
| `api`      | `b2b-system-api`             | REST、Socket.io、權限快取                            | migrate **成功結束**、file-storage healthy |
| `file-storage` | `apps/file-storage/Dockerfile` | S3 相容的物件儲存（[`03-file-storage.md`](./03-file-storage.md)） | —                     |
| `backstage` | `apps/backstage/Dockerfile`（nginx）| 靜態檔、反向代理、安全標頭                 | api healthy                     |
| `platform` | `apps/platform/Dockerfile`（nginx，`deploy/nginx.platform.conf`）| 身分與租戶入口：**獨立的 origin**（`:8081`），`/api/*` 同樣反向代理到 api | api healthy |
| `external-api` | `b2b-system-api`（`node dist/src/main.external.js`） | 對外 API：只認 API token、只入列不跑背景工作（[`06-external-api.md`](./06-external-api.md)） | migrate 成功結束、file-storage healthy |
| `external-gateway` | `nginxinc/nginx-unprivileged`（`deploy/nginx.external-api.conf`） | 對外 API 的網域（`:8082`）；在自己的 `external` 網路，碰不到內部 api | external-api healthy |

- **每個租戶一個網域**（[`05-tenancy.md`](./05-tenancy.md) §7）：backstage 的 nginx 是 `server_name _`，任何網域都由它服務，
  `Host` 原樣轉給 api 決定租戶；`*.<TENANT_BASE_DOMAIN>` 要有 wildcard DNS 與憑證。平台管理者在 apps/platform 建立租戶時，
  api 以 `TENANT_PROVISIONING_DATABASE_URL`（預設即 `PLATFORM_DATABASE_URL`）在同一台 postgres 建立那個租戶的 database 與 DB 角色。
- 前端是純靜態產物，SPA fallback 到 `index.html`。正式產物 **不含 sourcemap**（nginx 會原樣提供 `dist` 的每個檔案）；要上傳到錯誤追蹤服務時以
  `BUILD_SOURCEMAP=hidden` 建置、上傳後刪掉 `.map` 再部署。MSW 只在 `VITE_ENABLE_MOCK=true` 的建置裡。SSO 的網址（`VITE_OIDC_ISSUER`、`VITE_PLATFORM_APP_URL`）是建置參數，
  由 `PLATFORM_PUBLIC_ORIGIN` 產生；api 另需 `OIDC_JWKS`、`OIDC_COOKIE_KEYS`、`IDP_SECRET_KEY`（[`04-sso.md`](./04-sso.md) §7）。
- `/api/*` 反向代理去掉前綴後轉給 NestJS；`/api/socket.io/` 另一段 location 帶 `Upgrade` header，
  `proxy_read_timeout` 大於 Socket.io 心跳間隔。
- **網路分三段**：`backstage` 只在 `edge`，碰不到 `postgres`；`migrate` 只在 `data`；`file-storage` 在 `edge` 與 `storage`，
  碰不到 `postgres`。
- `/storage/` 的 location **不去掉前綴、原樣轉發 `Host`**、不緩衝、不限大小：瀏覽器以 presigned URL 直傳／下載，
  簽章涵蓋 host 與完整路徑（[`backend/09-file.md`](./backend/09-file.md) §3）。同源，所以 CSP 不必放寬。
  換成真正的 S3 時拿掉 `file-storage` 服務，改 api 的 `FILE_STORAGE_*` 即可。
- `migrate` 與 `api` 共用映像：部署時 schema 一定先於新版程式就位，api 不在啟動時自己跑 migration
  （多執行個體時會互搶）。
- CSP：`default-src 'self'`，不允許 inline script（Vite build 產物符合）；`connect-src 'self'` 同時涵蓋同源的 `wss:`；
  `form-action 'self'`、`object-src 'none'`。另有 HSTS、`X-Frame-Options`、`nosniff`，全部在 `deploy/nginx.security-headers.conf`
  （有自己 `add_header` 的 location 要再 include 一次，nginx 不會繼承）。
- **nginx 的容量與強化**（`deploy/nginx.main.conf`）：每條 WebSocket 佔兩個連線，`worker_connections 8192`、
  `worker_rlimit_nofile 65535`（compose 的 `ulimits` 同步放寬）；對 api 用 `upstream` ＋ `keepalive`（`/api/` 清掉
  `Connection` 標頭，api 的 `keepAliveTimeout` 65 秒大於 nginx 的 60 秒）；`server_tokens off`、`gzip_proxied any`。
  映像是 `nginxinc/nginx-unprivileged`（uid 101、listen 8080），compose 以唯讀根目錄、`cap_drop: [ALL]` 執行。
  改設定後跑 `sh deploy/check-nginx.sh`（Docker：`nginx -t` ＋ 實際轉發的標頭檢查）。
- **`X-Forwarded-Host` 一律由 nginx 以 `Host` 覆寫**：api 信任這一跳帶來的 `X-Forwarded-Host`（`requestHost()`），不覆寫的話
  客戶端自帶的值會被拿來決定租戶。nginx 前面若還有 LB，LB 也要覆寫（或清掉）這個標頭。
- TLS 由前面的 LB / ingress 終結；Socket.io 的 Origin 與連線同源（租戶自己的網域）一律允許，`PUBLIC_ORIGIN` 只是額外的白名單。
- api 設 `TRUST_PROXY=uniquelocal`：只信任私有網段（nginx）帶來的 `X-Forwarded-For`，
  HTTP 與 WebSocket 的每 IP 限流才看得到真實客戶端；外部自帶的標頭無法偽造 IP。
- **NAT 的設計假設**：企業客戶的上千名員工常共用一個出口 IP。已登入的請求以使用者計、未登入與登入類端點的 IP 桶
  按「整間公司在同一個 IP」估算（[`backend/03-api-conventions.md`](./backend/03-api-conventions.md) §8）；
  數值不夠時調環境變數，不必改程式。

### 4.3 為什麼不拆成更多服務，以及何時要拆

Phase 0 是 **模組化單體**：`modules/` 之間只透過 exports 的 service 互動，將來要拆有清楚的邊界，
但現在拆只會多出網路呼叫與分散式交易。必須存在的服務只有上表六個；`file-storage` 是可替換的基礎設施
（等同 S3），不是業務服務。

| 想拆出來的東西            | 現在不拆的理由                                                               | 拆的前提                                                                 |
| ------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Socket.io 獨立成 realtime 服務 | 推播必須在寫入交易之後、由同一個 service 觸發；拆開就要一條可靠的事件匯流排 | 有了 outbox 或 `LISTEN/NOTIFY` 事件流；連線數大到影響 REST 的延遲        |
| auth 獨立（後端）服務     | 每個請求都要驗 token 與權限；拆開就是每個請求多一跳。有了第二個產品之後只拆了 **前端**（`apps/platform`，[`architecture/04-sso.md`](04-sso.md) §12.2 D2），OIDC Provider 仍是 api 的模組 | 身分服務要給本平台以外的系統用，且負載或發版節奏與 api 明顯不同         |
| Redis                     | 快取與 room 都在單一程序的記憶體裡就夠                                       | 見下一段；Postgres `LISTEN/NOTIFY` 能滿足時仍不需要                      |

**api 水平擴展（`replicas > 1`）要同時具備四件事**，缺一就會出錯，所以 compose 目前固定單一執行個體：

1. 推播跨節點：伺服器端的推播 **已完成**（領域事件經平台 DB 轉送，每個節點推給自己的連線，[`backend/08-realtime.md`](./backend/08-realtime.md) §7.6）；
   跨裝置中繼（`channel.relay`）仍只在本節點（同 §10.3）。
2. 權限／使用者快取跨節點失效：**已完成**（§4.4）。
3. 租戶登記的快取跨節點失效（停用、網域的變更）：**已完成**（§4.4）。
4. nginx 的 upstream 要能看到每個執行個體（`resolver 127.0.0.11` ＋ 變數化的 `proxy_pass`，或改用 LB）；
   Socket.io 只用 websocket 傳輸，**不需要** sticky session。

另外還沒跨節點的：HTTP 與 WebSocket 的速率限制（每個節點各自計數）、feature flag 的全平台快取（最多晚 `TENANT_CACHE_TTL` 秒），
見 [`../features/multi-instance.md`](../features/multi-instance.md)。

### 4.4 程序之間的一致性

快取都在各程序的記憶體裡。一個程序寫入之後，先失效本機，再經平台 DB 的 `LISTEN`／`NOTIFY`（`core/broadcast`）通知其他程序
（[`architecture/06-external-api.md`](06-external-api.md) §9.2 D16、D18）。對外 API、之後拆出的 worker、多個 api 執行個體都靠這一層。

| 頻道 | 內容 | 收到時 | 送出的地方 |
| --- | --- | --- | --- |
| `authz_revision` | `{ tenant, revision }` | 比已知新才處理：整個租戶的權限快取失效、發 `permissions.changed` | `AuthzRevision`（[`backend/05-rbac.md`](./backend/05-rbac.md) §5.1） |
| `user_cache` | `{ tenant, users }`（平台管理者 `tenant: null`；一則最多 150 個 id） | 這些人的使用者快取（狀態、`token_version`）失效 | `UserCacheService.invalidate()`；同一輪的多次失效合併送出 |
| `tenant_directory` | `{}` | 租戶登記整份重新讀（含網域快照） | `TenantDirectory.invalidate()` |
| `file_folder_tree` | `{ tenant }` | 那個租戶的資料夾結構快取作廢 | `FileFolderTree.invalidate()`（[`backend/09-file.md`](./backend/09-file.md) §11.1） |
| `settings` | `{ tenant }` | 那個租戶的系統設定快取作廢 | `SettingService.invalidate()`（[`backend/12-settings.md`](./backend/12-settings.md)） |
| `notification_policy` | `{ tenant }` | 那個租戶的通知政策快取作廢 | `NotificationPolicyService.invalidate()`（[`backend/16-notification-event.md`](./backend/16-notification-event.md) §3） |
| `api_token_cache` | `{ tenant, tokens }` | 這些 API token 的驗證快取作廢 | `ApiTokenCacheService.invalidate()`（撤銷之後；[`06-external-api.md`](./06-external-api.md) §5） |
| `domain_event` | 推播類的領域事件 | 在那個租戶的脈絡裡交給本機的推播 | `DomainEventRelay`（[`backend/08-realtime.md`](./backend/08-realtime.md) §7.6） |

- 除了 `authz_revision`，訊息都經 `BroadcastService.channel()` 包上送出的程序 id，**自己送的不會收回來**（本機在送出前已處理過）。
- **不保證送達**：送出失敗只記 log；監聽連線斷線重連時，每個訂閱者丟掉整份快取。各快取原本的 TTL 是最後防線。
- 只送 key，不送資料：`NOTIFY` 的 payload 上限 8000 位元組。

---

## 5. 錯誤與可觀測性

| 面向         | 作法                                                                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 錯誤碼       | 後端回 `{ error: { code, message, details? } }`，`code` 是穩定的 SCREAMING_SNAKE 字串（見 [`backend/03-api-conventions.md`](./backend/03-api-conventions.md) §5） |
| 前端錯誤訊息 | `@b2b-system/web-core/errors` 的 `useErrorMessage()` 把 `code` 對應到已本地化的訊息；沒有對應時退回通用訊息＋顯示 code                                                                |
| Request ID   | `RequestIdMiddleware` 產生 `x-request-id`，出現在回應 header、日誌與稽核紀錄中                                                                                    |
| 結構化日誌   | Pino（JSON）：HTTP 存取日誌與應用程式日誌（`new Logger(Xxx.name)`，進入點以 `app.useLogger()` 接上）共用同一個 Pino。請求內的每一筆都帶 `requestId`（與回應的 `x-request-id`、稽核紀錄相同），應用程式日誌另有 `context`（類別名稱），存取日誌另有 `req`／`res`／`responseTime`；背景工作的日誌沒有 `requestId`。等級：development `debug`、production `info`、test 靜音 |
| 授權失敗     | 每一次 403 都寫入 `audit_logs`（`action = 'authz.denied'`），含缺少的權限鍵                                                                                       |
| 健康檢查     | `GET /health`（liveness）、`GET /health/ready`（平台 DB ping ＋ 物件儲存 ping，失敗回 `degraded`）                                                                  |

---

## 6. 安全基線

| 項目          | 決定                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| 密碼雜湊      | Argon2id，memory 19 MiB / iterations 2 / parallelism 1（OWASP 建議）                                       |
| Access Token  | JWT（HS256 或 RS256），**5 分鐘**，只存記憶體，不進 `localStorage`                                         |
| Refresh Token | 不透明隨機值，**雜湊後**入庫，7 天，每次使用即輪替，**重用偵測 → 整條家族撤銷**                            |
| Cookie        | `HttpOnly; Secure; SameSite=Lax; Path=/api/auth`；一律 host-only（不設 `Domain`），不使用跨域 cookie（[`04-sso.md`](./04-sso.md) §2） |
| CSRF          | refresh 端點是唯一吃 cookie 的端點，額外要求 `x-refresh-request: 1` 自訂標頭（簡單請求無法跨站帶自訂標頭） |
| 暴力破解      | 同帳號連續 5 次失敗鎖定 15 分鐘；登入類端點以「帳號 ＋ IP」與 IP 限流（[`backend/03-api-conventions.md`](./backend/03-api-conventions.md) §8） |
| 反提權        | 授予權限／指派角色時檢查「操作者是否持有該權限」                                                           |
| 自我保護      | 使用者不能刪除自己、不能改自己的角色；改自己持有的角色時不能拿掉自己管理角色所需的權限（`ROLE_SELF_LOCKOUT`） |
| SQL injection | Drizzle 參數化查詢；禁止字串拼接 SQL                                                                       |
| 稽核不可變    | `audit_logs` 只有 INSERT 權限的 DB role；無 UPDATE / DELETE                                                |
