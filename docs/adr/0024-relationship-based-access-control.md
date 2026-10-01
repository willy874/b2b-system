# ADR-0024 — 權限改成關係圖（ReBAC），以雙寫＋影子比對逐步切換

- 狀態：**採用**（G0～G3b 已實作並合併，G3a 於 2026-09-30 合併（96ae80a），G3b 同日）；G4 的決定 D10～D16 於 2026-10-01 確認；G4a（群組、反提權一般化）與 G4b（說明）於 2026-10-01 完成，規格見 `rbac/08-groups.md`、`rbac/09-explain.md`；G5 待做
- 日期：2026-09-30
- 相關：提案 [`../features/permission-graph.md`](../features/permission-graph.md)（只剩 G5）；群組 [`../rbac/08-groups.md`](../rbac/08-groups.md)；說明 [`../rbac/09-explain.md`](../rbac/09-explain.md)；規格 [`../rbac/01-domain-model.md`](../rbac/01-domain-model.md) §6.4；
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

### G4：群組、反提權、explain（2026-10-01 決定，尚未實作）

- **D10 不開放角色繼承角色**：維持 [ADR-0006](./0006-flat-permission-scope.md) 的「複製角色」。角色的權限永遠是明確清單，
  反提權、自我鎖定、I8 都只看一個角色；分組的需求由群組處理。
- **D11 把人放進群組 ＝ 指派群組持有的角色**：寫入 `group:G#member@user:u`（或 `@group:H#member`）時，
  G **與它的所有上層群組** 持有的角色都要通過指派角色的反提權（`403 AUTHZ_ESCALATION`）。附帶規則：
  - 操作者不能把自己、或自己所屬的群組加進群組（I9 的延伸）。
  - 移除成員不檢查反提權；目標是 super-admin 時只有 super-admin 能操作（比照 `UserService.assertCanManage`）。
  - 從回收桶還原群組時，持有的角色隨保留的邊重新生效，還原前先以本條檢查（比照 `UserService.restore`）。
- **D12 群組不能持有 super-admin**：super-admin 一律直接指派給使用者。`group:assignRole` 指定 super-admin 一律拒絕，
  因此「是不是 super-admin」（`hasRoleSlug`、`assertCanManage`、I8 的計數）仍只看直接持有的角色，不必改成走主體閉包。
- **D13 反提權檢查的是「授予給一個主體」的能力**：把人放進一個主體（角色、群組）時，只檢查那個主體帶的 **全域權限鍵**，
  不檢查它在資料夾上的授權——那些授權在授予給這個主體時，已由持有 `can_share` 的人檢查過一次。與現在指派角色的行為一致。
- **D14 explain 逐節點遮蔽**：查自己不需要 `authz:explain`；路徑上操作者沒有讀取權（`group:read`、`role:read`、資料夾的 `can_read`）的節點，
  只回型別（「某個群組」），不回 id 與名稱，段數與關係照樣顯示。使用者 **直接所屬** 的群組、直接持有的角色一律顯示。
  主體閉包要記下路徑（`subjectClosures` 的遞迴 CTE 多帶一個路徑陣列），explain 才能從使用者本人串起。
- **D15 G4 不做外部 IdP 的群組對應**：群組只有手動成員；IdP 群組對應另開提案，與 SCIM 一起評估，預設方向是「整個群組由 IdP 管理、不能手動改成員」。
- **D16 G4 不下放群組管理**：只有 `group:update` 能管成員。將來要加 `owner` 關係時，要先重新評估 D13——
  owner 能把群組的資料夾授權擴散給任何人，等於下放 `can_share`。

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
| 角色繼承角色（D10 的替代） | 引擎幾乎不用改，但反提權、自我鎖定、I8 都要展開閉包，改一個角色的影響要跨角色計算；explain 回答「為什麼」，不回答「改這個會影響誰」 |
| 加成員不檢查、靠 `group:update` 把關（D11 的替代） | `group:update` 會變成繞過 `user:assignRole` 反提權的後門 |
| 允許群組持有 super-admin（D12 的替代） | 判斷 super-admin 的三處與 I8 的計數都要改成走主體閉包，換來的彈性很少用到 |
| 加成員時一併檢查群組的資料夾授權（D13 的替代） | 要掃出群組的所有資料夾授權逐一判斷；`details.missing` 還會透露操作者看不到的資料夾 |
| explain 查自己時不遮蔽，或只給第一段（D14 的替代） | 前者洩漏巢狀群組的上層與資料夾名稱；後者在資料夾繼承的情況幾乎沒有資訊 |
| G4 就做 IdP 群組同步或對應規則（D15 的替代） | 還沒有指定的 IdP；各家群組 claim 差異大（Azure AD 是 object id、有數量上限），現在設計欄位多半會猜錯 |
| 群組 `owner` 可管成員（D16 的替代） | 依 D13，owner 可以擴散群組的資料夾授權；等 G5 的專案成員管理有需求時一起評估 |

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
  （[ADR-0025](./0025-entity-revisions.md) D2、R3 起改成持有者邊也保留，還原角色時原本的持有者自動回來；永久刪除時才刪。）
- 「每個主體在一個資料夾只有一個等級」不再是 DB 的唯一索引，由 `FileFolderGrantRepository.set`（先刪後插）維持；
  授權的寫入經 `FileFolderTree.write` 序列化。

## 實作紀錄（G3b）

| 項目 | 位置 |
| --- | --- |
| 刪 migration 0008 的同步 trigger 與函式（含 `roles_mirror_super_admin`）、`user_roles`、`role_permissions`、`resource_grants` 與 enum `resource_type`、`grant_level`、`grant_subject_type` | migration `0010_drop_legacy_authz_tables.sql`（不可回退） |
| 舊表的 Drizzle schema 檔、`db/relations.ts` 的項目、`test/relation-tuples.spec.ts`、`test/db.ts` 與 `db/reset.ts` 的 TRUNCATE | 已刪除 |
| 等級與對象型別的常數（`GRANT_LEVELS`、`GRANT_SUBJECT_TYPES`、`EVERYONE_SUBJECT_ID`） | 從 `db/schema/resource-grants.ts` 移到 `modules/file/file-grant.levels.ts` |

## 實作紀錄（G4a）

| 項目 | 位置 |
| --- | --- |
| `group:*` 權限鍵、依賴樹、預設角色 | `db/seeds/permissions.ts`、`db/seeds/roles.ts`、`docs/rbac/02-permission-catalog.md` §2.10 |
| `groups` 表、`updated_at` 與 revision 的 trigger | migration `0016_groups.sql`、`0017_groups_triggers.sql`；`backend/02-database.md` §2.14 |
| 邊的形狀（`groupMemberTuple`、`groupRoleTuple`、`isGroupMemberTuple()`、`isGroupRoleTuple()`） | `db/schema/relation-tuples.ts` |
| `group` 型別、`role#holder` 接受群組的成員、主體閉包與反向解析沿 `group#member` 走 | `core/authz/authz.types.ts`、`authz.repository.ts` |
| 群組 CRUD、成員、持有的角色、還原（D11、D12） | `modules/group/`；端點見 `backend/05-rbac.md` §9 |
| 測試 | `modules/group/__tests__/group.service.spec.ts`、`test/groups.spec.ts`、`core/authz/__tests__/authz.checker.spec.ts`（群組） |

與提案不同的地方：

- **`group` 是核心型別**，不是由 `modules/group` 在 `onModuleInit` 註冊：主體閉包的遞迴 CTE（core）要知道哪些關係是成員關係、
  已刪除的節點看哪張表；與 `role` 同屬「使用者集合」。
- **群組巢狀有層數上限**（`GROUP_MAX_NESTING_DEPTH` = 6，`409 GROUP_NESTING_TOO_DEEP`）：主體閉包的深度上限是 8，
  超過的鏈會讓權限靜靜地消失，所以在寫入時擋。還原群組時也檢查循環與層數（刪除期間結構可能被改過）。
- **I9 的延伸多一條**：操作者不能改自己所屬（直接或間接）群組持有的角色（D11 只寫了加成員）；理由同 I9——等於改自己的角色。
- **成員的寫入以 advisory lock 排隊**（`group_membership`）：循環與層數的檢查要看到一致的結構，與資料夾樹同一個做法。
- **反提權一般化**：模型為每個型別宣告 **能力**（`defineType(…, { capabilities })`：租戶上的權限鍵與 `superAdmin`、資料夾上的 `can_*`），
  `AuthzService.grantedCapabilities` 算出「放進某個 `物件#關係` 取得的能力」——能力本身、等級靜態蘊含的能力、
  使用者集合往上閉包在租戶上的能力（D11、D13）。`assertGrantable`、`assertRolesAssignable`、群組的加成員都改走 `PermissionService.assertCanGrant`；
  資料夾等級的動作表改由同一個 `capabilitiesOf` 算出。super-admin 的特判（以 slug 判斷）因此拿掉：指派它取得的是 `superAdmin` 這個能力，
  `details` 的形狀不變。
- **提案的 `grantedBy`（誰能寫這條邊）沒有放進模型**：那一半已由路由宣告（`role:grantPermission`、`user:assignRole`、`group:assignRole`）與
  資料夾的 `can('share')` 擋下，錯誤是 `403 AUTHZ_FORBIDDEN` 並寫 `authz.denied`；搬進模型只是把同一個判斷宣告兩次。
- **寫入時的模型驗證以測試保證**（`validateTuple`、`src/__tests__/relation-tuples-model.spec.ts`）：邊只由 `db/schema/relation-tuples.ts` 的建構函式與
  資料夾授權的 repository 產生，每一種形狀對完整的模型驗一次；repository 不依賴 core 的服務，不在每次寫入時驗。
- 前端（`features/group`）、群組的回收桶、資料夾授權給群組、使用者與角色詳情的群組一併完成；`GET /groups` 以 `?userId=`／`?roleId=`
  篩選，不另開 `/users/:id/groups` 之類的跨資源端點。
- 既有租戶的系統角色以 migration 0018 補上群組的權限鍵（seed 只在角色新建立時寫入權限）。

## 實作紀錄（G4b）

| 項目 | 位置 |
| --- | --- |
| `authz:explain`（admin、auditor 預設持有） | `db/seeds/permissions.ts`、`roles.ts`；既有租戶由 migration `0019_authz_explain_system_roles.sql` 補上 |
| 帶路徑的主體閉包、全域權限的來源、接上閉包的來歷 | `core/authz`：`AuthzRepository.closurePaths`、`AuthzService.tenantSourcesOf`、`withClosurePath` |
| 「自己或有權限」、依操作者遮蔽（D14）、權限來源 API | `modules/authz-explain`（`GET /users/:id/permission-sources`） |
| 資料夾的說明 | `modules/file/file-access-explain.service.ts`（`GET /file-folders/:id/explain?userId=`） |
| 前端 | `core/components/ExplainPath`（路徑、`PermissionSourceList`）、個人資料頁、使用者詳情、資料夾共用對話框 |
| 規格 | `rbac/09-explain.md` |

與提案不同的地方：

- **沒有通用的 `GET /authz/explain?object=…`**：說明資源需要它的結構邊（資料夾的上層、繼承），只有擁有者模組載入得了，core 又不能依賴業務模組。
  所以由擁有者模組提供端點（資料夾是 `GET /file-folders/:id/explain`），名稱與可見性以 resolver 交給 `AuthzExplainService.describePaths`。
- **全域權限的來源不用判斷器的 `explain()`**：它只回第一條路徑；改以 `tenantSourcesOf` 列出租戶節點上直接取得的每一條邊，依賴樹帶出的鍵由閉包推出，
  一個鍵的所有來源（不同的角色、不同的群組）都列得出來。
- **個人資料頁也有「我的有效權限」**：提案只寫了使用者詳情；但查自己不需要權限，沒有 `user:read` 的人進不了使用者詳情，
  所以在個人資料頁另放一份（同一個 `PermissionSourceList`）。
- 「為什麼不能」的最接近缺口沒有做：不能做時只回 `allowed: false`（`rbac/09-explain.md` §6）。
