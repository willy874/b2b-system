# ADR-0024 — 權限改成關係圖（ReBAC），以雙寫＋影子比對逐步切換

- 狀態：**採用**（G0～G3b 已實作並合併，G3a 於 2026-09-30 合併（96ae80a），G3b 同日；G4 待做）
- 日期：2026-09-30
- 相關：提案 [`../features/permission-graph.md`](../features/permission-graph.md)（只剩 G4 以後）；規格 [`../rbac/01-domain-model.md`](../rbac/01-domain-model.md) §6.4；
  延伸 [ADR-0005](./0005-permission-resolved-server-side.md)（權限在伺服器端解析）；
  取代 [ADR-0006](./0006-flat-permission-scope.md) 的「延伸路徑」與 [ADR-0015](./0015-file-folder-access.md) 的解析方式

## 背景

權限判斷分成三套：全域 RBAC（`user_roles` ⋈ `role_permissions`）、資料夾授權（`resource_grants` ＋ `resolveHierarchyLevels`）、
擁有者規則（寫死在 `FileAccessContext`）。群組、專案 → 資料夾的跨資源繼承、「他為什麼能做 X」都會碰到這三套各自的上限。
同時，權限鍵之間沒有包含關係：可以授予「刪除」卻不授予「檢視」，角色的權限編輯器也無法互鎖。

## 決定

- **D1 自己在 Postgres 上實作關係圖**（Zanzibar 的 tuple 模型），不部署 OpenFGA／SpiceDB。模型只用 OpenFGA 支援的子集
  （直接、計算、`X from Y`、交集、萬用字元、過期），將來可以匯出。
- **D2 全域權限鍵是租戶節點上的關係**：`tenant:self#role:update@role:<id>#holder`；super-admin 是 `tenant:self#superAdmin`。
- **D3 結構邊（資料夾的上層、建立者）由資源自己的表提供**，不存進 `relation_tuples`。
- **D4 只有 allow**：支援交集（擁有者規則），不支援排除。
- **D6 權限依賴樹**：同資源的「子能力」與跨資源、只指向 read 的「依賴」；`create ⇒ 編輯自己建立的 ⇒ read`（規則 A）、`delete ⇒ update ⇒ read`。
  受反提權限制的鍵不能被包含。只儲存明確授予的鍵，包含的鍵是算出來的。
- **切換策略：雙寫＋影子比對。**
  - G1：新增 `relation_tuples`，migration 回填，舊表上的 trigger 在同一交易雙寫；開發與測試環境每次解析時兩套都跑、不一致就報錯（`AUTHZ_SHADOW`）。
  - G2：讀取改走引擎、依賴閉包生效；寫入仍經舊表（trigger 同步），影子比對繼續。
  - G3a：讀寫只走 tuple、以 revision 失效快取；刪影子比對。舊表與雙寫 trigger 保留——滾動部署期間舊版（G2）程序仍寫舊表，
    由 trigger 同步到 tuple；新版程式不寫舊表，trigger 不會被觸發。
  - G3b：下一次部署才把舊表、雙寫 trigger 與它們的 schema 定義一起刪掉（破壞性變更拆成兩次部署，`backend/02-database.md` §5.1）。
- **D7 失效廣播走平台 DB 的單一頻道**：`authz_revision` 由租戶 DB 的 trigger 在同一交易遞增；提交後程式在平台 DB `NOTIFY`
  （payload `{ tenant, revision }`），每個程序一條 LISTEN 連線（`core/broadcast`）。其他程序內的快取之後共用這條頻道。
- **D8 一個租戶一個 revision**：任何 tuple 寫入都讓整個租戶的閉包失效，重算按需、lazy；有指標顯示壓力再拆。
- **D9 G3 不改反提權**：`assertGrantable`、`assertRolesAssignable` 保留，只換資料來源；由模型宣告「誰能寫這條邊」的一般化隨 G4（群組）一起做，
  讓 G3 維持對外無行為變化的純搬遷。

## 理由

1. 稽核在交易內、權限寫入與業務寫入同一個交易；外部授權服務會變成雙寫問題。每個租戶一個 database 也讓外部服務的隔離變複雜。
2. trigger 雙寫讓 G1 不必修改任何寫入路徑，也不可能漏掉某條路徑；影子比對讓既有的整合測試直接成為新舊一致的驗收。
3. 依賴樹寫在模型裡，guard、資源的 `can_*`、反提權、profile 自動一致；前端的技能樹只是把同一份資料畫出來。

## 代價

| 代價 | 緩解 |
| --- | --- |
| G1～G3a 期間舊表仍在（G1～G2 同一份資料存兩份；G3a 起程式不再讀寫舊表） | trigger 保證同交易；`test/relation-tuples.spec.ts` 逐種寫入比對（與 trigger 一起在 G3b 刪除）；G3b 刪舊表與 trigger（migration 0010） |
| G1～G2 的影子比對讓開發環境的解析多一倍查詢 | 只在快取未命中時比；正式環境預設關閉；G3a 已刪除 |
| 依賴閉包讓部分自訂角色多出權限（例：只有 `file:create` 的角色取得全域讀取） | seed 時寫稽核 `role.permissionsImplied` 列出多出的鍵；發佈說明點名 |
| G3a 起每次權限寫入都多一次平台 DB 的 `NOTIFY`，監聽連線斷線期間的通知會漏 | 送出失敗只記錄；重連時整個權限快取丟棄；TTL 仍是安全網 |
| G3 起失效粒度變粗（任何授權變更讓整個租戶重算） | 按需重算、每人一句 CTE；拆 revision 的條件見 D8 |
| 提交後、`NOTIFY` 前程序掛掉會漏一次失效 | TTL 60 秒兜底；revision 單調遞增，下一次通知就會補上 |

## 替代方案

| 方案 | 不採用的理由 |
| --- | --- |
| OpenFGA／SpiceDB | 見理由 1 |
| 直接切換（不雙寫） | 使用者選擇較保守的切換方式；影子比對也能在開發環境持續驗證 |
| 只把資源授權放進圖、全域 RBAC 不動 | 留下兩種寫入路徑，群組持有角色時失效範圍要兩邊各算一次 |
| 在租戶 DB `pg_notify`（D7 的替代） | `NOTIFY` 只送得到同一個 database，每個租戶要一條常駐 LISTEN 連線 |
| 兩個 revision：全域／資源授權各一（D8 的替代） | 快取鍵與失效邏輯變複雜，目前規模看不出需要 |

## 實作紀錄（G0～G2）

| 項目 | 位置 |
| --- | --- |
| 權限依賴樹與 G1–G4 不變條件（啟動時驗證） | `apps/api/src/db/seeds/permissions.ts`（`PERMISSION_DEPENDENCIES`）、`docs/rbac/02-permission-catalog.md` §9 |
| 關係圖引擎（模型 DSL、判斷器、靜態蘊含、主體閉包 CTE） | `apps/api/src/core/authz/` |
| 檔案管理器的型別 | `apps/api/src/modules/file/file.authz.ts` |
| `relation_tuples` 與同步 trigger、回填 | migration `0007`、`0008` |
| 影子比對 | `AUTHZ_SHADOW`（G3a 已刪除） |
| 角色權限的技能樹（互鎖） | `apps/backstage/src/features/role/components/PermissionSkillTree.tsx`、`components/TreeEditor` 的狀態／分組擴充 |

G0～G2 與提案不同的地方：快取仍逐事件失效（`authz_revision` 與 `pg_notify` 延到 G3，寫入改經 tuple 之後才有單一的失效點）；
`resolveHierarchyLevels` 與舊的權限查詢保留到 G3，只給影子比對用。（兩者都已在 G3a 處理，見下節。）

## 實作紀錄（G3a）

| 項目 | 位置 |
| --- | --- |
| 邊的形狀與查詢條件（`roleHolderTuple`、`rolePermissionTuple`、`superAdminTuple`、`isRoleHolderTuple()`…） | `apps/api/src/db/schema/relation-tuples.ts` |
| 角色持有者、角色權限鍵的讀寫 | `modules/role/role.repository.ts`、`modules/user/user.repository.ts`、`modules/permission/permission.repository.ts` |
| 資料夾授權的讀寫（原 `modules/resource-grant`，已刪除） | `modules/file/file-folder-grant.repository.ts`；等級規則在 `modules/file/file-grant.levels.ts` |
| super-admin 邊由 seed 明確寫入（冪等） | `apps/api/src/db/seeds/index.ts`（`seedRoles` → `ensureSuperAdminTuple`） |
| `authz_revision` 與遞增 trigger | migration `0009_authz_revision.sql` |
| 平台 DB 的 `LISTEN`／`NOTIFY` | `apps/api/src/core/broadcast/`（`BroadcastService`；平台 DB 的連線是 DI token `PLATFORM_SQL`） |
| revision 的失效與廣播 | `apps/api/src/core/authz/authz.revision.ts`（`AuthzRevision`，頻道 `authz_revision`）；服務端入口 `PermissionService.permissionsChanged()` |
| 測試 | `apps/api/test/authz-revision.spec.ts`、`core/authz/__tests__/authz.revision.spec.ts`、`modules/file/__tests__/file-grant.levels.spec.ts` |

與提案不同的地方：

- 雙寫 trigger（migration `0008`，含 `roles_mirror_super_admin`）沒有在 G3a 刪除，保留到 G3b 與舊表一起刪——
  `backend/02-database.md` 要求 migration 與前一版程式相容，滾動部署期間舊版程序仍寫舊表。
- 刪除角色是軟刪除並刪掉它的持有者邊；它的權限鍵邊、它作為主體的資料夾授權保留，解析時略過已刪除的角色。
- 「每個主體在一個資料夾只有一個等級」不再是 DB 的唯一索引，由 `FileFolderGrantRepository.set`（先刪後插）維持；
  授權的寫入經 `FileFolderTree.write` 序列化。

## 實作紀錄（G3b）

| 項目 | 位置 |
| --- | --- |
| 刪 migration 0008 的同步 trigger 與函式（含 `roles_mirror_super_admin`）、`user_roles`、`role_permissions`、`resource_grants` 與 enum `resource_type`、`grant_level`、`grant_subject_type` | migration `0010_drop_legacy_authz_tables.sql`（不可回退） |
| 舊表的 Drizzle schema 檔、`db/relations.ts` 的項目、`test/relation-tuples.spec.ts`、`test/db.ts` 與 `db/reset.ts` 的 TRUNCATE | 已刪除 |
| 等級與對象型別的常數（`GRANT_LEVELS`、`GRANT_SUBJECT_TYPES`、`EVERYONE_SUBJECT_ID`） | 從 `db/schema/resource-grants.ts` 移到 `modules/file/file-grant.levels.ts` |
