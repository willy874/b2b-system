# 後端 23 — 組織管理（部門樹、成員、主管）

描述「誰的主管是誰」：部門是一棵樹，使用者屬於部門、部門有主管。多階段審批以它找「申請人的主管」「某部門的主管」
（[`20-approval.md`](./20-approval.md) §9.2）。部門 **不是授權來源**：權限仍由角色與群組決定（D1）。

可由平台對每個租戶關閉（`organization`，§6）；新租戶與既有租戶預設都不啟用（D3）。

> 程式碼：後端 `apps/api/src/modules/organization/`（`OrgUnitService`、`OrgChartService`、`OrgAssigneeResolvers`、`OrgUnitTrashHandler`）；
> 前端 `apps/backstage/src/features/organization/`、部門選擇器 `apps/backstage/src/core/components/OrgUnitPicker/`。

---

## 1. 範圍

| 做 | 不做 |
| --- | --- |
| 部門樹：建立、改名、搬移（換上層、同層排序）、刪除（回收桶）、還原 | 部門帶來權限：部門持有角色、以部門授權資料夾（D1） |
| 成員：一人可屬多個部門，最多一個 **主要部門**；每個部門可有多位主管；自由文字的職稱 | 職級、成本中心等人事欄位；矩陣式組織的「虛線主管」 |
| 主管的解析：某人的第 N 層主管、某部門的主管（給審批） | 依生效日期排程的異動、組織架構的歷史快照、部門的版本歷史 |
| 使用者列表依部門篩選（可含下層）；使用者詳情的「所屬部門」 | 組織圖的匯入（之後以 [`22-data-transfer.md`](./22-data-transfer.md) 登記部門資源）、外部 IdP／SCIM 的部門同步 |
| 命令面板搜尋部門 | 公告依部門發送 |

---

## 2. 資料模型（租戶 DB，migration 0047）

| 表 | 欄位 |
| --- | --- |
| `org_units` | `parent_id`（null = 最上層，可以有多個最上層；`RESTRICT`）、`name`、`code`（citext，選填）、`description`、`sort_order`、`version`、軟刪除 |
| `org_unit_members` | `unit_id`、`user_id`（皆 `CASCADE`）、`is_manager`、`is_primary`、`title`；`PK (unit_id, user_id)` |

| 約束 | 內容 |
| --- | --- |
| `org_units_sibling_name_key` | 同一個上層之下名稱不分大小寫唯一（未刪除者；最上層以固定值代替 null） |
| `org_units_code_key` | 代碼唯一（未刪除者） |
| `org_unit_members_primary_key` | `UNIQUE (user_id) WHERE is_primary`：一人最多一個主要部門 |

- 樹以鄰接表表示，查詢用遞迴 CTE；不存 `path`、不做閉包表、不快取（D4）。
- 深度上限 `ORG_UNIT_MAX_DEPTH = 10`（最上層算第 1 層）；搬移時擋循環（`409 ORG_UNIT_CYCLE`）與超過深度（`409 ORG_UNIT_TOO_DEEP`）。
- 結構的寫入（建立、改名、搬移、刪除、還原）以交易層級的 advisory lock（`org_structure`）排隊，與群組的 `group_membership` 同一個做法。
- 成員不進 `relation_tuples`（D1）；改成員不必 `permissionsChanged()`。
- 使用者被軟刪除時成員資格保留（休眠，主管解析與成員數略過他），永久刪除時隨外鍵刪除。

---

## 3. 主管的解析（`OrgChartService`）

`OrganizationModule` 匯出的唯讀服務（`org-chart.service.ts`），給其他模組呼叫：

| 方法 | 回傳 |
| --- | --- |
| `managersOf(userId, level)` | 某人的第 `level` 層主管 |
| `managersOfUnit(unitId)` | 某部門的主管（只看這個部門） |
| `unitScope(unitId, includeDescendants)` | 部門（與下層）的 id，給使用者列表的篩選 |
| `isEnabled()` | 目前的租戶是否啟用 `organization` |

**第 N 層主管**（D5）：

```
從申請人的「主要部門」開始往上走：
  第 1 層 = 第一個「有主管、而且主管不只申請人自己」的部門，它的主管（扣掉申請人）
  第 2 層 = 從第 1 層那個部門的上層繼續往上走，找到的下一組主管
只算 status = active、未刪除的人類帳號；路徑上已刪除的部門照樣往上走（它的主管不算）；走到最上層還沒找到 → 空陣列
```

- 主管本人送出的申請，第 1 層是上層部門的主管；同一個部門的另一位主管也算（彼此可以互審）。
- 沒有主要部門的人沒有主管（不猜）。
- `organization` 未啟用時所有方法回空集合（D2）；呼叫端只要處理「找不到」一種情況。

---

## 4. 與其他模組

| 模組 | 怎麼用 |
| --- | --- |
| 審批 | `OrgAssigneeResolvers` 在 `onModuleInit` 向審批登記 `manager`、`orgUnit` 兩種審核者規則（[`20-approval.md`](./20-approval.md) §9.2、D15）；`organization` 未啟用時不可用、展開為空 |
| 使用者 | `GET /users?orgUnitId=&includeDescendants=true`：`UserService` 以 `OrgChartService.unitScope()` 展開部門，`UserRepository` 以 `EXISTS (org_unit_members)` 篩選。**`organization` 未啟用時帶這個參數回 `400 VALIDATION_FAILED`**（不靜靜地忽略，否則前端會以為篩選生效）。匯出的篩選不含部門 |
| 回收桶 | 類型 `orgUnit`（`OrgUnitTrashHandler`，`purgeOrder` 25、`feature: organization`）；還有下層（含已刪除、未到期的）的部門這一輪略過，下層先被刪後下一輪再處理 |

---

## 5. API

| Method | Path | 權限 | 說明 |
| --- | --- | --- | --- |
| GET | `/org-units` | `orgUnit:read` | 整棵樹（扁平陣列，帶 `parentId`、`sortOrder`、`memberCount`、`managerCount`）；`?keyword=` 只回名稱或代碼符合的部門與它們的上層 |
| POST | `/org-units` | `orgUnit:create` | `{ name, parentId?, code?, description? }`；排在同層最後 |
| GET | `/org-units/:id` | `orgUnit:read` | 詳情，含上層路徑 `path`（最上層在前，不含自己） |
| PATCH | `/org-units/:id` | `orgUnit:update` | `name`、`code`、`description`；必帶 `version`（`409 ORG_UNIT_VERSION_CONFLICT`） |
| POST | `/org-units/:id/move` | `orgUnit:update` | `{ parentId, beforeId?, version }`：換上層與同層排序 |
| DELETE | `/org-units/:id` | `orgUnit:delete` | 軟刪除；有下層 `409 ORG_UNIT_HAS_CHILDREN` |
| POST | `/org-units/:id/restore` | `orgUnit:delete` ＋ `trash` | 還原；上層已刪除 `409 ORG_UNIT_PARENT_DELETED`；名稱或代碼被佔用 `409 ORG_UNIT_NAME_DUPLICATE`／`ORG_UNIT_CODE_DUPLICATE` |
| GET | `/org-units/:id/members` | `orgUnit:read` ＋ `user:read` | 成員（主管在前）；`?includeDescendants=true` 含下層、`?keyword=` |
| PATCH | `/org-units/:id/members` | `orgUnit:update` | 差異語意 `{ add, update, remove }`；設 `isPrimary` 會在同一個交易取消那個人原本的主要部門；改到自己 `403 AUTHZ_SELF_MODIFY`（D6） |
| GET | `/users/:id/org-units` | `orgUnit:read` | 那個人所屬的部門（主要部門在前），每一列帶上層路徑 |

全部標 `@RequireFeature('organization')`（還原另要 `trash`）。錯誤碼：`ORG_UNIT_NOT_FOUND`、`ORG_UNIT_NAME_DUPLICATE`（`details.conflictingUnitId`）、
`ORG_UNIT_CODE_DUPLICATE`、`ORG_UNIT_VERSION_CONFLICT`、`ORG_UNIT_CYCLE`、`ORG_UNIT_TOO_DEEP`（`details.max`）、`ORG_UNIT_HAS_CHILDREN`、`ORG_UNIT_PARENT_DELETED`、`ORG_UNIT_NOT_DELETED`。

推播 `orgUnit`：受眾是 `orgUnit:read` 的人與被異動的成員（user room）。稽核：`orgUnit.create`／`update`／`move`／`delete`／`restore`、
`orgUnit.member.add`／`update`／`remove`（`before`／`after` 是成員清單）。

---

## 6. 平台關閉 `organization`（D2）

| | 停用時 | 照舊 |
| --- | --- | --- |
| 端點 | `/org-units`、`/users/:id/org-units` 回 `404 FEATURE_DISABLED`；`GET /users?orgUnitId=` 回 `400` | 部門、成員、主管 |
| 前端 | 沒有組織頁、使用者詳情沒有「所屬部門」、使用者列表沒有部門篩選、審批流程的「主管」「部門」規則停用 | — |
| 審批 | `manager`／`orgUnit` 規則展開為空 → 關卡短缺 → `approval:override`（[`20-approval.md`](./20-approval.md) §9.12） | — |
| 回收桶 | 「部門」分頁不顯示 | 到期照常永久刪除 |

`TenantFeatureImpacts`：`orgUnits`（部門數）、`orgUnitMembers`（有部門的人數）、`approvalFlowsUsingOrg`（以主管為審核者的啟用中流程數，由審批的 `ApprovalFlowService` 提供）。

---

## 7. 權限

| 權限鍵 | 說明 | 依賴 | 預設角色 |
| --- | --- | --- | --- |
| `orgUnit:read` | 部門樹、詳情、成員、使用者所屬的部門 | — | super-admin、admin、auditor |
| `orgUnit:create` | 建立部門 | 包含 `orgUnit:update` | super-admin、admin |
| `orgUnit:update` | 改名、搬移、排序；增減成員、設定主管與主要部門 | 包含 `orgUnit:read`；依賴 `user:read` | super-admin、admin |
| `orgUnit:delete` | 軟刪除與還原 | 包含 `orgUnit:update` | super-admin、admin |

`orgUnit:update` 不受反提權限制（不授予任何權限鍵）。不能改自己（D6）。既有租戶的系統角色由 migration 0047 補上。

---

## 8. 前端

| 位置 | 內容 |
| --- | --- |
| `features/organization`（可啟用的 feature `organization`） | `/organization`（Page Key `ORG_UNIT`，`orgUnit:read`；側欄「人員管理」，群組之後）。選中的部門在網址 `?unitId=` |
| 左側部門樹 | 依 `parentId` 組樹，同層依 `sortOrder`、名稱；本地以名稱或代碼篩選（保留上層，有關鍵字時全部展開）；每個節點顯示直接成員數 |
| 右側詳情 | 上層路徑、名稱、代碼與說明的就地編輯（帶 `version`，衝突時 `VersionConflictAlert`）；「新增下層部門」（`orgUnit:create`）、「搬移到…」對話框（`orgUnit:update`，以 `OrgUnitPicker` 選新的上層或最上層，自己與下層不能選）、「刪除」（`orgUnit:delete`，先確認；成功後改選上層） |
| 成員表（另要 `user:read`） | 可勾「含下層部門」（下層的列只顯示）；每列切換主管、主要部門、編輯職稱、移除；自己那一列沒有操作（D6）；加成員以伺服器端搜尋使用者 |
| 命令面板、回收桶 | 搜尋部門名稱與代碼（route id `organization.unit`）；回收桶「部門」分頁（`orgUnit:delete`） |
| `core/components/OrgUnitPicker` | 樹狀、可搜尋的部門選擇器（`ui/Select` 的巢狀選項）；資料與文字由呼叫端傳入。首屏的程式不 import 它（會把 Select 帶進 entry chunk） |
| 使用者 feature | 詳情的「所屬部門」（主要部門在前、上層路徑、主管與職稱）；列表的部門篩選（`orgUnitId`、`includeDescendants`，也套用到匯出）。都只在 `organization` 已安裝且有 `orgUnit:read` 時出現 |

與當初構想不同：用「搬移到…」對話框取代 TreeEditor 的拖放、行內改名與右鍵選單，沒有同層的拖曳排序（API 的 `beforeId` 已支援）；沒有「建立部門」的命令面板指令（建立是頁內對話框）。

---

## 9. 測試

| 層 | 涵蓋 |
| --- | --- |
| 單元 `org-unit.service.spec.ts` | 每個錯誤碼分支：上層不存在、層數、同層同名、代碼、版本衝突、循環、子樹放不下、有下層、還原的狀態、上層已刪除、改到自己、使用者不存在；主要部門的取消順序 |
| 單元 `org-chart.service.spec.ts` | 第 N 層主管（沒有主管的部門往上跳過）、扣掉申請人、未啟用時回空 |
| 整合 `test/organization.spec.ts` | 部門樹的建立與唯一性、關鍵字、搬移的循環與撞名與樂觀鎖、深度上限、成員與主要部門、主管的解析（主管本人、兩位主管、停用的主管）、使用者列表的篩選、刪除與回收桶與還原的順序、auditor 唯讀、`organization` 停用 |
| 整合 `test/approval-chain.spec.ts` | `manager` 規則經組織解析；`organization` 停用時展開為空 |

---

## 10. 設計決策：組織管理

> 2026-10-08 決定並實作（原 `docs/features/organization.md`），為了多階段審批的「申請人的主管」（[`20-approval.md`](./20-approval.md) §10）。

### 10.1 背景

系統描述「人」原本只有角色（能做什麼）與群組（純分組、授權用、可巢狀但沒有上下級）。業務流程常要問「這個人的主管是誰」；
用群組硬湊表達不出樹與主管，而且群組的成員關係就是授權——把部門做成群組，每次人事異動都可能改到權限。

### 10.2 決定

| # | 決定 | 理由 | 評估過的方案 |
| --- | --- | --- | --- |
| D1 | **部門不是授權來源**：不寫進 `relation_tuples`，不能持有角色、不能被授權資料夾 | 人事異動頻繁，若同時改權限，每次調動都要過反提權與整個租戶的權限失效；授權已經有群組 | 部門＝一種群組：群組可以巢狀成任意圖、部門必須是樹；群組停用時部門也跟著消失；主管沒有地方放 |
| D2 | **平台可關閉，id `organization`**；停用時頁面與端點消失、資料保留、`OrgChartService` 回空集合 | 與其他 feature 一致；回空集合讓呼叫端只處理「找不到主管」一種情況 | 停用時讓審批鏈拒絕送出：使用者無從理解，也讓兩個 feature 綁死 |
| D3 | **新 feature 預設不啟用**（平台 DB 的預設值不加、既有租戶不補） | 全新的加值能力，沒有人會因為沒有它而失去功能 | 預設開：所有既有租戶的側欄多出一個空的「組織」 |
| D4 | **鄰接表 ＋ 遞迴 CTE**，不存 `path`、不做閉包表、不快取 | 規模小（百到千個部門），讀取點少；搬移只改一列 | `ltree`：搬移要改整棵子樹；閉包表：寫入複雜度高 |
| D5 | **主管只沿主要部門往上找，跳過申請人自己**；沒有主要部門 → 沒有主管 | 明確、可預測；多部門的人若從每個部門都找主管，審批會出現多組互不相干的審核者 | 每個成員資格各自有「匯報對象」：彈性最大，但維護成本高，且與部門樹互相矛盾 |
| D6 | **不能改自己的部門成員資格與主管身分** | 主管身分決定審批的審核資格；與「不能改自己的角色」（I9）同一個理由 | 只擋「把自己設成主管」：搬自己到別的部門一樣能換一個比較寬鬆的主管 |

### 10.3 實作紀錄

| 項目 | 補充 |
| --- | --- |
| 版本歷史 | 提案寫了以 `RevisionService` 記錄部門；**沒有做**：部門的變更都有稽核（含搬移的前後上層），沒有「還原到某一版」的需求 |
| 刪除的條件 | 只能刪除沒有（未刪除的）下層的部門；永久刪除時還有任何下層（含已刪除、未到期的）的部門這一輪略過，靠 `parent_id` 的 `RESTRICT` 保證不會留下孤兒 |
| 成員的異動與推播 | 被異動的成員以 user room 推播（使用者詳情的「所屬部門」）；部門的 `version` 不因成員異動遞增 |
