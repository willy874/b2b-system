# 後端 13 — 回收桶、還原與到期永久刪除

刪除的東西先進回收桶，保留期限內可以還原，到期後由排程永久刪除。
決策見 [ADR-0025](../../adr/0025-entity-revisions.md) D5、D6、D8～D11；前端見 [`../frontend/13-trash.md`](../frontend/13-trash.md)。

目前（R2）只有 **使用者** 進回收桶；角色（R3）、檔案與資料夾（R4）依 ADR 的分階段加入。

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
| `type` | 必填，`TrashResourceType`（目前只有 `user`）。一次只列一種類型，不跨類型合併分頁（D9） |
| `offset`、`limit` | 一般的分頁（[`03-api-conventions.md`](./03-api-conventions.md) §2） |
| `keyword` | 選填；使用者比對 email 與顯示名稱 |

回應的每一列（`TrashItem`）：`id`、`type`、`name`（使用者：顯示名稱）、`description`（使用者：email）、`deletedAt`、
`deletedBy`（`{ id, name }` 或 `null`）、`purgeAt`（`deletedAt` ＋ 目前的保留天數）。
使用者的刪除者取自刪除時寫入的 `updated_by`：刪除之後沒有任何路徑會再更新那一列。

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
| 結果 | 工作的 `output`：`{ retentionDays, cutoff, purged: { user: n }, skipped: { user: n } }` |

- 分批以 `id` 的 keyset 往後走：略過的列不會在同一輪被重複取到，一輪一定會結束。
- 中途失敗也安全：已提交的批次已經刪掉，重做時只剩還沒處理的列。
- 保留天數調小之後，下一次排程就依新的天數清除（沒有寬限期）。設定頁的說明寫明「到期後無法再還原」。

---

## 6. 錯誤碼

| 錯誤碼 | HTTP | 何時 |
| --- | --- | --- |
| `USER_NOT_DELETED` | 409 | 還原一個沒有被刪除的使用者，或被別人搶先還原 |
| `USER_EMAIL_DUPLICATE`／`USER_USERNAME_DUPLICATE` | 409 | 還原時 email／username 已被未刪除的帳號使用；`details.conflictingUserId` |
| `AUTHZ_ESCALATION` | 403 | 還原會讓人取得 actor 指派不了的角色 |
| `AUTHZ_FORBIDDEN` | 403 | 看回收桶的某一類卻沒有該類型的 `<resource>:delete` |

---

## 7. 測試

| 對象 | 檔案 |
| --- | --- |
| 列表的權限檢查、永久刪除的稽核、外鍵略過、keyset 分批、註冊檢查、排程註冊 | `src/modules/trash/__tests__/trash.service.spec.ts` |
| HTTP：還原（狀態保留、refresh token 不回復、個人資料夾補建、稽核）、409 帶 `conflictingUserId`、反提權、`USER_NOT_DELETED`／404、權限；`GET /trash` 的排序、刪除者、`purgeAt`、權限；`trash.purge` 的硬刪除與連帶資料、擁有資料夾時略過、依設定的保留天數 | `test/trash.spec.ts` |
| `notDeleted` 的掃描 | `src/__tests__/soft-delete-scan.spec.ts` |
| 端點的權限宣告 | `test/route-audit.spec.ts` |
