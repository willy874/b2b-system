# 後端 13 — 回收桶、還原與到期永久刪除

刪除的東西先進回收桶，保留期限內可以還原，到期後由排程永久刪除。
決策見 [ADR-0025](../../adr/0025-entity-revisions.md) D2、D5、D6、D8～D11；前端見 [`../frontend/13-trash.md`](../frontend/13-trash.md)。

目前（R3）**使用者**（§4）與 **角色**（§6）進回收桶；檔案與資料夾（R4）依 ADR 的分階段加入。

---

## 1. 組成

```
core/resource/resource-types.ts   RESOURCE_TYPE：跨模組的資源識別（user、role、file、fileFolder），與稽核、關係圖同一組字串
db/schema/soft-delete.ts          notDeleted(table)、isDeleted(table)（02-database.md §1）

modules/trash/                    通用模組：不 import 任何業務模組
├── trash.types.ts                TrashHandler、TrashItem、ExpiredTrashItem
├── trash.constants.ts            TRASH_RESOURCE_TYPES、TRASH_PERMISSIONS、TRASH_PURGE_BATCH_SIZE
├── trash.registry.ts             類型 → handler；啟動時檢查登記是否齊全
├── trash.service.ts              列表（含權限檢查）、到期永久刪除
├── trash-purge.job.ts            trash.purge 背景工作
├── trash.settings.ts             trash.retentionDays
└── trash.controller.ts           GET /trash

modules/user/user-trash.handler.ts   使用者的 TrashHandler（onModuleInit 註冊）
modules/user/user.service.ts         restore()：POST /users/:id/restore
modules/role/role-trash.handler.ts   角色的 TrashHandler
modules/role/role.service.ts         restore()：POST /roles/:id/restore
db/migrations/0012_*.sql             roles.deleted_at 改變時關係圖的 revision +1（§6.1）
```

- **擁有者模組實作、通用模組排程**（D9）：與審批的 `ApprovalHandler` 同一個模式。擁有者 import `TrashModule`，
  在 `onModuleInit` 呼叫 `TrashService.registerHandler(handler)`；`modules/trash` 只認識介面。
- **還原端點在擁有者的 controller**：`POST /<resource>/:id/restore`。權限宣告、`route-audit`、錯誤碼、
  連帶處理（D5、D6）都留在擁有者，通用模組不知道業務規則。
- **不提供手動永久刪除**（D9）：永久刪除只由排程執行。

### 1.1 `TrashHandler`

| 成員 | 說明 |
| --- | --- |
| `type` | `TRASH_RESOURCE_TYPES` 的一個值（`RESOURCE_TYPE`） |
| `permission` | 看這一類與還原所需的權限：`<resource>:delete`（D10：能刪就能復原） |
| `purgeOrder` | 永久刪除的順序，小的先：檔案 10 → 資料夾 20 → 使用者 30 → 角色 40（D11，外鍵的 `RESTRICT` 靠順序滿足） |
| `listDeleted(query)` | 已刪除的列（`deleted_at` 新的在前），回傳共用的 `TrashItem` 形狀：`name`、`description`、`deletedAt`、`deletedBy` |
| `findExpired(cutoff, afterId, limit)` | `deleted_at < cutoff`、依 `id` 的 keyset 取下一批；已知這一輪刪不掉的直接不回傳 |
| `purge(item, tx)` | 在呼叫端的交易（每一列一個 savepoint）內硬刪除並處理連帶資料；回傳 `false` 代表略過 |
| `afterPurge(ids)` | 一批提交之後的副作用：快取失效、`permissionsChanged()`、推播 |

與 ADR 的差異：D9 寫的是批次的 `purge(ids, tx)`；實作改成 `findExpired` ＋ 逐列 `purge` ＋ `afterPurge`，
讓一列因外鍵刪不掉時只略過它自己、略過的列不會在同一輪被重複取到，交易後的副作用也與交易內的刪除分開（登記在根目錄 `CLAUDE.md`）。

**新增一種類型**：在 `TRASH_RESOURCE_TYPES` 加值、在 `TRASH_PERMISSIONS` 加它的 `<resource>:delete`，
擁有者實作並註冊 handler、提供還原端點；前端同步登記（[`../frontend/13-trash.md`](../frontend/13-trash.md) §3）。
兩份清單與註冊不一致時程序啟動失敗（`TrashRegistry`：重複註冊、類型或權限不在清單、清單裡的類型沒有 handler）。

---

## 2. 軟刪除的查詢條件

所有查詢用 `notDeleted(table)`；故意讀已刪除的列（回收桶、還原、永久刪除）用 `isDeleted(table)`。
寫法與 🔒 掃描測試見 [`02-database.md`](./02-database.md) §1（D8）。

---

## 3. `GET /trash`

| 參數 | 說明 |
| --- | --- |
| `type` | 必填，`TrashResourceType`（`user`、`role`）。一次只列一種類型，不跨類型合併分頁（D9） |
| `offset`、`limit` | 一般的分頁（[`03-api-conventions.md`](./03-api-conventions.md) §2） |
| `keyword` | 選填；使用者比對 email 與顯示名稱，角色比對名稱與 slug |

回應的每一列（`TrashItem`）：`id`、`type`、`name`（使用者：顯示名稱；角色：名稱）、`description`（使用者：email；角色：說明，可能是 `null`）、
`deletedAt`、`deletedBy`（`{ id, name }` 或 `null`）、`purgeAt`（`deletedAt` ＋ 目前的保留天數）。
刪除者取自刪除時寫入的 `updated_by`（使用者與角色都一樣）：刪除之後沒有任何路徑會再更新那一列。
角色的持有者人數不在列表裡（`TrashItem` 是各類型共用的形狀）；還原的回應帶 `holdersRestored`。

**權限的兩層檢查**：

1. 路由宣告 `@RequireAnyPermission(...TRASH_PERMISSIONS)`：一種都不能刪的人由 `PermissionsGuard` 擋下
   （`403 AUTHZ_FORBIDDEN`、`authz.denied` 稽核），`route-audit` 的總表也看得到這個端點要哪些鍵。
2. `TrashService` 再以該類型 handler 的 `permission` 檢查一次：持有 `role:delete` 卻要看 `type=user` 時同樣
   `403 AUTHZ_FORBIDDEN`（`details.required`），並寫 `authz.denied`（`metadata.type`）。super-admin 豁免。

不用 `@Authenticated()` ＋ 只在 service 檢查：那樣沒有任何刪除權限的人也會進到 service，路由總表也看不出端點的權限。

---

## 4. 使用者

### 4.1 還原：`POST /users/:id/restore`

權限 `user:delete`（D10）。回應是還原後的 `User`。

1. 找已刪除的列；找不到 → 使用者存在但沒被刪除 `409 USER_NOT_DELETED`（與 `USER_NOT_LOCKED` 同一個語意），
   不存在或已被永久刪除 `404 USER_NOT_FOUND`。
2. 唯一值：email 或 username 已被 **未刪除** 的帳號使用 → `409 USER_EMAIL_DUPLICATE`／`USER_USERNAME_DUPLICATE`，
   `details: { field, value, conflictingUserId }`（D6）。email 不能改，管理者只能先處理佔用的帳號。
   檢查與寫入之間的競態由 partial unique index 擋下，照一般的唯一鍵衝突轉成同一個錯誤碼（不帶 `conflictingUserId`）。
3. 反提權：刪除時保留的持有者邊中 **仍存在** 的角色會跟著生效，所以先以 `assertRolesAssignable` 檢查它們
   （不能藉還原讓人取得自己給不了的角色，含 super-admin）。已刪除的角色的邊本來就被讀取忽略（D5「關聯略過」）。
4. 交易內：`UPDATE users SET deleted_at = NULL, updated_by = <actor> WHERE id = $id AND deleted_at IS NOT NULL`
   （並行的兩個還原只有一個命中，另一個 `409 USER_NOT_DELETED`）＋ 稽核 `user.restore`
   （`changes.after: { email, status }`、`metadata: { deletedAt, roles }`）。
5. 交易後：使用者快取與權限快取失效 → `permissionsChanged([id])` → `resource.changed`（`user` / `create`，`refs.role`）。

不回復的東西：

| 項目 | 還原後 | 理由 |
| --- | --- | --- |
| `status` | 維持刪除前的值（停用的仍是停用） | 刪除不改 `status` |
| `token_version` | 維持刪除時加一後的值 | 刪除前的 access token 不會復活 |
| refresh token | 不回復（刪除時已撤銷） | 要重新登入 |
| 外部身分連結 | 不回復（刪除時已解除） | 要重新連結 |
| 啟用／重設連結 | 不回復（刪除時已作廢） | 還沒啟用的人由「重設密碼」重寄啟用信（`resetPassword` 對 `pending` 寄啟用信） |
| `version` | 不遞增 | 與刪除相同，不是實體可編輯欄位的寫入（[`03-api-conventions.md`](./03-api-conventions.md) §11） |
| 個人資料夾 | 由 `permissions.changed` 的訂閱者（`FileSystemFolderService.ensurePersonalFolders`）補建 | 使用者模組不依賴檔案模組；刪除時空的個人資料夾已被刪掉，有內容的保留（還是他的） |

### 4.2 永久刪除

`findExpired` 排除 **還擁有資料夾** 的人（`file_folders.owner_id` 是 `ON DELETE RESTRICT`，含已軟刪除、尚未永久刪除的個人資料夾）：
他們這一輪略過，等資料夾先被清掉（R4 之後由檔案的 handler 以較小的 `purgeOrder` 先處理）。在那之前，
刪除時個人資料夾有內容、或曾經有過個人資料夾的人不會被永久刪除——這是 D11 的「本輪略過、下一輪再處理」，不是錯誤。

每一個指向 `users` 的參照（租戶 DB）與處理方式：

| 參照 | 刪除規則 | 處理 |
| --- | --- | --- |
| `relation_tuples`（主體 `user:<id>`：持有角色、資料夾授權；物件 `user:<id>`） | 多型，沒有外鍵 | `purge` 內明確刪除 |
| `relation_tuples.created_by` | `SET NULL` | 自動 |
| `refresh_tokens.user_id`、`auth_tokens.user_id`、`user_identities.user_id` | `CASCADE` | 自動 |
| `file_folders.owner_id` | `RESTRICT` | `findExpired` 排除；並行建立的由 savepoint 捕捉外鍵違反，當作略過 |
| `file_folders.created_by`／`updated_by`、`files.created_by`／`updated_by` | `SET NULL` | 自動 |
| `identity_providers.created_by`／`updated_by`、`system_settings.updated_by` | `SET NULL` | 自動 |
| `approval_requests.requester_id`／`reviewer_id` | `SET NULL` | 自動；申請人與審核者的名字另存成文字，列表照樣顯示 |
| `users.created_by`／`updated_by`、`roles.created_by`／`updated_by` | 沒有外鍵 | 保留原值（只剩 id，查不到名字） |
| `audit_logs.actor_id`、`resource_id` | 沒有外鍵（刻意反正規化） | 保留：稽核本來就不依賴使用者存在 |
| `job_outbox`／佇列裡帶 `userId` 的工作（寄信） | 沒有外鍵 | handler 執行時找不到使用者就略過（`user_not_found`） |

`afterPurge`：使用者與權限快取失效、`permissionsChanged()`（刪了持有者邊，照 05-rbac §5.1 的規則通知）、
`resource.changed`（`user` / `delete`，每人一筆）。

---

## 5. 到期永久刪除：`trash.purge`

| 項目 | 內容 |
| --- | --- |
| 工作 | `trash.purge`（`scope: 'tenant'`、`exclusive`），排程 `TRASH_PURGE_CRON`（預設 `30 4 * * *`，每天 04:30 UTC；空字串停用） |
| 保留天數 | 系統設定 `trash.retentionDays`（預設 30，1～365；[`12-settings.md`](./12-settings.md) §3） |
| 對象 | 依 `purgeOrder` 逐類處理 `deleted_at < now - retentionDays` 的列 |
| 交易 | 每批（`TRASH_PURGE_BATCH_SIZE` = 100）一個交易；每一列一個 savepoint：外鍵違反只略過那一列，其他錯誤讓整個工作失敗、依設定重試 |
| 稽核 | 每一列一筆 `<resource>.purge`，與刪除同一個 savepoint：`actorId: null`、`actorEmail: 'system'`、`metadata: { retentionDays, deletedAt }` |
| 結果 | 工作的 `output`：`{ retentionDays, cutoff, purged: { user: n, role: n }, skipped: { … } }` |

- 分批以 `id` 的 keyset 往後走：略過的列不會在同一輪被重複取到，一輪一定會結束。
- 中途失敗也安全：已提交的批次已經刪掉，重做時只剩還沒處理的列。
- 保留天數調小之後，下一次排程就依新的天數清除（沒有寬限期）。設定頁的說明寫明「到期後無法再還原」。

---

## 6. 角色（R3）

### 6.0 刪除保留持有者邊

刪除角色（`DELETE /roles/:id`）只軟刪除角色列，**不刪** 持有者邊 `role:<id>#holder@user:*`（D2）。權限鍵的邊與
以角色為主體的資料夾授權本來就保留。持有者在軟刪除之前查出（`findHolderIds`），只用來推播。

| 讀取 | 為什麼休眠的邊不生效 |
| --- | --- |
| 關係圖的主體閉包（權限集合） | 遞迴 CTE 只走未刪除的角色（`authz.repository.ts`） |
| 使用者的角色（`HELD_ROLE`：列表、詳情、`GET /users/:id/roles`）、`hasRoleSlug`、`countActiveUsersByRoleSlug`（最後一位 super-admin） | join `roles` 時加 `notDeleted(roles)`；super-admin 是系統角色、本來就刪不掉 |
| `GET /users?roleId=` | 子查詢只認未刪除的角色（以刪除的角色篩選是空的，不會列出休眠的持有者） |
| 以角色為起點的查詢（`countUsers`、`listUsers`、`userCountOf`、`findHolderIds`、`findUserIdsByRole`、`userHasRole`） | **不看** 角色是否刪除；呼叫端先確認角色的狀態（`findById`／`lockActive`），程式碼註解寫明這個前提（D2 ②）。還原時故意用 `countUsers` 算休眠的持有者 |

- `PUT /users/:id/roles`（`replaceRoles`）只刪 **未刪除角色** 的持有者邊（D2 ①）：改一次某人的角色不會清掉他在已刪除角色上的休眠邊。
- 刪除與還原都不寫 `relation_tuples`，但會改變權限的解析結果，所以 migration 0012 在 `roles.deleted_at` 改變時讓
  `authz_revision` +1（與 `relation_tuples` 的 trigger 同一個函式）。沒有它，其他程序收到的廣播 revision 沒前進、會被略過，
  刪除的角色的權限要等 TTL 才消失（[`05-rbac.md`](./05-rbac.md) §5.1）。
- 滾動部署期間舊版程式刪除角色時仍會刪邊；新版不依賴「刪除的角色一定有邊」，兩者並存無誤。**R3 之前刪除的角色已經沒有持有者邊**。

### 6.1 還原：`POST /roles/:id/restore`

權限 `role:delete`（D10）。回應是 `RestoredRole`：還原後的 `Role` ＋ `holdersRestored`（重新生效的持有者人數，等於還原後的 `userCount`）。

1. 找已刪除的列；找不到 → 角色存在但沒被刪除 `409 ROLE_NOT_DELETED`，不存在或已被永久刪除 `404 ROLE_NOT_FOUND`。
   系統角色刪不掉（service 與 DB trigger 都擋，[`../../rbac/01-domain-model.md`](../../rbac/01-domain-model.md) §5），所以不會走到還原。
2. 唯一值（D5）：名稱（不分大小寫）或 slug 已被 **未刪除** 的角色使用 → `409 ROLE_NAME_DUPLICATE`，
   `details: { field: 'name' | 'slug', value, conflictingRoleId }`。slug 建立後不可變：撞 slug 時只能先刪除佔用的角色；撞名稱時也可以先把它改名。
   檢查與寫入之間的競態由 partial unique index 擋下（同一個錯誤碼，不帶 `conflictingRoleId`）。
3. 反提權：`assertRolesAssignable(actor, [id])`——與指派角色同一個檢查。還原等於把這個角色（連同它的權限鍵）重新交給每一位原本的持有者，
   所以角色帶的鍵都要是 actor 持有的（`403 AUTHZ_ESCALATION`，`details.missing`）；super-admin 豁免。
   只比對權限鍵（`assertGrantable`）與它的差別只在 super-admin 角色的特判，而系統角色不會被刪除；選指派的檢查是讓規則的語意與效果（持有者重新生效）一致。
4. 交易內：`UPDATE roles SET deleted_at = NULL, updated_by = <actor> WHERE id = $id AND deleted_at IS NOT NULL`
   （並行的兩個還原只有一個命中，另一個 `409 ROLE_NOT_DELETED`）→ 計算 `holdersRestored`（休眠的邊中仍存在的使用者）→
   稽核 `role.restore`（`changes.after: { name, slug }`、`metadata: { deletedAt, holdersRestored }`）。
5. 交易後：`permissionsChanged(持有者)`（權限快取失效、個人資料夾補建）→ `resource.changed`：`role` / `create`（重新出現在列表、回收桶失效），
   加上每位持有者一筆 `userRole` / `update`（`refs.role`；他們的角色摘要與本人的 profile 重抓）。

`version` 不遞增（與刪除相同）。R3 之前刪除的角色沒有持有者邊，還原後沒有持有者：回應與稽核的 `holdersRestored` 是 0，這是預期的（ADR-0025 R3）。

### 6.2 永久刪除

沒有任何表以外鍵參照 `roles`；`purgeOrder` 40（最後），只是照 D11 的順序。`findExpired` 不排除任何列（系統角色刪不掉，不會出現）。

| 參照 | 處理 |
| --- | --- |
| `relation_tuples` 以角色為物件：持有者邊 `role:<id>#holder@user:*` | `purge` 內明確刪除（多型，沒有外鍵） |
| `relation_tuples` 以角色為主體：權限鍵 `tenant:self#<key>@role:<id>#holder`、資料夾授權 `fileFolder:<f>#<等級>@role:<id>#holder` | 同上 |
| `audit_logs.resource_id` | 保留：稽核不依賴角色存在（刻意反正規化，`resource_name` 存了名稱） |

`afterPurge`：`permissionsChanged()`（刪了邊，照 05-rbac §5.1 的規則通知）、`resource.changed`（`role` / `delete`，每個一筆）。

---

## 7. 錯誤碼

| 錯誤碼 | HTTP | 何時 |
| --- | --- | --- |
| `USER_NOT_DELETED` | 409 | 還原一個沒有被刪除的使用者，或被別人搶先還原 |
| `USER_EMAIL_DUPLICATE`／`USER_USERNAME_DUPLICATE` | 409 | 還原時 email／username 已被未刪除的帳號使用；`details.conflictingUserId` |
| `ROLE_NOT_DELETED` | 409 | 還原一個沒有被刪除的角色，或被別人搶先還原 |
| `ROLE_NAME_DUPLICATE` | 409 | 還原時名稱或 slug 已被未刪除的角色使用；`details.field`、`details.conflictingRoleId` |
| `AUTHZ_ESCALATION` | 403 | 還原會讓人取得 actor 指派不了的角色（使用者），或角色帶了 actor 沒有的權限鍵（角色） |
| `AUTHZ_FORBIDDEN` | 403 | 看回收桶的某一類卻沒有該類型的 `<resource>:delete` |

---

## 8. 測試

| 對象 | 檔案 |
| --- | --- |
| 列表的權限檢查、永久刪除的稽核、外鍵略過、keyset 分批、註冊檢查、排程註冊 | `src/modules/trash/__tests__/trash.service.spec.ts` |
| HTTP：還原（狀態保留、refresh token 不回復、個人資料夾補建、稽核）、409 帶 `conflictingUserId`、反提權、`USER_NOT_DELETED`／404、權限；`GET /trash` 的排序、刪除者、`purgeAt`、權限；`trash.purge` 的硬刪除與連帶資料、擁有資料夾時略過、依設定的保留天數 | `test/trash.spec.ts` |
| 角色：刪除保留持有者邊但權限立刻消失、依角色篩選與使用者的角色看不到刪除的角色、revision +1、`replaceRoles` 保留休眠的邊；還原（持有者回來、`holdersRestored`、R3 之前刪除的是 0、稽核）、名稱／slug 的 409 帶 `conflictingRoleId`、反提權、`ROLE_NOT_DELETED`／404、權限；`GET /trash?type=role`；`trash.purge` 刪除角色與所有邊 | `test/role-trash.spec.ts` |
| `notDeleted` 的掃描 | `src/__tests__/soft-delete-scan.spec.ts` |
| 端點的權限宣告 | `test/route-audit.spec.ts` |
