# 後端 13 — 回收桶、還原與到期永久刪除

刪除的東西先進回收桶，保留期限內可以還原，到期後由排程永久刪除。
決策見 [`backend/14-revisions.md`](14-revisions.md) §9.2 D2、D5、D6、D8～D11；前端見 [`../frontend/13-trash.md`](../frontend/13-trash.md)。
平台可對租戶關閉回收桶（feature `trash`，[`architecture/05-tenancy.md`](../05-tenancy.md) §12.2 D3）：`GET /trash` 與每個還原端點都標
`@RequireFeature('trash')`（新增可還原的資源時也要標），刪除與到期永久刪除照舊。

會進回收桶的類型以 `modules/trash/trash.constants.ts` 的 `TRASH_RESOURCE_TYPES` 為準（列在那裡卻沒有登記 handler，程序啟動失敗）。
目前是 **使用者**（§4）、**角色**（§6）、**群組**（§6.3）、**檔案** 與 **資料夾**（§7）、**公告**（[`19-announcement.md`](./19-announcement.md) §9.2 D19）。
檔案的物件（原檔、縮圖、變體）保留到永久刪除，
保留期限內還原不會少內容；這是分兩次部署做到的（[`14-revisions.md`](14-revisions.md) §9.3 的 R4a、R4b，§7.5）。

---

## 1. 組成

```
core/resource/resource-types.ts   RESOURCE_TYPE：跨模組的資源識別（user、role、group、file、fileFolder、serviceAccount、apiToken、webhook、tag、announcement），與稽核、關係圖同一組字串
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
modules/file/file-trash.handler.ts         檔案的 TrashHandler
modules/file/file-folder-trash.handler.ts  資料夾的 TrashHandler
modules/file/file.service.ts               restore()：POST /files/:id/restore
modules/file/file-folder.service.ts        restore()：POST /file-folders/:id/restore
modules/file/file-objects.service.ts       一個檔案的所有物件：刪除（刪除檔案、永久刪除共用）、還原前確認還在
db/migrations/0012_*.sql             roles.deleted_at 改變時關係圖的 revision +1（§6.1）
db/migrations/0013_*.sql             files.deletion_id、file_folders.deletion_id（§7.0）
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
| `feature` | 選填：這一類所屬的租戶 feature（[`frontend/02-plugin-system.md`](../frontend/02-plugin-system.md) §9）。檔案與資料夾是 `file`；使用者、角色是常駐的，沒有 |
| `purgeOrder` | 永久刪除的順序，小的先：檔案 10 → 資料夾 20 → 使用者 30 → 角色 40 → 群組 50 → 公告 60（D11，外鍵的 `RESTRICT` 靠順序滿足；公告見 [`19-announcement.md`](./19-announcement.md)，feature `announcement`） |
| `listDeleted(query)` | 已刪除的列（`deleted_at` 新的在前），回傳共用的 `TrashItem` 形狀：`name`、`description`、`deletedAt`、`deletedBy` |
| `findExpired(cutoff, afterId, limit)` | `deleted_at < cutoff`、依 `id` 的 keyset 取下一批；已知這一輪刪不掉的直接不回傳 |
| `purge(item, tx)` | 在呼叫端的交易（每一列一個 savepoint）內硬刪除並處理連帶資料；回傳 `false` 代表略過 |
| `afterPurge(ids)` | 一批提交之後的副作用：快取失效、`permissionsChanged()`、推播 |

與設計決策（[`14-revisions.md`](14-revisions.md) §9.2 D9）的差異：D9 寫的是批次的 `purge(ids, tx)`；實作改成 `findExpired` ＋ 逐列 `purge` ＋ `afterPurge`，
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
| `type` | 必填，`TrashResourceType`（`TRASH_RESOURCE_TYPES` 的值，見本文開頭）。一次只列一種類型，不跨類型合併分頁（D9） |
| `offset`、`limit` | 一般的分頁（[`03-api-conventions.md`](./03-api-conventions.md) §2） |
| `keyword` | 選填；使用者比對 email 與顯示名稱，角色比對名稱與 slug，檔案與資料夾比對名稱 |

回應的每一列（`TrashItem`）：`id`、`type`、`name`（使用者：顯示名稱；角色、檔案、資料夾：名稱）、
`description`（使用者：email；角色：說明，可能是 `null`；檔案：原本所在的資料夾路徑，例 `/素材/ui`，根目錄是 `/`；資料夾：原本的上層路徑）、
`deletedAt`、`deletedBy`（`{ id, name }` 或 `null`）、`purgeAt`（`deletedAt` ＋ 目前的保留天數）。
刪除者取自刪除時寫入的 `updated_by`（每一類都一樣）：刪除之後沒有任何路徑會再更新那一列。
角色的持有者人數不在列表裡（`TrashItem` 是各類型共用的形狀）；還原的回應帶 `holdersRestored`。

**權限的兩層檢查**：

1. 路由宣告 `@RequireAnyPermission(...TRASH_PERMISSIONS)`：一種都不能刪的人由 `PermissionsGuard` 擋下
   （`403 AUTHZ_FORBIDDEN`、`authz.denied` 稽核），`route-audit` 的總表也看得到這個端點要哪些鍵（`user:delete`、`role:delete`、`file:delete`）。
2. `TrashService` 再以該類型 handler 的 `permission` 檢查一次：持有 `role:delete` 卻要看 `type=user` 時同樣
   `403 AUTHZ_FORBIDDEN`（`details.required`），並寫 `authz.denied`（`metadata.type`）。super-admin 豁免。

不用 `@Authenticated()` ＋ 只在 service 檢查：那樣沒有任何刪除權限的人也會進到 service，路由總表也看不出端點的權限。

**租戶 feature**：handler 宣告了 `feature` 而租戶停用了它（例：停用檔案功能時的 `type=file`／`fileFolder`）→ `404 FEATURE_DISABLED`，
與那一類的端點（`@RequireFeature('file')`）一致，不暴露功能存在。`GET /trash` 本身是常駐的端點，無法以 `@RequireFeature` 標在路由上，
所以 `TrashService` 依類型判斷，並排在權限檢查 **之前**（與 `FeatureGuard` 排在 `PermissionsGuard` 之前同一個理由：功能沒開時一律 404，
不寫 `authz.denied`）。前端在 feature 停用時已經卸載該類型的分頁（[`../frontend/13-trash.md`](../frontend/13-trash.md)），這裡才是存取控制。
**到期永久刪除照常進行**：保留期限是資料的規則，與功能是否開著無關。

---

## 4. 使用者

### 4.1 還原：`POST /users/:id/restore`

權限 `user:delete`（D10）。回應是還原後的 `User`。

1. 找已刪除的列；找不到 → 使用者存在但沒被刪除 `409 USER_NOT_DELETED`（與 `USER_NOT_LOCKED` 同一個語意），
   不存在或已被永久刪除 `404 USER_NOT_FOUND`。
2. 唯一值：email 或 username 已被 **未刪除** 的帳號使用 → `409 USER_EMAIL_DUPLICATE`／`USER_USERNAME_DUPLICATE`，
   `details: { field, value, conflictingUserId }`（D6）。email 不能改，管理者只能先處理佔用的帳號。
   檢查與寫入之間的競態由 partial unique index 擋下，照一般的唯一鍵衝突轉成同一個錯誤碼（不帶 `conflictingUserId`）。
3. 反提權：刪除不動關係圖，保留的邊中 **仍存在** 的會跟著生效——他直接持有的角色，以及他直接所屬的群組
   （群組、上層群組持有的角色經由閉包回來）。所以先以 `assertCanGrant` 檢查 `role:<r>#holder` 與 `group:<g>#member`，
   與指派角色、加成員同一個規則（不能藉還原讓人取得自己給不了的角色，含 super-admin；[`05-rbac.md`](./05-rbac.md) §4.1）。
   已刪除的角色與群組的邊本來就被讀取忽略（D5「關聯略過」）。
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
他們這一輪略過，等資料夾先被清掉：資料夾的 handler（`purgeOrder` 20）排在使用者（30）之前，系統在刪除使用者時軟刪除的空個人資料夾
與使用者一起到期，**同一輪** 就先被清掉，使用者接著就能刪（§7.3）。個人資料夾比使用者晚一點點被刪（刪除使用者之後的事件），
截止時間剛好落在兩者之間時使用者這一輪略過、下一輪再刪。刪除時個人資料夾 **有內容** 的人，資料夾不會被刪（留給管理者整理），
他也就不會被永久刪除——這是 D11 的「本輪略過、下一輪再處理」，不是錯誤。

每一個指向 `users` 的參照（租戶 DB）與處理方式：

| 參照 | 刪除規則 | 處理 |
| --- | --- | --- |
| `relation_tuples`（主體 `user:<id>`：持有角色、資料夾授權；物件 `user:<id>`） | 多型，沒有外鍵 | `purge` 內明確刪除 |
| `relation_tuples.created_by` | `SET NULL` | 自動 |
| `resource_tags`（`resource_type = 'user'`；檔案、資料夾的 handler 同樣清 `file`、`fileFolder`） | 多型，沒有外鍵 | `purge` 內以 `TagService.removeAllFor()` 刪除（[`18-tag.md`](./18-tag.md) §1.1） |
| `tags.created_by`／`updated_by`、`resource_tags.created_by` | `SET NULL` | 自動 |
| `refresh_tokens.user_id`、`auth_tokens.user_id`、`user_identities.user_id` | `CASCADE` | 自動 |
| `file_folders.owner_id` | `RESTRICT` | `findExpired` 排除；並行建立的由 savepoint 捕捉外鍵違反，當作略過 |
| `file_folders.created_by`／`updated_by`、`files.created_by`／`updated_by` | `SET NULL` | 自動 |
| `identity_providers.created_by`／`updated_by`、`system_settings.updated_by` | `SET NULL` | 自動 |
| `revisions.actor_id`（版本的作者，[`14-revisions.md`](./14-revisions.md) §2） | `SET NULL` | 自動；版本保留，作者顯示為「系統」 |
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
| 結果 | 工作的 `output`：`{ retentionDays, cutoff, purged: { <type>: n, … }, skipped: { … } }`（以 `TrashResourceType` 為鍵） |
| 順序 | 檔案（10）→ 資料夾（20）→ 使用者（30）→ 角色（40）→ 群組（50）→ 公告（60）：`files.folder_id`、`file_folders.parent_id`、`file_folders.owner_id` 都是 `RESTRICT` |

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
| 以角色為起點的查詢（`listUsers`、`userCountOf`、`findHolderIds`） | **不看** 角色是否刪除；呼叫端先確認角色的狀態（`findById`／`lockActive`），程式碼註解寫明這個前提（D2 ②） |
| 含經由群組的持有者（`PermissionService.findUserIdsHoldingRole`） | 走關係圖，**角色已刪除時是空的**：刪除角色在軟刪除之前（交易內、鎖住角色列之後）查；還原時在清掉 `deleted_at` 之後、同一個交易內查（`holdersRestored`） |

- `PUT /users/:id/roles`（`replaceRoles`）只刪 **未刪除角色** 的持有者邊（D2 ①）：改一次某人的角色不會清掉他在已刪除角色上的休眠邊。
- 刪除與還原都不寫 `relation_tuples`，但會改變權限的解析結果，所以 migration 0012 在 `roles.deleted_at` 改變時讓
  `authz_revision` +1（與 `relation_tuples` 的 trigger 同一個函式）。沒有它，其他程序收到的廣播 revision 沒前進、會被略過，
  刪除的角色的權限要等 TTL 才消失（[`05-rbac.md`](./05-rbac.md) §5.1）。
- 滾動部署期間舊版程式刪除角色時仍會刪邊；新版不依賴「刪除的角色一定有邊」，兩者並存無誤。**R3 之前刪除的角色已經沒有持有者邊**。

### 6.1 還原：`POST /roles/:id/restore`

權限 `role:delete`（D10）。回應是 `RestoredRole`：還原後的 `Role` ＋ `holdersRestored`（重新取得這個角色的人數，含經由群組持有的；直接持有者的人數是還原後的 `userCount`）。

1. 找已刪除的列；找不到 → 角色存在但沒被刪除 `409 ROLE_NOT_DELETED`，不存在或已被永久刪除 `404 ROLE_NOT_FOUND`。
   系統角色刪不掉（service 與 DB trigger 都擋，[`../../rbac/01-domain-model.md`](../../rbac/01-domain-model.md) §5），所以不會走到還原。
2. 唯一值（D5）：名稱（不分大小寫）或 slug 已被 **未刪除** 的角色使用 → `409 ROLE_NAME_DUPLICATE`，
   `details: { field: 'name' | 'slug', value, conflictingRoleId }`。slug 建立後不可變：撞 slug 時只能先刪除佔用的角色；撞名稱時也可以先把它改名。
   檢查與寫入之間的競態由 partial unique index 擋下（同一個錯誤碼，不帶 `conflictingRoleId`）。
3. 反提權：`assertRolesAssignable(actor, [id])`——與指派角色同一個檢查。還原等於把這個角色（連同它的權限鍵）重新交給每一位原本的持有者，
   所以角色帶的鍵都要是 actor 持有的（`403 AUTHZ_ESCALATION`，`details.missing`）；super-admin 豁免。
   只比對權限鍵（`assertGrantable`）與它的差別只在 super-admin 角色的特判，而系統角色不會被刪除；選指派的檢查是讓規則的語意與效果（持有者重新生效）一致。
4. 交易內：`UPDATE roles SET deleted_at = NULL, updated_by = <actor> WHERE id = $id AND deleted_at IS NOT NULL`
   （並行的兩個還原只有一個命中，另一個 `409 ROLE_NOT_DELETED`）→ 計算 `holdersRestored`（休眠的邊帶回的、未刪除的使用者，含經由群組持有的）→
   稽核 `role.restore`（`changes.after: { name, slug }`、`metadata: { deletedAt, holdersRestored }`）。
5. 交易後：`permissionsChanged(持有者)`（權限快取失效、個人資料夾補建）→ `resource.changed`：`role` / `create`（重新出現在列表、回收桶失效），
   加上每位持有者（含經由群組的）一筆 `userRole` / `update`（`refs.role`；他們的角色摘要與本人的 profile 重抓）。
   持有者多到一則推播放不下（合約上限 100 筆，[`08-realtime.md`](./08-realtime.md) §9）時改成一筆不帶 id 的 `userRole` / `update`。

`version` 不遞增（與刪除相同）。R3 之前刪除的角色沒有持有者邊，還原後沒有持有者：回應與稽核的 `holdersRestored` 是 0，這是預期的（[`backend/14-revisions.md`](14-revisions.md) §9 R3）。

### 6.2 永久刪除

沒有任何表以外鍵參照 `roles`；`purgeOrder` 40（最後），只是照 D11 的順序。`findExpired` 不排除任何列（系統角色刪不掉，不會出現）。

| 參照 | 處理 |
| --- | --- |
| `relation_tuples` 以角色為物件：持有者邊 `role:<id>#holder@user:*` | `purge` 內明確刪除（多型，沒有外鍵） |
| `relation_tuples` 以角色為主體：權限鍵 `tenant:self#<key>@role:<id>#holder`、資料夾授權 `fileFolder:<f>#<等級>@role:<id>#holder` | 同上 |
| `revisions`（`resource_type = 'role'`，[`14-revisions.md`](./14-revisions.md) §5.1） | `purge` 內以 `RevisionService.deleteAll()` 刪除（多型，沒有外鍵） |
| `audit_logs.resource_id` | 保留：稽核不依賴角色存在（刻意反正規化，`resource_name` 存了名稱） |

`afterPurge`：`permissionsChanged()`（刪了邊，照 05-rbac §5.1 的規則通知）、`resource.changed`（`role` / `delete`，每個一筆）。

---

### 6.3 群組（[`rbac/01-domain-model.md`](../../rbac/01-domain-model.md) §9 G4a）

與角色相同的模式：`DELETE /groups/:id` 軟刪除，成員邊（`group:<id>#member@…`）、上層群組的成員邊（`…@group:<id>#member`）、持有的角色、
以它為對象的資料夾授權都 **保留**（休眠），主體閉包略過已刪除的群組；`groups.deleted_at` 的改變由 trigger 讓 revision +1（migration 0017）。
`POST /groups/:id/restore`（`group:delete`）清 `deleted_at`，反提權與加成員相同（`group:G#member` 帶來的租戶能力，[`rbac/01-domain-model.md`](../../rbac/01-domain-model.md) §9.3 D11），
並檢查刪除期間結構有沒有變成循環或超過巢狀層數。永久刪除（`GroupTrashHandler`，`purgeOrder` 50）：沒有外鍵參照 `groups`，
`purge` 刪群組列與以它為物件或主體的 `relation_tuples`；`afterPurge` 呼叫 `permissionsChanged()` 並推 `group` / `delete`。

## 7. 檔案與資料夾

### 7.0 刪除：`deletion_id` 與物件

| 操作 | 軟刪除的列 | `deletion_id` | 物件儲存的內容 |
| --- | --- | --- | --- |
| `DELETE /files/:id` | 那個檔案 | 新的一個 | 保留（原檔、瀏覽器縮圖、變體），`trash.purge` 永久刪除之後才刪（§7.3） |
| `DELETE /file-folders/:id`（遞迴） | 資料夾、所有子孫資料夾、其中的檔案（含上傳中的） | 同一個（刪除時間也相同） | 保留（本來就不在請求內刪） |
| 放棄上傳、維護排程清掉逾時的上傳 | 那個 `pending` 檔案 | 新的一個 | 當下刪（從未可見，不進回收桶） |
| 系統刪除擁有者已刪除的空個人資料夾 | 那個個人資料夾 | 新的一個 | 沒有內容 |

- `files.deletion_id`、`file_folders.deletion_id`（`uuid NULL`，migration 0013；[`02-database.md`](./02-database.md) §5.2）：未刪除時是 null，還原時清掉。
  **migration 0013 之前（R4a 之前）刪除的列是 null**：以 `IS NOT DISTINCT FROM` 比對，舊的遞迴刪除（資料夾與檔案都是 null）整棵視為同一批。
- **資料夾授權不動**：刪除資料夾不刪 `relation_tuples` 上以它為物件的授權邊。刪除的資料夾不在資料夾結構（`FileFolderTree`，只載入未刪除的）裡，
  沒有上層、繼承與建立者的結構邊，授權也就流不到任何地方（與 D2「保留的邊休眠」同一個道理）；還原後結構回來，授權隨之生效。永久刪除時才刪邊（§7.3）。
- **維護排程的孤兒**（[`09-file.md`](./09-file.md) §9 第 3 類）：「查不到 **任何** 紀錄（含已軟刪除的）」的物件，
  已刪除紀錄的物件留給 `trash.purge`。

### 7.1 還原資料夾：`POST /file-folders/:id/restore`

閘門 `file:access` 或 `file:delete`（與刪除相同）。回應是 `RestoredFileFolder`：還原後的 `FileFolder` ＋ `foldersRestored`（含自己）、
`filesRestored`、`filesSkipped`。

1. 找已刪除的列；找不到 → 資料夾存在但沒被刪除 `409 FILE_FOLDER_NOT_DELETED`，不存在或已被永久刪除 `404 FILE_FOLDER_NOT_FOUND`。
   系統資料夾（共用、私人、個人）只由系統刪除 → `403 FILE_FOLDER_SYSTEM_PROTECTED`（還原別人的個人資料夾會與補建的新個人資料夾衝突）。
2. 上層已刪除 → `409 FILE_FOLDER_RESTORE_CONFLICT`，`details: { reason: 'parentDeleted', parentType: 'fileFolder', parentId }`（D5：先還原上層）。
3. **同一批**：從這個資料夾往下，只走已刪除、`deletion_id` 相同的子資料夾（遞迴 CTE）；之前個別刪掉的子資料夾（連同它底下的）與檔案 `deletion_id` 不同，維持刪除。
   同一批的檔案只取已完成上傳的（`pending` 的直傳網址早已過期，只能重新上傳）。
4. 在排隊之前逐一 HeadObject 確認檔案的物件還在（並行上限 16）。**原檔不在的檔案維持刪除**（`filesSkipped`），不讓整個資料夾的還原失敗：
   資料夾本身沒有內容，擋下來只會讓其他檔案也救不回來；那些檔案之後以個別項目出現在回收桶的「檔案」分頁（所在的資料夾已還原），還原會得到 `objectMissing`。
   瀏覽器縮圖不在 → `has_thumbnail = false`；影像變體不在 → `variant_status = 'pending'`，交易後重新排入產生。
5. `FileFolderTree.write` 的交易（樹鎖）內：重新確認上層還在 → 同一層同名（不分大小寫、未刪除）→ `409 FILE_FOLDER_NAME_CONFLICT`，
   `details: { name, conflictingId }`（D5，唯一值衝突沿用建立時的錯誤碼）；競態由 partial unique index 擋下，轉成同一個錯誤碼（不帶 `conflictingId`）→
   `UPDATE … SET deleted_at = NULL, deletion_id = NULL WHERE id = ANY(同一批) AND deleted_at IS NOT NULL AND deletion_id IS NOT DISTINCT FROM $d`
   （並行的兩個還原只有一個命中，另一個 `409 FILE_FOLDER_NOT_DELETED`）→ 深度上限（上層可能在刪除後被移得更深）→ 還原確認過的檔案。
6. **權限以還原之後的結構判斷**：同一個交易內建立存取判斷（此時結構已含還原的資料夾），照 **刪除** 的規則檢查「現在能不能刪掉它」——
   讀得到這個資料夾（否則 403）、`can_remove`、只靠擁有者規則時子樹沒有別人的東西（`not-owner`）、子樹裡的私人資料夾要另外有刪除權（`protected-subfolder`）。
   不能就整個 rollback（拒絕照常寫 `authz.denied`，在交易外）。授權是沿結構繼承的，資料夾不在結構裡時無法判斷；還原之後判斷才與刪除完全一致。
7. 稽核 `fileFolder.restore`（`changes.after: { name, parentId }`、`metadata: { deletedAt, deletionId, folderCount, fileCount, filesSkipped }`）與還原同一個交易。
8. 交易後：結構快取失效（`FileFolderTree.write`）→ 重新排入變體 → `resource.changed`：`fileFolder` / `create`、有檔案時加一筆 `file` / `create`（`id = '*'`）。

### 7.2 還原檔案：`POST /files/:id/restore`

閘門 `file:access` 或 `file:delete`。回應是還原後的 `StoredFile`。

1. 找已刪除、已完成上傳的列；找不到 → 檔案存在、沒被刪除而且看得到 `409 FILE_NOT_DELETED`，否則（不存在、已被永久刪除、放棄的上傳、
   看不到所在的資料夾）`404 FILE_NOT_FOUND`。
2. 所在的資料夾已刪除 → `409 FILE_RESTORE_CONFLICT`，`details: { reason: 'parentDeleted', parentType: 'fileFolder', parentId }`。
3. 權限與刪除相同：讀得到所在的資料夾（否則 `404 FILE_NOT_FOUND`），而且 `can_remove`（資料夾的 `can_delete`，或本人上傳而仍能在那裡上傳；否則 `403 AUTHZ_FORBIDDEN`）。
4. 原檔已不在物件儲存 → `409 FILE_RESTORE_CONFLICT`，`details: { reason: 'objectMissing' }`。刪除時物件會保留，
   只剩人為刪除、維護排程誤判，或 R4b 之前（刪除當下仍刪物件）個別刪除的檔案會造成。這個檢查永久保留。縮圖、變體不在時與 §7.1 第 4 步相同，只修正紀錄。
5. 交易內（與遞迴刪除排隊：資料夾在檢查之後才被刪時同樣回 `parentDeleted`）：以 `deletion_id` 為條件清 `deleted_at`、`deletion_id`（被搶先 → `FILE_NOT_DELETED`）＋
   稽核 `file.restore`（`changes.after: { name, folderId }`、`metadata: { deletedAt, deletionId }`）。
6. 交易後：`file` / `create`（`refs.fileFolder` 是所在的資料夾）。

檔名沒有唯一性，沒有同名衝突。`version` 不遞增（與刪除相同）。

### 7.3 永久刪除

| 類型 | `purgeOrder` | `findExpired` | `purge` | `afterPurge` |
| --- | --- | --- | --- | --- |
| `file` | 10 | 所有到期的已刪除檔案（含放棄的上傳、跟著資料夾刪的） | 硬刪除列 ＋ 以它為物件的 `relation_tuples` | **提交之後** 刪物件（原檔、縮圖、`variants/<id>/`，並行上限 16，失敗只記 warn）→ `file` / `delete` |
| `fileFolder` | 20 | 到期子樹的 **根**（上層也到期的不回傳，由上層一起刪） | 子樹所有已刪除的資料夾由最深一層往上硬刪（`parent_id` 是 `RESTRICT`）＋ 以它們為物件或主體的 `relation_tuples`（資料夾授權） | `fileFolder` / `delete`；不必 `permissionsChanged()`（資料夾授權不在權限快取裡，09-file §11），revision 由 `relation_tuples` 的 trigger +1 |

- 上層到期 ⇒ 子孫也到期：子孫不是與上層同時刪除，就是更早個別刪除（上層被刪之後不可能再有東西被刪）。
- 資料夾裡還有沒清掉的檔案（例：這一輪檔案的 purge 失敗）→ 外鍵違反，savepoint 當作這一輪略過。
- 系統刪除的個人資料夾也在這裡清掉，擁有者（`owner_id` 是 `RESTRICT`）才能被永久刪除（§4.2）。
- 物件在交易 **之後** 才刪：交易 rollback 時紀錄還在、內容也要在。提交後、刪物件前中斷 → 物件查不到任何紀錄，由維護排程的孤兒對帳清掉。
- 存取申請（`approval_requests` 的 payload 帶資料夾 id）沒有外鍵，不清；審核時資料夾不存在會回 `FILE_FOLDER_NOT_FOUND`。

### 7.4 權限：回收桶與還原

| 入口 | 規則 |
| --- | --- |
| 回收桶（`GET /trash?type=file`／`fileFolder`） | **全域** `file:delete`（handler 的 `permission`），與使用者、角色相同的兩層檢查（§3） |
| 還原端點 | 與刪除相同：閘門 `file:access` 或 `file:delete`，範圍由資料夾授權與擁有者規則判斷（§7.1 第 6 步、§7.2 第 3 步） |

只有資料夾層級刪除權的人（`file:access` ＋ 資料夾的 `editor`，或擁有者規則）看不到回收桶，但能以刪除提示的「復原」還原自己剛刪的東西，
也能直接呼叫還原端點。回收桶不做「只列你還原得了的項目」：那要為每一列建立存取判斷（已刪除的資料夾不在結構裡，還要模擬還原後的結構），
而且列表的分頁與總數會隨權限變動；全域權限的持有者才是清理回收桶的角色。這與 D10「能刪就能復原」一致——回收桶是全域的管理介面，
對應全域的刪除權。

### 7.5 兩次部署（R4a、R4b）

「刪除時保留物件」與「維護排程不刪已刪除紀錄的物件」必須有先後：滾動部署期間舊版的維護排程會把「紀錄已刪除」的物件當孤兒刪掉，
新版保留的物件就白留了。所以分兩次部署：

| 階段 | 內容 |
| --- | --- |
| R4a | `deletion_id`（migration 0013）、維護排程的孤兒改成「查不到任何紀錄」、還原端點、回收桶與永久刪除；`DELETE /files/:id` 仍在交易後立刻刪物件，前端的檔案刪除提示不附「復原」 |
| R4b | R4a 的維護排程全部上線之後：`FileService.remove()` 不再刪物件（留到 `trash.purge`）；檔案刪除提示附「復原」、確認文字改成「移到回收桶，保留期限內可以還原」 |

R4b 之前個別刪除的檔案已經沒有物件，還原會得到 `objectMissing`（§7.2 第 4 步）；它們到期後照常被 `trash.purge` 清掉。

**儲存用量**：物件多保留一個 `trash.retentionDays`。系統目前沒有依紀錄統計用量或檢查配額的地方（上傳只檢查單檔上限 `file.uploadMaxSize`），
所以回收桶裡的檔案不影響任何計算；之後加用量指標或配額時要決定是否計入回收桶（`observability` 提案），要縮短保留就調小 `trash.retentionDays`。

---

## 8. 錯誤碼

| 錯誤碼 | HTTP | 何時 |
| --- | --- | --- |
| `USER_NOT_DELETED` | 409 | 還原一個沒有被刪除的使用者，或被別人搶先還原 |
| `USER_EMAIL_DUPLICATE`／`USER_USERNAME_DUPLICATE` | 409 | 還原時 email／username 已被未刪除的帳號使用；`details.conflictingUserId` |
| `ROLE_NOT_DELETED` | 409 | 還原一個沒有被刪除的角色，或被別人搶先還原 |
| `ROLE_NAME_DUPLICATE` | 409 | 還原時名稱或 slug 已被未刪除的角色使用；`details.field`、`details.conflictingRoleId` |
| `AUTHZ_ESCALATION` | 403 | 還原會讓人取得 actor 指派不了的角色（使用者），或角色帶了 actor 沒有的權限鍵（角色） |
| `AUTHZ_FORBIDDEN` | 403 | 看回收桶的某一類卻沒有該類型的 `<resource>:delete`；還原檔案或資料夾時不能刪除它（§7.1、§7.2） |
| `FILE_NOT_DELETED`／`FILE_FOLDER_NOT_DELETED` | 409 | 還原一個沒有被刪除的檔案／資料夾，或被別人搶先還原 |
| `FILE_RESTORE_CONFLICT` | 409 | 還原檔案：`details.reason` 是 `parentDeleted`（帶 `parentType`、`parentId`）或 `objectMissing` |
| `FILE_FOLDER_RESTORE_CONFLICT` | 409 | 還原資料夾：上層已刪除（`reason: 'parentDeleted'`） |
| `FILE_FOLDER_NAME_CONFLICT` | 409 | 還原資料夾時同一層已有同名的資料夾；`details.conflictingId` |
| `FEATURE_DISABLED` | 404 | `GET /trash?type=` 的類型所屬的租戶 feature 已停用（§3） |

---

## 9. 測試

| 對象 | 檔案 |
| --- | --- |
| 列表的權限檢查、租戶 feature 停用時 `FEATURE_DISABLED`（到期永久刪除照常）、永久刪除的稽核、外鍵略過、keyset 分批、註冊檢查、排程註冊 | `src/modules/trash/__tests__/trash.service.spec.ts` |
| HTTP：還原（狀態保留、refresh token 不回復、個人資料夾補建、稽核）、409 帶 `conflictingUserId`、反提權、`USER_NOT_DELETED`／404、權限；`GET /trash` 的排序、刪除者、`purgeAt`、權限；`trash.purge` 的硬刪除與連帶資料、擁有資料夾時略過、依設定的保留天數 | `test/trash.spec.ts` |
| 角色：刪除保留持有者邊但權限立刻消失、依角色篩選與使用者的角色看不到刪除的角色、revision +1、`replaceRoles` 保留休眠的邊；還原（持有者回來、`holdersRestored`、R3 之前刪除的是 0、稽核）、名稱／slug 的 409 帶 `conflictingRoleId`、反提權、`ROLE_NOT_DELETED`／404、權限；`GET /trash?type=role`；`trash.purge` 刪除角色與所有邊 | `test/role-trash.spec.ts` |
| 檔案與資料夾：`deletion_id` 的批次、刪除後物件保留而還原成功、物件已不在時 `objectMissing`、只還原同一批、物件不在的檔案略過、`parentDeleted`、同名的 `conflictingId`、`*_NOT_DELETED`／404、權限（只能讀的人 403、資料夾授權的成員還原自己的檔案但看不到回收桶）、資料夾授權還原後生效；`GET /trash` 只列批次的根與個別刪除的檔案（帶路徑）；維護排程不刪已刪除紀錄的物件；`trash.purge` 刪列、授權的邊、物件，個人資料夾清掉後同一輪刪除使用者 | `test/file-trash.spec.ts` |
| 檔案的還原規則（每個 `AppException` 分支、縮圖與變體的修正、擁有者規則） | `src/modules/file/__tests__/file.service.spec.ts` |
| 資料夾的還原規則（同一批、略過、衝突、系統資料夾、以還原後的結構判斷權限） | `src/modules/file/__tests__/file-folder.service.spec.ts` |
| 維護排程不把已刪除紀錄的物件當孤兒 | `src/modules/file/__tests__/file-maintenance.service.spec.ts` |
| `notDeleted` 的掃描 | `src/__tests__/soft-delete-scan.spec.ts` |
| 端點的權限宣告 | `test/route-audit.spec.ts` |
