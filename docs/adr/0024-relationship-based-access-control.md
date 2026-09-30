# ADR-0024 — 權限改成關係圖（ReBAC），以雙寫＋影子比對逐步切換

- 狀態：**採用**（G0～G2 已實作，`feat/permission-graph`；G3 另開）
- 日期：2026-09-30
- 相關：提案 [`../features/permission-graph.md`](../features/permission-graph.md)；
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
  - G3（另開）：寫入只寫 tuple、以 revision 失效快取、刪舊表。

## 理由

1. 稽核在交易內、權限寫入與業務寫入同一個交易；外部授權服務會變成雙寫問題。每個租戶一個 database 也讓外部服務的隔離變複雜。
2. trigger 雙寫讓 G1 不必修改任何寫入路徑，也不可能漏掉某條路徑；影子比對讓既有的整合測試直接成為新舊一致的驗收。
3. 依賴樹寫在模型裡，guard、資源的 `can_*`、反提權、profile 自動一致；前端的技能樹只是把同一份資料畫出來。

## 代價

| 代價 | 緩解 |
| --- | --- |
| G1～G2 期間同一份資料存兩份 | trigger 保證同交易；`test/relation-tuples.spec.ts` 逐種寫入比對；G3 刪舊表 |
| 影子比對讓開發環境的解析多一倍查詢 | 只在快取未命中時比；正式環境預設關閉 |
| 依賴閉包讓部分自訂角色多出權限（例：只有 `file:create` 的角色取得全域讀取） | seed 時寫稽核 `role.permissionsImplied` 列出多出的鍵；發佈說明點名 |
| 快取仍靠逐事件失效，直到 G3 | 失效清單不變；TTL 仍是安全網 |

## 替代方案

| 方案 | 不採用的理由 |
| --- | --- |
| OpenFGA／SpiceDB | 見理由 1 |
| 直接切換（不雙寫） | 使用者選擇較保守的切換方式；影子比對也能在開發環境持續驗證 |
| 只把資源授權放進圖、全域 RBAC 不動 | 留下兩種寫入路徑，群組持有角色時失效範圍要兩邊各算一次 |

## 實作紀錄（G0～G2）

| 項目 | 位置 |
| --- | --- |
| 權限依賴樹與 G1–G4 不變條件（啟動時驗證） | `apps/api/src/db/seeds/permissions.ts`（`PERMISSION_DEPENDENCIES`）、`docs/rbac/02-permission-catalog.md` §9 |
| 關係圖引擎（模型 DSL、判斷器、靜態蘊含、主體閉包 CTE） | `apps/api/src/core/authz/` |
| 檔案管理器的型別 | `apps/api/src/modules/file/file.authz.ts` |
| `relation_tuples` 與同步 trigger、回填 | migration `0007`、`0008` |
| 影子比對 | `AUTHZ_SHADOW`（`docs/architecture/backend/05-rbac.md` §4.2） |
| 角色權限的技能樹（互鎖） | `apps/backstage/src/features/role/components/PermissionSkillTree.tsx`、`components/TreeEditor` 的狀態／分組擴充 |

與提案不同的地方：快取仍逐事件失效（`authz_revision` 與 `pg_notify` 延到 G3，寫入改經 tuple 之後才有單一的失效點）；
`resolveHierarchyLevels` 與舊的權限查詢保留到 G3，只給影子比對用。

