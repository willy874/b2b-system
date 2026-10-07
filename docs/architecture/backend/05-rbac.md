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

**Service 層的權限鍵判斷**：路由的宣告表達不了的權限（依審批類型而定、依回收桶的類型而定、「自己或有權限」、只在某些狀態才需要、
標籤組由擁有者決定）由 service 判斷，**一律** 經 `PermissionService.assertHasAll(actor, keys, { route, metadata? })`
（任一個就好用 `assertHasAny`），不自己比對權限集合。它與 guard 同一個形狀：super-admin 放行；缺少時以 `recordSafely` 寫
`authz.denied`（`metadata: { route, required, missing, ...metadata }`，`route` 是被拒絕的端點樣板），再拋
`403 AUTHZ_FORBIDDEN { required, missing }`（§3.1）。稽核不跟著呼叫端的交易：rollback 時拒絕紀錄仍要留下。

| 呼叫端 | 要求 | 為什麼路由擋不了 |
| --- | --- | --- |
| `ApprovalService.approve` | 審批類型要求的權限（註冊：`user:create`） | 路由只宣告 `approval:review`，類型在請求本體之外 |
| `TrashService.list` | 該類型的 `<resource>:delete` | `GET /trash` 宣告「任一種刪除權」，類型在 query |
| `AuthzExplainService.assertCanExplain` | 查別人時 `authz:explain` | 「自己或有權限」 |
| `AnnouncementService.update` | 排程中、暫停中的公告另要 `announcement:publish` | 依公告的狀態 |
| `RoleService.revertToRevision` | 權限鍵會改變時另要 `role:grantPermission` | 依那一版的內容 |
| 標籤組的 `assertCanBrowse`、使用者的 `resolveEditable` | `user:read`／`user:update`；檔案組是 `file:access` 或 `file:read` | `GET /tags`、`PUT /tags/assignments/…` 只宣告 `@Authenticated()`，由擁有者決定（[`18-tag.md`](./18-tag.md)） |

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

### 3.2 平台管理者的端點（`@RequirePlatformPermissions`）

apps/platform 的平台管理者與租戶的使用者是兩份帳號（[`architecture/05-tenancy.md`](../05-tenancy.md) §10.2 D5），
權限目錄也是兩份（[`../../rbac/02-permission-catalog.md`](../../rbac/02-permission-catalog.md) §8）。平台的端點宣告
`@RequirePlatformPermissions('tenant:create')`（所有鍵都要有），同一個 `PermissionsGuard` 判斷：

| 情況 | 結果 |
| --- | --- |
| 請求的網域屬於某個租戶 | `404 PLATFORM_ONLY`——`JwtAuthGuard` 在驗 token **之前** 就擋下，等同端點不存在 |
| 平台管理者（`realm: 'platform'` 的 token）有全部的鍵 | 放行；權限來自 `platform_admins.role` 的固定對照，不查租戶的權限快取 |
| 缺任何一個 | `403 AUTHZ_FORBIDDEN`（帶 `missing`），拒絕寫 **平台** 稽核 `platform_audit_logs` |

路由稽核（§7）把它算成一種宣告；WebSocket 的處理器不能用它（平台管理者不連 WebSocket）。
guard 因此注入 `PlatformAdminService`（查管理者的角色）與 `PlatformAuditService`（拒絕時寫平台稽核）；
`PlatformAdminModule` 與 `PermissionModule`、`AuditLogModule` 一樣是 `@Global` 的葉節點
（[`../../coding-standards/07-layer-dependencies.md`](../../coding-standards/07-layer-dependencies.md) §3.2 註 4）。

---

## 4. `PermissionService`

權限集合由 `core/authz` 的關係圖解析（[`rbac/01-domain-model.md`](../../rbac/01-domain-model.md) §9、§4.2）：
`AuthzService.tenantPermissionsOf()` 批次解析——主體閉包一條遞迴 CTE、租戶節點上的邊一條查詢，再在記憶體判斷。
`permissions` 是 **權限依賴樹的閉包**（[`../../rbac/02-permission-catalog.md`](../../rbac/02-permission-catalog.md) §9），
並多帶 `subjects`（主體閉包，給 `FileAccessService` 解析資料夾授權時沿用）。反提權因為 actor 的集合已是閉包，
只要比「明確鍵 ⊆ actor 閉包」；自我鎖定要比「剩下的鍵的閉包」。

```ts
export interface PermissionSet {
  permissions: Set<PermissionKey>; // 依賴樹的閉包；super-admin 不展開（看 isSuperAdmin）
  isSuperAdmin: boolean;
  subjects?: readonly string[];    // 主體閉包：user:<id>、user:*、role:<id>#holder…
}

@Injectable()
export class PermissionService {
  async getPermissionSet(userId: string): Promise<PermissionSet> {
    const cached = this.cache.get(userId);
    if (cached) return cached;

    const ticket = this.cache.ticket(); // 載入期間被失效就不寫回（§5）
    const resolved = await this.authz.tenantPermissionsOf([userId], { withDependencies: true });
    const { effective, isSuperAdmin, subjects } = resolved.get(userId)!;
    const value = { permissions: effective, isSuperAdmin, subjects };
    this.cache.set(userId, value, ticket);
    return value;
  }

  /** 供 /auth/profile 使用：super-admin 展開成全集，讓前端沒有特例 */
  async getEffectivePermissionKeys(userId: string): Promise<PermissionKey[]> {
    const { permissions, isSuperAdmin } = await this.getPermissionSet(userId);
    return isSuperAdmin ? this.repo.findAllPermissionKeys() : [...permissions];
  }

  /**
   * 反提權的通用入口（§4.1）：把主體放進 targets 的每一個「物件#關係」取得的租戶能力，actor 都要有。
   * super-admin 角色帶來的能力是 superAdmin，只有 super-admin 有——不必以 slug 特判
   */
  async assertCanGrant(actorId: string, targets: RelationRef[], tx?: DbOrTx): Promise<void> {
    if (targets.length === 0) return;
    const { permissions, isSuperAdmin } = await this.getPermissionSet(actorId);
    if (isSuperAdmin) return;
    const capabilities = await this.authz.grantedCapabilities(targets, { tx });
    const missing = capabilities.map((c) => c.relation).filter((r) => !permissions.has(r));
    if (missing.includes(SUPER_ADMIN_RELATION)) {
      const allKeys = await this.repo.findAllPermissionKeys();
      throw new AppException(ErrorCode.AUTHZ_ESCALATION, {
        missing: allKeys.filter((k) => !permissions.has(k)),
        role: SUPER_ADMIN_SLUG,
      });
    }
    if (missing.length) throw new AppException(ErrorCode.AUTHZ_ESCALATION, { missing });
  }

  /** 角色帶權限鍵：取得的就是那些鍵 */
  assertGrantable(actorId: string, keys: PermissionKey[]) {
    return this.assertCanGrant(actorId, keys.map((key) => ({ object: TENANT_OBJECT, relation: key })));
  }

  /** 指派角色：成為 role:<id>#holder，取得角色在租戶上的每個能力 */
  assertRolesAssignable(actorId: string, roleIds: string[], tx?: DbOrTx) {
    return this.assertCanGrant(
      actorId,
      roleIds.map((id) => ({ object: { type: 'role', id }, relation: 'holder' })),
      tx,
    );
  }
}
```

**反方向：誰持有某個權限**。`findActiveUserIdsWithPermission(key)` 給「要通知有某個權限的人」用（審批送出時的審核者，
[`backend/15-notification.md`](15-notification.md) §12.2 D5）：先以 `AuthzService.usersWithTenantRelations()` 的反向遞迴 CTE 找出候選
（在租戶節點上持有 `key`、帶來它的鍵或 `superAdmin` 的角色的持有者；過期的邊與已刪除的角色不算），
去掉停用與刪除的人，再以上面的 `getPermissionSets` 確認——判斷仍由正向解析決定，反向查詢只縮小範圍。
細節見 [`15-notification.md`](./15-notification.md) §5。

### 4.1 反提權與 super-admin 角色

**規則只有一條**（[`rbac/01-domain-model.md`](../../rbac/01-domain-model.md) §9 G4）：把某個主體放進 `物件#關係`，主體因此取得的能力，
操作者必須全部都有。「取得了什麼」由關係圖算，不是各 service 手寫：

| 寫入的邊 | 取得的能力（`AuthzService.grantedCapabilities`） | 誰比對 |
| --- | --- | --- |
| `tenant:self#<key>@role:<r>#holder`（角色帶權限鍵） | `<key>` | `PermissionService.assertGrantable` |
| `role:<r>#holder@user:<u>`／`@group:<g>#member`（指派角色） | 角色在租戶上的每個能力：權限鍵，super-admin 角色則是 `superAdmin` | `assertRolesAssignable` |
| `group:<g>#member@…`（加成員） | 沿成員關係往上的閉包——上層群組、它們持有的角色——在租戶上的能力（D11）；不含資料夾授權（D13） | `assertCanGrant` |
| `fileFolder:<f>#<等級>@…`（資料夾授權） | 等級靜態蘊含的 `can_*`（`capabilitiesOf`），在 `<f>` 上比對 | `FileAccessContext.missingActions` |

- 模型為每個型別宣告哪些關係是 **能力**（`defineType(…, { capabilities })`）：租戶上是每個權限鍵與 `superAdmin`、資料夾上是五個 `can_*`。
  等級、`role#holder`、`group#member` 不是能力，是取得能力的途徑；新增資源型別時宣告它的能力，反提權就自動涵蓋。
- 租戶能力以操作者的權限集合比對（含依賴樹的閉包），super-admin 讓每個能力都成立，所以自然豁免。
- 「誰能寫這條邊」的另一半（`role:grantPermission`、`user:assignRole`、`group:assignRole`、資料夾的 `can_share`）仍由路由宣告與
  service 的 `can('share')` 擋，錯誤是 `403 AUTHZ_FORBIDDEN`，不併入能力的比對。

`super-admin` 是 **隱含全集**：它沒有任何權限鍵的邊，只有 `tenant:self#superAdmin@role:<id>#holder`
（[`rbac/05-seed-and-bootstrap.md`](../../rbac/05-seed-and-bootstrap.md) §4、
[`rbac/02-permission-catalog.md`](../../rbac/02-permission-catalog.md) §4）。
只比對權限鍵會查出空陣列、檢查直接通過——任何持有 `user:assignRole` 或 `user:create` 的人都能把 super-admin 指派給任何人。
`superAdmin` 因此也是租戶的能力：指派 super-admin 角色取得的是它，只有 super-admin 自己有：

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

- 走這個檢查的端點：`POST /users`（`roleIds`）、`PUT /users/:id/roles`，審批核准時帶入的 `roleIds`，
  以及還原（`POST /roles/:id/restore` 檢查被還原的角色；[`13-trash.md`](./13-trash.md)）。
  新增任何會指派角色的端點都必須呼叫 `assertRolesAssignable()`，不可自行只比對權限鍵。

**讓既有的邊重新生效也是授予**。刪除使用者、停用使用者都不動關係圖：他持有角色的邊、群組成員的邊都留著，
只是暫時不起作用（刪除的人讀不到、停用的人登入不了）。所以下面兩個操作等於重新指派那些角色、重新把他加進那些群組，
以 `assertCanGrant` 檢查他 **直接持有的角色**（`role:<r>#holder`）與 **直接所屬的群組**（`group:<g>#member`，引擎沿上層群組、
群組持有的角色展開），actor 給不了 → `403 AUTHZ_ESCALATION`（`UserService.assertCanRevive`）：

| 操作 | 為什麼要檢查 |
| --- | --- |
| 還原使用者（`POST /users/:id/restore`） | 還原後他以原本的密碼登入，取得所有角色與群組帶來的權限 |
| 停用後改回 active（`PATCH /users/:id`，`inactive` → `active`） | 同上；停用時撤銷了 session，但沒有拿掉任何邊 |

只檢查「直接」的兩種邊就夠：上層群組與群組持有的角色由 `grantedCapabilities` 的閉包涵蓋；已刪除的角色與群組不會跟著回來，不列入。
停用、刪除、解鎖不檢查——前兩者是拿掉能力；解鎖的人本來就是 `active`（登入失敗的自動鎖定不改 `status`），沒有失去過角色。

**反方向：被操作的人是 super-admin**（`UserService.assertCanManage`）。
上面只檢查「新授予的」角色；持 `user:update`／`user:delete`／`user:assignRole` 的 admin 仍能停用、刪除 super-admin，
或把他的角色換成 member，藉此排除上級。所以目標持有 super-admin 時，只有 super-admin 能改他的狀態、刪除他、
整批取代他的角色，否則 `403 AUTHZ_ESCALATION`（`details: { role: 'super-admin', target }`）。
是不是 super-admin 直接查 DB（`UserRepository.hasRoleSlug`），不經權限快取。重設密碼、解鎖不在此限（信寄到本人信箱；解鎖是幫忙）。

---

### 4.2 關係圖引擎（`core/authz`）

通用、不認識任何業務型別；業務模組在 `onModuleInit` 把自己的型別註冊進來（[`../../coding-standards/07-layer-dependencies.md`](../../coding-standards/07-layer-dependencies.md) §3.2）。
領域上的模型（有哪些型別、關係怎麼定義）見 [`../../rbac/01-domain-model.md`](../../rbac/01-domain-model.md) §6.4。

| 檔案 | 職責 |
| --- | --- |
| `authz.model.ts` | 模型 DSL：`defineType`、`direct`、`computed`、`from`（`X from Y`）、`union`、`and`（交集，只用在收窄的組合）；**沒有排除**。`createModel` 在啟動時驗證：引用的型別與關係存在、`from` 的 tupleset 是直接關係、`computed` 沒有循環。`impliedRelations` 算靜態蘊含（等級蘊含哪些動作、依賴閉包） |
| `authz.types.ts` | 核心型別 `user`、`group`（`member`：使用者或另一個群組的成員）、`role`（`holder`：使用者或群組的成員）、`tenant`（由權限目錄產生：一個權限鍵一個關係＝直接授予 ∪ `superAdmin` ∪ 包含它的鍵）；每個物件都有隱含的 `tenant` 邊。`group` 是核心型別而不是由模組註冊：主體閉包的 CTE 要知道哪些關係是成員關係、已刪除的節點看哪張表 |
| `authz.registry.ts` | `register(type)`：業務型別（例：`modules/file/file.authz.ts` 的 `fileRoot`、`fileFolder`、`file`）；第一次取用時組合並驗證 |
| `authz.repository.ts` | `relation_tuples` 的讀取：主體閉包與帶路徑的版本（`closurePaths`，說明用）（遞迴 CTE 沿 `group#member`、`role#holder` 走，深度上限 8，排除已刪除的角色與群組）、某種物件上的直接邊（濾掉過期的）、`authz_revision`。群組巢狀的層數由寫入端限制在 `GROUP_MAX_NESTING_DEPTH`（6），閉包永遠走得完 |
| `authz.snapshot.ts` | 把一次判斷需要的邊載入記憶體；**結構邊供應者**（`EdgeProvider`）補上不存在 tuple 表的邊——資料夾的 `parent`／`inherits_from`／`owner` 由 `file_folders` 供應（[`rbac/01-domain-model.md`](../../rbac/01-domain-model.md) §9.2 D3） |
| `authz.checker.ts` | `check`／`explain`／`withEdges`：在快照上展開關係定義，同一個 `物件#關係` 只算一次（記憶化），遞迴深度上限 64；未知的型別或關係視為不成立 |
| `authz.service.ts` | `tenantPermissionsOf`（全域權限）、`checkerFor`（資源：一次載入操作者在這些型別上的邊，交給判斷器）、`grantedCapabilities`（反提權：放進某個 `物件#關係` 取得的能力，§4.1） |
| `authz.revision.ts` | 寫入後的失效與跨程序廣播（§5.1） |

- **寫入不經引擎**：角色、使用者、資料夾授權的 repository 直接寫 `relation_tuples`，邊的形狀與查詢條件集中在
  `db/schema/relation-tuples.ts`（`roleHolderTuple`、`rolePermissionTuple`、`isRoleHolderTuple()`…）。
  寫入時的模型驗證（型別有這個直接關係、主體種類是它允許的；`validateTuple`）以測試保證：每一種建構函式產生的邊都對完整的模型驗過一次
  （`src/__tests__/relation-tuples-model.spec.ts`）。邊只由這些建構函式產生，所以不在每次寫入時再驗一次。
- **判斷的成本**：全域權限在租戶節點上只有一層，閉包算完就是 `Set<PermissionKey>`，guard 仍是 O(1)。
  資料夾是「整棵結構一次載入 ＋ 記憶化」，一次請求建一個判斷器（`FileAccessService.contextFor`）。
- 說明（為什麼能做 X）：`explain()` 的路徑從主體閉包裡的主體開始，`closurePaths` 記下每個主體是怎麼來的、`withClosurePath` 把兩段接起來；
  全域權限的所有來源由 `tenantSourcesOf` 列出。API、遮蔽與畫面見 [`../../rbac/09-explain.md`](../../rbac/09-explain.md)。

## 5. 權限快取

```ts
@Injectable()
export class PermissionCacheService {
  // key 是「租戶 × 使用者」（`<tenantId>:<userId>`）：一個程序服務所有租戶
  private readonly store = new Map<string, { value: PermissionSet; expiresAt: number }>();
  private readonly ttl = env.PERMISSION_CACHE_TTL * 1000; // 預設 60 秒

  get(userId: string): PermissionSet | undefined { /* 過期就刪 */ }

  /** 開始載入前取票；`set` 帶票時，載入期間被失效的結果不寫回 */
  ticket(): number { /* … */ }
  set(userId: string, value: PermissionSet, ticket?: number): void { /* … */ }

  invalidate(userId: string): void { /* 一個人（目前的租戶） */ }
  invalidateTenant(tenantId?: string): void { /* 一個租戶的所有人；省略時是目前的租戶 */ }
  invalidateAll(): void { /* 全部 */ }
}
```

**取票**：`getPermissionSet` 在查 DB 之前取票，寫回時帶上。載入期間若那個人、他的租戶（`invalidateTenant`）或全部被失效，
結果就不寫回——否則正在進行的舊讀取會把剛失效的值寫回去，直到 TTL 過期（`core/cache/invalidation-tracker.ts`）。

### 5.1 失效時機：以租戶的 revision 為單位

[`rbac/01-domain-model.md`](../../rbac/01-domain-model.md) §9.2 D7、D8。角色的持有者、角色的權限鍵、資料夾授權都是
租戶 DB `relation_tuples` 的邊；**任何** 寫入都讓同一個租戶的所有人的權限快取失效，不再逐事件列出「要失效誰」。

```
寫入 relation_tuples 的交易
  └─ trigger（每條語句）：authz_revision.revision + 1        ← 同一個交易；寫入者在這一列排隊，提交順序＝版本順序
提交之後：permissionService.permissionsChanged(userIds?)
  └─ AuthzRevision.changed()
       1. 本機 PermissionCacheService.invalidateTenant()
       2. 發 permissions.changed（推播重算 room，08-realtime.md §6.2）
       3. 讀 revision，在平台 DB 的 `authz_revision` 頻道 NOTIFY { tenant, revision }
其他程序收到（core/broadcast，每個程序一條 LISTEN 連線）
  └─ revision 比那個租戶已知的新才處理：invalidateTenant(tenant)，並在那個租戶的脈絡（Tenancy.run）發 permissions.changed
     自己送的、亂序晚到的都略過
監聽連線重連 → invalidateAll()（中間的通知可能漏了）
```

| 事件 | 呼叫 | 範圍 |
| --- | --- | --- |
| 指派／移除使用者的角色、角色的權限變更、刪除或還原角色、帶角色建立使用者 | 交易提交後 `permissionService.permissionsChanged()` | 整個租戶（本機 ＋ 廣播） |
| 資料夾授權的寫入 | 不呼叫：資料夾授權不在權限快取裡（`FileAccessService` 每次解析） | 不失效、不廣播；revision 仍 +1，下一次廣播的 revision 涵蓋它 |
| 停用／刪除使用者、`token_version` 遞增 | `permissionService.invalidateUser(id)`（不是關係圖的變更） | 該使用者（本機） |
| 權限目錄變更（seed / migration） | 無：`db:seed` 在另一個程序執行、不送廣播（revision 仍 +1） | 靠 TTL 或重啟 |

```ts
// RoleService：寫入與稽核在交易內，失效在交易「之後」
await withTransaction(this.db, async (tx) => { /* 寫 relation_tuples ＋ 稽核 */ });
// 持有者不是失效的依據：給剛取得檔案權限的人補建個人資料夾、讓他們的畫面重抓（RESOURCE_CHANGED 的 affectedUserIds）
const holders = await this.permissionService.findUserIdsByRole(roleId);
await this.permissionService.permissionsChanged(holders);
```

- `permissionsChanged(userIds?)` 的 `userIds` 是已知直接受影響的人，只給需要逐人處理的訂閱者（補建個人資料夾）；
  它不是完整清單，也不影響失效範圍。
- 刪除角色是軟刪除，**持有者邊保留**（休眠，還原角色時原本的持有者自動回來；[`backend/14-revisions.md`](14-revisions.md) §9.2 D2、
  [`13-trash.md`](./13-trash.md) §6）。原本的持有者在軟刪除前查出，只用來推播。刪除與還原不寫 `relation_tuples`，
  revision 由 `roles.deleted_at` 的 trigger +1（migration 0012，[`02-database.md`](./02-database.md) §2.11），否則其他程序會把廣播當成舊的略過。
- 還原角色（`POST /roles/:id/restore`）的反提權與指派角色相同（`assertRolesAssignable`）：角色帶的鍵都要是 actor 持有的。
- 還原角色到某一版（`POST /roles/:id/revisions/:version/revert`）照改權限的規則：加回的鍵過 `assertGrantable`、`assertNoSelfLockout`，交易後 `permissionsChanged()`（[`14-revisions.md`](./14-revisions.md) §4.3）。
- 送出廣播是 best-effort：失敗只記 log；提交之後、送出之前程序結束也會漏一次。其他程序最遲在 TTL（60 秒）後重新解析；
  revision 單調遞增，下一次通知也會補上。
- 粒度是整個租戶：一次授權變更讓那個租戶的每個人下一次請求重算一次（每人一句 CTE，按需）。拆粒度的條件見 [`rbac/01-domain-model.md`](../../rbac/01-domain-model.md) §9.2 D8。

### 5.2 為什麼是 in-memory 而不是 Redis

快取在各程序的記憶體裡；跨程序的一致性靠上面的廣播（平台 DB 的 `LISTEN`／`NOTIFY`，`core/broadcast`），
不另外部署 Redis。60 秒 TTL 是最後防線：即使某個程序漏收通知，最遲 60 秒後也會重新解析。
其他快取（租戶目錄、資料夾樹、系統設定、使用者快取）也經 `core/broadcast` 跨程序失效，各自一個頻道（[`../01-system.md`](../01-system.md) §4.4）。

快取失效之後由 `AuthzRevision` 發佈 `permissions.changed`（`DomainEventBus`）；`modules/realtime` 的 listener 收到後
重算那個租戶在本機的所有連線的 room（[`08-realtime.md`](./08-realtime.md) §6.2、§7）。

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

同一個檢查也擋下 **標在平台端點上的 `@RequireFeature()`**：可啟用的 feature 以租戶為單位，平台的請求沒有租戶脈絡，
`FeatureGuard` 不判斷，標了也不生效（[`../05-tenancy.md`](../05-tenancy.md) §5.1）。`@RequireFeature` 不是授權宣告，
端點仍要有上面三者之一；哪些端點標了哪個 feature 由 `test/route-audit.spec.ts` 以路徑前綴釘住。
`@RequireFlag('<key>')` 同樣不能標在平台端點上，而且 key 必須在 `core/feature-flags` 的目錄裡——不在目錄裡的 flag
一律視為關閉，端點會被永遠關死（[`../05-tenancy.md`](../05-tenancy.md) §5.2）。

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
| 不能讓自己失去管理角色的權限（§8.4）  | `RoleService` → `PermissionService.assertNoSelfLockout` | `ROLE_SELF_LOCKOUT` |

### 8.2 `assertNotLastSuperAdmin`

```ts
// 在寫入的交易內呼叫：先取 advisory lock，再計數、再寫入
private async assertNotLastSuperAdmin(userId: string, tx: DbOrTx): Promise<void> {
  await this.repo.lockSuperAdminGuard(tx);        // pg_advisory_xact_lock(hashtext('super_admin_guard'))
  if (!(await this.repo.hasRoleSlug(userId, SUPER_ADMIN_SLUG, tx))) return;
  const remaining = await this.repo.countActiveUsersByRoleSlug(SUPER_ADMIN_SLUG, userId, tx);
  if (remaining < 1) throw new AppException('LAST_SUPER_ADMIN');
}
```

呼叫點：停用使用者、刪除使用者、`PUT /users/:id/roles`（新清單不含 super-admin 時），都在寫入的交易內。
在交易外先計數再寫入是 check-then-act：兩位 super-admin 同時刪除對方，兩邊都看到「還剩一位」，
結果一位都不剩。advisory lock 讓這些寫入依序執行；
每個租戶是自己的 database，不會跨租戶互鎖。是不是 super-admin 直接查 DB，不經權限快取。

`PUT /users/:id/roles` 也在同一個交易內先鎖住使用者列、讀出目前的角色：稽核的 `before` 是真正被取代的那一份；
請求帶 `expectedRoleIds`（前端草稿所依據的角色）時，與目前的角色不同就回 `409 USER_ROLES_CONFLICT`，
不會蓋掉別人剛做的變更。

`countActiveUsersByRoleSlug` 只算 `status = 'active'` 且未刪除的使用者——
把 super-admin 全部停用而不刪除，一樣會讓系統無人可管。

平台管理者的「最後一位 super-admin」是同一個寫法（`PlatformAdminManagementService.update`）：在平台 DB 的交易內
`lockSuperAdminGuard`（`hashtext('platform_super_admin_guard')`）→ `countActiveSuperAdmins(…, tx)` → 寫入 → 稽核。
平台管理者全部失去 super-admin 時沒有任何 API 救得回來（`db:seed` 只在一位管理者都沒有時才建立），只能直接改資料庫。

### 8.3 自我操作的判定

```ts
private assertNotSelf(actorId: string, targetId: string): void {
  if (actorId === targetId) throw new AppException(ErrorCode.AUTHZ_SELF_MODIFY);
}
```

適用於：改自己的 `status`、改自己的角色、刪除自己。
**不適用** 於：改自己的 `displayName`（那有專門的 `PATCH /auth/profile`）。

### 8.4 不能把自己鎖在外面

管理者改 **自己持有的** 角色的權限（`PATCH /roles/:id/permissions`）或刪除它（`DELETE /roles/:id`，含 `force`）時，
若變更之後自己會失去目前持有的 `role:read`、`role:update`、`role:grantPermission` 其中之一
（其他角色也沒有提供），回 `ROLE_SELF_LOCKOUT`（403，`details.lost` 列出會失去的權限）。

- super-admin 豁免（權限是隱含全集，也沒有角色能拿掉它）。
- 只看操作者本人：同一個角色的其他持有者失去權限是正常的業務操作。
- 沒有持有該角色、或本來就沒有那些權限時不擋。
- 「持有」與「剩下的權限」都以操作者的 **主體閉包**（`PermissionSet.subjects` 裡的 `role:<id>#holder`）判斷：經由群組（含巢狀）持有的角色
  與直接持有的一樣算（[`rbac/08-groups.md`](../../rbac/08-groups.md) §1）。只經由群組持有該角色的人一樣會被擋；
  經由群組持有另一個提供同樣權限的角色時，不會被誤擋。剩下的鍵是閉包中其他角色的鍵（`PermissionRepository.findPermissionKeysOfRoles`）
  加上變更後的鍵，再套依賴樹的閉包。

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
| POST   | `/auth/sso/callback`        | `@Public`（授權碼 ＋ PKCE 就是憑證，[`architecture/04-sso.md`](../04-sso.md) §12.2 D3） |
| POST   | `/platform/auth/sso/callback` | `@Public`（apps/platform 的 BFF：平台管理者，[`architecture/05-tenancy.md`](../05-tenancy.md) §10.2 D5） |
| POST   | `/platform/auth/refresh`    | `@Public`                        |
| POST   | `/platform/auth/logout`     | `@Public`（同 `/auth/logout`）   |
| GET    | `/platform/auth/profile`    | `@Authenticated`（平台管理者）   |
| GET    | `/platform/auth/setup/verify` | `@Public`（平台管理者的啟用 token；連結不帶 `?tenant=`） |
| POST   | `/platform/auth/setup`      | `@Public`                        |
| POST   | `/platform/auth/reset-password` | `@Public`                    |
| GET    | `/platform/admins` | `@RequirePlatformPermissions('platformAdmin:read')` |
| POST   | `/platform/admins` | `@RequirePlatformPermissions('platformAdmin:create')` |
| PATCH  | `/platform/admins/:id` | `@RequirePlatformPermissions('platformAdmin:update')` |
| POST   | `/platform/admins/:id/password-link` | `@RequirePlatformPermissions('platformAdmin:update')` |
| GET    | `/platform/audit-logs` | `@RequirePlatformPermissions('platformAuditLog:read')` |
| GET    | `/platform/jobs/queues` | `@RequirePlatformPermissions('platformJob:read')` |
| GET    | `/platform/jobs` | `@RequirePlatformPermissions('platformJob:read')` |
| GET    | `/platform/jobs/:id` | `@RequirePlatformPermissions('platformJob:read')` |
| POST   | `/platform/jobs/:id/retry` | `@RequirePlatformPermissions('platformJob:retry')` |
| GET    | `/platform/tenants` | `@RequirePlatformPermissions('tenant:read')`（[`architecture/05-tenancy.md`](../05-tenancy.md) §10.2 D12、D13；只在 apps/platform 的網域） |
| GET    | `/platform/tenants/:id` | `@RequirePlatformPermissions('tenant:read')` |
| POST   | `/platform/tenants` | `@RequirePlatformPermissions('tenant:create')` |
| PATCH  | `/platform/tenants/:id` | `@RequirePlatformPermissions('tenant:update')` |
| POST   | `/platform/tenants/:id/provision` | `@RequirePlatformPermissions('tenant:create')` |
| POST   | `/platform/tenants/:id/disable` | `@RequirePlatformPermissions('tenant:update')` |
| POST   | `/platform/tenants/:id/enable` | `@RequirePlatformPermissions('tenant:update')` |
| DELETE | `/platform/tenants/:id` | `@RequirePlatformPermissions('tenant:delete')` |
| POST   | `/platform/tenants/:id/domains` | `@RequirePlatformPermissions('tenant:update')` |
| DELETE | `/platform/tenants/:id/domains/:domain` | `@RequirePlatformPermissions('tenant:update')` |
| GET    | `/tenant/current`           | `@Public`（目前網域的租戶，[`architecture/05-tenancy.md`](../05-tenancy.md) §10.2 D7） |
| GET    | `/tenants/lookup`           | `@Public`（以代碼找租戶的登入入口，[`architecture/05-tenancy.md`](../05-tenancy.md) §10.2 D11） |
| GET    | `/oidc-interaction/:uid`    | `@Public`（互動 cookie 就是憑證，[`architecture/04-sso.md`](../04-sso.md) §12.2 D16） |
| GET    | `/oidc-interaction/:uid/details` | `@Public`                   |
| POST   | `/oidc-interaction/:uid/login` | `@Public`                     |
| POST   | `/oidc-interaction/:uid/abort` | `@Public`                     |
| GET    | `/oidc-interaction/external/callback` | `@Public`（外部 IdP 跳回；state 就是憑證，[`architecture/04-sso.md`](../04-sso.md) §12.2 D8） |
| GET    | `/oidc-interaction/:uid/discover` | `@Public`（email 網域 → 外部 IdP 連線） |
| POST   | `/oidc-interaction/:uid/external` | `@Public`                  |
| GET    | `/oidc-interaction/:uid/external/complete` | `@Public`（一次性 ticket ＋ 互動 cookie） |
| POST   | `/auth/logout`              | `@Public`（有 bearer 時在 service 照 `JwtAuthGuard` 的規則驗證；沒有時以 refresh cookie 認人，要求 `x-refresh-request: 1`，[`architecture/04-sso.md`](../04-sso.md) §3.4） |
| GET    | `/auth/profile`             | `@Authenticated`                 |
| PATCH  | `/auth/profile`             | `@Authenticated`                 |
| POST   | `/auth/change-password`     | `@Authenticated`                 |
| GET    | `/auth/api-tokens`          | `@Authenticated`（自己的個人 API token，[`architecture/06-external-api.md`](../06-external-api.md) §9.2 D14） |
| POST   | `/auth/api-tokens`          | `@Authenticated`                 |
| DELETE | `/auth/api-tokens/:tokenId` | `@Authenticated`                 |
| GET    | `/v1/me`                    | `@Authenticated`（**對外 API**：只認 API token；內部 api 上回 404，[`architecture/06-external-api.md`](../06-external-api.md) §9.2 D11） |
| GET    | `/v1/folders`               | `file:access` \| `file:read`³（對外 API） |
| GET    | `/v1/files`                 | `file:access` \| `file:read`³（對外 API） |
| POST   | `/v1/files`                 | `file:access` \| `file:create`³（對外 API） |
| GET    | `/v1/files/:id`             | `file:access` \| `file:read`³（對外 API） |
| POST   | `/v1/files/:id/parts`       | `file:access` \| `file:create`³（對外 API） |
| POST   | `/v1/files/:id/complete`    | `file:access` \| `file:create`³（對外 API） |
| DELETE | `/v1/files/:id/upload`      | `file:access` \| `file:create`³（對外 API） |
| GET    | `/v1/users`                 | `user:read`（對外 API；只有人） |
| GET    | `/v1/users/:id`             | `user:read`（對外 API） |
| GET    | `/notifications`            | `@Authenticated`（只看自己的，[`backend/15-notification.md`](15-notification.md) §12.2 D9） |
| GET    | `/notifications/unread-count` | `@Authenticated`               |
| POST   | `/notifications/read-all`   | `@Authenticated`                 |
| POST   | `/notifications/:id/read`   | `@Authenticated`（不是自己的回 404） |
| GET    | `/notifications/all`        | `notification:read`（通知總覽，[`backend/19-announcement.md`](19-announcement.md) §9.2 D1） |
| GET    | `/notification-events`      | `system:read`（[`backend/16-notification-event.md`](16-notification-event.md) §9.2 D10）    |
| PATCH  | `/notification-events`      | `system:update`                  |
| GET    | `/me/notification-preferences` | `@Authenticated`（只看自己的，[`backend/16-notification-event.md`](16-notification-event.md) §9.2 D15） |
| PATCH  | `/me/notification-preferences` | `@Authenticated`              |
| GET    | `/announcements`            | `announcement:read`（[`backend/19-announcement.md`](19-announcement.md) §9.2 D15） |
| POST   | `/announcements`            | `announcement:create`            |
| POST   | `/announcements/audience-preview` | `announcement:update`      |
| POST   | `/announcements/recurrence-preview` | `announcement:update`    |
| GET    | `/announcements/trigger-events` | `announcement:read`         |
| GET    | `/announcements/:id`        | `announcement:read`              |
| PATCH  | `/announcements/:id`        | `announcement:update`（草稿以外另要 `announcement:publish`，service 檢查） |
| DELETE | `/announcements/:id`        | `announcement:delete`            |
| POST   | `/announcements/:id/restore` | `announcement:delete`           |
| POST   | `/announcements/:id/publish`、`/pause`、`/resume` | `announcement:publish` |
| GET    | `/announcements/:id/dispatches` | `announcement:read`          |
| POST   | `/announcements/:id/dispatches/:dispatchId/revoke` | `announcement:publish` |
| GET    | `/me/announcement-messages/:dispatchId` | `@Authenticated`（只看得到自己收到的） |
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
| GET    | `/users/:id/permission-sources` | `@Authenticated`：自己；別人要 `authz:explain`（service 判斷，[`rbac/01-domain-model.md`](../../rbac/01-domain-model.md) §9 G4b） |
| POST   | `/users/:id/reset-password` | `user:resetPassword`             |
| POST   | `/users/:id/unlock`         | `user:update`                    |
| POST   | `/users/:id/restore`        | `user:delete`                    |
| GET    | `/users/:userId/api-tokens` | `user:update`（別人的個人 API token，[`architecture/06-external-api.md`](../06-external-api.md) §9.2 D14） |
| DELETE | `/users/:userId/api-tokens/:tokenId` | `user:update`           |
| GET    | `/service-accounts`         | `serviceAccount:read`            |
| POST   | `/service-accounts`         | `serviceAccount:create`（指派的角色受反提權限制） |
| GET    | `/service-accounts/:id`     | `serviceAccount:read`            |
| PATCH  | `/service-accounts/:id`     | `serviceAccount:update`          |
| DELETE | `/service-accounts/:id`     | `serviceAccount:delete`          |
| PUT    | `/service-accounts/:id/roles` | `serviceAccount:update`（反提權） |
| GET    | `/service-accounts/:id/tokens` | `serviceAccount:read`         |
| POST   | `/service-accounts/:id/tokens` | `serviceAccount:update`（token 的有效權限必須是操作者持有的，[`architecture/06-external-api.md`](../06-external-api.md) §9.2 D4） |
| DELETE | `/service-accounts/:id/tokens/:tokenId` | `serviceAccount:update` |
| GET    | `/webhooks`、`/webhooks/events`、`/webhooks/:id`、`/webhooks/:id/deliveries` | `webhook:read`（feature `webhook`，[`17-webhook.md`](./17-webhook.md) §6） |
| POST   | `/webhooks`                 | `webhook:create`                 |
| PATCH  | `/webhooks/:id`             | `webhook:update`                 |
| DELETE | `/webhooks/:id`             | `webhook:delete`                 |
| POST   | `/webhooks/:id/rotate-secret`、`/webhooks/:id/test`、`/webhooks/:id/deliveries/:deliveryId/redeliver` | `webhook:update` |
| GET    | `/tags?scope=`              | 登入；service 檢查進得了標籤組（[`18-tag.md`](./18-tag.md) §1） |
| POST   | `/tags`                     | `tag:create`                     |
| PATCH  | `/tags/:id`                 | `tag:update`                     |
| DELETE | `/tags/:id`                 | `tag:delete`                     |
| PUT    | `/tags/assignments/:resourceType/:resourceId` | 登入；service 交給擁有者判斷目標的編輯權限 |
| GET    | `/trash`                    | `user:delete` \| `role:delete` \| `group:delete` \| `file:delete`⁴ |
| GET    | `/roles`                    | `role:read`                      |
| POST   | `/roles`                    | `role:create`                    |
| GET    | `/roles/:id`                | `role:read`                      |
| PATCH  | `/roles/:id`                | `role:update`                    |
| DELETE | `/roles/:id`                | `role:delete`                    |
| GET    | `/roles/:id/permissions`    | `role:read` ＋ `permission:read` |
| PATCH  | `/roles/:id/permissions`    | `role:grantPermission`           |
| GET    | `/roles/:id/users`          | `role:read` ＋ `user:read`       |
| POST   | `/roles/:id/duplicate`      | `role:create`                    |
| GET    | `/groups`                   | `group:read`（`?userId=` 這個人所在的群組、標 `direct`／`nested`；`?roleId=` 持有角色的群組） |
| POST   | `/groups`                   | `group:create`                   |
| GET    | `/groups/:id`               | `group:read`                     |
| PATCH  | `/groups/:id`               | `group:update`                   |
| DELETE | `/groups/:id`               | `group:delete`                   |
| POST   | `/groups/:id/restore`       | `group:delete`（成員取得的角色受反提權限制，[`rbac/01-domain-model.md`](../../rbac/01-domain-model.md) §9.3 D11） |
| GET    | `/groups/:id/members`       | `group:read` ＋ `user:read`（EVERY） |
| PATCH  | `/groups/:id/members`       | `group:update`（加入的成員取得群組與上層群組的角色：反提權，D11） |
| GET    | `/groups/:id/roles`         | `group:read` ＋ `role:read`（EVERY） |
| PATCH  | `/groups/:id/roles`         | `group:assignRole`（反提權；super-admin 一律拒絕，D12） |
| POST   | `/roles/:id/restore`        | `role:delete`                    |
| GET    | `/roles/:id/revisions`      | `role:read`                      |
| GET    | `/roles/:id/revisions/:version` | `role:read`                  |
| POST   | `/roles/:id/revisions/:version/revert` | `role:update`（權限鍵會改變時 service 另要 `role:grantPermission`） |
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
| GET    | `/file-folders/:id/explain` | `@Authenticated`：查自己；別人要 `authz:explain`（service 判斷，G4b） |
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

⁴ `@RequireAnyPermission(...TRASH_PERMISSIONS)`：回收桶支援的每一類的 `<resource>:delete`（`user:delete`、`role:delete`、`group:delete`、`file:delete`）；
指定的 `type` 再由 `TrashService` 以該類型的權限檢查（[`./13-trash.md`](./13-trash.md) §3）。

**這張表必須與 `docs/rbac/04-api-spec.md` 一致**，且有一支測試從 metadata
產生它並與文件比對（見 §7.1）。

---

## 10. 常見錯誤

| ❌                                    | ✅                                     |
| ------------------------------------- | -------------------------------------- |
| Controller 裡寫 `if (!user.can(...))` | 用 `@RequirePermissions`               |
| 沒宣告權限就當成公開                  | 沒宣告 = 啟動失敗                      |
| 把權限寫進 JWT                        | 每次查（有快取）                       |
| 權限寫入後逐一列出要失效的使用者      | 交易提交後呼叫 `permissionsChanged()`，整個租戶失效 |
| 只檢查後端反提權 / 只檢查前端         | **兩邊都要**（前端是體驗，後端是安全） |
| `super-admin` 在前端也要特判          | profile 展開成全集，前端無特例         |
| 快取失效寫在交易內                    | 寫在交易 **之後**（交易可能 rollback） |
| `@RequirePermissions('role:updte')`   | 有測試比對權限目錄，typo 會被抓到      |
| 403 時不留紀錄                        | 每次拒絕都寫 `authz.denied` 稽核       |

---

## 11. 設計決策：權限在伺服器端即時解析，不放進 Token

> 原 ADR-0005，2026-09-19 決定。解析方式後來由 [`rbac/01-domain-model.md`](../../rbac/01-domain-model.md) §9 延伸（改由關係圖解析、權限集合含依賴樹閉包；§4.2），
> 「不放進 token、伺服器端即時解析、主動失效快取」不變；失效的粒度也改成整個租戶（§5.1）。

### 11.1 背景

JWT 常見的做法是把使用者的角色或權限寫進 payload，Guard 直接從 token 讀，
不查資料庫。問題在於 **JWT 簽出之後無法修改**：管理員移除某人的權限後，
那個人手上的 token 在到期前仍然帶著舊權限。

對一個以 RBAC 為核心產品的系統，這個空窗是不可接受的。流程面的說明見
[`../../rbac/03-flows.md`](../../rbac/03-flows.md)。

### 11.2 決定

- Access token 的 payload **只有** `{ sub, ver, jti, iat, exp }`，不含角色與權限
- `PermissionsGuard` 每次請求呼叫 `PermissionService.getPermissionSet(userId)`
- 該方法走 `PermissionCacheService`：in-memory Map，TTL 60 秒
- **所有授權變更都主動失效快取**（指派角色、角色權限變更、刪除角色、停用使用者）
- `GET /auth/profile` 回傳完整權限集合給前端做 UI gating；
  super-admin 在此展開成全集，讓前端沒有特例分支

### 11.3 理由

1. **權限變更立即生效。** 主動失效讓生效延遲 < 1 秒。60 秒 TTL 只是漏網時的
   安全網。
2. **Token 保持小。** 15 個權限鍵寫進 JWT 會讓每個請求的標頭多幾百 bytes。
3. **成本可接受。** 命中快取時 < 1 ms；未命中時是一句走 index-only scan 的
   三表 join。
4. **稽核更準確。** 授權判斷發生在請求當下，用的是當下的真實權限，
   而不是登入當下的快照。
5. **super-admin 展開成全集** 讓前端只有一種判斷方式（集合裡有沒有這個鍵），
   不會有 `if (isSuperAdmin || can(...))` 這種未來會被漏掉的分支。

### 11.4 代價

| 代價 | 緩解 |
| --- | --- |
| 每個請求多一次快取查詢 | in-memory Map，成本可忽略 |
| 快取失效的正確性成為關鍵 | 失效時機在 §5.1 列表化，且有 E2E 測試驗證「移除權限後下一次請求即 403」 |
| **刪除角色時的順序陷阱**：先刪再查會查不到受影響的人 | 當時明確規定「先查使用者、再刪角色」，並有專門的測試。改成整個租戶失效（§5.1）之後，持有者不再是失效的依據，只用於推播與補建個人資料夾 |
| 多執行個體時 in-memory 快取不同步 | 60 秒 TTL 是安全網；升級路徑是換 Redis 或 Postgres `LISTEN/NOTIFY`，介面不變（現已採 `LISTEN/NOTIFY`，§5.2） |

### 11.5 替代方案

| 方案 | 不採用的理由 |
| --- | --- |
| 權限寫進 JWT | 無法在 token 有效期內撤銷 |
| 角色寫進 JWT，權限每次查 | 只解決一半：角色變更仍有空窗，而且還是要查 DB |
| 完全不快取 | 每個請求一次三表 join。可行但沒必要，且列表頁的並發請求會放大 |
| 改用非常短的 token（30 秒） | 續期請求量暴增，且仍有空窗 |
