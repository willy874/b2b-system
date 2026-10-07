# 組織管理（部門樹、成員、主管）

- 優先度：P2
- 狀態：規劃中
- 依賴：—
- 相關：[`approval-chains.md`](./approval-chains.md)（多階段審批鏈：審核者「申請人的主管」「某部門的主管」由本功能解析）、
  [`iam/07-groups.md`](../architecture/iam/07-groups.md)（群組：與部門的分工見 D1）、[`05-tenancy.md`](../architecture/05-tenancy.md) §5.1（平台層開關）、
  [`backend/13-trash.md`](../architecture/backend/13-trash.md)、[`backend/14-revisions.md`](../architecture/backend/14-revisions.md)、[`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md)（`TreeEditor`）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

系統現在描述「人」只有兩種方式：

- **角色**：決定能做什麼（權限鍵）。
- **群組**（[`iam/07-groups.md`](../architecture/iam/07-groups.md)）：純分組，用來把角色與資料夾授權一次給一批人；可巢狀，但 **沒有上下級**，也沒有「誰是負責人」。

B2B 的業務流程卻常常要問「這個人的主管是誰」「業務部的負責人是誰」：

- 多階段審批鏈的第一關幾乎都是「申請人的直屬主管」（[`approval-chains.md`](./approval-chains.md) 開放問題 2）。
- 之後的業務功能（報表依部門彙總、依部門篩選使用者、公告發給某個部門）都需要一份正式的組織架構。

用群組硬湊（每個部門開一個群組、主管另開一個群組）表達不出 **樹** 與 **主管**，
而且群組的成員關係就是授權（[`iam/07-groups.md`](../architecture/iam/07-groups.md) §1）——把部門做成群組，
等於每次人事異動都可能改到權限，反提權的檢查也會擋住單純的人事調動。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 部門樹：建立、改名、搬移（換上層）、排序、刪除（回收桶）、還原、版本歷史 | 部門帶來權限：部門持有角色、以部門授權資料夾（D1；需要時把部門同步成群組，另開提案） |
| 部門成員：一人可屬多個部門，其中一個是 **主要部門**；每個部門可有多位主管 | 職稱、職級、成本中心等人事欄位（只留一個自由文字的「職稱」） |
| 主管的解析：「某人的第 N 層主管」「某部門的主管」，給審批鏈等功能呼叫 | 依生效日期排程的組織異動、組織架構的歷史快照（某天的樣子） |
| 使用者列表依部門篩選（可含下層）；使用者詳情顯示所屬部門 | 組織圖的匯入（等 [`import-export.md`](./import-export.md)）、外部 IdP／SCIM 的部門同步 |
| 命令面板搜尋部門 | 公告依部門發送（之後由公告登記受眾類型） |
| **平台可關閉**（`organization`，D2）：關閉時頁面與端點消失，資料保留，依賴主管解析的功能得到空集合 | 租戶自行開關 |

## 使用者故事

**作為人資，我希望把新進人員放進「業務部 / 北區」並設為主要部門，以便他送出的申請自動找到北區主管。**

- **Given** 「北區」的主管是 Amy，上層「業務部」的主管是 Ben
- **When** 我把 Carl 加進「北區」並勾選「主要部門」
- **Then** Carl 的第 1 層主管是 Amy、第 2 層是 Ben；Amy 自己的第 1 層主管是 Ben（略過自己）

**作為平台營運，我希望對沒有購買組織管理的租戶關掉這個功能，以便後台不出現用不到的頁面。**

- **Given** 租戶 acme 已建好部門樹，審批流程的第一關是「申請人的主管」
- **When** 我在 apps/platform 關閉 `organization`
- **Then** backstage 沒有「組織」頁、使用者詳情沒有「所屬部門」；部門資料保留；
  之後進入「申請人的主管」那一關的審批找不到審核者，改由持有 `approval:override` 的人處理（[`approval-chains.md`](./approval-chains.md) D9）

## 初步構想

### 資料模型（租戶 DB）

```
org_units
  id uuid pk
  parent_id uuid null → org_units.id      null = 最上層（可以有多個最上層部門）
  name text                               同一個上層之下不分大小寫唯一（未刪除者）
  code citext null                        選填的代碼（給匯入、外部系統對應），未刪除者唯一
  description text null
  sort_order integer                      同層的排序（TreeEditor 拖曳）
  version integer                         樂觀鎖
  created_at / created_by / updated_at / updated_by / deleted_at

org_unit_members
  unit_id uuid → org_units.id
  user_id uuid → users.id
  is_manager boolean default false        這個部門的主管（可多位）
  is_primary boolean default false        這個人的主要部門
  title text null                         職稱（自由文字，只用來顯示）
  created_at / created_by
  pk (unit_id, user_id)
  unique (user_id) WHERE is_primary       一人最多一個主要部門
  index (user_id)
```

- 樹以 `parent_id` 的鄰接表表示，查詢用遞迴 CTE。一個租戶的部門數是百到千級，不另存 `path`／閉包表（D4）。
- 深度上限 `ORG_UNIT_MAX_DEPTH = 10`；搬移時擋循環。結構的寫入（建立、搬移、刪除、還原）以交易層級的 advisory lock（`org_structure`）排隊，
  與群組的 `group_membership` 同一個做法（[`iam/07-groups.md`](../architecture/iam/07-groups.md) §1.1）。
- **成員不搬進 `relation_tuples`**：部門不是授權來源（D1），放在關係圖裡只會讓主體閉包多走一種邊。

### 主管的解析（`OrgChartService`）

給其他模組呼叫的唯讀介面，放在 `modules/organization`，由 `OrganizationModule` 匯出：

```ts
interface OrgChartService {
  /** 某人的第 level 層主管（level 1 = 直屬）。沒有主要部門、找不到、或 organization 未啟用時回空陣列。 */
  managersOf(userId: string, level: number, tx?: DbOrTx): Promise<string[]>;
  /** 某部門的主管（直接設定在該部門的人，不往上找）。部門不存在、已刪除、或 organization 未啟用時回空陣列。 */
  managersOfUnit(unitId: string, tx?: DbOrTx): Promise<string[]>;
  /** 部門與它所有下層（使用者列表的篩選用）。 */
  descendantsOf(unitId: string, tx?: DbOrTx): Promise<string[]>;
}
```

**第 N 層主管** 的定義（D5）：

```
從申請人的「主要部門」開始往上走：
  第 1 層 = 第一個「有主管、而且主管不只申請人自己」的部門，它的主管（扣掉申請人）
  第 2 層 = 從第 1 層那個部門的上層繼續往上走，找到的下一組主管
  …
只算 status = active、未刪除的使用者；走到最上層還沒找到 → 空陣列
```

- 主管本人送出的申請，第 1 層是上層部門的主管——同一個部門的另一位主管 **也算**（一個部門有兩位主管時，彼此可以互審）。
- 沒有主要部門的人（只屬於非主要部門，或不屬於任何部門）沒有主管：組織架構不完整時不猜。
- 不快取：只在審批關卡啟動時呼叫，一次是一條沿 `parent_id` 往上的遞迴查詢。

### 後端

- `modules/organization/`：controller ／ service ／ repository ／ dto；`OrgChartService`；`OrgUnitTrashHandler`；`OrgUnitRevision` 的登記。
- **可關閉**（D2）：`TENANT_FEATURES` 加 `organization`；controller 標 `@RequireFeature('organization')`；
  `OrgChartService` 每個方法先看 `TenantContext.features`，未啟用就回空陣列——呼叫端（審批）不必知道這個開關。
- 使用者的端點：`GET /users` 加 `orgUnitId`、`includeDescendants`；**這兩個參數在 organization 未啟用時回 `VALIDATION_FAILED`**，不靜靜地忽略
  （忽略會讓前端以為篩選生效）。`modules/user` 透過 `OrgChartService.descendantsOf()` 取得部門清單，不直接查 `org_unit_members`。
- 刪除使用者：成員資格保留（休眠），還原時回來；永久刪除時由 `UserTrashHandler.purge` 一併刪掉 `org_unit_members` 的列（外鍵 `ON DELETE CASCADE` 也行，但照回收桶的慣例在 purge 裡明寫）。
- 回收桶：`org_unit` 類型（[`backend/13-trash.md`](../architecture/backend/13-trash.md) §2）。**只能刪除沒有下層部門的部門**（`409 ORG_UNIT_HAS_CHILDREN`）；
  成員資格隨部門休眠，還原時回來。還原時上層已刪除 → `409 ORG_UNIT_PARENT_DELETED`（先還原上層）。
- 版本歷史：`RevisionService.record`（[`backend/14-revisions.md`](../architecture/backend/14-revisions.md) §6），記 `name`、`code`、`description`、`parentId`。成員不進版本歷史（稽核有）。
- 推播：`ChangeSource.ORG_UNIT`，受眾是 `orgUnit:read` 的人與 **被異動的成員** 的 user room（使用者詳情的「所屬部門」）。
- 稽核：`orgUnit.create`／`update`／`move`（`before`／`after` 的 `parentId`）／`delete`／`restore`、`orgUnit.member.add`／`remove`／`update`（主管、主要部門、職稱的變更）。
- 指標：不加（不是佇列、外部呼叫或並行上限，[`08-monitoring.md`](../architecture/08-monitoring.md) §2.4）。
- `TenantFeatureImpacts`（[`05-tenancy.md`](../architecture/05-tenancy.md) §12.5）：登記 `orgUnits`（部門數）、`orgUnitMembers`（有部門的人數）、
  `approvalFlowsUsingOrg`（以主管為審核者的審批流程數；由 approval 模組登記，見 [`approval-chains.md`](./approval-chains.md) D9）。

### API

| Method | Path | 權限 | 說明 |
| --- | --- | --- | --- |
| GET | `/org-units` | `orgUnit:read` | 整棵樹（扁平陣列，帶 `parentId`、`sortOrder`、`memberCount`、`managerCount`）；`?keyword=` 只回符合的部門與它們的上層 |
| POST | `/org-units` | `orgUnit:create` | `{ name, parentId?, code?, description? }`；`sortOrder` 排在同層最後 |
| GET | `/org-units/:id` | `orgUnit:read` | 詳情，含上層路徑（麵包屑） |
| PATCH | `/org-units/:id` | `orgUnit:update` | `name`、`code`、`description`；必帶 `version` |
| POST | `/org-units/:id/move` | `orgUnit:update` | `{ parentId: string \| null, beforeId?: string, version }`：換上層與同層排序（TreeEditor 的拖放）；循環 `409 ORG_UNIT_CYCLE`、超過深度 `409 ORG_UNIT_TOO_DEEP` |
| DELETE | `/org-units/:id` | `orgUnit:delete` | 軟刪除；有下層 `409 ORG_UNIT_HAS_CHILDREN` |
| POST | `/org-units/:id/restore` | `orgUnit:delete` ＋ `@RequireFeature('trash')` | 還原 |
| GET | `/org-units/:id/members` | `orgUnit:read` ＋ `user:read` | 直接成員；`?includeDescendants=true` 含下層（每列帶所屬的部門） |
| PATCH | `/org-units/:id/members` | `orgUnit:update` | 差異語意 `{ add: [{ userId, isManager?, isPrimary?, title? }], update: [...], remove: [userId] }`；設 `isPrimary` 會把那個人原本的主要部門取消（同一個交易） |
| GET | `/users/:id/org-units` | `orgUnit:read` | 那個人所屬的部門（主要部門在前），含每個部門的上層路徑 |

錯誤碼（`packages/error-codes`）：`ORG_UNIT_NOT_FOUND`、`ORG_UNIT_NAME_DUPLICATE`（`details.conflictingUnitId`）、`ORG_UNIT_CODE_DUPLICATE`、
`ORG_UNIT_VERSION_CONFLICT`、`ORG_UNIT_CYCLE`、`ORG_UNIT_TOO_DEEP`（`details.max`）、`ORG_UNIT_HAS_CHILDREN`、`ORG_UNIT_PARENT_DELETED`、`ORG_UNIT_NOT_DELETED`。

### 權限

| 權限鍵 | 顯示名稱 | 說明 | 依賴 |
| --- | --- | --- | --- |
| `orgUnit:read` | 檢視組織 | 部門樹、部門詳情、成員 | — |
| `orgUnit:create` | 建立部門 | | `orgUnit:read` |
| `orgUnit:update` | 編輯組織 | 改名、搬移、排序；**增減成員、設定主管與主要部門** | `orgUnit:read` |
| `orgUnit:delete` | 刪除部門 | 軟刪除與還原 | `orgUnit:read` |

- 預設角色：`admin` 全部；`auditor` 只有 `orgUnit:read`；`member` 沒有（使用者詳情的「所屬部門」也要 `orgUnit:read`）。
- **不能改自己（D6）**：把自己加進或移出部門、改自己的主管身分或主要部門 → `403 AUTHZ_SELF_MODIFY`。
  部門雖然不帶權限，但「是誰的主管」決定誰能審誰的申請（審批鏈），讓自己變成主管等於讓自己能審別人的申請。
  另外，改 super-admin 的成員資格不限 super-admin（部門不帶權限，與群組的 §2.2 不同）。
- `orgUnit:update` **不** 列為受反提權限制的鍵（它不授予任何權限鍵，[`iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md) §9.2 G4 不適用）。

### 前端（backstage）

- `features/organization/`（可啟用的 feature，`FEATURE_CATALOG` 的 `organization`）：
  - `/organization`：左側部門樹（`@b2b-system/ui` 的 `TreeEditor`：拖放搬移與排序、行內改名、右鍵選單新增下層／刪除），右側選中部門的詳情與成員表
    （加成員走伺服器端搜尋；每列可切換「主管」「主要部門」、編輯職稱、移除）。頁面權限 `ORG_UNIT`（`orgUnit:read`）。
  - `navigation.ts`：側欄「組織」；`search.ts`：命令面板搜尋部門名稱與代碼，選取後開到 `/organization?unitId=`。
- 使用者 feature：詳情加「所屬部門」區塊、列表加部門篩選（部門選擇器 ＋「含下層部門」），都經 `apis/org-unit/` 取資料，
  以 `useIsFeatureReady('organization')` 決定是否顯示（feature 之間只經 `apis/`，[`coding-standards/07-layer-dependencies.md`](../coding-standards/07-layer-dependencies.md) §2.2）。
- 部門選擇器（樹狀、可搜尋）要給使用者列表與審批流程設定共用：放 `apps/backstage/src/core/components/OrgUnitPicker`，資料由呼叫端傳入的 query 提供。
- 回收桶：「部門」分頁（`registerTrashType`）；版本歷史：部門詳情的「歷史」。

### 平台（apps/platform）

- `TENANT_FEATURE_LABEL_KEY`／`TENANT_FEATURE_DESCRIPTION_KEY` 加 `organization`（「組織管理」）；關閉時的確認框列出影響數量（部門數、有部門的人數、用到主管的審批流程數），
  並說明「以主管為審核者的審批關卡會找不到人，改由持有 `approval:override` 的人處理」。

## 開放問題

1. 部門要不要帶權限（部門持有角色、以部門授權資料夾）？
   **結論**：不要（D1）。部門描述「匯報關係」，群組描述「授權」；需要時另做「把部門同步成群組」。
2. 一個人能不能屬於多個部門？主管怎麼算？
   **結論**：可以多個，但只有一個主要部門；主管只沿主要部門往上找（D5）。矩陣式組織的「虛線主管」不做。
3. 既有租戶要不要預設啟用？
   **結論**：既有租戶與新租戶 **都不啟用**（D3）。這是新的能力，沒有人會因為沒有它而失去功能；平台依租戶購買的方案打開。
4. 主管要不要也能是「職位」（例如「業務部經理」這個位子空缺時由代理人擔任）？
   **結論**：不做。主管是部門上的一個布林欄位；位子空缺時往上一層找（D5），代理由審批的 `approval:override` 處理。

## 設計決策

| # | 決定 | 理由 | 評估過的方案 |
| --- | --- | --- | --- |
| D1 | **部門不是授權來源**：不寫進 `relation_tuples`，不能持有角色、不能被授權資料夾 | 人事異動（調部門、換主管）頻繁，若同時改權限，每次調動都要過反提權、都要整個租戶的權限失效；授權已經有群組，兩者分工清楚 | 部門＝一種群組（`group` 加 `kind` 與 `parent`）：模型最省，但群組可以巢狀成任意圖、部門必須是樹；群組停用（`group` feature）時部門也跟著消失；主管沒有地方放 |
| D2 | **平台可關閉，id `organization`**。停用時 `/org-units` 與使用者端點的部門參數回 404／422、沒有頁面；**資料保留**；`OrgChartService` 回空集合 | 與其他 feature 一致：「關掉只是看不到、資料照舊、重新打開後一致」（[`05-tenancy.md`](../architecture/05-tenancy.md) §12）。回空集合讓呼叫端只要處理「找不到主管」一種情況——組織架構本來就可能不完整 | 停用時讓審批鏈直接拒絕送出：使用者無從理解，也讓兩個 feature 綁死 |
| D3 | **新 feature 預設不啟用**（平台 DB 的預設值不加、既有租戶不補） | 前例（`webhook`、`announcement`、`group`）都是「原本就有、改為可關」或「隨版本給所有人」，所以預設開；組織管理是全新的加值能力 | 預設開：會讓所有既有租戶的側欄多出一個空的「組織」 |
| D4 | **鄰接表 ＋ 遞迴 CTE**，不存 `path`、不做閉包表、不快取 | 規模小（百到千個部門），讀取點少（樹狀頁、篩選、審批關卡啟動）；搬移只改一列 | `ltree` 的 path：搬移要改整棵子樹；閉包表：寫入複雜度高，換來的讀取速度用不到 |
| D5 | **主管只沿主要部門往上找，跳過申請人自己**；沒有主要部門 → 沒有主管 | 一個明確、可預測的規則；多部門的人若從每個部門都找主管，審批會出現多組互不相干的審核者 | 每個成員資格各自有「匯報對象」欄位（點對點的 reports-to）：彈性最大，但維護成本高，且與部門樹會互相矛盾 |
| D6 | **不能改自己的部門成員資格與主管身分** | 主管身分決定審批的審核資格；與「不能改自己的角色」（I9）同一個理由 | 只擋「把自己設成主管」：搬自己到別的部門一樣能改變自己的主管是誰（換一個比較寬鬆的主管） |

## 歸檔去向

- `docs/architecture/backend/22-organization.md`（模組、資料表、主管的解析、API、設計決策）
- `docs/architecture/frontend/` 的組織頁章節（或併入 `03-feature-anatomy.md` 的範例）
- `docs/architecture/iam/02-permission-catalog.md`（`orgUnit` 一節、預設角色、依賴樹）
- `docs/architecture/05-tenancy.md` §5.1（`organization` 停用時的效果）
