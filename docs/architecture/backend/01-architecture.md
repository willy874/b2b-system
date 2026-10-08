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
  config · database · cache · errors · http · logger · metrics · tracing · validation · storage
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

只列各資料夾的角色與幾個關鍵檔案；完整內容以程式為準。

```
apps/api/src/
├── main.ts                               內部 api 的程序（:3000）
├── main.external.ts                      對外 API 的程序（:3001，06-external-api.md）
├── app.module.ts / external-api.module.ts
├── swagger.ts                            OpenAPI（內部、對外兩份；03-api-conventions.md §12）
│
├── core/                                 ← 機制層，不認識任何 module（🔒 layer-dependencies.spec.ts）
│   ├── config/                           env.schema.ts：Zod 驗證環境變數，缺就啟動失敗
│   ├── database/                         PLATFORM_DB 連線池與 drizzle 實例（database.provider.ts）
│   │   ├── delete-in-batches.ts          deleteInBatches()：保留清理的分批刪除（token、通知、webhook 事件）
│   │   ├── like.ts                       escapeLike()、containsPattern()、prefixPattern()：關鍵字搜尋的跳脫（03-api-conventions.md §2）
│   │   ├── optimistic-lock.ts            missedUpdate()：樂觀鎖的 UPDATE 沒命中 → 404 或 409（03-api-conventions.md §11）
│   │   └── transaction.ts                withTransaction()、afterCommit()
│   ├── tenant/                           依網域決定租戶、每租戶的連線池、TENANT_DB（02-database.md §6、05-tenancy.md）
│   ├── feature-flags/                    feature flag 的目錄與判斷（FeatureFlagService；05-tenancy.md §5.2）
│   ├── cache/                            權限集合、使用者、API token 的快取（★ permission-cache.service.ts）
│   ├── authz/                            ★ 關係圖權限引擎（iam/01-model.md §9）：型別 DSL、判斷器、relation_tuples 查詢、revision
│   ├── broadcast/                        程序之間的失效廣播：平台 DB 的 LISTEN／NOTIFY
│   ├── events/                           DomainEventBus：領域事件（交易後發佈，訂閱者如推播；08-realtime.md §7）
│   ├── errors/                           AppException、ErrorCode（轉出 @b2b-system/error-codes）、HttpExceptionFilter、資料庫錯誤的去參數化
│   ├── http/                             request-context（AsyncLocalStorage）、分頁與排序、游標、對外連線的 SSRF 防護（outbound.ts）
│   ├── logger/                           Pino：存取日誌與應用程式日誌、redact
│   ├── metrics/                          Prometheus 指標（instruments.ts 一份清單）、給 Prometheus 的 /metrics server（../08-monitoring.md §2）
│   ├── tracing/                          OpenTelemetry 的手動 span（inSpan）、租戶屬性、網址遮蔽（../08-monitoring.md §3）
│   ├── validation/                       ZodValidationPipe、Zod → OpenAPI
│   ├── settings/                         執行期可調的系統設定（12-settings.md）
│   ├── jobs/                             ★ JobQueue（pg-boss）：defineJob()、register／enqueue（10-jobs.md）
│   ├── mail/                             ★ MailTransport（smtp／console）、MailService、信的外框（11-mail.md）
│   ├── storage/                          ★ ObjectStorage（S3 SDK；09-file.md）
│   ├── image/                            ★ ImageProcessor（sharp；09-file.md §5.4）
│   ├── crypto/                           SecretBox：租戶連線字串、IdP 密鑰的加密
│   └── resource/                         RESOURCE_TYPE：跨模組的資源識別字串
│
├── common/                               ← 薄；decorator、guard、請求上的型別
│   ├── decorators/                       @Public、@Authenticated、@RequirePermissions、@RequireFeature、@RequireFlag、@ApiSurface、@CurrentUser…
│   ├── guards/                           SurfaceGuard、RateLimitGuard、JwtAuthGuard、WsAuthGuard、FeatureGuard、PermissionsGuard（§3.1）
│   ├── auth/                             access token 的驗證（AccessTokenModule）、API token 的格式
│   ├── types/                            AuthUser、PERMISSION 常數、請求與 socket 的型別
│   ├── route-audit.ts                    啟動時的路由稽核：沒宣告授權就啟動失敗（05-rbac.md §7）
│   └── rate-limit.ts                     速率限制的規則（03-api-conventions.md §8）
│
├── modules/                              ← 業務模組，一個資料夾一個 Nest module（相依見 §4）
│   ├── auth/                             登入、續期、登出、SSO 互動、外部 IdP 登入（04-auth.md、04-sso.md）
│   ├── credential/                       token 的儲存、密碼雜湊與政策、帳號連結信（§4.2）
│   ├── oidc-provider/                    api 當 OIDC Provider（04-sso.md §12）
│   ├── identity-provider/                外部 IdP 連線（04-sso.md §12.2 D8–D11）
│   ├── user/                             使用者管理（UserService）與登入流程等其他模組用的帳號讀寫（UserAccountService）
│   ├── role/ · group/ · permission/      角色、群組、權限目錄與權限集合（05-rbac.md、iam/07-groups.md）
│   ├── authz-explain/                    「為什麼能做 X」（iam/08-explain.md）
│   ├── service-account/ · api-token/     服務帳號與 API token（06-external-api.md）
│   ├── approval/                         審批的狀態機；handler 由擁有資源的模組登記（backend/20-approval.md）
│   ├── file/                             files 轉介表、直傳上傳、影像變體、資料夾與資料夾授權（09-file.md）
│   ├── trash/ · revision/                回收桶（13-trash.md）、版本歷史（14-revisions.md）
│   ├── notification/                     站內通知與事件管理（15-notification.md、16-notification-event.md）
│   ├── webhook/ · tag/ · announcement/   Webhook（17）、標籤（18）、公告（19）
│   ├── audit-log/                        稽核的寫入、查詢、熱 → 冷搬移（06-audit-log.md）
│   ├── realtime/                         推播：訂閱領域事件、Socket.io gateway（08-realtime.md）
│   ├── system/                           系統設定的 API（12-settings.md）
│   ├── job/                              背景工作的管理 API（10-jobs.md §6）
│   ├── tenant/                           租戶的公開資訊、平台的租戶管理與佈建（05-tenancy.md）
│   ├── platform-admin/                   平台管理者、平台的帳號流程與稽核（05-tenancy.md §10.2 D5）
│   ├── platform-notification/            平台管理者的站內通知（15-notification.md §6.2）
│   ├── feature-flag/                     feature flag 的平台管理 API（05-tenancy.md §5.2）
│   └── health/
│
├── db/
│   ├── schema/                           租戶 DB 的表（每租戶一個 database）；soft-delete.ts 的 notDeleted()／isDeleted()
│   ├── platform/                         平台 DB 的 schema 與 migration、租戶登記
│   ├── relations.ts
│   ├── migrations/                       租戶 DB 的 migration（drizzle-kit 產生，進版控）
│   ├── connect.ts · provision.ts         不經 DI 的連線、租戶 DB 的建立與 migration（執行期也用）
│   ├── bootstrap/                        租戶的初始資料：權限目錄、系統角色、第一位管理員（db:seed 與租戶佈建共用）
│   ├── seeds/                            db:seed（permissions.ts 是權限鍵的唯一來源）、db:seed:dev、db:seed:e2e
│   ├── client.ts · script-guard.ts       CLI 的連線（讀 .env、解開租戶連線字串）與防呆（02-database.md §6.1）
│   └── migrate.ts · reset.ts · archive-audit-logs.ts · drop-tenant.ts
│
└── cli/                                  維運指令（不經 Nest DI；正式映像也編進去）
    └── reset-super-admin.ts              災難復原：簽發 super-admin 的一次性重設連結（iam/05-bootstrap.md §7）
```

---

## 3. 請求管線

```
HTTP Request
  │
  ▼ ⓪ httpMetricsMiddleware（main.ts 第一個 app.use）
     量每個請求的時間，回應結束時以路由樣板記一筆（../08-monitoring.md §2.2）；被 guard 擋下的也算
  │
  ▼ ① RequestIdMiddleware → TenantMiddleware
     產生 / 沿用 x-request-id，塞進 AsyncLocalStorage（讓 logger 與稽核都能取用）；
     依網域決定租戶（05-tenancy.md）
  │
  ▼ ①' SurfaceGuard (APP_GUARD，全域 guard 的第一個)
     另一個入口的路由回 404 NOT_FOUND：內部 api 的 /v1/*、對外 API 的內部路由（06-external-api.md §9.2 D11）。
     不驗身分、不限流，就像那條路由不存在
  │
  ▼ ② RateLimitGuard (APP_GUARD)
     速率限制（03-api-conventions.md §8）：已登入以「租戶＋使用者」、未登入以 IP、登入類端點以「帳號＋IP」計數
  │
  ▼ ③ JwtAuthGuard (APP_GUARD)
     @Public → 放行
     驗簽 → 載入 user（UserCacheService，TTL 30s）
     檢查 deleted_at / status / token_version
     → request.user
  │
  ▼ ③' FeatureGuard (APP_GUARD)
     @RequireFeature('<id>')（class 或 handler）且在租戶脈絡裡：
     租戶的 features 不含它 → 404 FEATURE_DISABLED（[`frontend/02-plugin-system.md`](../frontend/02-plugin-system.md) §9.2 D11；05-tenancy.md §5.1）
     @RequireFlag('<key>')：flag 生效為關 → 同樣 404 FEATURE_DISABLED（[`architecture/05-tenancy.md`](../05-tenancy.md) §11.2 D5；05-tenancy.md §5.2）；兩者並存時都要成立
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
     稽核一律由 service 在業務的交易內寫入（與變更同生共死），沒有宣告式的稽核：
     interceptor 要等 handler 回傳之後才執行，不可能和業務寫入在同一個交易（docs/coding-standards/03-backend.md §1 第 6 條）
  │
  ▼ ⑦ TransformInterceptor
     回傳值包成 { data: ... }
  │
  ▼ ⑧ HttpExceptionFilter
     AppException / ZodError / 未知錯誤 → { error: { code, message, details } }
     5xx 只回 requestId，不回堆疊
  │
  ▼ HTTP Response
```

### 3.1 為什麼 Guard 用 `APP_GUARD` 而不是逐一 `@UseGuards`

```ts
// app.module.ts
providers: [
  { provide: APP_GUARD, useClass: SurfaceGuard },
  { provide: APP_GUARD, useClass: RateLimitGuard },
  { provide: APP_GUARD, useClass: JwtAuthGuard },
  { provide: APP_GUARD, useClass: WsAuthGuard },
  { provide: APP_GUARD, useClass: FeatureGuard },
  { provide: APP_GUARD, useClass: PermissionsGuard },
];
```

Nest 12 起全域 guard／interceptor 也套用到 WebSocket gateway：每個 guard 以 `ctx.getType()` 決定要不要管，
HTTP 由 `JwtAuthGuard`、ws 由 `WsAuthGuard` 認人（[`08-realtime.md`](./08-realtime.md) §4）。

全域註冊 ＋ **預設拒絕** ＝ 新增一個 controller 時，忘記加權限宣告的後果是
「啟動失敗」，而不是「開了一個無保護的端點」。

`@UseGuards` 的寫法則相反：忘記加 = 沒有保護。這個差異在安全上是決定性的。

---

## 4. 模組相依

各 `*.module.ts` 的 `imports`（Nest 的 DI 相依）。🔒 `src/__tests__/module-graph-doc.spec.ts` 拿這張圖與每個 `*.module.ts` 對照，
新增或拿掉一條 `imports` 而沒有改這裡，測試就失敗。

```
app.module
  ├─ core（global）: Config · Logger · Metrics · Tracing · Database · Tenancy · FeatureFlags · Cache · Authz · Broadcast · Settings · Events · Jobs · Storage · Mail · Image · AccessToken · MfaCore
  ├─ AuthModule            ──▶ Credential · User · Approval · OidcProvider · IdentityProvider · PlatformAdmin · Mfa
  ├─ MfaModule             ──▶ Credential · User · OidcProvider
  ├─ TenantModule          ──▶ Credential · OidcProvider · PlatformAdmin · PlatformNotification
  ├─ OidcProviderModule    ──▶ User · PlatformAdmin
  ├─ UserModule            ──▶ Credential · Approval · IdentityProvider · Trash · Notification · Webhook · Tag · Comment · Announcement · DataTransfer · Organization
  ├─ FileModule            ──▶ Approval · Trash · AuthzExplain · Webhook · Tag
  ├─ GroupModule           ──▶ Trash · Announcement
  ├─ OrganizationModule    ──▶ Trash · Approval
  ├─ RoleModule            ──▶ Trash · Revision
  ├─ ApprovalModule        ──▶ Notification · Webhook
  ├─ AnnouncementModule    ──▶ Notification · Trash
  ├─ WebhookModule         ──▶ Notification
  ├─ DataTransferModule    ──▶ Notification
  ├─ CommentModule         ──▶ Notification
  ├─ ServiceAccountModule  ──▶ ApiToken
  ├─ RealtimeModule        ──▶ Permission（訂閱 DomainEventBus；沒有模組依賴它）
  ├─ PlatformAdminModule   ──▶ PlatformNotification
  ├─ 沒有 imports：ApiToken · AuditLog · AuthzExplain · Credential · FeatureFlag · Health · IdentityProvider · Job · MfaEmail · MfaTotp · Notification · Permission · PlatformNotification · Revision · System · Tag · Trash
  └─ @Global：Permission · AuditLog · PlatformAdmin
```

`@Global` 的三個模組不必寫進 `imports` 也注入得到（上圖不畫這些邊）：`PermissionsGuard` 要用它們
（[`../../coding-standards/07-layer-dependencies.md`](../../coding-standards/07-layer-dependencies.md) §3.2 註 4），大部分模組也直接注入 `AuditService`、`PermissionService`。
只 import 對方的純函式或型別（不經 DI）的依賴也不在圖上，例：`platform-admin` 用 `credential/` 的 `password`、`token-hash`。
這兩種依賴與圖上的邊一起由 `src/__tests__/layer-dependencies.spec.ts` 檢查：模組之間（以資料夾計）不循環。

圖裡有兩種被依賴的模組：

| 種類 | 模組 | 規則 |
| --- | --- | --- |
| 葉節點 | `permission`、`audit-log`、`platform-admin`、`platform-notification`、`credential` | 只依賴彼此（🔒 `layer-dependencies.spec.ts` 的 `LEAF_MODULES`）：`PermissionsGuard` 與依賴 credential 的模組才不會把一整串業務模組帶進來 |
| 通用模組 | `notification`、`webhook`、`trash`、`revision`、`tag`、`approval`、`announcement`、`data-transfer` | 不 import 擁有資源的業務模組：擁有者 import 它，在 `onModuleInit`／constructor 登記自己的 handler、事件或資源類型（例：`TrashService.registerHandler()`、`WebhookEventCatalog.register()`），在業務交易內呼叫它 |

規則：

- **跨模組只注入對方 `exports` 的 service**，不注入 repository。
- 葉節點被很多人依賴，自己不依賴葉節點以外的業務模組（只可以 import 別人的純函式與型別）。
  `PlatformAdminModule` 用 `credential/` 的 `password`、`token-hash`、`refresh-rotation`、`mails/`，
  並 import 同為葉節點的 `PlatformNotificationModule`（換角色時通知本人）。
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

### 4.1 一個曾經的循環與它的解法

`UserService.replaceRoles()` 要做反提權檢查，需要「某個角色的權限集合」；`RoleService.remove()` 要知道「還有多少人持有這個角色」（`ROLE_IN_USE`）。
直覺的寫法是 `User → Role`（查權限集合）加上 `Role → User`（查持有人數），兩個模組互相依賴。

現在兩個模組之間 **沒有任何相依**，兩邊都只往下依賴關係圖：

- 持有者走關係圖：全域葉節點的 `PermissionService.findUserIdsHoldingRole()` 找出持有的人（含經由群組；邊的形狀 `role:<id>#holder@…` 在
  `db/schema/relation-tuples.ts`），`RoleRepository` 算其中未刪除的人數。`RoleService` 不需要 `UserService`。
- 反提權也在 `PermissionService`（`assertRolesAssignable()`、`assertCanGrant()`）：使用者、群組、服務帳號指派角色時都呼叫它，
  `UserService` 不需要 `RoleService`。

### 4.2 憑證基礎設施與登入流程

登入流程（`AuthModule`）要用 `UserModule` 找帳號；帳號管理（`UserModule`）停用人時要撤銷他的 refresh token、
寄啟用信要簽發 token。若 token 的儲存也放在 `AuthModule`，就成了 `Auth → User → Auth`。

解法：把「token 的儲存、密碼雜湊與政策、帳號連結信」抽成葉節點 `CredentialModule`，
`AuthModule`、`UserModule`、`TenantModule`（停用租戶時撤銷所有 session）都往下依賴它；
`AuthModule` 只留下流程（登入、續期、SSO、外部 IdP）。平台端同理：平台 DB 的表（含 `platform_refresh_tokens`）
都歸 `PlatformAdminModule`，平台的登入流程經 `PlatformRefreshTokenService` 存取。

MFA 的第二步（`MfaModule`，[`21-mfa.md`](./21-mfa.md)）也要用密碼登入的失敗計數、鎖定與「登入成功」的副作用，
而 `AuthModule` 依賴 `MfaModule`（登入互動密碼通過後交給它判斷）。所以這些不放在 `AuthService`：
租戶的在 `UserModule` 的 `UserLoginService`、平台的在 `PlatformAdminService`，`AuthModule` 與 `MfaModule` 都往下依賴它們。
驗證方式（`modules/mfa-<id>`）不依賴 `MfaModule`，只依賴 `core/mfa` 的註冊表。

`UserModule` 這一側也分成兩個 service：管理端點在 `UserService`；登入流程、OIDC Provider、註冊審批要的帳號讀寫
（`findAccountById`、`updateAccount`、`recordFailedLogin`、`createAccount`、`emitStatusChanged`…）在 `UserAccountService`，
`AuthModule`、`OidcProviderModule` 與審批的 handler 只注入它。改登入用到的帳號規則時不必讀整個使用者管理。

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
  JWT_SECRET: z.string().min(32).optional(), // 開發必填；production 只驗過渡期的舊 token（04-auth.md §11）
  JWT_SIGNING_KEYS: z.string().optional(),     // 金鑰環；內部 api 的 production 必填
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
0. import ./instrumentation：設了 OTEL_EXPORTER_OTLP_ENDPOINT 才掛上 OpenTelemetry（要早於 http、Nest、pino 被載入；../08-monitoring.md §3.1）
1. 解析並驗證 env（失敗 → process.exit(1)，訊息明確指出缺哪一個）
2. 建立 Nest app
3. ★ 路由稽核：掃描所有註冊的路由，任何未宣告授權的 → 拋錯終止啟動
4. 全域管線註冊
5. Swagger（僅非 production）
6. 監聽 PORT
```

第 3 步見 [`05-rbac.md`](./05-rbac.md) §7。它是整個「預設拒絕」策略的守門員。
