# 身分與存取 03 — 流程

本文件用序列圖描述授權相關的關鍵路徑。所有「檢查」步驟在實作時都必須有對應的測試。

認證的流程（登入、access token 續期與跨分頁協調、首次啟用與密碼重設）在
[`backend/04-auth.md`](../backend/04-auth.md) §3.5、§2.7、§5.3；§6 的錯誤路徑總表兩者都列。

---

## 1. 授權檢查（每個受保護請求）

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
  │    └─ miss → 關係圖解析（主體閉包 CTE ＋ 租戶節點上的邊，套權限依賴樹閉包；01 §6）→ 寫入 cache
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
[`backend/05-rbac.md`](../backend/05-rbac.md) §7）掃描所有註冊的路由，
任何未宣告的路由讓程序啟動失敗。

---

## 2. 建立角色並授予權限（含反提權）

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
  │               │◀── 整份權限目錄 ──────────────│
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
  │               │                    │ 5. INSERT relation_tuples：      │
  │               │                    │    tenant:self#<key>@role:R#holder│
  │               │                    │ 6. audit(role.create, {...})    │
  │               │                    │ 交易提交                        │
  │               │                    └─────────┬──────────────────────┘
  │               │◀── 201 { data: Role } ───────│
  │               │                              │
  │               │─ invalidateResources(role)   │
  │◀── 成功提示 ──│                              │
```

> **前端過濾不是安全機制**，只是體驗。後端的第 3 步才是真正的防線。兩邊都要有。

權限的挑選是 **樹狀下拉選單 ＋ 可展開的技能樹**（兩者連動，`features/role/components/PermissionSkillTree.tsx`，[`02-permission-catalog.md`](./02-permission-catalog.md) §9），互鎖相同：

```
點「刪除使用者」（可授予）
  └─ 明確的鍵 += user:delete
       └─ 前置 user:update、user:resetPassword、user:read 自動成為「已包含」（鎖住，不送出）
點「編輯使用者」（已包含）
  └─ 擋下：「要取消『編輯使用者』，先取消包含它的：刪除使用者」（aria-live 念出）
點「刪除使用者」（明確、沒有上層）
  └─ 取消；只由它帶出的前置跟著熄滅，原本明確點選的保留
操作者沒有的鍵 → 停用（反提權）；super-admin 角色 → 整棵唯讀
送出 → 只有明確點選的鍵（POST /roles 的 permissionKeys、PATCH 的 add／remove）
```

「有上層就不能取消前置」只是編輯器的互鎖；API 不因此拒絕（[`04-api.md`](./04-api.md) §2.3）。

---

## 3. 變更角色權限 → 生效

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
  ├─ 交易：DELETE relation_tuples 的 tenant:self#<key>@role:R#holder
  │         （trigger 讓 authz_revision +1）
  ├─ audit(role.grantPermission, { before, after })
  │
  ▼  交易之後
PermissionService.permissionsChanged()              整個租戶的權限快取失效；平台 DB 廣播 { tenant, revision }
  ├─ permissions.changed → realtime：租戶的所有連線重算 room（其他程序收到廣播也各自重算）
  └─ resource.changed（affectedUserIds = 持有 R 的人）→ 前端重抓 profile（backend/08-realtime.md §7）
  │
  ▼  下一次這些使用者的請求
PermissionsGuard → cache miss → 重新解析 → 不含 'user:delete' → 403
（若 R 其他的鍵經依賴樹帶出被移除的鍵——例如移除 user:update、但保留 user:delete——它仍然成立）
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

## 4. 指派角色給使用者

```
PUT /users/:id/roles  { roleIds: [...] }    ← 整批取代語意，非增量
  │
  ├─ 需要 user:assignRole
  ├─ 檢查 I9：actorId ≠ targetId（不能改自己的角色）→ 403 AUTHZ_SELF_MODIFY
  ├─ 檢查所有 roleId 存在且未刪除
  ├─ ★ 反提權：每個待指派角色的權限集合 ⊆ actor 權限集合
  │     （否則我可以把一個我做不到的角色指派給別人，等同提權）
  ├─ 檢查 I8：若此次操作會移除系統最後一個 super-admin → 403 LAST_SUPER_ADMIN
  ├─ 交易：DELETE relation_tuples 的 role:*#holder@user:<id>
  │         INSERT role:<r>#holder@user:<id>（新集合）
  ├─ audit(user.assignRole, { before: [...], after: [...] })
  └─ 交易之後：PermissionService.permissionsChanged([userId])   整個租戶失效並廣播（backend/05-rbac.md §5.1）
```

---

## 5. 停用 / 刪除使用者 → 強制登出

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

## 6. 錯誤路徑總表

| 情境                            | HTTP | 錯誤碼                                         | 前端行為                             |
| ------------------------------- | ---- | ---------------------------------------------- | ------------------------------------ |
| 帳密錯誤                        | 401  | `AUTH_INVALID_CREDENTIALS`                     | 表單內顯示錯誤                       |
| 帳號未啟用                      | 401  | `AUTH_ACCOUNT_PENDING`                         | 提示去收啟用信                       |
| 帳號停用                        | 403  | `AUTH_ACCOUNT_DISABLED`                        | 提示聯絡管理員                       |
| 帳號鎖定（登入失敗次數用完）    | 401  | `AUTH_INVALID_CREDENTIALS`                     | 與帳密錯誤相同（不透露鎖定）；外部 IdP 登入不受鎖定影響（04-auth.md §3.3） |
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
