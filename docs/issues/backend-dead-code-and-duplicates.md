# 後端的過渡程式碼、複本與死碼：租戶 status='locked' 的分支、escapeLike 等工具的複本、沒人用的匯出

## 現況

### 1. 租戶使用者已經沒有 `status = 'locked'`，程式仍保留相容分支

- 登入失敗的鎖定已改成只寫 `locked_until`、不改 `status`（[`backend/04-auth.md`](../architecture/backend/04-auth.md) §3.3）。
  - 租戶 migration `apps/api/src/db/migrations/0003_auth_session_hardening.sql`（L3–6）已把既有的 `status = 'locked'` 改回 `active`。
  - `PATCH /users/:id` 只收 `active`／`inactive`。程式裡沒有任何地方會再把租戶使用者寫成 `locked`。
- 仍在判斷它的地方（`apps/api/src/modules/`）：
  - `auth/auth.service.ts` 的 `resetPassword()`：L501、L514、L530–531（含發出 `locked → active` 的狀態變更事件）。
  - `user/user.service.ts` 的 `unlock()`：L472、L480。
  - `user/user.repository.ts` 的 `statusCondition()`：L79。
  - `auth/external-login.service.ts` 的 `assertUsable()`：L329–331。L324 的註解寫「`status = locked` 是舊版鎖定留下的值」。
- dev seed 反而還在產生這種舊狀態：`apps/api/src/db/seeds/dev.ts` 的 `STATUS_PLAN`（L36–41）有 2 位 `locked`，寫入 `status: 'locked'` 加上 15 分鐘後到期的 `lockedUntil`（L195–196）。[`rbac/05-seed-and-bootstrap.md`](../rbac/05-seed-and-bootstrap.md)（L257）也照這樣寫。
- `user.service.ts` 的 `displayStatusOf()`（L69）把鎖定中的 `active` 顯示成 `locked`。這是對外的顯示值，要保留。

### 2. core 已有的工具在模組裡被複製

- `apps/api/src/core/database/like.ts` 已經有 `escapeLike()`、`containsPattern()`、`prefixPattern()`（L5–17）。下面四個 repository 卻各自內嵌一份相同的 `escapeLike()`（`apps/api/src/modules/`）：
  - `tenant/platform-tenant.repository.ts`（L42）
  - `file/file.repository.ts`（L80）
  - `audit-log/audit-log.repository.ts`（L39）
  - `platform-admin/platform-audit-log.repository.ts`（L23）
- 分批刪除的迴圈有四份：
  - 通用的 `deleteInBatches()` 放在業務模組 `credential/delete-in-batches.ts`，常數名是 `TOKEN_CLEANUP_BATCH_SIZE`。`platform-notification/platform-notification.service.ts`（L15、L137）跨模組借用它。
  - `notification/notification.service.ts` 另寫一份私有的 `deleteInBatches()`（L321 起）。
  - `webhook/webhook-delivery.service.ts` 的 `cleanup()`（L232–242）把迴圈直接寫在流程裡。

### 3. 沒人用的匯出

以名稱搜尋整個 repo（含測試與兩個前端），下列匯出沒有任何使用者：

- `core/config/config.module.ts` 的 `TypedConfigService`（L8）。
- `core/http/request-context.ts` 的 `getClientId()`（L41）。bus 直接讀 `getRequestContext()?.clientId`。
- `db/seeds/permissions.ts` 的 `PERMISSION_RESOURCES`（L100）。
- `USER_PERMISSIONS`、`ROLE_PERMISSIONS`、`GROUP_PERMISSIONS`、`PERMISSION_MODULE_PERMISSIONS`（各模組 `*.constants.ts` 的 L3）。controller 都直接用 `PERMISSION.*`。
- `modules/file/file.constants.ts` 的 `MAX_PARTS_PER_REQUEST`（L189）。`dto/create-file-upload.dto.ts` 的 `partNumbers` 另外寫死 `.max(100)`（L55）；同一處的 `.max(10_000)`（L53）也沒有引用 `MAX_PART_COUNT`。
- `RoleModule`、`PermissionModule` 把 repository 放進 `exports`（`role.module.ts` L15、`permission.module.ts` L15；後者還是 `@Global`）。
  - [`conventions/03-backend.md`](../conventions/03-backend.md) §1 第 8 條：跨模組只注入對方 `exports` 的 service。
  - 現在沒有別的模組注入它們（`layer-dependencies.spec.ts` 擋下了 import），所以這個匯出是多餘的。
- `common/decorators` 的 `@Audit()`：見 [`audit-decorator-without-interceptor.md`](./audit-decorator-without-interceptor.md)。

## 影響

沒有錯誤的結果，都是閱讀與維護的成本：

- 第 1 點：
  - 讀的人得自己判斷哪條分支還活著。
  - dev 資料裡那 2 位帳號 15 分鐘後會永遠顯示 `locked`，登入回 `AUTH_ACCOUNT_DISABLED`。正式環境的鎖定則是到期自動解除。在 dev 驗證鎖定行為的人，看到的是舊語意。
- 第 2 點：之後改跳脫規則或分批刪除的終止條件時，容易漏改其中幾份。
- 第 3 點：
  - 常數與 DTO 的字面量已經分歧，改常數不會生效。
  - 匯出的 repository 讓跨模組注入在 DI 層面是可行的，只剩 import 檢查在擋。

## 修正方式

1. 鎖定：
   - `dev.ts` 改成 `status: 'active'` 加上未來的 `lockedUntil`。rbac/05 L257 一起改。
   - 刪掉第 1 點列出的 `status === 'locked'` 分支，以及 L324 的註解。`users.status` 的 enum 值保留（DTO 的顯示值用得到）。
   - 可另加 `CHECK (status <> 'locked')` 約束，防止之後又被寫入。
2. 工具：
   - 四個 repository 改用 `@/core/database` 的 `containsPattern()`／`prefixPattern()`。
   - `deleteInBatches()` 搬到 `core/database`，批次大小改成參數；notification、webhook、platform-notification、credential 共用。
3. 死碼：
   - 刪除第 3 點的匯出。
   - DTO 改用 `MAX_PARTS_PER_REQUEST`、`MAX_PART_COUNT`。
   - 兩個 module 的 `exports` 拿掉 repository。

## 驗證方式

- `pnpm typecheck`、`pnpm lint`、`pnpm test` 通過。
- `pnpm db:seed:dev` 之後，那 2 位帳號 15 分鐘後恢復成 `active`，可以正常登入。
- `git grep -n "function escapeLike"` 只剩 `core/database/like.ts`。
