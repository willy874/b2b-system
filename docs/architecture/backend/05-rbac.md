# 後端 05 — RBAC 實作

> 這是整個 Phase 0 的核心。認證（你是誰）見 [`04-auth.md`](./04-auth.md)。

## 1. 設計原則

| #   | 原則             | 落實方式                                                           |
| --- | ---------------- | ------------------------------------------------------------------ |
| 1   | **預設拒絕**     | 未宣告授權的路由 → 啟動失敗                                        |
| 2   | **宣告式**       | `@RequirePermissions('role:update')` 在 controller 上，一眼可稽核  |
| 3   | **單一判定點**   | 只有 `PermissionsGuard` 決定「能不能」，service 不重複判斷通用權限 |
| 4   | **立即生效**     | 權限不進 token；變更時主動失效快取                                 |
| 5   | **不能自我提權** | 授予的權限必須是自己已持有的                                       |
| 6   | **留下痕跡**     | 每一次拒絕都寫稽核                                                 |

**原則 3 的例外**：業務規則（系統角色保護、反提權、不能操作自己、最後一個
super-admin）仍在 service 判斷。那些不是「通用權限」，而是資源狀態相關的規則，
Guard 看不到資源。

**資源層級授權** 也是這個例外：檔案管理器的資料夾授權（[`../../rbac/07-resource-grants.md`](../../rbac/07-resource-grants.md)）
由 `FileAccessService` 判斷。Guard 仍然宣告閘門（`@RequireAnyPermission('file:access', 'file:<動作>')`），
所以「每個路由都有明確宣告」與「每次拒絕都寫稽核」兩條原則不變——資源層級的拒絕同樣寫 `authz.denied`。

---

## 2. Decorators

```ts
// common/decorators/public.decorator.ts
export const IS_PUBLIC = Symbol("IS_PUBLIC");
export const Public = () => SetMetadata(IS_PUBLIC, true);

// common/decorators/authenticated.decorator.ts
export const IS_AUTHENTICATED = Symbol("IS_AUTHENTICATED");
/** 只要登入即可，不需要特定權限。用於「對象是自己」的端點 */
export const Authenticated = () => SetMetadata(IS_AUTHENTICATED, true);

// common/decorators/require-permissions.decorator.ts
export const REQUIRED_PERMISSIONS = Symbol("REQUIRED_PERMISSIONS");

export interface PermissionRequirement {
  keys: PermissionKey[];
  match: "every" | "some";
}

export const RequirePermissions = (...keys: PermissionKey[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_PERMISSIONS, { keys, match: "every" } satisfies PermissionRequirement);

export const RequireAnyPermission = (...keys: PermissionKey[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, { keys, match: "some" } satisfies PermissionRequirement);
```

### 2.1 `@CurrentUser()`

```ts
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest().user;
  if (!user) {
    // 只可能發生在標了 @Public 又取用 @CurrentUser 的 handler → 程式錯誤
    throw new AppException(
      ErrorCode.INTERNAL_ERROR,
      undefined,
      "@CurrentUser used on an unauthenticated route",
    );
  }
  return user;
});
```

---

## 3. `PermissionsGuard`

```ts
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionService: PermissionService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(IS_AUTHENTICATED, targets)) return true;

    const req = ctx.switchToHttp().getRequest();
    const requirement = this.reflector.getAllAndOverride<PermissionRequirement>(
      REQUIRED_PERMISSIONS,
      targets,
    );

    // ★ 預設拒絕：沒有任何宣告 = 程式錯誤，不是「公開」
    if (!requirement) {
      throw new AppException(ErrorCode.ROUTE_PERMISSION_NOT_DECLARED, {
        route: `${req.method} ${req.route?.path}`,
      });
    }

    const { keys, match } = requirement;
    const { permissions, isSuperAdmin } = await this.permissionService.getPermissionSet(
      req.user.id,
    );

    if (isSuperAdmin) return true;

    const granted =
      match === "every"
        ? keys.every((k) => permissions.has(k))
        : keys.some((k) => permissions.has(k));

    if (!granted) {
      const missing = keys.filter((k) => !permissions.has(k));
      await this.audit.record({
        action: "authz.denied",
        result: "failure",
        actorId: req.user.id,
        actorEmail: req.user.email,
        resourceType: "authz",
        errorCode: "AUTHZ_FORBIDDEN",
        metadata: { route: `${req.method} ${req.route?.path}`, required: keys, missing },
      });
      throw new AppException(ErrorCode.AUTHZ_FORBIDDEN, { required: keys, missing });
    }

    return true;
  }
}
```

### 3.1 `AUTHZ_FORBIDDEN` 的 `details` 要不要帶 `missing`

**要。** 理由：這是一個管理後台，使用者本來就知道系統有哪些權限（`/permissions`
是唯讀開放給 `permission:read` 的）。告訴他缺哪一個，他才知道要去請誰開。
隱藏只會讓「權限不足」變成一個要開 ticket 才查得出來的謎。

---

## 4. `PermissionService`

```ts
export interface PermissionSet {
  permissions: Set<PermissionKey>;
  isSuperAdmin: boolean;
}

@Injectable()
export class PermissionService {
  async getPermissionSet(userId: string): Promise<PermissionSet> {
    const cached = this.cache.get(userId);
    if (cached) return cached;

    const [keys, isSuperAdmin] = await Promise.all([
      this.repo.findPermissionKeysByUser(userId),
      this.repo.isSuperAdmin(userId),
    ]);

    const value: PermissionSet = { permissions: new Set(keys), isSuperAdmin };
    this.cache.set(userId, value);
    return value;
  }

  /** 供 /auth/profile 使用：super-admin 展開成全集，讓前端沒有特例 */
  async getEffectivePermissionKeys(userId: string): Promise<PermissionKey[]> {
    const { permissions, isSuperAdmin } = await this.getPermissionSet(userId);
    return isSuperAdmin ? this.repo.findAllPermissionKeys() : [...permissions];
  }

  /** 反提權：待授予的權限必須是 actor 已持有的 */
  async assertGrantable(actorId: string, keys: PermissionKey[]): Promise<void> {
    if (keys.length === 0) return;
    const { permissions, isSuperAdmin } = await this.getPermissionSet(actorId);
    if (isSuperAdmin) return;
    const missing = keys.filter((k) => !permissions.has(k));
    if (missing.length) {
      throw new AppException(ErrorCode.AUTHZ_ESCALATION, { missing });
    }
  }

  /** 指派角色前：該角色帶的權限必須全部是 actor 已持有的；super-admin 另外特判（§4.1） */
  async assertRolesAssignable(actorId: string, roleIds: string[]): Promise<void> {
    if (roleIds.length === 0) return;
    const { permissions, isSuperAdmin } = await this.getPermissionSet(actorId);
    if (isSuperAdmin) return;
    if (await this.repo.includesSuperAdminRole(roleIds)) {
      const allKeys = await this.repo.findAllPermissionKeys();
      const missing = allKeys.filter((k) => !permissions.has(k));
      throw new AppException(ErrorCode.AUTHZ_ESCALATION, { missing, role: SUPER_ADMIN_SLUG });
    }
    const keys = await this.repo.findPermissionKeysByRoles(roleIds);
    await this.assertGrantable(actorId, keys);
  }
}
```

### 4.1 反提權與 super-admin 角色

`super-admin` 是 **隱含全集**：它在 `role_permissions` 裡沒有任何列
（[`rbac/05-seed-and-bootstrap.md`](../../rbac/05-seed-and-bootstrap.md) §4、
[`rbac/02-permission-catalog.md`](../../rbac/02-permission-catalog.md) §4）。
只用 `findPermissionKeysByRoles()` 比對會查出空陣列、檢查直接通過——
任何持有 `user:assignRole` 或 `user:create` 的人都能把 super-admin 指派給任何人（含自己的分身帳號）。

所以 `assertRolesAssignable()` 先以 slug（`SUPER_ADMIN_SLUG`）判斷 `roleIds` 是否含 super-admin：

| actor               | `roleIds` 含 super-admin | 結果                                      |
| ------------------- | ------------------------ | ----------------------------------------- |
| super-admin         | 是 / 否                  | 放行（super-admin 豁免反提權）            |
| 非 super-admin      | 是                       | **一律** `403 AUTHZ_ESCALATION`           |
| 非 super-admin      | 否                       | 照一般規則比對角色帶的權限鍵              |

- 「一律」的意思是：即使 actor 已持有目錄中的每個權限鍵也要擋。super-admin 還會繞過
  **未來新增** 的權限，以及 `LAST_SUPER_ADMIN` 等只針對 super-admin 的保護，不等於「目前的全集」。
- `details` 維持既有形狀：`missing` 是全集中 actor 未持有的權限鍵（可能為空陣列），
  另外加上 `role: 'super-admin'` 說明原因。

  ```json
  { "error": { "code": "AUTHZ_ESCALATION",
               "details": { "missing": ["system:update", "…"], "role": "super-admin" } } }
  ```

- 走這個檢查的端點：`POST /users`（`roleIds`）、`PUT /users/:id/roles`，以及審批核准時帶入的 `roleIds`。
  新增任何會指派角色的端點都必須呼叫 `assertRolesAssignable()`，不可自行只比對權限鍵。

---

## 5. 權限快取

```ts
@Injectable()
export class PermissionCacheService {
  private readonly store = new Map<string, { value: PermissionSet; expiresAt: number }>();
  private readonly ttl = env.PERMISSION_CACHE_TTL * 1000; // 預設 60 秒

  get(userId: string): PermissionSet | undefined {
    const entry = this.store.get(userId);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.store.delete(userId);
      return undefined;
    }
    return entry.value;
  }

  set(userId: string, value: PermissionSet): void {
    this.store.set(userId, { value, expiresAt: Date.now() + this.ttl });
  }

  invalidate(userId: string): void {
    this.store.delete(userId);
  }
  invalidateAll(): void {
    this.store.clear();
  }
}
```

### 5.1 失效時機（必須完整）

| 事件                             | 失效對象                       |
| -------------------------------- | ------------------------------ |
| 指派 / 移除使用者的角色          | 該使用者                       |
| 角色的權限變更                   | **持有該角色的所有使用者**     |
| 刪除角色                         | 同上（先查出使用者，再刪角色） |
| 停用 / 刪除使用者                | 該使用者                       |
| 權限目錄變更（seed / migration） | **全部**                       |

```ts
// RoleService：持有者在交易「之前」查出，交易之後失效
const holders = await this.repo.findUserIdsByRole(roleId);
await withTransaction(this.db, async (tx) => { /* 寫入 ＋ 稽核 */ });
this.permissionService.invalidateUsers(holders);
```

**順序陷阱**：刪除角色時必須 **先** 查出受影響的使用者，**再** 執行刪除。
反過來的話 `user_roles` 已被 cascade 刪除，查不到任何人，快取永遠不會失效——
直到 TTL 過期為止那些人還保有已被刪除角色的權限。

### 5.2 為什麼是 in-memory 而不是 Redis

Phase 0 是單一 API 執行個體。in-memory Map 的失效是即時且確定的。

**多執行個體時的升級路徑**：換成 Redis（或加一個 Postgres `LISTEN/NOTIFY`
的失效廣播）。`PermissionCacheService` 的介面不變，只換實作。
60 秒 TTL 在那之前就是安全網：即使某個節點漏收失效通知，最遲 60 秒後也會重新解析。

快取失效之後，同一處發佈領域事件（`DomainEventBus`）；`modules/realtime` 的 listener 收到後
同步受影響使用者的 room、把變更推給他們（[`08-realtime.md`](./08-realtime.md) §6.2、§7）。

### 5.3 快取值的大小

一個使用者的權限集合最多 15 個短字串。1000 個線上使用者約 200 KB。
不需要 LRU 淘汰，但仍加一個上限（10000 筆）避免異常情況下無限成長。

---

## 6. Controller 的樣子

```ts
@Controller("roles")
@ApiTags("roles")
export class RoleController {
  @Get()
  @RequirePermissions(PERMISSION.ROLE_READ)
  async list(@Query(new ZodValidationPipe(ListRoleSchema)) query: ListRoleDto) {
    return this.roleService.list(query);
  }

  @Post()
  @RequirePermissions(PERMISSION.ROLE_CREATE)
  async create(
    @Body(new ZodValidationPipe(CreateRoleSchema)) dto: CreateRoleDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.roleService.create(dto, actor);
  }

  @Get(":id/permissions")
  @RequirePermissions(PERMISSION.ROLE_READ, PERMISSION.PERMISSION_READ) // EVERY
  async listPermissions(@Param("id", ParseUUIDPipe) id: string) {
    return this.roleService.listPermissions(id);
  }

  @Patch(":id/permissions")
  @RequirePermissions(PERMISSION.ROLE_GRANT_PERMISSION)
  async updatePermissions(
    @Param("id", ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(UpdatePermissionsSchema)) dto: UpdatePermissionsDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.roleService.updatePermissions(id, dto, actor);
  }

  @Delete(":id")
  @RequirePermissions(PERMISSION.ROLE_DELETE)
  @HttpCode(204)
  async remove(
    @Param("id", ParseUUIDPipe) id: string,
    @Query(new ZodValidationPipe(DeleteRoleSchema)) query: DeleteRoleDto,
    @CurrentUser() actor: AuthUser,
  ) {
    await this.roleService.remove(id, query.force ?? false, actor);
  }
}
```

**Controller 裡沒有任何 `if`。** 所有判斷在 decorator（通用權限）或
service（業務規則）。

---

## 7. 路由稽核（啟動時）

這是「預設拒絕」策略的守門員。

```ts
// main.ts
export function auditRoutes(app: INestApplication): void {
  const reflector = app.get(Reflector);
  const router = app.getHttpAdapter().getInstance()._router;
  const undeclared: string[] = [];

  for (const layer of router.stack) {
    if (!layer.route) continue;
    const handler = layer.route.stack[0].handle;
    const meta =
      reflector.get(IS_PUBLIC, handler) ??
      reflector.get(IS_AUTHENTICATED, handler) ??
      reflector.get(REQUIRED_PERMISSIONS, handler);
    if (meta === undefined) {
      undeclared.push(`${Object.keys(layer.route.methods)[0].toUpperCase()} ${layer.route.path}`);
    }
  }

  if (undeclared.length) {
    throw new Error(
      `以下路由未宣告授權策略（需要 @Public / @Authenticated / @RequirePermissions 其中之一）：\n` +
        undeclared.map((r) => `  - ${r}`).join("\n"),
    );
  }
}
```

於 `app.listen()` **之前** 呼叫。忘記宣告權限 = 程序起不來 = 開發時就會發現。

> 實作細節：Express 的 `_router.stack` 是私有 API。更穩健的作法是用
> `DiscoveryService` 掃描所有 controller 的 method metadata。兩種都可以，
> 重點是這個檢查必須存在。

### 7.1 對應的測試

```ts
it("每一個路由都宣告了授權策略", async () => {
  const app = await createTestApp();
  expect(() => auditRoutes(app)).not.toThrow();
});

it("權限目錄與 @RequirePermissions 使用的鍵完全一致", async () => {
  const declared = collectDeclaredPermissionKeys(app); // 掃 metadata
  const catalog = new Set(PERMISSION_SEED.map(([r, a]) => `${r}:${a}`));
  for (const key of declared) expect(catalog).toContain(key);
});
```

第二個測試防止 typo：`@RequirePermissions('role:updte')` 會讓那個端點永遠
403，而且是靜默的。

---

## 8. 業務規則（在 Service）

### 8.1 完整清單

| 規則                                   | 位置                                      | 錯誤碼                       |
| -------------------------------------- | ----------------------------------------- | ---------------------------- |
| 系統角色不可刪除 / 改 slug             | `RoleService`                             | `ROLE_SYSTEM_PROTECTED`      |
| super-admin 角色的權限不可變更         | `RoleService`                             | `ROLE_SUPER_ADMIN_IMMUTABLE` |
| 角色仍被使用時不可刪除（除非 `force`） | `RoleService`                             | `ROLE_IN_USE`                |
| 反提權（授予權限）                     | `PermissionService.assertGrantable`       | `AUTHZ_ESCALATION`           |
| 反提權（指派角色）                     | `PermissionService.assertRolesAssignable` | `AUTHZ_ESCALATION`           |
| 只有 super-admin 能指派 super-admin（§4.1） | `PermissionService.assertRolesAssignable` | `AUTHZ_ESCALATION`      |
| 不能修改自己的狀態 / 角色              | `UserService`                             | `AUTHZ_SELF_MODIFY`          |
| 不能刪除自己                           | `UserService`                             | `AUTHZ_SELF_MODIFY`          |
| 不能移除最後一個 super-admin           | `UserService` / `RoleService`             | `LAST_SUPER_ADMIN`           |

### 8.2 `assertNotLastSuperAdmin`

```ts
private async assertNotLastSuperAdmin(userId: string): Promise<void> {
  const isSuper = await this.permissionRepo.isSuperAdmin(userId);
  if (!isSuper) return;
  const count = await this.roleRepo.countActiveUsersByRoleSlug('super-admin');
  if (count <= 1) throw new AppException(ErrorCode.LAST_SUPER_ADMIN);
}
```

呼叫點：停用使用者、刪除使用者、`PUT /users/:id/roles`（新清單不含 super-admin 時）。

`countActiveUsersByRoleSlug` 只算 `status = 'active'` 且未刪除的使用者——
把 super-admin 全部停用而不刪除，一樣會讓系統無人可管。

### 8.3 自我操作的判定

```ts
private assertNotSelf(actorId: string, targetId: string): void {
  if (actorId === targetId) throw new AppException(ErrorCode.AUTHZ_SELF_MODIFY);
}
```

適用於：改自己的 `status`、改自己的角色、刪除自己。
**不適用** 於：改自己的 `displayName`（那有專門的 `PATCH /auth/profile`）。

---

## 9. 端點 × 權限總表

| Method | Path                        | 宣告                             |
| ------ | --------------------------- | -------------------------------- |
| POST   | `/auth/login`               | `@Public`                        |
| POST   | `/auth/refresh`             | `@Public`                        |
| POST   | `/auth/register`            | `@Public`                        |
| POST   | `/auth/forgot-password`     | `@Public`                        |
| POST   | `/auth/reset-password`      | `@Public`                        |
| GET    | `/auth/setup/verify`        | `@Public`                        |
| POST   | `/auth/setup`               | `@Public`                        |
| POST   | `/auth/sso/callback`        | `@Public`（授權碼 ＋ PKCE 就是憑證，ADR-0019 D3） |
| POST   | `/platform/auth/sso/callback` | `@Public`（apps/auth 的 BFF：平台管理者，ADR-0020 D5） |
| POST   | `/platform/auth/refresh`    | `@Public`                        |
| POST   | `/platform/auth/logout`     | `@Authenticated`（平台管理者）   |
| GET    | `/platform/auth/profile`    | `@Authenticated`（平台管理者）   |
| GET    | `/tenant/current`           | `@Public`（目前網域的租戶，ADR-0020 D7） |
| GET    | `/tenants/lookup`           | `@Public`（以代碼找租戶的登入入口，ADR-0020 D11） |
| GET    | `/oidc-interaction/:uid`    | `@Public`（互動 cookie 就是憑證，ADR-0019 D16） |
| GET    | `/oidc-interaction/:uid/details` | `@Public`                   |
| POST   | `/oidc-interaction/:uid/login` | `@Public`                     |
| POST   | `/oidc-interaction/:uid/abort` | `@Public`                     |
| GET    | `/oidc-interaction/external/callback` | `@Public`（外部 IdP 跳回；state 就是憑證，ADR-0019 D8） |
| GET    | `/oidc-interaction/:uid/discover` | `@Public`（email 網域 → 外部 IdP 連線） |
| POST   | `/oidc-interaction/:uid/external` | `@Public`                  |
| GET    | `/oidc-interaction/:uid/external/complete` | `@Public`（一次性 ticket ＋ 互動 cookie） |
| POST   | `/auth/logout`              | `@Authenticated`                 |
| GET    | `/auth/profile`             | `@Authenticated`                 |
| PATCH  | `/auth/profile`             | `@Authenticated`                 |
| POST   | `/auth/change-password`     | `@Authenticated`                 |
| GET    | `/identity-providers`       | `identityProvider:read`          |
| POST   | `/identity-providers`       | `identityProvider:create`        |
| PATCH  | `/identity-providers/:id`   | `identityProvider:update`        |
| DELETE | `/identity-providers/:id`   | `identityProvider:delete`        |
| GET    | `/users`                    | `user:read`                      |
| POST   | `/users`                    | `user:create`                    |
| GET    | `/users/:id`                | `user:read`                      |
| PATCH  | `/users/:id`                | `user:update`                    |
| DELETE | `/users/:id`                | `user:delete`                    |
| GET    | `/users/:id/roles`          | `user:read`                      |
| PUT    | `/users/:id/roles`          | `user:assignRole`                |
| GET    | `/users/:id/permissions`    | `user:read`                      |
| POST   | `/users/:id/reset-password` | `user:resetPassword`             |
| POST   | `/users/:id/unlock`         | `user:update`                    |
| GET    | `/roles`                    | `role:read`                      |
| POST   | `/roles`                    | `role:create`                    |
| GET    | `/roles/:id`                | `role:read`                      |
| PATCH  | `/roles/:id`                | `role:update`                    |
| DELETE | `/roles/:id`                | `role:delete`                    |
| GET    | `/roles/:id/permissions`    | `role:read` ＋ `permission:read` |
| PATCH  | `/roles/:id/permissions`    | `role:grantPermission`           |
| GET    | `/roles/:id/users`          | `role:read` ＋ `user:read`       |
| POST   | `/roles/:id/duplicate`      | `role:create`                    |
| GET    | `/permissions`              | `permission:read`                |
| GET    | `/audit-logs`               | `auditLog:read`                  |
| GET    | `/audit-logs/:id`           | `auditLog:read`                  |
| GET    | `/health`                   | `@Public`                        |
| GET    | `/health/ready`             | `@Public`                        |
| GET    | `/system/info`              | `system:read`                    |
| GET    | `/approvals`                | `approval:read`                  |
| GET    | `/approvals/:id`            | `approval:read`                  |
| POST   | `/approvals/:id/approve`    | `approval:review` ＋ 類型要求的權限¹ |
| POST   | `/approvals/:id/reject`     | `approval:review`                |
| GET    | `/files` | `file:access` \| `file:read`³ |
| GET    | `/files/upload-policy` | `file:access` \| `file:create`³ |
| POST   | `/files` | `file:access` \| `file:create`³ |
| POST   | `/files/:id/parts` | `file:access` \| `file:create`³ |
| POST   | `/files/:id/complete` | `file:access` \| `file:create`³ |
| DELETE | `/files/:id/upload` | `file:access` \| `file:create`³ |
| GET    | `/files/:id/image/:variant` | `@Public`（網址簽章）²           |
| GET    | `/files/:id` | `file:access` \| `file:read`³ |
| PATCH  | `/files/:id` | `file:access` \| `file:update`³ |
| DELETE | `/files/:id` | `file:access` \| `file:delete`³ |
| POST   | `/files/move` | `file:access` \| `file:update`³ |
| GET    | `/file-folders` | `file:access` \| `file:read`³ |
| POST   | `/file-folders` | `file:access` \| `file:create`³ |
| POST   | `/file-folders/paths` | `file:access` \| `file:create`³ |
| PATCH  | `/file-folders/:id` | `file:access` \| `file:update`³ |
| DELETE | `/file-folders/:id` | `file:access` \| `file:delete`³ |
| GET    | `/file-folders/:id/grants` | `file:access` \| `file:share`³ |
| PUT    | `/file-folders/:id/grants` | `file:access` \| `file:share`³ |
| DELETE | `/file-folders/:id/grants/:subjectType/:subjectId` | `file:access` \| `file:share`³ |
| GET    | `/file-folders/:id/grant-subjects` | `file:access` \| `file:share`³ |
| PATCH  | `/file-folders/:id/access` | `file:access` \| `file:share`³ |
| POST   | `/file-folders/:id/access-requests` | `file:access` \| `file:read`³ |
| GET    | `/file-folders/:id/access-requests` | `file:access` \| `file:share`³ |
| POST   | `/file-folders/:id/access-requests/:requestId/approve` | `file:access` \| `file:share`³ |
| POST   | `/file-folders/:id/access-requests/:requestId/reject` | `file:access` \| `file:share`³ |

¹ 路由宣告只有 `approval:review`；核准時 `ApprovalService` 另外檢查該類型 handler 要求的權限
（`user.register` = `user:create`，指派角色時再加 `user:assignRole`），缺少時同樣回
`403 AUTHZ_FORBIDDEN` ＋ `details.missing`。見 [`../../rbac/06-approval.md`](../../rbac/06-approval.md) §3.2。

² 影像 API 給 `<img src>` 用，帶不了 access token；以網址上的 HMAC 簽章授權，網址只從看得到該檔案的回應拿得到。
見 [`./09-file.md`](./09-file.md) §5.4。

³ `A \| B` 是 `@RequireAnyPermission(A, B)`：guard 只當閘門（能進檔案管理器），哪個資料夾能做什麼由
`FileAccessService` 依資料夾授權判斷（§1 原則 3 的例外，見 [`../../rbac/07-resource-grants.md`](../../rbac/07-resource-grants.md)）。
路由稽核測試把 SOME 寫成 `a|b`、EVERY 寫成 `a+b`。

**這張表必須與 `docs/rbac/04-api-spec.md` 一致**，且有一支測試從 metadata
產生它並與文件比對（見 §7.1）。

---

## 10. 常見錯誤

| ❌                                    | ✅                                     |
| ------------------------------------- | -------------------------------------- |
| Controller 裡寫 `if (!user.can(...))` | 用 `@RequirePermissions`               |
| 沒宣告權限就當成公開                  | 沒宣告 = 啟動失敗                      |
| 把權限寫進 JWT                        | 每次查（有快取）                       |
| 刪除角色後才失效快取                  | **先查出受影響的使用者**，再刪         |
| 只檢查後端反提權 / 只檢查前端         | **兩邊都要**（前端是體驗，後端是安全） |
| `super-admin` 在前端也要特判          | profile 展開成全集，前端無特例         |
| 快取失效寫在交易內                    | 寫在交易 **之後**（交易可能 rollback） |
| `@RequirePermissions('role:updte')`   | 有測試比對權限目錄，typo 會被抓到      |
| 403 時不留紀錄                        | 每次拒絕都寫 `authz.denied` 稽核       |
