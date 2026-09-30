# 後端 14 — 版本歷史

選擇性加入的實體每次寫入後存一份 **整份** 快照，可以列出版本、檢視某一版、與目前或前一版比較，並還原到某一版。
決策見 [ADR-0025](../../adr/0025-entity-revisions.md) D1、D7、D10、D12（R5）；前端見 [`../frontend/14-revisions.md`](../frontend/14-revisions.md)。

目前加入的實體只有 **角色**（名稱、說明、權限鍵；§4）。

---

## 1. 組成

```
db/schema/revisions.ts              revisions 表（租戶 DB）
db/migrations/0014_revisions.sql    建表 ＋ 既有角色的基準版本（手寫，§4.2）
core/resource/resource-types.ts     RESOURCE_TYPE：resource_type 的值（與稽核、關係圖、回收桶同一組字串）

modules/revision/                   通用模組：不 import 任何業務模組
├── revision.constants.ts           REVISION_RESOURCE_TYPES、REVISION_SNAPSHOT_MAX_BYTES（1 MiB）、REVISION_PRUNE_BATCH_SIZE
├── revision.repository.ts          寫入下一版、列表、單版、刪除某資源的所有版本、保留清理的一批
├── revision.service.ts             RevisionService：record()、list()、get()、getSnapshot()、deleteAll()、prune()
├── revision-prune.job.ts           revision.prune 背景工作
├── revision.settings.ts            revision.keepVersions、revision.keepDays
└── dto/revision.dto.ts             ListRevisionSchema、RevisionVersionSchema、RevisionSummary

modules/role/role-revision.ts       角色的白名單 toRoleRevision()、RoleRevisionSnapshotSchema（純函式，seed 也用）
modules/role/dto/role-revision.dto.ts   RoleRevision、RevertRoleRevisionRequest
modules/role/role.service.ts        寫入時記錄；listRevisions()、getRevision()、revertToRevision()
modules/role/role-trash.handler.ts  永久刪除角色時一起刪掉它的版本
```

- **`RevisionWriter` 就是 `RevisionService.record()`**：放在通用的 `modules/revision`（與 `modules/trash` 同一種模組），
  而不是 `core/`——它需要 repository 與系統設定，是一般的 Nest 模組；業務模組 import `RevisionModule` 使用它，
  它不認識任何業務模組（🔒 `layer-dependencies.spec.ts`）。
- **擁有者決定內容與權限**：快照的白名單、版本端點與權限宣告、還原時的業務規則都在擁有者模組（角色在 `modules/role`），
  與回收桶的還原端點同一個理由（ADR-0025 D9）。`modules/revision` 只負責存、讀、清。
- 版本與稽核分開保存（D10）：稽核仍只存變更的欄位（`06-audit-log.md` §5），版本存整份；權限與保留期限各自獨立。

---

## 2. `revisions` 表

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | `uuid` PK | |
| `resource_type` | `text` | `RESOURCE_TYPE` 的值（`role`…）；text ＋ 程式常數，不用 Postgres enum（D7、[`02-database.md`](./02-database.md) §1 的例外） |
| `resource_id` | `uuid` | 實體的 id；多型，沒有外鍵 |
| `version` | `integer` | 這個資源自己的流水號（1, 2, 3…），見 §3.1 |
| `snapshot` | `jsonb NULL` | 寫入 **之後** 的狀態；超過上限時是 null（§3.2） |
| `actor_id` | `uuid NULL` → `users.id` `ON DELETE SET NULL` | 寫入的人；系統寫入（基準版本、seed）是 null。永久刪除使用者時版本保留、作者變成 null |
| `created_at` | `timestamptz` | |

- 唯一鍵 `revisions_resource_version_key (resource_type, resource_id, version)`：同時服務「某個資源的版本，新的在前」與 `max(version)`（倒序掃描同一個索引）。
- 索引 `revisions_created_at_idx (created_at)`：保留清理以時間篩選。

---

## 3. 寫入：`RevisionService.record(tx, …)`

```ts
await this.revisions.record(tx, {
  resourceType: RESOURCE_TYPE.ROLE,
  resourceId: role.id,
  snapshot: toRoleRevision(role, permissionKeys), // 擁有者的白名單，寫入之後的狀態
  actorId: actor.id,
});
```

- **同一個業務交易**（與稽核同一條規則，[`03-backend.md`](../../conventions/03-backend.md) §1 第 6 條）：業務寫入 rollback，版本也不留下。
- 回傳這一版的版本號。

### 3.1 版本號：每個資源自己的流水號

版本號由 `record()` 在同一個 INSERT 裡以 `coalesce(max(version), 0) + 1` 產生，**與實體的樂觀鎖 `version` 無關**：

- 關聯的寫入（角色的權限鍵）不遞增實體的 `version`（[`03-api-conventions.md`](./03-api-conventions.md) §11），但會改變內容，所以要有新的一版；
  兩個號碼綁在一起就得讓權限鍵的變更也遞增 `roles.version`，會讓別人開著的名稱編輯表單無故衝突。
- 呼叫端要先在同一個交易內鎖住實體列（`SELECT … FOR UPDATE`，或已經 `UPDATE` 過那一列），同一個資源的寫入才會依序拿到號碼；
  萬一沒鎖，唯一鍵讓後到的交易失敗，而不是產生重複的號碼。新建立的實體（還沒提交）沒有並行的寫入者。
- 被保留清理刪掉的舊版本號不會重用（`max` 取的是還在的最大值，而最新的幾版永遠保留）。

### 3.2 單版上限

`JSON.stringify(snapshot)` 的 UTF-8 位元組數超過 1 MiB（`REVISION_SNAPSHOT_MAX_BYTES`）時：業務寫入照常成功，那一版照樣佔一個版本號，
`snapshot = null`，記 warn log（`版本快照超過上限，這一版不保存內容`，帶 `resourceType`、`resourceId`、`version`、`bytes`）。
列表以 `tooLarge: true` 標示「過大未保存」，單版端點回 `snapshot: null`，還原回 `409 REVISION_UNAVAILABLE`（`details.reason: 'tooLarge'`）。
角色的內容遠小於上限；這是給之後的大型實體（編輯器資料）的保護，超過的實體改用差異策略時另寫 ADR（D1）。

---

## 4. 角色

### 4.1 什麼時候產生一版

| 寫入 | 端點 | 鎖 | 角色的 `version` |
| --- | --- | --- | --- |
| 建立 | `POST /roles` | 新列 | 1 |
| 複製 | `POST /roles/:id/duplicate` | 新列 | 1 |
| 改名稱、說明 | `PATCH /roles/:id` | 條件式 `UPDATE` | + 1 |
| 增減權限鍵 | `PATCH /roles/:id/permissions` | `lockActiveRow`（`FOR UPDATE`） | 不變 |
| 還原到某一版 | `POST /roles/:id/revisions/:version/revert` | `lockActiveRow` ＋ 條件式 `UPDATE` | + 1 |

刪除、還原刪除（`POST /roles/:id/restore`）、持有者的變更都 **不** 產生新的一版：它們不改變快照的內容。
快照是 `toRoleRevision(role, permissionKeys)`＝`{ name, description, permissionKeys }`，權限鍵只算目錄裡的（與 `GET /roles/:id/permissions` 相同）、
依 JS 的預設排序（UTF-16 碼位）排好，兩版之間的差異才不會因為順序而出現。不含 id、slug（不可變）、`is_system`、時間戳、`version`。
super-admin 的快照權限鍵是空陣列（隱含全集不是權限鍵的邊），它也不能被還原（§4.3）。

### 4.2 既有角色的基準版本

R5 之前的角色沒有任何版本。migration 0014 在建表之後以 SQL 為 **每一個** 角色（含已刪除、之後可能被還原的）寫第 1 版：
migration 當下的名稱、說明與權限鍵（`COLLATE "C"` 排序，與 JS 一致），`actor_id` 為 null（前端顯示「系統」），`ON CONFLICT DO NOTHING`。

- 與前一版程式相容（`02-database.md` §5.1）：舊版不讀寫這張表。滾動部署期間舊版做的變更沒有版本（舊版建立的角色沒有第 1 版）；
  新版之後的第一次寫入照常記下寫入後的狀態，「最新一版＝目前的內容」仍然成立，只是中間少了舊版做的那一步。
- 新租戶：migration 時還沒有角色；`db:seed` 建立系統角色時同樣寫第 1 版（`db/seeds/role-revisions.ts`，`actor_id` null），
  `db:seed:dev` 的範例角色也是。
- 不採用「第一次寫入時若沒有任何版本，先補一版寫入前的狀態」：每個寫入路徑都要多讀一次寫入前的完整內容，
  而需要它的只有滾動部署那幾分鐘內被舊版建立的角色。

### 4.3 還原到某一版：`POST /roles/:id/revisions/:version/revert`

把那一版的快照當成 **一次新的更新**（D1）：名稱、說明照 `PATCH /roles/:id`，權限鍵照 `PATCH /roles/:id/permissions`，寫入之後產生新的一版，歷史不改寫。
請求本體 `{ version? }`：確認還原時看到的 **角色的** `version`（樂觀鎖，與 `PATCH /roles/:id` 相同，R1 選填、R1b 之後必填）。回應是還原後的 `Role`。

1. 角色不存在或已刪除 → `404 ROLE_NOT_FOUND`；帶了 `version` 而不是目前的 → `409 ROLE_VERSION_CONFLICT`（`details.current`）；
   super-admin → `403 ROLE_SUPER_ADMIN_IMMUTABLE`。
2. 取那一版：不存在（或已被保留清理刪除）→ `404 REVISION_NOT_FOUND`；過大未保存 → `409 REVISION_UNAVAILABLE`（`reason: 'tooLarge'`）；
   形狀對不上 `RoleRevisionSnapshotSchema`（白名單之後改過）→ 同一個錯誤碼（`reason: 'incompatible'`）。
3. 目錄裡已經不存在的權限鍵略過（記在稽核的 `metadata.skippedPermissions`），不讓舊版本因為目錄改過而無法還原。
4. 名稱（不分大小寫）與目前不同而已被別的角色使用 → `409 ROLE_NAME_DUPLICATE`。
5. 交易內，先 `lockActiveRow` 鎖住角色列，再以 **交易內** 讀到的權限鍵算出要加、要拿掉的鍵（交易外讀到的可能已被別人改過）。權限鍵會改變時：
   - 另外要有 `role:grantPermission`（與改權限的端點相同；否則只有 `role:update` 的人能藉還原拿掉角色的鍵）→ 沒有就 `403 AUTHZ_FORBIDDEN`
     （`details.required`，並寫 `authz.denied`，與 `PermissionsGuard` 相同的形狀）；
   - 反提權：加回的鍵都要是 actor 持有的（`assertGrantable`）→ `403 AUTHZ_ESCALATION`（`details.missing`）；super-admin 豁免；
   - 自我鎖定：actor 持有這個角色、還原後會失去管理角色所需的權限 → `403 ROLE_SELF_LOCKOUT`。
6. 條件式 `UPDATE`（名稱、說明、`version + 1`；沒命中照 R1 回 404 或 409）→ 增減權限鍵 → 稽核 `role.update`
   （`changes` 只有變了的欄位，權限鍵變了時帶 `permissions` 的前後；`metadata: { revertedFrom: <版本號>, skippedPermissions? }`）→ `record()` 新的一版。
7. 交易後：權限鍵變了時 `permissionsChanged(持有者)` → `resource.changed`：`role` / `update`，權限鍵變了時加 `rolePermission` / `update`（與兩個一般端點相同的順序）。

選的就是最新一版（內容與目前相同）時仍照常執行並產生新的一版；前端不提供這個操作（按鈕停用）。

### 4.4 讀取

| 端點 | 權限 | 說明 |
| --- | --- | --- |
| `GET /roles/:id/revisions` | `role:read` | 一般分頁（`offset`、`limit`），版本新的在前；每一列 `RevisionSummary`：`version`、`createdAt`、`actor`（`{ id, name }` 或 null）、`tooLarge`。不帶快照 |
| `GET /roles/:id/revisions/:version` | `role:read` | `RoleRevision`＝`RevisionSummary` ＋ `snapshot`（`{ name, description, permissionKeys }` 或 null） |
| `POST /roles/:id/revisions/:version/revert` | `role:update`（權限鍵變動另要 `role:grantPermission`） | §4.3 |

看版本＝看得到角色（D10），不另外開權限鍵。已刪除的角色回 `404 ROLE_NOT_FOUND`（先還原角色）。
作者的名字以 `users` 的 left join 取得（被軟刪除的人照樣顯示名字，被永久刪除的是 null）。

---

## 5. 保留與清除

| 項目 | 內容 |
| --- | --- |
| 工作 | `revision.prune`（`scope: 'tenant'`、`exclusive`），排程 `REVISION_PRUNE_CRON`（預設 `45 4 * * *`，每天 04:45 UTC；空字串停用） |
| 設定 | `revision.keepVersions`（預設 50，1～1000）、`revision.keepDays`（預設 90，1～3650）；[`12-settings.md`](./12-settings.md) §3 |
| 條件 | 刪除「不在每個資源最新 `keepVersions` 版內 **而且** 早於 `keepDays` 天」的版本：保留的是兩者的聯集（D1） |
| 分批 | 每批最多 1000 筆一條 `DELETE`（各自提交）；不滿一批就結束。中途失敗重跑只剩還沒刪的 |
| 結果 | 工作的 `output`：`{ keepVersions, keepDays, cutoff, deleted }` |

- 排名以版本號倒序（`row_number() OVER (PARTITION BY resource_type, resource_id ORDER BY version DESC)`），最新一版永遠保留（`keepVersions` 下限 1）。
- 版本不寫稽核：清除是保留政策的執行，不是誰的操作；工作的 `output` 與 log 記了清掉幾筆。

### 5.1 實體被永久刪除時

實體的版本跟著實體走：擁有者的回收桶 handler 在 `purge` 的同一個 savepoint 內呼叫 `RevisionService.deleteAll(type, id, tx)`。
角色見 [`13-trash.md`](./13-trash.md) §6.2。軟刪除時不刪（還原之後版本歷史還在）。

---

## 6. 讓一個實體加入版本歷史

1. `REVISION_RESOURCE_TYPES` 加上它的 `RESOURCE_TYPE`（沒有就先在 `core/resource/resource-types.ts` 加，D7）。
2. 在擁有者模組寫白名單 `toXxxRevision(row)`（純函式）與它的 zod schema：只含可編輯的欄位，**不含** id、時間戳、`deleted_at`、`version`、
   雜湊、token 之類的機密。形狀之後改變時，舊版本仍是舊的形狀——還原前以 schema 驗證，對不上就當成無法還原。
3. 每個會改變快照內容的寫入路徑，在 **同一個交易** 內、鎖住實體列之後呼叫 `revisions.record(tx, …)`，傳 **寫入之後** 的狀態。
4. 擁有者的 controller 提供 `GET /<resource>/:id/revisions`、`GET /<resource>/:id/revisions/:version`（`<resource>:read`）與
   `POST /<resource>/:id/revisions/:version/revert`（`<resource>:update` ＋ 該資源本來的業務規則與反提權，D10），
   還原記 `<resource>.update` 並帶 `metadata.revertedFrom`；`route-audit.spec.ts` 的總表同步。
5. 既有資料的基準版本：手寫 migration 以 SQL 產生同一個形狀（或說明為什麼不需要）。
6. 永久刪除的 handler 呼叫 `deleteAll()`。
7. 前端：`apis/<domain>/` 的三個操作、資源依賴圖把版本的 query 放進該資源的 `entity`、版本紀錄的畫面（[`../frontend/14-revisions.md`](../frontend/14-revisions.md)）。

---

## 7. 錯誤碼

| 錯誤碼 | HTTP | 何時 |
| --- | --- | --- |
| `REVISION_NOT_FOUND` | 404 | 指定的版本不存在，或已被保留清理刪除 |
| `REVISION_UNAVAILABLE` | 409 | 還原的那一版過大未保存（`reason: 'tooLarge'`），或形狀與目前的白名單對不上（`reason: 'incompatible'`） |
| `ROLE_VERSION_CONFLICT` | 409 | 還原時帶的角色 `version` 不是目前的（`details.current`） |
| `AUTHZ_FORBIDDEN` | 403 | 還原會改變權限鍵，而沒有 `role:grantPermission`（`details.required`） |
| `AUTHZ_ESCALATION` | 403 | 還原會加回 actor 沒有的權限鍵（`details.missing`） |

---

## 8. 測試

| 對象 | 檔案 |
| --- | --- |
| 建立、改名稱說明、改權限鍵、複製各產生一版（權限鍵不遞增角色的 `version`）；rollback 不留下；超過 1 MiB 存 null 並記 warn、列表標 `tooLarge`、還原 409；列表分頁與作者、單版、`REVISION_NOT_FOUND`、已刪除的角色 404、權限；還原（`version + 1`、新的一版、稽核 `revertedFrom`、持有者的權限立刻跟著變、樂觀鎖衝突、反提權、要 `role:grantPermission`、super-admin、撞名、目錄已不存在的鍵）；保留清理（最新 N ∪ N 天、依設定）；永久刪除角色時刪掉版本；migration 的基準版本與 seed 的第 1 版 | `test/role-revisions.spec.ts` |
| `record` 的上限與位元組計算、`get`／`getSnapshot` 的錯誤、`prune` 的分批與截止時間、排程註冊 | `src/modules/revision/__tests__/revision.service.spec.ts` |
| 端點的權限宣告 | `test/route-audit.spec.ts` |
