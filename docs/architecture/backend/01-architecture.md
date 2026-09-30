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
│   │   ├── database.module.ts            全域 module，提供 PLATFORM_DB（平台 DB 的連線池）
│   │   ├── database.provider.ts          建立連線池 ＋ drizzle 實例；TENANT_DB / PLATFORM_DB token
│   │   └── transaction.ts                withTransaction()、afterCommit()
│   ├── tenant/                           依網域決定租戶、每租戶的連線池、TENANT_DB（02-database.md §6）
│   ├── feature-flags/                    feature flag 的目錄與判斷（FeatureFlagService；05-tenancy.md §5.2）
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
│   ├── mail/
│   │   ├── mail-transport.ts             ★ MailTransport 抽象類別（smtp / console，見 11-mail.md）
│   │   ├── mail.service.ts               範本 → HTML ＋ 純文字 → 傳輸層；信裡的連結
│   │   └── mail-layout.tsx               所有信共用的外框（React Email）
│   ├── authz/                            ★ 關係圖權限引擎（ADR-0024；rbac/01-domain-model.md §6）
│   │   ├── authz.model.ts                型別 DSL（direct／computed／from／聯集／交集）、模型驗證、靜態蘊含
│   │   ├── authz.checker.ts              記憶化判斷器（check／explain／withEdges）
│   │   ├── authz.types.ts                核心型別 user、role、由權限目錄產生的 tenant
│   │   ├── authz.registry.ts             業務模組在 onModuleInit 註冊自己的型別（例：file.authz.ts）
│   │   ├── authz.repository.ts           relation_tuples 查詢、主體閉包遞迴 CTE
│   │   ├── authz.service.ts              批次解析權限集合、建立判斷器
│   │   └── authz.revision.ts             關係圖的 revision：寫入後失效整個租戶的權限快取並廣播（05-rbac.md §5.1）
│   ├── broadcast/
│   │   └── broadcast.service.ts          程序之間的失效廣播：平台 DB 的 LISTEN／NOTIFY，每個程序一條監聽連線
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
│   │   ├── require-feature.decorator.ts  @RequireFeature：端點屬於可啟用的 feature（ADR-0021 D11）
│   │   ├── require-flag.decorator.ts     @RequireFlag：端點還在以 feature flag 試行（ADR-0022 D5）
│   │   ├── current-user.decorator.ts
│   │   └── audit.decorator.ts
│   ├── guards/
│   │   ├── jwt-auth.guard.ts
│   │   ├── feature.guard.ts              租戶沒有啟用 → FEATURE_DISABLED（404）
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
│   ├── file/                             files 轉介表 ＋ 直傳上傳、影像變體、維護排程、資料夾授權的讀寫與等級規則（09-file.md）
│   ├── job/                              背景工作的管理 API（10-jobs.md §6）
│   ├── feature-flag/                     feature flag 的平台管理 API（05-tenancy.md §5.2）
│   └── health/
│
├── db/
│   ├── schema/
│   │   ├── users.ts
│   │   ├── roles.ts
│   │   ├── permissions.ts
│   │   ├── relation-tuples.ts            關係圖的邊與 authz_revision；邊的建構函式與查詢條件（ADR-0024）
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
  ▼ ③' FeatureGuard (APP_GUARD)
     @RequireFeature('<id>')（class 或 handler）且在租戶脈絡裡：
     租戶的 features 不含它 → 404 FEATURE_DISABLED（ADR-0021 D11；05-tenancy.md §5.1）
     @RequireFlag('<key>')：flag 生效為關 → 同樣 404 FEATURE_DISABLED（ADR-0022 D5；05-tenancy.md §5.2）；兩者並存時都要成立
     排在 JWT 之後：未登入照舊 401，不讓未登入者知道租戶開了哪些功能；
     排在權限之前：功能沒開一律 404，不以 403 透露端點存在，也不寫 authz.denied
     沒有租戶脈絡（平台的請求）不判斷；平台端點標了 @RequireFeature / @RequireFlag 由路由稽核擋下
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
  { provide: APP_GUARD, useClass: FeatureGuard },
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
  ├─ core（global）: Config · Database · Cache · Logger · Events（DomainEventBus）· Jobs · Mail · Settings · Authz …
  ├─ AuthModule          ──▶ Credential · User · Approval · OidcProvider · IdentityProvider · PlatformAdmin
  ├─ TenantModule        ──▶ Credential · OidcProvider · PlatformAdmin
  ├─ OidcProviderModule  ──▶ User · PlatformAdmin
  ├─ UserModule          ──▶ Credential · Approval · IdentityProvider
  ├─ FileModule          ──▶ ResourceGrant · Approval
  ├─ RealtimeModule      ──▶ Permission（訂閱 DomainEventBus；沒有模組依賴它）
  ├─ 葉節點：Credential · IdentityProvider · Approval · ResourceGrant · Role · FeatureFlag · Job · System · Health
  └─ 全域葉節點（@Global）：Permission · AuditLog · PlatformAdmin
```

全域葉節點不必寫進 `imports` 也注入得到（上圖省略）：`PermissionsGuard` 在每個模組裡都要用它們，
gateway 以 `@UseGuards` 在自己的模組裡建立 guard（[`../../conventions/07-layer-dependencies.md`](../../conventions/07-layer-dependencies.md) §3.2 註 4）。

規則：

- **跨模組只注入對方 `exports` 的 service**，不注入 repository。
- 葉節點被很多人依賴，自己不依賴業務模組的 DI（只可以 import 別人的純函式與型別）。
  `PlatformAdminModule` 用 `credential/` 的 `password`、`token-hash`、`refresh-rotation`、`mails/`。
- 循環依賴一律用重構解決，**不用 `forwardRef`**。出現循環代表職責畫錯了。
- **副作用走領域事件，不反向依賴**：業務模組發佈 `DomainEventBus` 事件，
  推播這類「晚一點發生也沒關係」的副作用由訂閱的模組處理（[`08-realtime.md`](./08-realtime.md) §7）。
  業務模組不 import `RealtimeModule`。
- **直接呼叫還是發事件**：事件是 fire-and-forget（不拋錯、不等待，[`08-realtime.md`](./08-realtime.md) §7.2），
  所以只放「失敗了也不影響這次操作的結果」的副作用。操作本身的一部分、要知道成敗的步驟，直接呼叫對方 `exports` 的 service。

  | 情境 | 做法 | 例 |
  | --- | --- | --- |
  | 失敗要讓操作失敗、或要回報給呼叫端 | 直接呼叫 | 停用租戶時撤銷 session、結束 IdP session：`PlatformTenantService.endEverything` 逐步呼叫並收集失敗的步驟 |
  | 推播、快取預熱、補建衍生資料等「晚一點也沒關係」 | 發佈事件 | 權限變更 → 即時連線換 room、補建個人資料夾（`FileSystemFolderService` 訂閱 `permissions.changed`） |
  | 兩者都要 | 先直接呼叫，成功後再發事件 | `endEverything` 撤銷完 session 之後發 `sessions.revoked`，讓 realtime 斷線 |

  同一個效果不要兩條路都做：訂閱端要能分辨哪些情況已經由直接呼叫處理（例：`OidcProviderService` 訂閱
  `sessions.revoked` 只處理帶 `userIds` 的，租戶層級的由 `endTenantSessions` 直接處理）。

### 4.1 一個實際的循環與它的解法

`UserService.assignRoles()` 需要檢查反提權，也就是需要「某個角色的權限集合」——
那在 `RoleService` 裡。而 `RoleService.delete()` 需要知道「還有多少使用者持有
這個角色」——那在 `UserService` 裡。

解法：把「查某角色有多少人持有」放進 `RoleRepository`（它查 `relation_tuples` 上角色的持有者邊
`role:<id>#holder@user:*`，邊的形狀在 `db/schema/relation-tuples.ts`），`RoleService` 不需要 `UserService`。
單向依賴：`UserModule → RoleModule`。

### 4.2 憑證基礎設施與登入流程

登入流程（`AuthModule`）要用 `UserService` 找帳號；帳號管理（`UserModule`）停用人時要撤銷他的 refresh token、
寄啟用信要簽發 token。若 token 的儲存也放在 `AuthModule`，就成了 `Auth → User → Auth`。

解法：把「token 的儲存、密碼雜湊與政策、帳號連結信」抽成葉節點 `CredentialModule`，
`AuthModule`、`UserModule`、`TenantModule`（停用租戶時撤銷所有 session）都往下依賴它；
`AuthModule` 只留下流程（登入、續期、SSO、外部 IdP）。平台端同理：平台 DB 的表（含 `platform_refresh_tokens`）
都歸 `PlatformAdminModule`，平台的登入流程經 `PlatformRefreshTokenService` 存取。

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

  await withTransaction(this.db, async (tx) => {
    if (dto.remove.length) await this.roleRepo.removePermissions(roleId, dto.remove, tx);
    if (dto.add.length)    await this.roleRepo.addPermissions(roleId, dto.add, actor.id, tx);
    await this.auditService.record({
      action: 'role.grantPermission', resourceType: 'role', resourceId: roleId,
      changes: { before, after: /* … */ },
    }, tx);                                        // ★ 稽核在同一個交易裡
  });

  // ★ 快取失效在交易「之後」——交易可能 rollback；整個租戶失效並廣播（05-rbac §5.1）
  await this.permissionService.permissionsChanged();
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
  PLATFORM_DATABASE_URL: z.string().url(),
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
