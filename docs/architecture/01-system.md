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
│ apps/api  (NestJS 11)                                               │
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
│  core/     database(Drizzle) · config · cache · logger · errors     │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ SQL (postgres-js / node-postgres)
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│ PostgreSQL 17                                                       │
│   users · roles · permissions · user_roles · role_permissions       │
│   refresh_tokens · audit_logs                                       │
└─────────────────────────────────────────────────────────────────────┘
```

**登入不在 backstage**：`apps/auth` 是全平台共用、不分工作區的前端（獨立的 origin），`apps/api` 當 OIDC Provider。
backstage 以授權碼 ＋ PKCE 跳到 apps/auth 登入，再以自己 origin 的 `/api/auth/sso/callback` 換成上圖的 app session。
平台層級的頁面（租戶、外部 IdP 連線、帳號流程）也在 apps/auth。見 [`04-sso.md`](./04-sso.md)。

---

## 2. 相依方向（不可違反）

### 前端

```
features/  ──▶  apis/  ──▶  core/client
    │             │
    │             └──▶  packages/api-sdk
    ├──▶  components/  ──▶  Base UI
    ├──▶  core/        （permission · router · cache · errors · locales）
    └──▶  shared/      （純工具，不得反向依賴 core 或 features）

app/  ──▶  features/    （只組裝，不實作業務）
core/  ✗──▶ features/   （核心永遠不認識功能）
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
[backstage] /auth/login → 頂層跳轉 → {apps/auth}/api/oidc/auth?client_id=backstage&code_challenge=…&state=…
  [api] oidc-provider：沒有 IdP session → apps/auth /interaction/:uid
[apps/auth] 互動頁 └─▶ POST /oidc-interaction/:uid/login { email, password }（或導向外部 IdP）
        [api] AuthService.verifyCredentials
                ├─ UserRepository.findByEmail          (citext 比對)
                ├─ argon2.verify(password_hash, pw)
                ├─ 檢查 status = 'active'、失敗次數 / 鎖定、只允許 SSO 的網域
                └─ 寫入 audit_logs (auth.login.success)
        ◀── { redirectTo }（頁面頂層跳轉 → provider 建立 IdP session → 303 backstage /auth/callback?code&state）
[backstage] /auth/callback
  └─▶ POST /auth/sso/callback { code, codeVerifier, clientId, redirectUri }
        [api] 本程序內兌換授權碼（PKCE）
                ├─ 簽發 access token  (JWT, 5 min, 僅含 sub/jti/ver/sid)
                └─ 產生 refresh token (opaque 隨機 256-bit，雜湊後入庫，記 client_id、idp_session_uid)
        ◀── 200 { accessToken, expiresIn, tokenType }
            Set-Cookie: refresh_token=…; HttpOnly; Secure; SameSite=Lax; Path=/api/auth（backstage 的 host-only cookie）
  ◀─ SessionStore.setTokens()  （access token 只存在記憶體閉包）
  └─▶ GET /auth/profile
        ◀── 200 { user, roles[], permissions: PermissionKey[] }
  └─▶ usePermissionStore.setPermissions(permissions)   ← 權限集合水合完成
  └─▶ router.history.replace(returnTo)
```

已有 IdP session 時（例：先在 apps/auth 登入過），provider 直接帶授權碼跳回，不出現登入頁。細節見 [`04-sso.md`](./04-sso.md) §3。

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
                                  → 集合是否包含 'role:update'？否 → 403
              ZodValidationPipe   body 驗證
              RolesController.update
                └─ RolesService.update
                     ├─ 系統角色保護檢查（is_system → 403）
                     ├─ 反提權檢查（若變更權限）
                     ├─ RoleRepository.update ＋ AuditService.record('role.update', diff)（交易內）
                     ├─ PermissionService.invalidateUsers(holders)（交易後；holders 在交易前查出）
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
| 後端授權判斷 | `PermissionCacheService`（in-memory，TTL 60s）＋ 角色/指派變更時 **主動失效**                   | 主動失效 < 1s；漏網情況 ≤ 60s |
| Access Token | **不內嵌權限**（只有 `sub`、`jti`、`ver`）→ 不會有 token 內的陳舊權限                           | 不適用                        |
| 前端 UI      | 伺服器推 `resource.changed`（`userRole` / `role` / `rolePermission`）→ 依賴圖衍生失效 `PROFILE` → 重抓 `GET /auth/profile`；推播斷線時退回：登入後、window focus 時、每 5 分鐘重新取得 | 推播 < 1s；斷線時 ≤ 5 min |
| 強制登出     | 使用者被停用或刪除 → `users.token_version` +1 → 推 `session.revoked` 並斷線；既存 access token 驗簽時因 `ver` 不符而失效 | 推播 < 1s；否則下一次請求 |

推播的設計見 [`backend/08-realtime.md`](./backend/08-realtime.md)、[`frontend/11-realtime.md`](./frontend/11-realtime.md)。

> **關鍵取捨**：access token 不帶權限，代表每次請求都要解析權限集合。這是用
> 一次快取查詢換取「權限變更立即生效」。見
> [ADR-0005](../adr/0005-permission-resolved-server-side.md)。

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
└─ apps/auth          vite                     (localhost:5175，IdP 的 origin)
                        └─ proxy /api     → http://localhost:3000
```

外部 IdP 登入的開發與 E2E 另外跑 `pnpm dev:mock-idp`（localhost:4455）。

前端一律透過 `/api` 前綴打到 Vite dev proxy，**不在程式碼裡寫死後端位址**，
production 由反向代理負責同源。這讓 refresh token cookie 可以是同源的
`httpOnly` cookie，不需要 CORS credentials 的複雜度。

### 4.2 Production（`docker-compose.prod.yml`）

```
                         ┌──────────────────────────────┐
  Internet ─────────────▶│ backstage（nginx） :8080 → 80│  network: edge
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
| `postgres` | `postgres:17-alpine`          | 唯一的狀態儲存                                       | —                               |
| `migrate`  | `b2b-system-api`（同 api）   | `migrate.js` ＋ `seeds/index.js`，跑完即結束         | postgres healthy                |
| `api`      | `b2b-system-api`             | REST、Socket.io、權限快取                            | migrate **成功結束**、file-storage healthy |
| `file-storage` | `apps/file-storage/Dockerfile` | S3 相容的物件儲存（[`03-file-storage.md`](./03-file-storage.md)） | —                     |
| `backstage` | `apps/backstage/Dockerfile`（nginx）| 靜態檔、反向代理、安全標頭                 | api healthy                     |
| `auth`     | `apps/auth/Dockerfile`（nginx，`deploy/nginx.auth.conf`）| 身分與租戶入口：**獨立的 origin**（`:8081`），`/api/*` 同樣反向代理到 api | api healthy |

- 前端是純靜態產物，SPA fallback 到 `index.html`。SSO 的網址（`VITE_OIDC_ISSUER`、`VITE_AUTH_APP_URL`）是建置參數，
  由 `AUTH_PUBLIC_ORIGIN` 產生；api 另需 `OIDC_JWKS`、`OIDC_COOKIE_KEYS`、`IDP_SECRET_KEY`（[`04-sso.md`](./04-sso.md) §7）。
- `/api/*` 反向代理去掉前綴後轉給 NestJS；`/api/socket.io/` 另一段 location 帶 `Upgrade` header，
  `proxy_read_timeout` 大於 Socket.io 心跳間隔。
- **網路分三段**：`backstage` 只在 `edge`，碰不到 `postgres`；`migrate` 只在 `data`；`file-storage` 在 `edge` 與 `storage`，
  碰不到 `postgres`。
- `/storage/` 的 location **不去掉前綴、原樣轉發 `Host`**、不緩衝、不限大小：瀏覽器以 presigned URL 直傳／下載，
  簽章涵蓋 host 與完整路徑（[`backend/09-file.md`](./backend/09-file.md) §3）。同源，所以 CSP 不必放寬。
  換成真正的 S3 時拿掉 `file-storage` 服務，改 api 的 `FILE_STORAGE_*` 即可。
- `migrate` 與 `api` 共用映像：部署時 schema 一定先於新版程式就位，api 不在啟動時自己跑 migration
  （多執行個體時會互搶）。
- CSP：`default-src 'self'`，不允許 inline script（Vite build 產物符合）；`connect-src 'self'` 同時涵蓋同源的 `wss:`。
- TLS 由前面的 LB / ingress 終結；`PUBLIC_ORIGIN` 設成瀏覽器看到的 origin，作為 Socket.io 的 Origin 白名單。
- api 設 `TRUST_PROXY=uniquelocal`：只信任私有網段（nginx）帶來的 `X-Forwarded-For`，
  HTTP 與 WebSocket 的每 IP 限流才看得到真實客戶端；外部自帶的標頭無法偽造 IP。

### 4.3 為什麼不拆成更多服務，以及何時要拆

Phase 0 是 **模組化單體**：`modules/` 之間只透過 exports 的 service 互動，將來要拆有清楚的邊界，
但現在拆只會多出網路呼叫與分散式交易。必須存在的服務只有上表六個；`file-storage` 是可替換的基礎設施
（等同 S3），不是業務服務。

| 想拆出來的東西            | 現在不拆的理由                                                               | 拆的前提                                                                 |
| ------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Socket.io 獨立成 realtime 服務 | 推播必須在寫入交易之後、由同一個 service 觸發；拆開就要一條可靠的事件匯流排 | 有了 outbox 或 `LISTEN/NOTIFY` 事件流；連線數大到影響 REST 的延遲        |
| auth 獨立（後端）服務     | 每個請求都要驗 token 與權限；拆開就是每個請求多一跳。有了第二個產品之後只拆了 **前端**（`apps/auth`，[ADR-0019](../adr/0019-sso-identity-platform.md) D2），OIDC Provider 仍是 api 的模組 | 身分服務要給本平台以外的系統用，且負載或發版節奏與 api 明顯不同         |
| Redis                     | 快取與 room 都在單一程序的記憶體裡就夠                                       | 見下一段；Postgres `LISTEN/NOTIFY` 能滿足時仍不需要                      |

**api 水平擴展（`replicas > 1`）要同時具備三件事**，缺一就會出錯，所以 compose 目前固定單一執行個體：

1. Socket.io 跨節點廣播：`@socket.io/postgres-adapter`（[`backend/08-realtime.md`](./backend/08-realtime.md) §10.3）。
2. 權限／使用者快取跨節點失效：同一條 `LISTEN/NOTIFY`（[`backend/05-rbac.md`](./backend/05-rbac.md) §5.2）。
   否則某節點上被拿掉權限的人，最多還能用 60 秒。
3. nginx 的 upstream 要能看到每個執行個體（`resolver 127.0.0.11` ＋ 變數化的 `proxy_pass`，或改用 LB）；
   Socket.io 只用 websocket 傳輸，**不需要** sticky session。

---

## 5. 錯誤與可觀測性

| 面向         | 作法                                                                                                                                                              |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 錯誤碼       | 後端回 `{ error: { code, message, details? } }`，`code` 是穩定的 SCREAMING_SNAKE 字串（見 [`backend/03-api-conventions.md`](./backend/03-api-conventions.md) §5） |
| 前端錯誤訊息 | `core/errors/useErrorMessage.ts` 把 `code` 對應到已本地化的訊息；沒有對應時退回通用訊息＋顯示 code                                                                |
| Request ID   | `RequestIdMiddleware` 產生 `x-request-id`，出現在回應 header、日誌與稽核紀錄中                                                                                    |
| 結構化日誌   | Pino（JSON），欄位含 `requestId` / `userId` / `route` / `durationMs` / `statusCode`                                                                               |
| 授權失敗     | 每一次 403 都寫入 `audit_logs`（`action = 'authz.denied'`），含缺少的權限鍵                                                                                       |
| 健康檢查     | `GET /health`（liveness）、`GET /health/ready`（含 DB ping）                                                                                                      |

---

## 6. 安全基線

| 項目          | 決定                                                                                                       |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| 密碼雜湊      | Argon2id，memory 19 MiB / iterations 2 / parallelism 1（OWASP 建議）                                       |
| Access Token  | JWT（HS256 或 RS256），**5 分鐘**，只存記憶體，不進 `localStorage`                                         |
| Refresh Token | 不透明隨機值，**雜湊後**入庫，7 天，每次使用即輪替，**重用偵測 → 整條家族撤銷**                            |
| Cookie        | `HttpOnly; Secure; SameSite=Lax; Path=/api/auth`；一律 host-only（不設 `Domain`），不使用跨域 cookie（[`04-sso.md`](./04-sso.md) §2） |
| CSRF          | refresh 端點是唯一吃 cookie 的端點，額外要求 `x-refresh-request: 1` 自訂標頭（簡單請求無法跨站帶自訂標頭） |
| 暴力破解      | 同帳號連續 5 次失敗鎖定 15 分鐘；同 IP 速率限制（`@nestjs/throttler`）                                     |
| 反提權        | 授予權限／指派角色時檢查「操作者是否持有該權限」                                                           |
| 自我保護      | 使用者不能刪除自己、不能移除自己最後一個具 `role:update` 的角色                                            |
| SQL injection | Drizzle 參數化查詢；禁止字串拼接 SQL                                                                       |
| 稽核不可變    | `audit_logs` 只有 INSERT 權限的 DB role；無 UPDATE / DELETE                                                |
