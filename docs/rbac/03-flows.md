# RBAC 03 — 流程

本文件用序列圖描述每一條關鍵路徑。所有「檢查」步驟在實作時都必須有對應的測試。

---

## 1. 登入

```
使用者        apps/backstage                 apps/api                      DB
  │              │                        │                           │
  │─ 輸入帳密 ──▶│                        │                           │
  │              │─ POST /auth/login ────▶│                           │
  │              │                        │─ findByEmail(citext) ────▶│
  │              │                        │◀── user | null ───────────│
  │              │                        │                           │
  │              │                     ┌──┴─────────────────────────┐ │
  │              │                     │ 1. user 存在？             │ │
  │              │                     │ 2. locked_until > now？    │ │
  │              │                     │ 3. status = 'active'？     │ │
  │              │                     │ 4. argon2.verify(pw)？     │ │
  │              │                     └──┬─────────────────────────┘ │
  │              │                        │                           │
  │              │                    失敗 │─ failed_login_count+1 ──▶│
  │              │                        │  （達 5 次 → locked 15m） │
  │              │                        │─ audit(auth.login.failure)│
  │              │◀── 401 AUTH_INVALID ───│                           │
  │              │    （訊息不區分帳號不存在/密碼錯）                   │
  │              │                        │                           │
  │              │                    成功 │─ failed_login_count = 0 ▶│
  │              │                        │─ last_login_at = now ────▶│
  │              │                        │─ INSERT refresh_tokens ──▶│
  │              │                        │   (family_id = new uuid)  │
  │              │                        │─ audit(auth.login.success)│
  │              │◀── 200 + Set-Cookie ───│                           │
  │              │                        │                           │
  │              │─ SessionStore.setTokens(accessToken, expiresIn)     │
  │              │                        │                           │
  │              │─ GET /auth/profile ───▶│                           │
  │              │                        │─ 解析權限集合 ───────────▶│
  │              │◀── { user, roles, permissions[] } ─────────────────│
  │              │                        │                           │
  │              │─ usePermissionStore.setPermissions(permissions)     │
  │              │─ i18n.changeLanguage(user.preferences.locale)       │
  │              │─ navigate('/')                                      │
  │◀── 首頁 ─────│                        │                           │
```

**回應載荷**

```jsonc
// POST /auth/login → 200
{
  "data": {
    "accessToken": "eyJhbGciOi...",
    "tokenType": "Bearer",
    "expiresIn": 300,
  },
}
// Set-Cookie: refresh_token=<opaque>; HttpOnly; Secure; SameSite=Lax; Path=/auth; Max-Age=604800
```

```jsonc
// GET /auth/profile → 200
{
  "data": {
    "user": {
      "id": "0192...",
      "email": "admin@example.com",
      "displayName": "Admin",
      "status": "active",
      "preferences": { "locale": "zh-TW", "timezone": "Asia/Taipei" },
    },
    "roles": [{ "id": "...", "slug": "admin", "name": "系統管理員" }],
    "permissions": ["user:create", "user:read", "role:read", "..."],
  },
}
```

**安全要點**

- 帳號不存在與密碼錯誤 **回傳相同的錯誤碼與相同的回應時間**（對不存在的帳號也
  執行一次 dummy argon2 驗證），避免帳號列舉。
- `status = 'pending'` 回 `AUTH_ACCOUNT_PENDING`（這個可以區分，因為使用者需要
  知道要去收啟用信）；`inactive` / `locked` 回 `AUTH_ACCOUNT_DISABLED` / `AUTH_ACCOUNT_LOCKED`。

---

## 2. Access Token 續期（含跨分頁協調）

```
分頁 A                    SessionStore               分頁 B
  │                           │                        │
  │─ 需要發請求 ─────────────▶│                        │
  │                    ┌──────┴──────────────────┐     │
  │                    │ ensureAccessToken()     │     │
  │                    │  剩餘壽命 > 30s？        │     │
  │                    │   是 → 直接回傳          │     │
  │                    │   否 → 往下              │     │
  │                    │  已有 in-flight refresh？│     │
  │                    │   是 → 共用那個 promise  │     │
  │                    └──────┬──────────────────┘     │
  │                           │                        │
  │                           │─ navigator.locks ─────▶│ 取得續期鎖（B 在此排隊）
  │                           │                        │
  │                           │─ POST /auth/refresh    │
  │                           │  Cookie: refresh_token │
  │                           │  x-refresh-request: 1  │
  │                           │                        │
  │                           │◀─ 200 新 accessToken   │
  │                           │   Set-Cookie 新 refresh│
  │                           │                        │
  │                           │─ BroadcastChannel ────▶│ 「新 token 在這」
  │                           │─ 釋放鎖                │─ 拿到鎖時 token 已新鮮 → 直接採用
  │◀── accessToken ───────────│                        │
```

**後端 `POST /auth/refresh` 的判定**

```
收到 refresh token
  │
  ├─ 雜湊後查 refresh_tokens
  │    └─ 查無 → 401 AUTH_REFRESH_INVALID
  │
  ├─ revoked_at IS NOT NULL，或同家族有任一列已撤銷 → 401 AUTH_REFRESH_REVOKED
  │
  ├─ expires_at < now       → 401 AUTH_REFRESH_EXPIRED
  │
  ├─ used_at IS NOT NULL    → ★ 重用偵測
  │    ├─ UPDATE refresh_tokens SET revoked_at = now,
  │    │         revoked_reason = 'reuse_detected'
  │    │   WHERE family_id = <該家族>
  │    ├─ audit(auth.refresh.reuse_detected)  ← 高風險事件
  │    └─ 401 AUTH_REFRESH_REUSED
  │
  └─ 正常 → 交易內：
       ├─ UPDATE 舊列 SET used_at = now
       │    WHERE used_at IS NULL AND revoked_at IS NULL
       │    └─ 0 列（併發請求搶先）→ 已撤銷回 REVOKED，否則同上 ★ 重用偵測
       ├─ INSERT 新列（同 family_id）
       ├─ 檢查 user.status 仍為 active、token_version 未變
       └─ 簽發新 access token
```

> **為什麼要跨分頁協調**：refresh token 是輪替的。兩個分頁同時拿同一個舊 token
> 去續期，第二個會被判定為「重用」，整條家族被撤銷，使用者被登出。
> Web Locks 讓同一瀏覽器的分頁依序續期，後一個拿到鎖時用的已經是新 cookie。

---

## 3. 授權檢查（每個受保護請求）

```
HTTP Request
  │
  ▼
RequestIdMiddleware       產生 x-request-id
  │
  ▼
JwtAuthGuard
  ├─ @Public？ → 放行
  ├─ 取 Authorization: Bearer → 驗簽
  │    失敗 → 401 AUTH_TOKEN_INVALID
  ├─ 讀 payload { sub, ver, jti, tid }（tid 要等於網域決定的租戶）
  ├─ 載入 user（快取 30s）
  │    ├─ 不存在 / deleted_at → 401 AUTH_TOKEN_INVALID
  │    ├─ status ≠ active     → 403 AUTH_ACCOUNT_DISABLED
  │    └─ ver ≠ user.token_version → 401 AUTH_TOKEN_STALE（被強制登出）
  └─ request.user = { id, email, status }
  │
  ▼
PermissionsGuard
  ├─ Reflector 讀 @RequirePermissions([...keys], match)
  │    無宣告 → ★ 預設拒絕？放行？
  │      → 見下方「預設策略」
  ├─ PermissionService.getPermissionSet(userId)
  │    ├─ 命中 cache（key = `${tenantId}:${userId}`，TTL 60s）→ 回傳
  │    └─ miss → 一次 SQL 解析 → 寫入 cache
  ├─ super-admin？ → 放行
  ├─ match = EVERY → keys.every(k => set.has(k))
  │  match = SOME  → keys.some(k => set.has(k))
  └─ 不通過 →
       ├─ audit(authz.denied, { required: keys, missing: [...] })
       └─ 403 AUTHZ_FORBIDDEN
  │
  ▼
ZodValidationPipe → Controller → Service → Repository
```

### 3.1 預設策略：**預設拒絕**

`PermissionsGuard` 對 **沒有任何宣告** 的 handler 的處理：

- 若 handler 或 controller 標了 `@Public()` → 放行（未登入亦可）。
- 若標了 `@Authenticated()` → 只要通過 `JwtAuthGuard` 即可（用於個人範圍端點）。
- **兩者都沒有 → 拋 500 `ROUTE_PERMISSION_NOT_DECLARED`**。

這個「忘記宣告就爆炸」的設計是刻意的：它讓「漏掉權限檢查」在開發期就被發現，
而不是上線後才變成資安事件。啟動時另有一個 **路由稽核**（見
[`../architecture/backend/05-rbac.md`](../architecture/backend/05-rbac.md) §7）掃描所有註冊的路由，
任何未宣告的路由讓程序啟動失敗。

---

## 4. 建立角色並授予權限（含反提權）

```
管理員         apps/backstage                       apps/api
  │               │                              │
  │─ 進入 /role ─▶│                              │
  │               │  usePagePermission(ROLE_PAGE)
  │               │  canCreate = can('role:create')
  │               │  → 「建立角色」按鈕才顯示
  │               │                              │
  │─ 點建立 ─────▶│                              │
  │               │─ GET /permissions ──────────▶│ 需要 permission:read
  │               │◀── 全部 15 筆權限目錄 ────────│
  │               │                              │
  │               │  ★ 前端反提權過濾：
  │               │     可勾選項 = 目錄 ∩ 我的權限集合
  │               │     （其餘顯示為 disabled ＋ 提示）
  │               │                              │
  │─ 勾選 + 送出 ▶│                              │
  │               │─ POST /roles ───────────────▶│ 需要 role:create
  │               │  { name, description,        │
  │               │    permissionKeys: [...] }   │
  │               │                              │
  │               │                    ┌─────────┴──────────────────────┐
  │               │                    │ 交易開始                        │
  │               │                    │ 1. name 未被使用？              │
  │               │                    │    否 → 409 ROLE_NAME_DUPLICATE │
  │               │                    │ 2. permissionKeys 全部存在？    │
  │               │                    │    否 → 400 PERMISSION_UNKNOWN  │
  │               │                    │ 3. ★ 反提權：                   │
  │               │                    │    keys ⊆ actor 權限集合？      │
  │               │                    │    （super-admin 豁免）         │
  │               │                    │    否 → 403 AUTHZ_ESCALATION    │
  │               │                    │ 4. INSERT roles                 │
  │               │                    │ 5. INSERT role_permissions[]    │
  │               │                    │ 6. audit(role.create, {...})    │
  │               │                    │ 交易提交                        │
  │               │                    └─────────┬──────────────────────┘
  │               │◀── 201 { data: Role } ───────│
  │               │                              │
  │               │─ invalidateResources(role)   │
  │◀── 成功提示 ──│                              │
```

> **前端過濾不是安全機制**，只是體驗。後端的第 3 步才是真正的防線。兩邊都要有。

---

## 5. 變更角色權限 → 生效

```
管理員 移除角色 R 的 'user:delete'
  │
  ▼
PATCH /roles/:id/permissions  { add: [], remove: ['user:delete'] }
  │
  ├─ 檢查 role:grantPermission 權限
  ├─ 檢查 R 不是 super-admin（ROLE_SUPER_ADMIN_IMMUTABLE）
  ├─ 檢查反提權（add 的鍵 ⊆ actor 權限集合）
  ├─ ★ 檢查 I8：若 R 是最後一個帶 super-admin 等效權限的角色 → 拒絕
  ├─ 查出持有 R 的所有 user_id（holders）
  ├─ 交易：DELETE role_permissions WHERE role_id = R AND permission_id IN (...)
  ├─ audit(role.grantPermission, { before, after })
  │
  ▼  交易之後
PermissionService.invalidateUsers(holders)          逐一刪除快取
DomainEventBus.publish(permissions.changed / resource.changed)
  └─ realtime：holders 換 room、收到推播 → 前端重抓 profile（backend/08-realtime.md §7）
  │
  ▼  下一次這些使用者的請求
PermissionsGuard → cache miss → 重新解析 → 不含 'user:delete' → 403
```

**前端何時知道？**

| 觸發點                     | 機制                                                                     |
| -------------------------- | ------------------------------------------------------------------------ |
| 使用者自己重新整理         | `GET /auth/profile` 重新水合權限 store                                   |
| 分頁重新取得焦點           | TanStack Query `refetchOnWindowFocus` 觸發 profile 查詢                  |
| 停在頁面不動               | profile 查詢 `staleTime: 5min` → 最遲 5 分鐘                             |
| 使用者按了一個已失效的按鈕 | 後端回 403 → 全域錯誤處理顯示「權限已變更」toast ＋ 強制重新取得 profile |

最後一項是關鍵的兜底：**UI 與後端不一致時，以後端為準，並立刻自我修正**。

---

## 6. 指派角色給使用者

```
PUT /users/:id/roles  { roleIds: [...] }    ← 整批取代語意，非增量
  │
  ├─ 需要 user:assignRole
  ├─ 檢查 I9：actorId ≠ targetId（不能改自己的角色）→ 403 AUTHZ_SELF_MODIFY
  ├─ 檢查所有 roleId 存在且未刪除
  ├─ ★ 反提權：每個待指派角色的權限集合 ⊆ actor 權限集合
  │     （否則我可以把一個我做不到的角色指派給別人，等同提權）
  ├─ 檢查 I8：若此次操作會移除系統最後一個 super-admin → 403 LAST_SUPER_ADMIN
  ├─ 交易：DELETE user_roles WHERE user_id = :id
  │         INSERT user_roles (新集合)
  ├─ audit(user.assignRole, { before: [...], after: [...] })
  └─ PermissionCacheService.invalidate(userId)
```

---

## 7. 停用 / 刪除使用者 → 強制登出

```
PATCH /users/:id { status: 'inactive' }   或   DELETE /users/:id
  │
  ├─ 需要 user:update / user:delete
  ├─ 檢查 I9：不能停用／刪除自己
  ├─ 檢查 I8：不能是最後一個 super-admin
  ├─ 交易：
  │   ├─ UPDATE users SET status / deleted_at
  │   ├─ ★ UPDATE users SET token_version = token_version + 1
  │   └─ UPDATE refresh_tokens SET revoked_at = now,
  │          revoked_reason = 'user_disabled'
  │      WHERE user_id = :id AND revoked_at IS NULL
  ├─ PermissionCacheService.invalidate(userId)
  ├─ UserCache.invalidate(userId)
  └─ audit(user.update / user.delete)
  │
  ▼
該使用者手上的 access token：
  下一次請求 → JwtAuthGuard 比對 ver ≠ token_version → 401 AUTH_TOKEN_STALE
  refresh token → 已被撤銷 → 401 AUTH_REFRESH_REVOKED
  → 前端 SessionStore 收到終止訊號 → 清空 → 導向登入頁
```

---

## 8. 首次啟用與密碼重設

兩條流程共用同一個 token 機制（單次使用、有期限、雜湊入庫）。

```
① 管理員建立使用者（status = pending，password_hash = NULL）
     └─ 產生 activation token（24h）→ 寄信
② 使用者點連結 {AUTH_APP_URL}/setup?token=xxx（apps/auth 的頁面，docs/architecture/04-sso.md §6.2）
     └─ GET  /auth/setup/verify?token=xxx   → 200 { email } | 400 TOKEN_INVALID
     └─ POST /auth/setup { token, password }
           ├─ 密碼強度檢查（≥ 租戶設定的長度 `auth.passwordMinLength`，至少 12 字元；非常見密碼）
           ├─ argon2 雜湊 → users.password_hash
           ├─ status: pending → active
           ├─ 標記 token 已使用
           └─ audit(user.activate)
③ 忘記密碼 /auth/forgot-password { email }
     └─ ★ 不論 email 是否存在都回 200（避免帳號列舉）
     └─ 存在且 active → 產生 reset token（1h）→ 寄信
④ POST /auth/reset-password { token, password }
     ├─ 同上驗證與雜湊
     ├─ ★ token_version + 1（重設密碼強制所有裝置登出）
     ├─ 撤銷所有 refresh token
     └─ audit(auth.password_reset)
```

---

## 9. 錯誤路徑總表

| 情境                            | HTTP | 錯誤碼                                         | 前端行為                             |
| ------------------------------- | ---- | ---------------------------------------------- | ------------------------------------ |
| 帳密錯誤                        | 401  | `AUTH_INVALID_CREDENTIALS`                     | 表單內顯示錯誤                       |
| 帳號未啟用                      | 401  | `AUTH_ACCOUNT_PENDING`                         | 提示去收啟用信                       |
| 帳號停用                        | 403  | `AUTH_ACCOUNT_DISABLED`                        | 提示聯絡管理員                       |
| 帳號鎖定                        | 403  | `AUTH_ACCOUNT_LOCKED`                          | 顯示剩餘鎖定時間                     |
| access token 失效               | 401  | `AUTH_TOKEN_INVALID`                           | 觸發一次續期，失敗則登出             |
| access token 陳舊（被強制登出） | 401  | `AUTH_TOKEN_STALE`                             | **直接登出**，不嘗試續期             |
| refresh 重用偵測                | 401  | `AUTH_REFRESH_REUSED`                          | 直接登出 ＋ 顯示安全提示             |
| 權限不足                        | 403  | `AUTHZ_FORBIDDEN`                              | toast ＋ 重新取得 profile            |
| 提權嘗試                        | 403  | `AUTHZ_ESCALATION`                             | 表單錯誤：「無法授予你未持有的權限」 |
| 操作自己                        | 403  | `AUTHZ_SELF_MODIFY`                            | 按鈕本就 disabled；兜底顯示 toast    |
| 系統角色保護                    | 403  | `ROLE_SYSTEM_PROTECTED`                        | 按鈕本就 disabled                    |
| 最後一個 super-admin            | 403  | `LAST_SUPER_ADMIN`                             | toast 說明原因                       |
| 名稱重複                        | 409  | `ROLE_NAME_DUPLICATE` / `USER_EMAIL_DUPLICATE` | 欄位層級錯誤                         |
| 路由未宣告權限                  | 500  | `ROUTE_PERMISSION_NOT_DECLARED`                | 開發期即應攔下（啟動失敗）           |
