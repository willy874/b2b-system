# 系統架構

## 1. 全貌

```
┌─────────────────────────────────────────────────────────────────────┐
│ Browser                                                             │
│                                                                     │
│  apps/web  (React 19 + Vite)                                        │
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
[web] LoginPage
  └─▶ POST /auth/login { email, password }
        [api] AuthController.login
          └─▶ AuthService.login
                ├─ UserRepository.findByEmail          (citext 比對)
                ├─ argon2.verify(password_hash, pw)
                ├─ 檢查 status = 'active'
                ├─ 失敗次數 / 鎖定檢查
                ├─ 簽發 access token  (JWT, 5 min, 僅含 sub/jti/ver)
                ├─ 產生 refresh token (opaque 隨機 256-bit，雜湊後入庫)
                └─ 寫入 audit_logs (auth.login.success)
        ◀── 200 { accessToken, expiresIn, tokenType }
            Set-Cookie: refresh_token=…; HttpOnly; Secure; SameSite=Lax; Path=/auth
  ◀─ SessionStore.setTokens()  （access token 只存在記憶體閉包）
  └─▶ GET /auth/profile
        ◀── 200 { user, roles[], permissions: PermissionKey[] }
  └─▶ usePermissionStore.setPermissions(permissions)   ← 權限集合水合完成
  └─▶ router.navigate('/')
```

### 3.2 一次受權限保護的寫入

```
[web] RoleDetailPage → 「儲存」
  └─▶ useMutation(getRoleUpdateMutationOptions())
        └─▶ fetchRoleUpdateMutation (apis/role/update-role/fetcher.ts)
              └─▶ defineAuthFetcher → HttpContext('auth')
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
                     ├─ RoleRepository.update（交易內）
                     ├─ PermissionCache.invalidateByRole(roleId)
                     └─ AuditService.record('role.update', diff)
        ◀── 200 { data: Role }

  ◀─ onSuccess → queryClient.invalidateQueries(['ROLE_DETAIL', id])
                 → BroadcastChannel 通知其他分頁同步失效
```

### 3.3 權限變更如何傳到已登入的使用者

這是 RBAC 最容易出錯的地方，明確定義如下：

| 層           | 機制                                                                                            | 最壞延遲                      |
| ------------ | ----------------------------------------------------------------------------------------------- | ----------------------------- |
| 後端授權判斷 | `PermissionCacheService`（in-memory，TTL 60s）＋ 角色/指派變更時 **主動失效**                   | 主動失效 < 1s；漏網情況 ≤ 60s |
| Access Token | **不內嵌權限**（只有 `sub`、`jti`、`ver`）→ 不會有 token 內的陳舊權限                           | 不適用                        |
| 前端 UI      | `GET /auth/profile` 於：登入後、路由切換回首頁時、`window` focus 時、以及每 5 分鐘重新取得      | ≤ 5 min                       |
| 強制登出     | 使用者被停用或刪除 → `users.token_version` +1 → 所有既存 access token 驗簽時因 `ver` 不符而失效 | 下一次請求                    |

> **關鍵取捨**：access token 不帶權限，代表每次請求都要解析權限集合。這是用
> 一次快取查詢換取「權限變更立即生效」。見
> [ADR-0005](../adr/0005-permission-resolved-server-side.md)。

---

## 4. 部署拓撲

### 4.1 本機開發

```
pnpm dev
├─ docker compose up -d postgres        (localhost:5432)
├─ apps/api    nest start --watch       (localhost:3000)
└─ apps/web    vite                     (localhost:5173)
                 └─ proxy /api → http://localhost:3000
```

前端一律透過 `/api` 前綴打到 Vite dev proxy，**不在程式碼裡寫死後端位址**，
production 由反向代理負責同源。這讓 refresh token cookie 可以是同源的
`httpOnly` cookie，不需要 CORS credentials 的複雜度。

### 4.2 Production

```
                   ┌──────────────┐
  Internet ───────▶│  Nginx / LB  │
                   └──────┬───────┘
                          │ 同一個 origin
            ┌─────────────┴─────────────┐
            │                           │
     /  → 靜態檔                   /api/* → apps/api
     (apps/web 的 dist)            (Node 程序 / 容器)
                                         │
                                         ▼
                                   PostgreSQL
```

- 前端是純靜態產物，SPA fallback 到 `index.html`。
- `/api/*` 反向代理去掉前綴後轉給 NestJS。
- CSP：`default-src 'self'`，不允許 inline script（Vite build 產物符合）。

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
| Cookie        | `HttpOnly; Secure; SameSite=Lax; Path=/auth`                                                               |
| CSRF          | refresh 端點是唯一吃 cookie 的端點，額外要求 `x-refresh-request: 1` 自訂標頭（簡單請求無法跨站帶自訂標頭） |
| 暴力破解      | 同帳號連續 5 次失敗鎖定 15 分鐘；同 IP 速率限制（`@nestjs/throttler`）                                     |
| 反提權        | 授予權限／指派角色時檢查「操作者是否持有該權限」                                                           |
| 自我保護      | 使用者不能刪除自己、不能移除自己最後一個具 `role:update` 的角色                                            |
| SQL injection | Drizzle 參數化查詢；禁止字串拼接 SQL                                                                       |
| 稽核不可變    | `audit_logs` 只有 INSERT 權限的 DB role；無 UPDATE / DELETE                                                |
