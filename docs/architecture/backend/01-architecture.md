# 後端 01 — 架構

## 1. 分層

```
┌────────────────────────────────────────────────────────────┐
│ Controller      HTTP ↔ DTO；宣告權限；不含業務邏輯           │
├────────────────────────────────────────────────────────────┤
│ Service         業務規則、交易邊界、跨 repository 協調       │
├────────────────────────────────────────────────────────────┤
│ Repository      Drizzle 查詢；回傳 row 型別；不含業務判斷    │
├────────────────────────────────────────────────────────────┤
│ Schema (db/)    Drizzle 表定義與 relations                  │
└────────────────────────────────────────────────────────────┘

橫切（core/ ＋ common/）：
  config · database · cache · errors · http · logger · validation · storage
  decorators · guards
```

### 1.1 每一層的邊界

| 層         | 可以                                                                                | 不可以                                            |
| ---------- | ----------------------------------------------------------------------------------- | ------------------------------------------------- |
| Controller | 宣告 `@RequirePermissions`、解析 DTO、呼叫一個 service 方法                         | `if` 業務判斷、直接用 Drizzle、組 SQL             |
| Service    | 業務規則、開交易、呼叫多個 repository、呼叫其他 module 的 service、寫稽核、失效快取 | 直接碰 `Request` / `Response`、拋 `HttpException` |
| Repository | Drizzle 查詢、映射 row                                                              | 丟業務例外、決定「可不可以」                      |

**Service 不拋 `HttpException`，拋 `AppException`**（帶 `ErrorCode`）。
`HttpExceptionFilter` 負責把 `ErrorCode` 對應到 HTTP 狀態碼。這讓 service 可以
被 CLI、排程、測試直接呼叫而不需要 HTTP 語境。

---

## 2. 目錄

```
apps/api/src/
├── main.ts
├── app.module.ts
│
├── core/                                 ← 不認識任何 module
│   ├── config/
│   │   ├── config.module.ts
│   │   └── env.schema.ts                 Zod 驗證環境變數，缺就啟動失敗
│   ├── database/
│   │   ├── database.module.ts            全域 module，提供 DRIZZLE token
│   │   ├── database.provider.ts          建立連線池 ＋ drizzle 實例
│   │   └── transaction.ts                withTransaction() 輔助
│   ├── cache/
│   │   ├── cache.module.ts
│   │   ├── permission-cache.service.ts   ★ 權限集合快取
│   │   └── user-cache.service.ts         使用者基本資料快取（給 JwtAuthGuard）
│   ├── errors/
│   │   ├── error-code.ts                 ErrorCode enum ＋ → HTTP status 對照
│   │   ├── app.exception.ts
│   │   └── http-exception.filter.ts
│   ├── http/
│   │   ├── request-id.middleware.ts
│   │   ├── transform.interceptor.ts      包成 { data: ... }
│   │   └── pagination.ts                 分頁 DTO 與輔助
│   ├── logger/
│   │   └── logger.module.ts              Pino
│   ├── validation/
│   │   ├── zod-validation.pipe.ts
│   │   └── zod-openapi.ts                Zod schema → OpenAPI schema
│   ├── storage/
│   │   ├── object-storage.ts             ★ ObjectStorage 抽象類別（同時是 DI token）
│   │   ├── s3-object-storage.ts          實作：@aws-sdk/client-s3（見 09-file.md）
│   │   └── storage.module.ts
│   ├── image/
│   │   ├── image-processor.ts            ★ ImageProcessor 抽象類別（同時是 DI token）
│   │   ├── sharp-image-processor.ts      實作：sharp / libvips（見 09-file.md §5.4）
│   │   └── image.module.ts
│   └── jobs/
│       ├── job-type.ts                   defineJob()：工作名稱 ＋ 資料型別 ＋ 重試設定
│       ├── job-queue.ts                  ★ JobQueue：register / enqueue / retry（底層 pg-boss，見 10-jobs.md）
│       ├── job-store.ts                  管理頁的列表與即時計數
│       └── jobs.module.ts
│
├── common/                               ← 薄；只有 decorator 與 guard
│   ├── decorators/
│   │   ├── public.decorator.ts
│   │   ├── authenticated.decorator.ts
│   │   ├── require-permissions.decorator.ts
│   │   ├── current-user.decorator.ts
│   │   └── audit.decorator.ts
│   ├── guards/
│   │   ├── jwt-auth.guard.ts
│   │   └── permissions.guard.ts
│   └── types/
│       └── authenticated-request.ts
│
├── modules/
│   ├── auth/
│   ├── user/
│   ├── role/
│   ├── permission/
│   ├── audit-log/                        含熱 → 冷搬移的排程工作（06-audit-log.md §8）
│   ├── file/                             files 轉介表 ＋ 直傳上傳、影像變體、維護排程、資料夾授權（09-file.md）
│   ├── job/                              背景工作的管理 API（10-jobs.md §6）
│   ├── resource-grant/                   資源授權：resource_grants ＋ 通用的等級解析（rbac/07-resource-grants.md）
│   └── health/
│
├── db/
│   ├── schema/
│   │   ├── users.ts
│   │   ├── roles.ts
│   │   ├── permissions.ts
│   │   ├── user-roles.ts
│   │   ├── role-permissions.ts
│   │   ├── refresh-tokens.ts
│   │   ├── audit-logs.ts
│   │   ├── auth-tokens.ts                啟用 / 密碼重設 token
│   │   ├── files.ts                      檔案轉介表（id ↔ 物件儲存的 key）
│   │   └── index.ts
│   ├── relations.ts
│   ├── migrations/                       drizzle-kit 產生，進版控
│   └── seeds/
│       ├── index.ts
│       ├── permissions.ts
│       ├── roles.ts
│       ├── super-admin.ts
│       └── dev.ts
│
└── cli/                                  維運指令
    └── reset-super-admin.ts
```

---

## 3. 請求管線

```
HTTP Request
  │
  ▼ ① RequestIdMiddleware
     產生 / 沿用 x-request-id，塞進 AsyncLocalStorage（讓 logger 與稽核都能取用）
  │
  ▼ ② ThrottlerGuard (APP_GUARD)
     速率限制。/auth/login 與 /auth/forgot-password 有更嚴格的獨立設定
  │
  ▼ ③ JwtAuthGuard (APP_GUARD)
     @Public → 放行
     驗簽 → 載入 user（UserCacheService，TTL 30s）
     檢查 deleted_at / status / token_version
     → request.user
  │
  ▼ ④ PermissionsGuard (APP_GUARD)
     讀 metadata：@Public / @Authenticated / @RequirePermissions
     都沒有 → 拋 ROUTE_PERMISSION_NOT_DECLARED（開發期就該被路由稽核擋下）
     取權限集合（PermissionCacheService，TTL 60s）
     super-admin → 放行
     EVERY / SOME 判定 → 不過就 403 ＋ 寫 authz.denied 稽核
  │
  ▼ ⑤ ZodValidationPipe
     body / query / params 依宣告的 schema 驗證與轉型
  │
  ▼ ⑥ Controller → Service → Repository → PostgreSQL
  │
  ▼ ⑦ AuditInterceptor
     @Audit(...) 標記的 handler：成功後寫入 audit_logs
     （大多數稽核由 service 主動寫入，這個 interceptor 只處理單純的 CRUD）
  │
  ▼ ⑧ TransformInterceptor
     回傳值包成 { data: ... }
  │
  ▼ ⑨ HttpExceptionFilter
     AppException / ZodError / 未知錯誤 → { error: { code, message, details } }
     5xx 只回 requestId，不回堆疊
  │
  ▼ HTTP Response
```

### 3.1 為什麼 Guard 用 `APP_GUARD` 而不是逐一 `@UseGuards`

```ts
// app.module.ts
providers: [
  { provide: APP_GUARD, useClass: ThrottlerGuard },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: PermissionsGuard },
];
```

全域註冊 ＋ **預設拒絕** ＝ 新增一個 controller 時，忘記加權限宣告的後果是
「啟動失敗」，而不是「開了一個無保護的端點」。

`@UseGuards` 的寫法則相反：忘記加 = 沒有保護。這個差異在安全上是決定性的。

---

## 4. 模組相依

```
app.module
  ├─ CoreModule（global）: Config · Database · Cache · Logger · Events（DomainEventBus）
  ├─ AuthModule      ──▶ UserModule(exports UserService)
  │                  ──▶ PermissionModule(exports PermissionService)
  │                  ──▶ AuditLogModule(exports AuditService)
  ├─ UserModule      ──▶ RoleModule(exports RoleService)
  │                  ──▶ PermissionModule
  │                  ──▶ AuditLogModule
  ├─ RoleModule      ──▶ PermissionModule
  │                  ──▶ AuditLogModule
  ├─ PermissionModule
  ├─ AuditLogModule
  ├─ RealtimeModule  ──▶ PermissionModule（訂閱 DomainEventBus；沒有模組依賴它）
  └─ HealthModule
```

規則：

- **跨模組只注入對方 `exports` 的 service**，不注入 repository。
- `PermissionModule` 與 `AuditLogModule` 是葉節點，被很多人依賴，自己不依賴業務模組。
- 循環依賴一律用重構解決，**不用 `forwardRef`**。出現循環代表職責畫錯了。
- **副作用走領域事件，不反向依賴**：業務模組發佈 `DomainEventBus` 事件，
  推播這類「晚一點發生也沒關係」的副作用由訂閱的模組處理（[`08-realtime.md`](./08-realtime.md) §7）。
  業務模組不 import `RealtimeModule`。

### 4.1 一個實際的循環與它的解法

`UserService.assignRoles()` 需要檢查反提權，也就是需要「某個角色的權限集合」——
那在 `RoleService` 裡。而 `RoleService.delete()` 需要知道「還有多少使用者持有
這個角色」——那在 `UserService` 裡。

解法：把「查某角色有多少人持有」放進 `RoleRepository`（它可以 join `user_roles`，
那是它自己的關聯表），`RoleService` 不需要 `UserService`。
單向依賴：`UserModule → RoleModule`。

---

## 5. 交易

```ts
// core/database/transaction.ts
export async function withTransaction<T>(
  db: Database,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(fn);
}
```

### 5.1 交易邊界在 Service

```ts
async updatePermissions(roleId: string, dto: UpdatePermissionsDto, actor: AuthUser) {
  const role = await this.roleRepo.findById(roleId);
  if (!role) throw new AppException(ErrorCode.ROLE_NOT_FOUND);
  if (role.slug === 'super-admin') throw new AppException(ErrorCode.ROLE_SUPER_ADMIN_IMMUTABLE);

  await this.permissionService.assertGrantable(actor.id, dto.add);   // 反提權

  const before = await this.roleRepo.listPermissionKeys(roleId);
  const holders = await this.roleRepo.findUserIdsByRole(roleId);

  await withTransaction(this.db, async (tx) => {
    if (dto.remove.length) await this.roleRepo.removePermissions(roleId, dto.remove, tx);
    if (dto.add.length)    await this.roleRepo.addPermissions(roleId, dto.add, actor.id, tx);
    await this.auditService.record({
      action: 'role.grantPermission', resourceType: 'role', resourceId: roleId,
      changes: { before, after: /* … */ },
    }, tx);                                        // ★ 稽核在同一個交易裡
  });

  // ★ 快取失效在交易「之後」——交易可能 rollback
  this.permissionService.invalidateUsers(holders); // holders 在交易前查出（05-rbac §5.1）
}
```

### 5.2 兩條規則

| 規則                 | 理由                                                                                |
| -------------------- | ----------------------------------------------------------------------------------- |
| **稽核寫入在交易內** | 業務變更與它的紀錄必須同生共死                                                      |
| **快取失效在交易後** | 交易可能 rollback；提前失效會讓快取重新載入到「尚未提交」的舊值，之後又不會再被失效 |
| **領域事件在交易後、快取失效後發佈** | rollback 的變更不該被推出去；訂閱者（推播）觸發的重抓必須拿到已失效的快取 |

Repository 的每個寫入方法都接受一個可選的 `tx` 參數，預設用 `this.db`：

```ts
async addPermissions(roleId: string, keys: string[], actorId: string, tx?: Transaction) {
  const db = tx ?? this.db;
  // …
}
```

---

## 6. 設定與啟動

```ts
// core/config/env.schema.ts
export const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().default(3000),
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.coerce.number().int().default(300),
  REFRESH_TOKEN_TTL: z.coerce.number().int().default(604800),
  PERMISSION_CACHE_TTL: z.coerce.number().int().default(60),
  LOGIN_MAX_ATTEMPTS: z.coerce.number().int().default(5),
  LOGIN_LOCKOUT_SECONDS: z.coerce.number().int().default(900),
  SUPER_ADMIN_EMAIL: z.string().email(),
  SUPER_ADMIN_PASSWORD: z.string().min(12).optional(),
});
export type Env = z.infer<typeof EnvSchema>;
```

`main.ts` 啟動序：

```
1. 解析並驗證 env（失敗 → process.exit(1)，訊息明確指出缺哪一個）
2. 建立 Nest app
3. ★ 路由稽核：掃描所有註冊的路由，任何未宣告授權的 → 拋錯終止啟動
4. 全域管線註冊
5. Swagger（僅非 production）
6. 監聽 PORT
```

第 3 步見 [`05-rbac.md`](./05-rbac.md) §7。它是整個「預設拒絕」策略的守門員。
