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
│  │   → TransformInterceptor（稽核由 service 在交易內寫入）        │  │
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
features/A  ✗──▶ features/B  （跨 feature 只能經由 route id、apis/ 或事件）
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
                                    （關係圖解析、含權限依賴樹閉包、有快取；[`iam/01-model.md`](iam/01-model.md) §9）
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

開發用的服務都只聽 loopback：postgres 的帳密是公開的固定值（超級使用者）、Mailpit 的網頁看得到所有啟用與重設密碼的連結，
`docker-compose.yml` 只綁 `127.0.0.1`；api 與對外 API 的程序在 production 以外只聽 `127.0.0.1`（`LISTEN_HOST`）。
要從其他機器連（例：手機測試）時在本機覆寫：`LISTEN_HOST=0.0.0.0`、不進版控的 `docker-compose.override.yml`。

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
                         │  /apm/api/<id>/envelope/ → apm-service（去掉前綴）│
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
| `postgres` | `postgres:17-alpine`（digest 釘住） | 唯一的狀態儲存：平台 DB ＋ 每個租戶一個 database     | —                               |
| `migrate`  | `b2b-system-api`（同 api）   | `migrate.js` ＋ `seeds/index.js`，跑完即結束         | postgres healthy                |
| `api`      | `b2b-system-api`             | REST、Socket.io、背景工作（`APP_ROLES=all`；多實例時只有 REST，§4.3） | migrate **成功結束**、file-storage healthy |
| `api-worker`／`api-realtime` | `b2b-system-api` | 背景工作／推播（`worker` profile、`docker-compose.cluster.yml` 才啟動，§4.3） | 同 api |
| `file-storage` | `apps/file-storage/Dockerfile` | S3 相容的物件儲存（[`03-file-storage.md`](./03-file-storage.md)） | —                     |
| `apm-service` | `apps/apm-service/Dockerfile` | 前端錯誤與 Web Vitals 的收件，模擬 Sentry API（[`07-apm-service.md`](./07-apm-service.md)）；`127.0.0.1:9100` 給上傳 sourcemap、查詢與 `/metrics`。compose 的 `apm` profile：可整套關閉（[`07-apm-service.md`](./07-apm-service.md) §8.1） | — |
| `backstage` | `apps/backstage/Dockerfile`（nginx）| 靜態檔、反向代理、安全標頭                 | api healthy；APM 開啟時另等 apm-service |
| `platform` | `apps/platform/Dockerfile`（nginx，`deploy/nginx.platform.conf`）| 身分與租戶入口：**獨立的 origin**（`:8081`），`/api/*` 同樣反向代理到 api | api healthy；APM 開啟時另等 apm-service |
| `external-api` | `b2b-system-api`（`node dist/src/main.external.js`） | 對外 API：只認 API token、只入列不跑背景工作（[`06-external-api.md`](./06-external-api.md)）；compose 的 `external` profile | migrate 成功結束、file-storage healthy |
| `external-gateway` | `nginxinc/nginx-unprivileged:1.30.5-alpine`（`deploy/nginx.external-api.conf`） | 對外 API 的網域（`:8082`）；在自己的 `external` 網路，碰不到內部 api | external-api healthy |

- **變數放在獨立的 env 檔**：`docker compose --env-file deploy/prod.env -f docker-compose.prod.yml …`，範本是 `deploy/prod.env.example`。
  不要沿用開發的 `.env`：compose 會拿它替換 `${…}`，開發用的帳密與網域會流進正式環境。公開網址（`PUBLIC_ORIGIN`、`PLATFORM_PUBLIC_ORIGIN`、
  `DEFAULT_TENANT_DOMAINS`）與 `TRUSTED_PROXY_CIDRS` 沒有預設值，漏設時 `docker compose config` 就失敗；api 另外拒絕不是 https 或指向 localhost 的公開網址
  （[`02-repository-structure.md`](./02-repository-structure.md) §5）。
- **映像以 digest 釘住**（四個 Dockerfile、三份 compose、`deploy/check-nginx.sh`）：同一個 commit 不論何時建置都拿到同一個基底。
  nginx 用仍在維護的 stable 分支並寫明版本。更新時以 `docker buildx imagetools inspect <映像>:<tag>` 取得新的 digest，
  所有出現的地方一起改（`.github/workflows/ci.yml` 的 action 也以 commit SHA 釘住），再跑 `sh deploy/check-nginx.sh` 與 `sh deploy/smoke-test.sh`。
  repo 沒有自動提更新的工具（Renovate 等），要定期手動檢查。

- **每個租戶一個網域**（[`05-tenancy.md`](./05-tenancy.md) §7）：backstage 的 nginx 是 `server_name _`，任何網域都由它服務，
  `Host` 原樣轉給 api 決定租戶；`*.<TENANT_BASE_DOMAIN>` 要有 wildcard DNS 與憑證。平台管理者在 apps/platform 建立租戶時，
  api 以 `TENANT_PROVISIONING_DATABASE_URL`（預設即 `PLATFORM_DATABASE_URL`）在同一台 postgres 建立那個租戶的 database 與 DB 角色。
- 前端是純靜態產物，SPA fallback 到 `index.html`。正式產物 **不含 sourcemap**（nginx 會原樣提供 `dist` 的每個檔案）；要上傳到錯誤追蹤服務時以
  `BUILD_SOURCEMAP=hidden` 建置、上傳後刪掉 `.map` 再部署。MSW 只在 `VITE_ENABLE_MOCK=true` 的建置裡。SSO 的網址（`VITE_OIDC_ISSUER`、`VITE_PLATFORM_APP_URL`）是建置參數，
  由 `PLATFORM_PUBLIC_ORIGIN` 產生；api 另需 `OIDC_JWKS`、`OIDC_COOKIE_KEYS`、`IDP_SECRET_KEY`（[`04-sso.md`](./04-sso.md) §7）、
  `TENANT_SECRET_KEY`（[`05-tenancy.md`](./05-tenancy.md) §7）與 `WEBHOOK_SECRET_KEY`（[`backend/17-webhook.md`](./backend/17-webhook.md) §9.2 D14）。
  完整清單見 [`02-repository-structure.md`](./02-repository-structure.md) §5；compose 給 api 的變數由 `prod-compose-env.spec.ts` 以 production 的規則驗證。
- `/api/*` 反向代理去掉前綴後轉給 NestJS；`/api/socket.io/` 另一段 location 帶 `Upgrade` header，
  `proxy_read_timeout` 大於 Socket.io 心跳間隔。
- **網路分三段**：`backstage` 只在 `edge`，碰不到 `postgres`；`migrate` 只在 `data`；`file-storage` 在 `edge` 與 `storage`，
  碰不到 `postgres`。
- `/storage/` 的 location **不去掉前綴、原樣轉發 `Host`**、不緩衝、不限大小：瀏覽器以 presigned URL 直傳／下載，
  簽章涵蓋 host 與完整路徑（[`backend/09-file.md`](./backend/09-file.md) §3）。同源，所以 CSP 不必放寬。
  設定 `FILE_DOWNLOAD_ORIGIN` 時，下載與預覽改由獨立、不帶 cookie 的檔案網域提供（同一個 backstage 容器的另一個 server，CSP 放行那一個 origin；[`backend/09-file.md`](./backend/09-file.md) §3.2）。
  換成真正的 S3 時拿掉 `file-storage` 服務，改 api 的 `FILE_STORAGE_*` 即可。
- `migrate` 與 `api` 共用映像：部署時 schema 一定先於新版程式就位，api 不在啟動時自己跑 migration
  （多執行個體時會互搶）。
- CSP：`default-src 'self'`，不允許 inline script（Vite build 產物符合）；`connect-src 'self'` 同時涵蓋同源的 `wss:`；
  `form-action 'self'`、`object-src 'none'`。另有 HSTS、`X-Frame-Options`、`nosniff`、`Permissions-Policy`（相機、麥克風、定位、付款、USB 全關）、
  `Cross-Origin-Opener-Policy: same-origin`（登入是頂層跳轉，沒有依賴 `window.opener` 的 popup），全部在 `deploy/nginx.security-headers.conf`
  （有自己 `add_header` 的 location 要再 include 一次，nginx 不會繼承）。
- **nginx 的容量與強化**（`deploy/nginx.main.conf`）：每條 WebSocket 佔兩個連線，`worker_connections 8192`、
  `worker_rlimit_nofile 65535`（compose 的 `ulimits` 同步放寬）；對 api 用 `upstream` ＋ `keepalive`（`/api/` 清掉
  `Connection` 標頭，api 的 `keepAliveTimeout` 65 秒大於 nginx 的 60 秒）；`server_tokens off`、`gzip_proxied any`；
  存取日誌的 `log_format` 記 `$request_method $uri $server_protocol` 而不是 `$request`，不留 query string（OIDC 的 `code`／`state`、重設密碼的 token）。
  映像是 `nginxinc/nginx-unprivileged`（uid 101、listen 8080），compose 以唯讀根目錄、`cap_drop: [ALL]` 執行。
  三個 nginx 都有 `/_nginx_health`（只接受容器內的連線），前端映像的 `HEALTHCHECK` 與 external-gateway 的 healthcheck 打它，
  不依賴 api 的狀態。改設定後跑 `sh deploy/check-nginx.sh`（Docker：`nginx -t` ＋ 實際轉發的標頭、X-Forwarded-For、健康檢查）；
  改 compose 或 Dockerfile 後跑 `sh deploy/smoke-test.sh`（以一次性的假金鑰建置並啟動整套，等每個服務 healthy、經三個 nginx 打到後端）。
  兩者都在 CI 的 deploy job 裡（[`../coding-standards/05-git.md`](../coding-standards/05-git.md) §2.4）。
- **`X-Forwarded-Host` 一律由 nginx 以 `Host` 覆寫**：api 信任這一跳帶來的 `X-Forwarded-Host`（`requestHost()`），不覆寫的話
  客戶端自帶的值會被拿來決定租戶。nginx 前面若還有 LB，LB 也要覆寫（或清掉）這個標頭。
- TLS 由前面的 LB / ingress 終結；Socket.io 的 Origin 與連線同源（租戶自己的網域）一律允許，`PUBLIC_ORIGIN` 只是額外的白名單。
- **客戶端 IP**（登入、refresh、未登入請求的 IP 桶，對外 API 的驗證失敗計數，WebSocket handshake 都以它計數）分兩段判定：
  1. nginx 只採用前置 LB 帶來的 `X-Forwarded-For`：容器啟動時 `deploy/nginx-real-ip.sh` 依 `TRUSTED_PROXY_CIDRS` 產生
     `set_real_ip_from`（`real_ip_recursive on`），其他來源自帶的標頭一律忽略。各 location 把 `X-Forwarded-For` **覆寫** 成算出的單一 IP。
  2. api 只信任 nginx 這一跳（`TRUST_PROXY`，預設 `uniquelocal`）。docker 的位址池不在私有網段（例：100.64.0.0/10）時改成那個子網路或 `1`。
- **前置 LB 的要求**：必須是 L7、會附加（或覆寫）`X-Forwarded-For` 與 `X-Forwarded-Host`，`TRUSTED_PROXY_CIDRS` 填它連到 nginx 的來源網段
  （例：同一個 VPC 的 ALB 填 VPC 的網段；同一台主機上的代理填 docker bridge 的閘道）。以 TLS listener 終結、不加標頭的 L4 LB 不適用：
  所有人會算成 LB 那一個 IP。Cloudflare 之類的 CDN 要改用它提供的真實 IP 標頭與來源網段清單（改 `deploy/nginx-real-ip.sh` 的 `real_ip_header`）。
- **對外的 port 只綁在 LB 連得到的介面**：8080、8081、8082 綁在 `EDGE_BIND_ADDRESS`（預設 `127.0.0.1`，只有同一台主機上的代理連得到）。
  LB 在別台主機時設成主機在 LB 那一側的位址，並以防火牆限制只有 LB 能連：直接連 nginx 會繞過 TLS 與 LB 上的防護。
- **監控**（選用）：`docker compose … -f docker-compose.prod.yml -f docker-compose.monitoring.yml up -d` 多出 Prometheus、Tempo、Grafana、postgres-exporter，
  api、external-api、apm-service 接上只有監控服務的 `monitoring` 網路；Grafana 只綁 `MONITORING_BIND_ADDRESS`（預設 `127.0.0.1:3300`）。見 [`08-monitoring.md`](./08-monitoring.md) §6。
  不疊這份檔案就是監控整套關閉：api 不開 `/metrics`、不送 trace（`MONITORING_ENABLED`，[`08-monitoring.md`](./08-monitoring.md) §1.1）。
- **NAT 的設計假設**：企業客戶的上千名員工常共用一個出口 IP。已登入的請求以使用者計、未登入與登入類端點的 IP 桶
  按「整間公司在同一個 IP」估算（[`backend/03-api-conventions.md`](./backend/03-api-conventions.md) §8）；
  數值不夠時調環境變數，不必改程式。

### 4.3 角色與擴展：單體是預設，以環境變數拆開

api 是 **模組化單體**：`modules/` 之間只透過 exports 的 service 互動。擴展不拆 codebase，而是把 **同一個映像** 依「打開哪些入口」
分成角色，各自部署、各自擴展（§7 D1）。負載低時只跑一個程序，所有角色都在裡面。

| 角色（`APP_ROLES`） | 做什麼 | 本機狀態 | 怎麼擴展 |
| --- | --- | --- | --- |
| `http` | 內部 api 的 REST、OIDC Provider、匯入的分析、依請求轉出的影像格式 | 只有可失效的快取 | 依 CPU／請求數 |
| `realtime` | Socket.io gateway、跨裝置中繼、接收其他程序轉送的推播 | 只有 **連線本身**（不可搬移；斷了客戶端重連到別台） | 依連線數 |
| `worker` | pg-boss 的 worker 與排程、開機時的租戶初始化、影像變體 | 無（工作狀態在 pg-boss） | 依佇列深度 |
| （另一個進入點）對外 API | `main.external.ts`，固定只有 `http`、只入列 | 無 | 依請求數 |
| （一次性）`migrate` | migration ＋ 冪等 seed | — | 每次部署跑一次 |

- `APP_ROLES` 是逗號分隔的清單，預設 `all`（三個都是）。角色只決定入口，每個角色都 import 同樣的業務模組：
  沒有 `http` 時 `SurfaceGuard` 只開健康檢查（`ops`）、`/oidc/*` 回 404；沒有 `realtime` 時不載入 `RealtimeModule`，
  推播由 `DomainEventRelay` 交給有連線的程序（§4.4）；沒有 `worker` 時只入列。`JOBS_WORKER_ENABLED=false` 讓 `worker` 角色也只入列
  （測試、共用的 dev DB；[`backend/10-jobs.md`](./backend/10-jobs.md) §5）。
- `DEPLOYMENT_MODE`：`standalone`（預設）宣告只有一個程序，允許程序內的共享狀態；`cluster` 時多個程序共用的東西必須真的共享，
  否則拒絕啟動（`RATE_LIMIT_STORE=memory`、內部 api 沒設 `OIDC_JWKS`／`OIDC_COOKIE_KEYS`；§7 D5）。開兩個 standalone 程序不會被偵測到：速率限制會變成兩倍。
- trace 的 `service.name` 維持 `api`（與 Prometheus 的 job 相同），角色在資源屬性 `b2b.roles`（單體是 `all`）；啟動日誌也印出角色與部署模式。

**stateless 的判準**（§7 D4）：程序掛掉、或下一個請求落到別台時，不丟已確認的資料（長期狀態在 Postgres 或物件儲存）、
不給錯的結果（快取有失效廣播，TTL 是最壞情況的上限）、共享的計數不因實例數改變語意（速率限制走共享的 `RateLimitStore`）。
連線是唯一的例外，所以 `realtime` 可以水平擴展、不需要 sticky session 或 StatefulSet。真正有本機儲存的只有 `postgres`、
`apps/file-storage`、`apps/apm-service`：多實例時換成託管服務或各自單一實例。

| 程序內的狀態 | 處理 |
| --- | --- |
| 權限、使用者、租戶登記、資料夾樹、系統設定、通知政策、API token、MFA 方式、feature flag 的快取 | 失效經 `core/broadcast` 跨程序，TTL 兜底（§4.4） |
| HTTP、對外 API、WebSocket handshake 的速率限制，登入的漸進延遲 | `RateLimitStore`：standalone 預設程序記憶體，cluster 預設平台 DB 的共享計數（[`backend/03-api-conventions.md`](./backend/03-api-conventions.md) §8） |
| WebSocket 每人連線數、每條連線的訊息數、token 到期計時器 | 每個節點各自計算（連線不會換節點；§7 D7） |
| 跨裝置中繼 | 經廣播頻道 `user_relay` 送到其他節點（§7 D8） |
| 影像變體 | 背景工作 `file.imageVariants`（§7 D9） |
| 用量計數、API token 的 `last_used_at` | 每程序累計、以加法或單調更新寫入，多程序天然相加 |
| 影像處理的暫存檔 | 單次呼叫內使用；容器的 `/tmp` 設大小上限 |

**部署形態**：

| 形態 | 怎麼起 | 什麼時候用 |
| --- | --- | --- |
| 單體（預設） | `docker-compose.prod.yml`：一個 `api`（`all`） | 負載低、單台主機 |
| 背景工作分開 | `COMPOSE_PROFILES` 加 `worker`、`API_ROLES=http,realtime`：多一個 `api-worker` 容器，仍是 standalone | 影像處理或大量寄信拖慢 API；還不需要多台 api |
| 多實例（compose） | 疊 `docker-compose.cluster.yml`：`api`（`http`）×`API_HTTP_REPLICAS`、`api-realtime`×`API_REALTIME_REPLICAS`、`api-worker`×`API_WORKER_REPLICAS`，`DEPLOYMENT_MODE=cluster` | 單一程序撐不住、要滾動部署 |
| k8s | `deploy/k8s/overlays/standalone` 或 `overlays/cluster`（Kustomize：每個角色一個 Deployment、HPA、PDB、PgBouncer、`migrate` Job；§7 D15） | 要依負載自動擴縮 |

- 前端的 nginx 以 `deploy/nginx-upstreams.sh` 產生 upstream：`API_UPSTREAM`（預設 `api:3000`）、`REALTIME_UPSTREAM`（`/api/socket.io/`，預設同 api），
  `server … resolve` 在執行期重新解析，多實例時每個實例都收得到流量、擴縮後跟得上（§7 D12）。k8s 要寫完整的服務名稱（nginx 的 resolver 不套 search domain）。
- Prometheus 以 DNS 找目標（`deploy/monitoring/prometheus.yml`）：所有角色同一個 job `api`，`api-realtime`、`api-worker` 的目標另帶 `role` 標籤。
- **優雅關閉**（§7 D13）：收到 `SIGTERM` 後 readiness 回 503、WebSocket 不收新連線並在排空期內分批關閉傳輸，等 `SHUTDOWN_DRAIN_SECONDS`
  （compose 單體 0、多實例與 k8s 10）後才關 HTTP server 與各模組；背景工作最多再等 30 秒。容器的 `stop_grace_period`／`terminationGracePeriodSeconds` 要大於兩者之和。
- **滾動部署的前提**：migration 對上一版相容。CI 掃描新增的 migration，破壞性語句要有 `-- breaking-ok:`（§7 D14，[`backend/02-database.md`](./backend/02-database.md) §5.1）。
- **連線預算**乘上程序數，依角色調小各自的池（[`backend/02-database.md`](./backend/02-database.md) §6.2）；程序數 ≥ 2 且活躍的租戶多時在前面加 PgBouncer。

**仍然不拆成獨立服務的東西**：

| 想拆出來的東西            | 現在不拆的理由                                                               | 拆的前提                                                                 |
| ------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| 業務模組各自成為服務（各自的 codebase 與資料庫） | 業務呼叫在同一個交易裡（稽核、outbox）；拆開就是分散式交易，授權每次多一跳；每個租戶一個 database 已經是資料層的隔離（§7 D1） | 某個模組要給本平台以外的系統用，且負載或發版節奏明顯不同 |
| auth 獨立（後端）服務     | 每個請求都要驗 token 與權限；拆開就是每個請求多一跳。有了第二個產品之後只拆了 **前端**（`apps/platform`，[`architecture/04-sso.md`](04-sso.md) §12.2 D2），OIDC Provider 仍是 api 的模組 | 身分服務要給本平台以外的系統用，且負載或發版節奏與 api 明顯不同         |
| Redis／Valkey             | 共享計數與程序之間的訊息都由 Postgres 承擔（§7 D10）                          | `RateLimitStore` 的 p99 > 5 ms、平台 DB 的 CPU 因計數 > 60%，或 `NOTIFY` 佇列使用率持續 > 10% |
| 訊息佇列（RabbitMQ、Kafka、NATS） | 入列必須與業務交易一致，pg-boss ＋ outbox 已經做到（§7 D11）            | 持續每秒數百筆以上的工作、跨語言的消費者、事件重播                        |

### 4.4 程序之間的一致性

快取都在各程序的記憶體裡。一個程序寫入之後，先失效本機，再經平台 DB 的 `LISTEN`／`NOTIFY`（`core/broadcast`）通知其他程序
（[`architecture/06-external-api.md`](06-external-api.md) §9.2 D16、D18）。對外 API、之後拆出的 worker、多個 api 執行個體都靠這一層。

| 頻道 | 內容 | 收到時 | 送出的地方 |
| --- | --- | --- | --- |
| `authz_revision` | `{ tenant, revision }`；`{ tenant, features: true }` | revision 比已知新才處理；`features`（租戶啟用的 feature 變了，解析規則可能跟著變）一律處理：整個租戶的權限快取失效、發 `permissions.changed` | `AuthzRevision`（[`backend/05-rbac.md`](./backend/05-rbac.md) §5.1、[`iam/07-groups.md`](./iam/07-groups.md) §8） |
| `user_cache` | `{ tenant, users }`（平台管理者 `tenant: null`；一則最多 150 個 id） | 這些人的使用者快取（狀態、`token_version`）失效 | `UserCacheService.invalidate()`；同一輪的多次失效合併送出 |
| `tenant_directory` | `{}` | 租戶登記整份重新讀（含網域快照） | `TenantDirectory.invalidate()` |
| `file_folder_tree` | `{ tenant }` | 那個租戶的資料夾結構快取作廢 | `FileFolderTree.invalidate()`（[`backend/09-file.md`](./backend/09-file.md) §11.1） |
| `settings` | `{ tenant }` | 那個租戶的系統設定快取作廢 | `SettingService.invalidate()`（[`backend/12-settings.md`](./backend/12-settings.md)） |
| `notification_policy` | `{ tenant }` | 那個租戶的通知政策快取作廢 | `NotificationPolicyService.invalidate()`（[`backend/16-notification-event.md`](./backend/16-notification-event.md) §3） |
| `feature_flags` | `{}` | 全平台層的 feature flag 覆寫重新讀取 | `FeatureFlagService.changed()`（[`05-tenancy.md`](./05-tenancy.md) §11） |
| `api_token_cache` | `{ tenant, tokens }` | 這些 API token 的驗證快取作廢 | `ApiTokenCacheService.invalidate()`（撤銷之後；[`06-external-api.md`](./06-external-api.md) §5） |
| `user_relay` | `{ room, envelope }` | 跨裝置中繼送給本節點那個人的連線 | `RealtimeGateway`（[`backend/08-realtime.md`](./backend/08-realtime.md) §10.3） |
| `domain_event` | 推播類的領域事件 | 在那個租戶的脈絡裡交給本機的推播 | `DomainEventRelay`（[`backend/08-realtime.md`](./backend/08-realtime.md) §7.6） |

- 除了 `authz_revision`，訊息都經 `BroadcastService.channel()` 包上送出的程序 id，**自己送的不會收回來**（本機在送出前已處理過）。
- **不保證送達**：送出失敗只記 log；監聽連線斷線重連時，每個訂閱者丟掉整份快取。各快取原本的 TTL 是最後防線。
- 只送 key，不送資料：`NOTIFY` 的 payload 上限 8000 位元組。

### 4.5 備份、還原與日誌

**要保護的東西**

| 資料 | 位置 | 遺失時 |
| --- | --- | --- |
| postgres | volume `postgres-data`：平台 DB ＋ 每個租戶的 database ＋ DB 角色 | 全部的資料 |
| 物件 | volume `file-storage-data`（每個租戶一個 bucket） | 檔案內容；DB 的紀錄還在，但下載與預覽失敗 |
| 主金鑰 | 環境變數（`deploy/prod.env`）：`TENANT_SECRET_KEY`、`IDP_SECRET_KEY`、`WEBHOOK_SECRET_KEY`、`OIDC_JWKS`、`OIDC_COOKIE_KEYS`、`JWT_SIGNING_KEYS`、`PLATFORM_JWT_SIGNING_KEYS`、`FILE_URL_SIGNING_KEY` | 見下方「主金鑰」 |

無法復原的操作：`trash.purge`（回收桶到期永久刪除）、`pnpm db:drop-tenant --confirm`、`pnpm db:reset`。它們之前的狀態只能從備份拿回來。

**備份**：`sh deploy/backup.sh <輸出目錄>`（在部署目錄執行，排進主機的 cron，例如每天一次），輸出到 `<輸出目錄>/<UTC 時間>/`：

- `globals.sql`：DB 角色與密碼雜湊（`pg_dumpall --globals-only`）。租戶 DB 角色的密碼是佈建時隨機產生的，只存在平台 DB 的加密連線字串裡，
  所以角色要跟著備份，還原後連線字串才仍然有效。
- `<database>.dump`：平台 DB 與每個租戶的 database 各一份 `pg_dump -Fc`，對應「每個租戶可以單獨還原」的設計（[`05-tenancy.md`](./05-tenancy.md) §10.2）。
- `files.tar.gz`：file-storage 的 volume，在 DB 之後才打包。多出來、沒有紀錄的物件由檔案維護排程清掉
  （[`backend/09-file.md`](./backend/09-file.md) §9 #3）；反過來的話 DB 會指向不存在的物件。
- 輸出目錄要再複製到主機以外（另一個帳號的物件儲存、加密）。需要時間點還原（PITR）時改用 WAL 封存，這份腳本只做每日的邏輯備份。

**還原**（整台主機重建；同一份 `deploy/prod.env`，金鑰必須相同）：

1. 只啟動 postgres（空的 volume）：`docker compose --env-file deploy/prod.env -f docker-compose.prod.yml up -d postgres`。
   初始化腳本會建立三個角色與兩個空的 database。
2. 還原角色：`… exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres' < globals.sql`。已存在的角色會報 `already exists`，
   接著的 `ALTER ROLE` 仍會把密碼換回備份裡的值。
3. 每個 dump：初始化腳本已建立的平台 DB 與預設租戶 DB 以 `pg_restore -d <database>` 還原到既有的 database，其他租戶以
   `pg_restore --create -d postgres` 連同 database 一起建立（以超級使用者執行，擁有者會是原本的租戶角色）。
4. 還原檔案：`… run --rm --no-deps -T --entrypoint tar file-storage -xzf - -C /data < files.tar.gz`。
5. `up -d` 啟動其餘服務；`migrate` 照常執行（冪等）。確認平台與至少一個租戶都能登入、檔案能下載。

單獨還原一個租戶：把那個租戶的 database 改名保留（`ALTER DATABASE … RENAME TO …`），以 `pg_restore --create` 還原，再重新啟動 api（清掉連線池）。
檔案的 bucket 在 `files.tar.gz` 裡是 `<bucket>/` 子目錄，只解開那一個。

**主金鑰**：存進秘密管理服務，與資料備份分開保存（備份外洩時金鑰不一起外洩）。各金鑰遺失的後果：

| 金鑰 | 遺失時 |
| --- | --- |
| `TENANT_SECRET_KEY` | 平台 DB 裡所有租戶的連線字串都解不開，所有租戶無法服務。要以超級使用者替每個租戶角色重設密碼，再以新的金鑰加密新的連線字串寫回 `tenants.database_url_encrypted`（沒有現成的工具，要寫一次性的腳本，用 `SecretBox` 的 `TENANT_SECRET_PURPOSE`） |
| `IDP_SECRET_KEY`、`WEBHOOK_SECRET_KEY` | 外部 IdP 的 client secret、webhook 的簽章密鑰解不開：在畫面上重新輸入 client secret、重新產生 webhook 密鑰 |
| `OIDC_JWKS`、`OIDC_COOKIE_KEYS`、`JWT_SIGNING_KEYS`、`PLATFORM_JWT_SIGNING_KEYS`、`FILE_URL_SIGNING_KEY` | 換一把新的即可：已發出的 ID token、IdP session、access token、縮圖網址失效，使用者重新登入 |

**還原演練**：定期在另一台主機照上面的步驟還原一次，記下日期、備份的時間點、花了多久、遇到的問題。

| 日期 | 範圍 | 結果 |
| --- | --- | --- |
| 2026-10-06 | 本機 Docker（`docker-compose.prod.yml` 整套）：`deploy/backup.sh` → `down -v` → 步驟 1～5。另建一個模擬佈建的租戶（自己的角色與 database）一起演練 | 平台 DB、預設租戶、模擬租戶的資料與檔案都還原；租戶角色以備份前的密碼登入成功；database 的 ACL（`REVOKE … FROM PUBLIC`）保留；`migrate` 冪等通過、`/health/ready` 正常。沒有從畫面登入驗證；正式環境還沒演練過 |

**日誌**：每個服務都以 `json-file` 輪替（`max-size: 50m`、`max-file: 5`，compose 的 `x-logging`），單一服務最多約 250 MB。
nginx 的存取日誌與 api 的 pino 日誌每個請求一筆，不輪替會塞滿與 volume 同一顆的磁碟，資料庫也會跟著停擺。
需要長期保存時送到集中式日誌系統並設定保留期限；`migrate` 的日誌可能有初始平台管理者的一次性設定連結（1 小時有效）。
`docker inspect <容器> --format '{{.HostConfig.LogConfig}}'` 可以確認設定。

---

## 5. 錯誤與可觀測性

| 面向         | 作法                                                                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 錯誤碼       | 後端回 `{ error: { code, message, details? } }`，`code` 是穩定的 SCREAMING_SNAKE 字串（見 [`backend/03-api-conventions.md`](./backend/03-api-conventions.md) §5） |
| 前端錯誤訊息 | `@b2b-system/web-core/errors` 的 `useErrorMessage()` 把 `code` 對應到已本地化的訊息；沒有對應時退回通用訊息＋顯示 code                                                                |
| Request ID   | `RequestIdMiddleware` 產生 `x-request-id`，出現在回應 header、日誌與稽核紀錄中                                                                                    |
| 結構化日誌   | Pino（JSON）：HTTP 存取日誌與應用程式日誌（`new Logger(Xxx.name)`，進入點以 `app.useLogger()` 接上）共用同一個 Pino。請求內的每一筆都帶 `requestId`（與回應的 `x-request-id`、稽核紀錄相同），應用程式日誌另有 `context`（類別名稱），存取日誌另有 `req`／`res`／`responseTime`；背景工作的日誌沒有 `requestId`。等級：development `debug`、production `info`、test 靜音 |
| 授權失敗     | 每一次 403 都寫入 `audit_logs`（`action = 'authz.denied'`），含缺少的權限鍵                                                                                       |
| 健康檢查     | `GET /health`（liveness）、`GET /health/ready`（平台 DB、物件儲存、背景工作的連線池、event loop 延遲；排空中或平台 DB 連不上回 503，其他失敗回 `degraded`；[`08-monitoring.md`](./08-monitoring.md) §4） |
| 指標         | 每個 api 程序另開 `/metrics`（`METRICS_PORT` 9464／`EXTERNAL_METRICS_PORT` 9465，Prometheus 格式）：依路由的請求與延遲、快取、租戶連線池、交易、背景工作、推播、限流；不帶租戶標籤。見 [`08-monitoring.md`](./08-monitoring.md) §2 |
| Tracing      | OpenTelemetry → Tempo（`OTEL_EXPORTER_OTLP_ENDPOINT` 有值才載入）：HTTP、controller、交易、背景工作、對外連線、物件儲存；span 帶 `b2b.tenant`，日誌帶 `trace_id`。見 [`08-monitoring.md`](./08-monitoring.md) §3 |
| 監控部署     | `docker-compose.monitoring.yml` 疊在正式的 compose 上：Prometheus、Tempo、Grafana（儀表板與告警）、postgres-exporter。見 [`08-monitoring.md`](./08-monitoring.md) §6 |
| 前端錯誤     | 兩個前端以 `@sentry/browser` 送到同源的 `/apm/`，由 `apps/apm-service`（模擬 Sentry API）存檔、以 sourcemap 還原堆疊；錯誤頁可「複製錯誤資訊」（事件 id 或 `requestId`、版本、頁面）。見 [`frontend/19-observability.md`](./frontend/19-observability.md)、[`07-apm-service.md`](./07-apm-service.md) |
| 前端版本     | 產物帶 release（commit），每個請求帶 `x-client-release`，api 的存取日誌記成 `clientRelease` |

---

## 6. 安全基線

| 項目          | 決定                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| 密碼雜湊      | Argon2id，memory 19 MiB / iterations 2 / parallelism 1（OWASP 建議）                                       |
| Access Token  | JWT（HS256 或 RS256），**5 分鐘**，只存記憶體，不進 `localStorage`                                         |
| Refresh Token | 不透明隨機值，**雜湊後**入庫，7 天，每次使用即輪替，**重用偵測 → 整條家族撤銷**                            |
| Cookie        | `HttpOnly; Secure; SameSite=Lax; Path=/api/auth`；一律 host-only（不設 `Domain`），不使用跨域 cookie（[`04-sso.md`](./04-sso.md) §2） |
| CSRF          | refresh 端點是唯一吃 cookie 的端點，額外要求 `x-refresh-request: 1` 自訂標頭（簡單請求無法跨站帶自訂標頭）；會設定 session cookie 的登入、SSO 回呼只接受 JSON（擋登入 CSRF，[`backend/04-auth.md`](./backend/04-auth.md) §2.5） |
| 暴力破解      | 同帳號連續 5 次失敗鎖定 15 分鐘；登入類端點以「帳號 ＋ IP」與 IP 限流（[`backend/03-api-conventions.md`](./backend/03-api-conventions.md) §8） |
| 反提權        | 授予權限／指派角色時檢查「操作者是否持有該權限」                                                           |
| 自我保護      | 使用者不能刪除自己、不能改自己的角色；改自己持有的角色時不能拿掉自己管理角色所需的權限（`ROLE_SELF_LOCKOUT`） |
| SQL injection | Drizzle 參數化查詢；禁止字串拼接 SQL                                                                       |
| 稽核不可變    | `audit_logs` 只有 INSERT 權限的 DB role；無 UPDATE / DELETE                                                |

---

## 7. 設計決策：多實例部署與服務拆分

> 2026-10-08 決定並實作（原提案 `multi-instance`，branch `feat/multi-instance`）。相關：[`06-external-api.md`](./06-external-api.md) §9 T0（失效廣播與事件轉送）、
> [`backend/04-auth.md`](./backend/04-auth.md) §12（`RateLimitStore`）、[`backend/10-jobs.md`](./backend/10-jobs.md) §9（pg-boss）。

### 7.1 背景

api 原本假設一個程序服務所有租戶：HTTP、Socket.io、OIDC Provider、背景工作都寫死在同一個程序，compose 固定單一 `api`，
nginx 的 upstream 與 Prometheus 的 target 都只有一台。部署即全員斷線、背景工作與 API 搶同一個 event loop、沒有滾動部署的可能。
要求：負載低時仍是單體、不浪費資源；以環境變數切換成多實例，能搬到 k8s；不需要伺服器儲存的部分做到 stateless；
Memory Storage、Queue 之類的元件經過分析才引入。

逐檔盤點 `apps/api/src` 的程序內狀態後（§4.3 的表），大部分已經跨程序（快取的失效廣播、推播的轉送、DB 裡的 OIDC 狀態與 MFA challenge、
pg-boss 的排程鎖）。剩下的是：feature flag 的全平台快取只有 TTL、三處速率限制在程序記憶體、`channel.relay` 只到本節點、
影像變體在請求的程序裡產生、開機工作每個程序都做，以及角色寫死。

### 7.2 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **「服務」是同一個映像的部署角色，不是獨立的 codebase**：`APP_ROLES`（`http`、`realtime`、`worker`），預設 `all` | 擴展的需求來自負載的形狀（請求、長連線、背景工作的 CPU），不是業務邊界。業務呼叫在同一個交易裡（稽核、outbox），拆服務就是分散式交易；每個租戶一個 database 已經是資料層的隔離，服務各自一個 DB 會變成「租戶數 × 服務數」。角色化部署也是之後真的拆服務的前置步驟：程序之間只靠 Postgres 溝通 |
| D2 | **對外 API 維持獨立的進入點**，不併進 `APP_ROLES`；compose 改成 `external` profile | 它的 guard 鏈（只認 API token）是刻意的攻擊面分離（[`06-external-api.md`](./06-external-api.md) §9 D9、D10）；不用的部署少跑兩個容器 |
| D3 | **「整個系統做一次」的工作只在 `worker` 角色**：pg-boss 的 worker、排程同步、佇列深度指標、開機時為每個租戶補系統資料夾 | 多個 http／realtime 程序同時開機不必每個都進入每個租戶 DB；`syncSchedules` 會取消本程序設定裡是空字串的排程，只有 worker 做、設定來自同一份 env 才不會在滾動部署時互相覆寫。租戶 schema 的檢查、建立 bucket 維持每個程序做（各自要知道／冪等便宜） |
| D4 | **stateless 的判準**：掛掉或換一台處理時不丟資料、不給錯的結果、共享計數不因實例數改變語意；連線是唯一的例外 | `realtime` 是「有連線、沒有資料」：可以水平擴展、不需要 sticky session、不需要 StatefulSet |
| D5 | **`DEPLOYMENT_MODE=cluster` 的啟動檢查**：`RATE_LIMIT_STORE=memory`、內部 api 沒設 `OIDC_JWKS`／`OIDC_COOKIE_KEYS`（非 production 也檢查）就拒絕啟動 | 忘了設定共享儲存時不要默默變成 N 倍的限流；開發環境沒設 OIDC 金鑰時每個程序各自產生，ID token 換一台就驗不過。standalone 無從得知實例數，不檢查 |
| D6 | **共享速率限制：平台 DB 的 UNLOGGED 表 `rate_limit_counters`**，一條 `INSERT … ON CONFLICT DO UPDATE … RETURNING` 計數；排程 `rateLimit.cleanup` 每分鐘清過期的列。所有限流（`RateLimitGuard`、`LoginThrottle`、對外 API 的兩個 guard、WebSocket handshake）都走 `RateLimitStore`。計數存不了時登入類政策回 `503 AUTH_BUSY`、其他放行 | 不加元件；量級可負擔（§7.4）。UNLOGGED 不寫 WAL，計數當機後清空本來就可以接受。平台 DB 掛了本來就登入不了，但已登入的使用者還能用（租戶 DB 在另一台時） |
| D7 | **WebSocket 每人連線數維持「每個節點」** | 跨節點計算要一張 presence 表與心跳清除，成本與錯誤模式不成比例；它是防濫用，前端每個瀏覽器只有 leader 分頁連線 |
| D8 | **`channel.relay` 經 `core/broadcast`（頻道 `user_relay`）送到其他節點，不裝 Socket.io adapter** | 伺服器端推播已經由事件轉送跨節點，裝 adapter 每則推播會送兩次；外框 ≤ 4 KB 放得進 `NOTIFY` |
| D9 | **影像變體改成背景工作 `file.imageVariants`**（上傳完成的交易內入列） | http 程序不再有 sharp 的 CPU 尖峰；worker 可以給更多 CPU、依佇列深度擴展 |
| D10 | **Memory Storage（Valkey／Redis）這一版不引入**，介面留在 `RateLimitStore`、`BroadcastService`；要加時選 Valkey（BSD 授權、與 Redis 協定相容） | 跨程序的記憶體儲存只有兩個用途，都有 Postgres 的實作。觸發條件：`hit` 的 p99 > 5 ms、計數讓平台 DB 的 CPU > 60%、UNLOGGED 表的 autovacuum 跟不上；`pg_notification_queue_usage()` 持續 > 10% 或廣播每秒數千則。共享的資料快取與 session store 不規劃：本機快取＋失效廣播少一次網路往返，session 本來就在 JWT 與 DB |
| D11 | **Queue 繼續用 pg-boss**，不引入 RabbitMQ／Kafka／NATS | 入列必須與業務交易一致（outbox）；外部佇列要再寫一套 outbox → broker 的搬運。多個 worker 以 `SKIP LOCKED` 分攤，排程有分散式鎖，每租戶的並行上限由 DB 強制。持續每秒數百筆以上、跨語言消費者、事件重播時再評估 NATS JetStream／Kafka |
| D12 | **服務探索**：前端 nginx 的 upstream 以 `server … resolve` 在執行期解析（`deploy/nginx-upstreams.sh` 產生，位址由 `API_UPSTREAM`／`REALTIME_UPSTREAM` 指定）；Prometheus 以 `dns_sd_configs`；程序之間不互相呼叫 | Docker DNS 回傳每個實例的位址；`resolve`（nginx 1.27.3 起開源版支援）保留 upstream 的 keepalive，變數化的 `proxy_pass` 做不到。不需要 service mesh |
| D13 | **優雅關閉與探針**：readiness 在排空中或平台 DB 連不上時回 `503 SERVICE_NOT_READY`，其他依賴的異常仍是 200 ＋ `degraded`；`SIGTERM` 後排空 `SHUTDOWN_DRAIN_SECONDS` 再關閉，WebSocket 在排空期內分批關閉傳輸 | 一個非必要依賴的抖動不該讓所有程序同時被移出服務；分批讓上千條連線不在同一秒重連到其他節點 |
| D14 | **migration 相容的 CI 檢查**：掃描新增的 migration，破壞性語句（`DROP TABLE`／`COLUMN`、`RENAME`、改型別、`SET NOT NULL`、不帶 `DEFAULT` 的 `ADD COLUMN … NOT NULL`）要有 `-- breaking-ok: <理由>` | 滾動部署時新舊兩版程式同時連到新 schema。幾十行、秒級完成，擋下最常見的錯誤 |
| D15 | **k8s 的參考部署用 Kustomize**（`deploy/k8s`：base ＋ `standalone`／`cluster` overlay）；單體與 cluster 之間有「`api` ＋ `api-worker`」的中間階段（仍是 standalone） | `kubectl apply -k` 不需要額外工具，覆寫值用 overlay 就夠；中間階段讓背景工作的 CPU 不影響 API，又不必先準備共享的速率限制 |

### 7.3 評估過的方案

| 方案 | 結論 |
| --- | --- |
| 依業務拆成獨立服務（各自的 repo、資料庫，服務之間以 HTTP／訊息溝通） | 不採用：見 D1 |
| 共享速率限制用 Valkey 的 `INCR` ＋ `PEXPIRE` | 這一版不採用：D10 的升級目標 |
| 本機計數 ＋ 每秒同步到共享儲存（近似） | 不採用為預設：登入延遲與鎖定需要精確計數。D10 的觸發條件出現時，可以只對 `DEFAULT`／`ANONYMOUS` 啟用 |
| 每台的上限除以實例數 | 不採用：程序不知道實例數，自動擴展時上限會跟著變 |
| 裝 `@socket.io/postgres-adapter` | 不採用：見 D8 |
| 以上一版的程式碼對新 schema 跑整合測試（migration 相容） | 不採用：CI 時間翻倍，能抓到的與掃描重疊 |
| Helm chart | 不採用（這一版）：見 D15；要發布給別人安裝時再評估 |
| api 的 initContainer 跑 migration | 不採用：多個 Pod 同時跑會互搶；`migrate` 是部署流程裡的一個 Job |

### 7.4 共享計數的壓測

2026-10-08 在開發機（Docker Desktop、機器另有其他工作，load average ≈ 20）量測：

- 資料庫端（pgbench 在容器內跑同一條 upsert，1,000 個 key ＋ 一成落在 5 個熱門 key）：8 個連線 6,300 次／秒、平均 1.3 ms；32 個連線 17,000 次／秒、平均 1.9 ms。
  約是估算需求（1000 人在線 ≈ 600 次／秒）的 25 倍以上，熱門 key 的列鎖沒有成為瓶頸。
- 從 Node 經 Docker 的埠轉發打（`pnpm --filter @b2b-system/api bench:rate-limit`）：p50 3.7 ms（並行 8），p99 數十到數百 ms——被開發機的負載與埠轉發主導。
- 結論：吞吐量足夠，採用 Postgres。p99 < 5 ms 的門檻要在接近正式的環境（api 與 postgres 在同一個網段、沒有其他負載）重量一次；
  上線後看 `api_rate_limit_store_duration_seconds`，超過即依 D10 換 Valkey。

### 7.5 實作紀錄

| 項目 | 構想 | 實作 | 原因 |
| --- | --- | --- | --- |
| 排空的位置 | 在 Nest 的關閉 hook 裡等 | `core/lifecycle` 的 `enableGracefulShutdown()` 取代 `enableShutdownHooks()`，在訊號處理裡先排空再 `app.close()` | Nest 的關閉順序從 `onModuleDestroy` 開始，沒有「關 HTTP 之前先等」的位置；排空期間推播、廣播都還要運作 |
| WebSocket 的排空 | 分批斷線 | 分批關閉底層傳輸（`socket.conn.close()`），排空中拒絕新的 handshake | `socket.disconnect()` 在客戶端是「伺服器要你走」，Socket.io 不會自動重連 |
| readiness 的 503 | 回 503 | 新錯誤碼 `SERVICE_NOT_READY`（`details.draining`、`details.checks`） | Service 拋 `AppException`、controller 不寫判斷 |
| `JOBS_WORKER_ENABLED` | 移除，由 `APP_ROLES` 決定 | 保留：`worker` 角色裡是否真的執行工作（`false` 只入列，開機工作照做） | 測試與共用 dev DB 的驗證都依賴「不執行工作、其他照舊」 |
| 角色的讀取時機 | `ProcessRoles` provider | `APP_ROLES` 以字串保存、`processRolesOf()` 解析；`app.module.ts` 在 import 時從 `process.env` 讀 | Nest 的模組清單是靜態的，gateway 只要被 import 就會掛上 Socket.io；`./core/config` 先載入時已把 `.env` 寫進 `process.env` |
| `/oidc/*` | `SurfaceGuard` 擋 | OIDC 的 middleware 自己判斷：沒有 `http` 角色就交回 Nest（404） | `/oidc/*` 是 middleware，不經全域 guard |
| 計數存不了時的錯誤碼 | 503 | 沿用 `AUTH_BUSY`（`retryAfterSeconds`） | 前端已經會倒數並停用送出鈕（[`backend/04-auth.md`](./backend/04-auth.md) §12 D7） |
| 共享計數的壓測 | k6 對整個 api | `scripts/bench-rate-limit-store.ts` 直接壓 `hit`，另以 pgbench 量資料庫端 | 門檻定在儲存的延遲；整個 api 的壓測混了其他成本 |
| 剛上傳圖片的推播 | — | 交易後一律先推 `create`，變體好了再推 `update`（拿掉「3 秒內合併成一次」） | 變體在另一個程序產生，http 程序不知道它何時完成 |
| 影像變體的去重 | `exclusive`（以檔案 id） | 不用 `exclusive`；後執行的看到不是 `pending` 就結束 | `exclusive` 是每個租戶一筆，會讓同租戶的圖片排隊一張一張做 |
| 依請求轉出其他格式 | — | 仍在 http 程序 | 使用者正在等那張圖 |
| D5 的物件儲存檢查 | `cluster` 時 `FILE_STORAGE_*` 指向 apps/file-storage 要警告 | 沒做 | 小型 cluster 仍可能用單一實例的 file-storage；只寫在 §4.3 |
| nginx 的 upstream | 變數化的 `proxy_pass` 或 `resolve` | 啟動時由 `deploy/nginx-upstreams.sh` 產生 `resolve` 的 upstream（resolver 取自 `/etc/resolv.conf`） | 同一份設定在 compose（127.0.0.11）與 k8s（叢集的 DNS）都能用 |
| compose 的多實例 | 新的 `api-http` 服務 | `api` 本身改成 `http` 角色並設 `deploy.replicas`；`api-realtime`、`api-worker` 以 profile 定義在 `docker-compose.prod.yml`，`docker-compose.cluster.yml` 以 `!reset` 啟用 | 其他服務的 `depends_on: api` 與 nginx 的預設 upstream 不必改 |
| k8s 的驗證 | CI 以 kind 起叢集、經 Ingress 打 `/api/health/ready` | `deploy/check-k8s.sh`：kustomize 產生 ＋ kubeconform（strict）；行為由 `deploy/smoke-test.sh --cluster` 驗證 | 沒有能在本機先驗證的 kind 環境，不加一個驗證不了的 CI job；角色、探針與排空的行為已由 compose 的多實例驗證 |
| 多實例的 E2E | Playwright：api ×2、realtime ×2、worker ×1，滾動重啟期間不失敗 | 整合測試（`test/cross-process.spec.ts`：兩個程序之間的失效、推播、跨裝置中繼；`test/shared-rate-limit.spec.ts`；`test/process-roles.spec.ts`）＋ `deploy/smoke-test.sh --cluster` | Playwright 對多實例的整套環境沒有做；滾動重啟的行為由排空的單元測試與 readiness 的整合測試涵蓋 |
