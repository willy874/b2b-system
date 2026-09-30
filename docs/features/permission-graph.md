# 權限圖（Relationship-based Access Control）

- 優先度：P0
- 狀態：實作中（branch：`feat/permission-graph`；本 branch 做 G0～G2 與角色權限技能樹，G3 另開）
- 依賴：—
- 相關：[ADR-0024](../adr/0024-relationship-based-access-control.md)（本功能的決策）、[ADR-0005](../adr/0005-permission-resolved-server-side.md)、[ADR-0006](../adr/0006-flat-permission-scope.md)、[ADR-0015](../adr/0015-file-folder-access.md)、
  [`rbac/01-domain-model.md`](../rbac/01-domain-model.md)、[`rbac/07-resource-grants.md`](../rbac/07-resource-grants.md)、
  [`backend/05-rbac.md`](../architecture/backend/05-rbac.md)；會吸收 [`user-groups.md`](./user-groups.md)；[`multi-instance.md`](./multi-instance.md)（快取失效廣播）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

現在的權限判斷分成三套，各自解析、各自快取：

| 機制 | 回答 | 實作 | 問題 |
| --- | --- | --- | --- |
| 全域 RBAC | 這個人能不能做 X | `PermissionService`：`user_roles` ⋈ `role_permissions`，結果放 `PermissionCacheService` | 只有兩層；群組、群組帶角色都放不進去 |
| 資料夾授權 | 這個人能不能對這個資料夾做 X | `resource-grant.resolver.ts` 的 `resolveHierarchyLevels()` ＋ `resource_grants` | 只認識「一棵樹」；跨資源（專案 → 資料夾）要另外接 |
| 擁有者規則 | 自己建立的東西 | 寫死在 `FileAccessContext`（`created_by`） | 每種資源都要重寫一次 |

這三套在下一批功能都會碰到上限：

1. **群組**（[`user-groups.md`](./user-groups.md)）：開放問題 1「群組要不要帶角色」一旦答「要」，`PermissionService` 的解析與快取失效範圍都要改；
   巢狀群組更是 [`07-resource-grants.md`](../rbac/07-resource-grants.md) §10.2 自己寫下的「改用 Zanzibar 類服務」觸發條件。
2. **專案**：專案要成為資料夾的上層（07 §10.1），專案成員要自動成為底下資料夾與關卡的某個等級——這是跨資源的關係，不是一棵樹。
3. **快取失效要靠人工列清單**（[`05-rbac.md`](../architecture/backend/05-rbac.md) §5.1）：每多一種「會改變權限的事件」就要記得補一列；
   刪角色的「先查再刪」陷阱也是因為失效對象要事先算出來。加了群組之後，這張表會再多一倍。
4. **沒辦法回答「他為什麼能做 X」**：路徑散落在三套程式碼裡。ADR-0006 拒絕 deny 規則的理由正是「不要讓權限變成推理題」；
   關係一旦變多，就算只有 allow，也需要一個能把路徑列出來的工具。

把這三套收斂成 **同一張關係圖**（Google Zanzibar 的模型，也就是 OpenFGA／SpiceDB 在用的模型）：
使用者、群組、角色、租戶、資料夾、檔案都是節點，「持有角色」「是成員」「是上層」「被授予 viewer」都是邊，
「能不能做 X」就變成「從使用者走不走得到這個節點的這個關係」。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 通用的關係圖引擎（`core/authz`）：型別定義、檢查、展開、路徑說明 | 另外部署 OpenFGA／SpiceDB（見 §設計決定 D1） |
| 一張 `relation_tuples` 表取代 `user_roles`、`role_permissions`、`resource_grants` | deny／排除（`but not`）：維持「只有 allow」（D4） |
| 全域 RBAC、資料夾授權、擁有者規則全部改用引擎；對外 API 不變 | 過期以外的條件式權限（ABAC、時段、IP） |
| 以「租戶版本號」取代逐事件的快取失效清單 | 通用的 ListObjects（「列出我能讀的所有東西」）：資料夾仍整棵載入 |
| 群組（含巢狀、群組持有角色），吸收 `user-groups.md` | 平台管理者（`platform_admins` 仍是固定對照，範圍小、不值得） |
| 「為什麼能／不能」的說明 API 與使用者詳情頁的「有效權限」 | 角色繼承角色（見開放問題 3） |

## 使用者故事

**作為租戶管理者，我希望把「美術組」加進某個角色、再把組員加進美術組，以便人員異動時只要改群組成員。**

- **Given** 群組「美術組」持有角色 `editor`，Alice 是美術組成員
- **When** Alice 呼叫需要 `file:update` 的端點
- **Then** 放行；把 Alice 移出美術組之後的下一個請求回 `403 AUTHZ_FORBIDDEN`

**作為租戶管理者，我希望看到「Alice 為什麼能刪除這個資料夾」，以便決定要拔掉哪一條授權。**

- **Given** Alice 經由「美術組 → 專案 X 的 editor → 資料夾繼承」拿到刪除權
- **When** 在資料夾的共用對話框點 Alice 的「為什麼」
- **Then** 顯示完整路徑，且每一段都可以點到對應的管理頁

**作為開發者，我希望新增「關卡」這種資源時只要宣告它的關係，以便不用再寫一套解析與快取。**

## 初步構想

### 1. 圖的組成

```
                         ┌──────────────┐
         member          │   group:美術  │◀──── member ──── group:角色設計（巢狀）
  user:alice ───────────▶│              │
                         └──────┬───────┘
                                │ holder（群組持有角色）
                                ▼
  user:bob ── holder ──▶ ┌──────────────┐
                         │  role:editor │
                         └──────┬───────┘
                                │ tenant:self#file:update 的主體之一
                                ▼
                         ┌──────────────┐   file:update     ← 全域權限鍵 = 租戶節點上的關係
                         │ tenant:self  │   role:update
                         └──────▲───────┘   …（由權限目錄產生）
                                │ tenant（隱含邊，每個物件都有）
                ┌───────────────┴────────────────┐
                │                                │
       ┌────────┴───────┐  inherits_from  ┌──────┴─────────┐  editor
       │ fileFolder:素材 │◀───────────────│ fileFolder:角色 │◀──────── group:美術#member
       └────────────────┘                 └──────┬─────────┘
                                                 │ parent
                                          ┌──────┴─────────┐  owner
                                          │ file:hero.png  │◀──────── user:bob
                                          └────────────────┘
```

- **節點** `型別:id`：`user`、`group`、`role`、`tenant`（每個租戶 DB 只有一個，id 固定 `self`）、`fileFolder`、`file`；之後的 `project`、`level` 用同一種方式加入。
- **邊（tuple）** `物件#關係@主體`，主體可以是一個節點（`user:alice`）、一個節點的關係（`group:美術#member`、`role:editor#holder`），或萬用字元（`user:*`，取代現在的 `everyone`）。
- **全域權限鍵是租戶節點上的關係**：`tenant:self#role:update@role:admin#holder` ＝「admin 的持有者有 `role:update`」。
  所以 `role_permissions` 的每一列就是一條邊，**權限鍵的字串格式不變**（ADR-0006 的相容性承諾照舊成立）。
- **super-admin**：`tenant:self#superAdmin@role:super-admin#holder`；目錄產生的每個權限關係都定義成 `直接授予 ∪ superAdmin`。
  「隱含全集」從程式碼裡的特判變成模型裡的一行定義。

### 2. 模型（型別定義）

模型寫在程式碼裡、隨版本演進，跟權限目錄一樣 **不能由使用者修改**。語法借用 OpenFGA DSL 說明（實作是 TypeScript 物件，見 §4）：

```
type user

type group
  relations
    define member: [user, user:*, group#member]          # 巢狀群組；深度上限見 §5

type role
  relations
    define holder: [user, group#member]                   # 群組可以持有角色

type tenant
  relations
    define superAdmin: [role#holder]
    # 以下由權限目錄（db/seeds/permissions.ts）產生，一個權限鍵一個關係：
    # 依賴樹（§2.2）也寫在這裡：每個鍵的定義 ＝ 直接授予 ∪ superAdmin ∪ 包含它的鍵
    define user:read:          [role#holder] or superAdmin or user:update or user:resetPassword or user:assignRole
    define user:resetPassword: [role#holder] or superAdmin or user:update
    define role:read:          [role#holder] or superAdmin or role:update or user:assignRole or role:grantPermission or …
    define file:read:   [role#holder] or superAdmin or file:update or file:create or file:share
    define file:update: [role#holder] or superAdmin or file:delete   # file:create 不含 update，見 §2.1 規則 A
    define file:create: [role#holder] or superAdmin
    define file:delete: [role#holder] or superAdmin
    …

type fileFolder
  relations
    define tenant: [tenant]                               # 隱含邊，不存
    define parent: [fileFolder]                           # 結構邊，來自 file_folders.parent_id（D3）
    define inherits_from: [fileFolder]                    # 只在 inherit_grants = true 時存在（D3）
    define owner: [user]                                  # 結構邊，來自 created_by

    # 等級：高的蘊含低的，並且沿 inherits_from 往下流
    define manager:     [user, user:*, role#holder, group#member] or manager from inherits_from
    define editor:      [user, user:*, role#holder, group#member] or manager or editor from inherits_from
    define contributor: [user, user:*, role#holder, group#member] or editor or contributor from inherits_from
    define viewer:      [user, user:*, role#holder, group#member] or contributor or viewer from inherits_from

    # 動作：等級 ∪ 全域權限鍵（07 §3.2 的 has()）。都是「在這個位置上」的動作
    define can_read:       viewer      or file:read from tenant
    define can_create:     contributor or file:create from tenant
    define can_update:     editor      or file:update from tenant
    define can_delete:     editor      or file:delete from tenant
    define can_share:      manager     or file:share from tenant
    # 規則 A（§2.1）：能在這裡建立 ⇒ 能編輯自己在這裡建立的；能編輯全部當然也能編輯自己的
    define can_update_own: can_update or can_create

    # 對「這個資料夾本身」的操作看上層（07 §4），擁有者規則是交集
    define can_rename: can_update from parent or (owner and can_update_own from parent)
    define can_remove: can_delete from parent or (owner and can_update_own from parent)

type file
  relations
    define parent: [fileFolder]
    define owner: [user]
    define can_read:   can_read from parent
    define can_rename: can_update from parent or (owner and can_update_own from parent)
    define can_remove: can_delete from parent or (owner and can_update_own from parent)
```

對照現在的概念：

| 現在 | 圖上 |
| --- | --- |
| `user_roles (u, r)` | `role:r#holder@user:u` |
| `role_permissions (r, p)` | `tenant:self#<p.key>@role:r#holder` |
| super-admin 旁路 | `tenant:self#superAdmin@role:super-admin#holder` ＋ 模型定義 |
| `resource_grants (fileFolder, F, role, r, editor)` | `fileFolder:F#editor@role:r#holder` |
| `resource_grants (…, user, u, viewer)` | `fileFolder:F#viewer@user:u` |
| `everyone` 對象（全零 uuid） | `user:*` |
| `inherit_grants = false` | 不產生 `inherits_from` 邊 |
| 擁有者規則（`created_by`） | `owner` 關係 ＋ 交集 |
| 等級全序 `viewer < … < manager` | 計算關係（`editor` 定義裡含 `manager`） |
| `expires_at` | tuple 上的 `expires_at` 欄位，解析時忽略過期的邊 |

### 2.1 權限之間的包含

**沒有 read 的 edit 沒有意義；沒有 edit 的 create、delete 也不合理。** 所以同一個資源的動作不是互相獨立的勾選項，而是有包含關係：

```
   delete ──▶ update ──────────────┐
                 │                 ▼
                 └──▶ 編輯自己的 ──▶ read
   create ─────────────────▲
```

- `delete ⇒ update ⇒ read`：持有 `file:delete` 就等於也持有 `file:update`、`file:read`。
- **規則 A：`create ⇒ 編輯自己建立的 ⇒ read`。** 能建立的人一定能編輯（改名、移動、刪除）自己建立的東西，
  但不因此能編輯別人的。「有 edit 才有 create」仍然成立，只是 edit 的範圍是自己的東西；
  這保留了「投件箱」「共用上傳區」這類只能放、不能動別人東西的用途。
  - 「自己的」需要資源有擁有者（`owner` 關係，來自 `created_by`）。**沒有擁有者概念的資源**（`user`、`role`、`identityProvider`）
    沒有「自己的」範圍，規則 A 退化成完整的 `create ⇒ update`。
  - 資源之後加上擁有者時（例如角色記錄建立者），只要在模型裡補 `owner` 與 `can_update_own`，依賴樹改成規則 A 的形式。
- 具名動作一樣接到它依賴的動作上。

在圖上這只是計算關係（`file:read` 的定義裡含 `file:update`），不需要另外的機制；
guard、`GET /auth/profile`、`can()` 看到的都是 **包含之後** 的集合，所以 `@RequirePermissions('file:read')` 對只被授予 `file:delete` 的人也放行。

全域權限鍵的完整依賴樹見 §2.2。

**儲存與編輯**：

- tuple 只存 **明確授予** 的鍵，包含的鍵是算出來的。移除 `file:delete` 之後，如果 `file:update` 當初也有明確勾選，它還在；沒有就一起消失。
- 角色的權限編輯器：勾選 `file:delete` 時，`file:update`、`file:read` 顯示為「已包含（由 刪除檔案）」、勾選且鎖住；
  要取消 `file:read` 必須先取消所有包含它的鍵。`GET /roles/:id/permissions` 回傳每個鍵的 `source: 'explicit' | 'implied'` 與 `impliedBy`。
- 反提權不需要改：操作者的集合本來就是包含之後的，持有 `file:delete` 的人授予 `file:update` 天經地義；
  授予 `file:delete` 時操作者必須持有 `file:delete`，而那已經蘊含其餘兩個。
- 依賴樹是模型的一部分（跟權限目錄一起在 `db/seeds/permissions.ts` 宣告，§2.2），租戶不能改；不變條件在啟動時驗證。
- **伺服器端的規則比 UI 寬**：同時是明確與隱含的鍵保持明確；移除一個仍被其他鍵包含的明確鍵是允許的（它繼續以隱含的身分生效）。
  「要先取消上層才能取消前置」只是編輯器的互鎖，API 不因此拒絕請求。

**資料夾等級也照同一條規則**：`can_update` 含 `can_delete`，`can_update_own` 含 `can_update` 與 `can_create`，`can_read` 含全部。

| 等級 | 在這個位置 | 對自己建立的 | 對別人建立的 |
| --- | --- | --- | --- |
| `viewer` | read | — | read |
| `contributor` | read、create | read、改名、移動、刪除 | read |
| `editor` | read、create、update、delete | 全部 | 全部 |
| `manager` | 同上 ＋ share | 全部 | 全部 |

`contributor` 的語意與現在（07 §2 的 ◐）完全一樣，差別只是擁有者規則從 `FileAccessContext` 的手寫判斷變成模型裡的 `can_update_own`，
所以 **現有授權不需要遷移**。

> 刪除自己建立的東西也歸在「編輯自己的」裡：規則 A 的「edit」指的是對自己的東西有完整控制，
> 不另外拆「刪除自己的」。遞迴刪除的子樹條件（07 §4：子樹全部是自己的）仍在 service 檢查。

### 2.2 權限依賴樹

§2.1 的包含規則套到整份權限目錄，就是一棵（嚴格說是一張無循環的）依賴圖。邊有兩種，閉包時一視同仁，差別在驗證與顯示：

| 邊 | 意思 | 範圍 | 例 |
| --- | --- | --- | --- |
| **子能力** `──▶` | 上層的能力 **包含** 這個能力；這個能力也可以單獨授予 | 同一個資源 | `user:update ──▶ user:resetPassword`：能編輯使用者就能重設密碼；只給客服重設密碼也可以 |
| **依賴** `┈┈▶` | 少了它，這個能力無法完整操作 | 可以跨資源，**只能指向 `read`** | `user:assignRole ┈┈▶ role:read`：看不到角色就挑不了角色 |

箭頭讀作「持有左邊 ⇒ 也持有右邊」。

```
user
  user:delete ─┐
  user:create ─┴─▶ user:update ──▶ user:resetPassword ──▶ user:read
  user:assignRole ──▶ user:read
                  ┈┈▶ role:read

role
  role:delete ─┐
  role:create ─┴─▶ role:update ──▶ role:read
  role:grantPermission ──▶ role:read
                       ┈┈▶ permission:read

permission      permission:read          （葉節點）

file
  file:delete ──▶ file:update ──┐
  file:create ─────(＋ 資源上的 can_update_own，規則 A)──┐
  file:share ───────────────────┴───────────────────────┴─▶ file:read ──▶ file:access

system          system:update ──▶ system:read
approval        approval:review ──▶ approval:read
job             job:retry ──▶ job:read
identityProvider
  identityProvider:delete ─┐
  identityProvider:create ─┴─▶ identityProvider:update ──▶ identityProvider:read
auditLog        auditLog:read            （葉節點）

新增（G4）
group
  group:delete ─┐
  group:create ─┴─▶ group:update ──▶ group:read
                    group:update ┈┈▶ user:read   （挑成員要看得到使用者）
  group:assignRole ──▶ group:read             （群組持有角色；受反提權限制）
                   ┈┈▶ role:read
authz
  authz:explain ┈▶ user:read、role:read、group:read   （路徑會經過這三種節點）
```

**完整清單**（事實來源會是 `db/seeds/permissions.ts`，這張表是它的鏡像）：

| 權限鍵 | 子能力 | 依賴 |
| --- | --- | --- |
| `user:create` | `user:update` | |
| `user:delete` | `user:update` | |
| `user:update` | `user:resetPassword`、`user:read` | |
| `user:resetPassword` | `user:read` | |
| `user:assignRole` | `user:read` | `role:read` |
| `role:create` | `role:update` | |
| `role:delete` | `role:update` | |
| `role:update` | `role:read` | |
| `role:grantPermission` | `role:read` | `permission:read` |
| `system:update` | `system:read` | |
| `approval:review` | `approval:read` | |
| `file:create` | `file:read`（＋ 規則 A 的「編輯自己建立的」） | |
| `file:delete` | `file:update` | |
| `file:update` | `file:read` | |
| `file:share` | `file:read` | |
| `file:read` | `file:access` | |
| `job:retry` | `job:read` | |
| `identityProvider:create` / `:delete` | `identityProvider:update` | |
| `identityProvider:update` | `identityProvider:read` | |
| `group:create` / `:delete` | `group:update` | |
| `group:update` | `group:read` | `user:read` |
| `group:assignRole` | `group:read` | `role:read` |
| `authz:explain` | | `user:read`、`role:read`、`group:read` |
| `permission:read`、`auditLog:read`、`*:read`、`file:access` | （葉節點） | |

**不變條件**（啟動時驗證依賴圖，違反就啟動失敗，與路由稽核同一個層級）：

| # | 條件 | 理由 |
| --- | --- | --- |
| G1 | 沒有循環 | 閉包要有定義 |
| G2 | 子能力只能在同一個資源內 | 跨資源的關係一律是「依賴」，一眼分得出來 |
| G3 | 依賴只能指向 `<r>:read`（或閘門 `file:access`） | 依賴是「為了完整操作」而補上的，不能因此多出寫入能力 |
| G4 | **受反提權限制的鍵不能被任何鍵包含**：`user:assignRole`、`role:grantPermission`、`file:share`、`group:assignRole` 只能是根 | 否則「能編輯使用者」就會悄悄等於「能指派角色」，反提權的檢查點被繞過 |

G4 的直接結果：`user:update` **不** 包含 `user:assignRole`，`user:assignRole` 也 **不** 包含 `user:update`（只依賴兩邊的 read）；
`role:grantPermission` 同理，只帶 `role:read`、`permission:read`。敏感能力與一般編輯能力是兩條獨立的分支。

**宣告方式**：

```ts
// db/seeds/permissions.ts
{ key: 'user:update',          includes: ['user:resetPassword', 'user:read'] },
{ key: 'user:resetPassword',   includes: ['user:read'] },
{ key: 'user:assignRole',      includes: ['user:read'], requires: ['role:read'] },
{ key: 'role:grantPermission', includes: ['role:read'], requires: ['permission:read'] },
```

模型產生器由它反推每個權限關係的定義（§2 的 `define user:read: … or user:update or …`）；
前端的角色權限編輯器照同一份資料把子能力縮排在上層底下（`重設密碼` 掛在 `編輯使用者` 下面），依賴則顯示成「需要：檢視角色」。

**閉包之後對預設角色的影響**：

| 角色 | 變化 |
| --- | --- |
| `admin` | 無（本來就持有每個被包含的鍵） |
| `auditor` | 多出 `file:access`（由 `file:read`）。沒有行為變化：檔案路由本來就是 `file:access` 或 `file:read` 擇一，個人資料夾的條件也一樣 |
| `member` | 無 |

租戶自訂的角色可能多出鍵，最需要注意的是 **有 `user:update` 的角色多出 `user:resetPassword`**。
migration 列出每個角色多出來的鍵、寫稽核 `role.permissionsImplied`，不靜默改變。

**不進圖的規則**（仍在 service，是資源狀態而不是關係）：系統角色保護、最後一個 super-admin、不能操作自己、
遞迴刪除的子樹條件（07 §4）、上傳中檔案只給本人看、系統資料夾不可移動。圖只回答「有沒有這條關係」。

### 3. 資料模型（租戶 DB）

```
relation_tuples
  id                uuid pk
  object_type       text        'role' | 'tenant' | 'group' | 'fileFolder' | …
  object_id         text        uuid 或 'self'
  relation          text        'holder' | 'role:update' | 'editor' | …
  subject_type      text
  subject_id        text        uuid 或 '*'
  subject_relation  text        '' = 節點本身；'member' / 'holder' = 使用者集合
  expires_at        tstz null
  created_at / created_by
  unique (object_type, object_id, relation, subject_type, subject_id, subject_relation)
  index  (subject_type, subject_id, subject_relation)      ← 從使用者往外走（§5 主體閉包）
  index  (object_type, object_id, relation)                ← 從物件往回查

authz_revision                                              ← 單列；relation_tuples 的 trigger 在同一交易內 +1
  revision   bigint

groups / group_members → 不另開 group_members：成員就是 group:G#member 的邊；groups 只存名稱、說明、deleted_at
```

- 寫入時以模型驗證「這個型別能不能有這個關係、主體型別對不對」（取代外鍵與 enum）；多型關聯沒有外鍵，
  解析時 join 未刪除的節點（沿用 07 §8 的做法）。
- `permissions` 表保留：它是目錄（顯示名稱、排序），模型從它產生租戶節點的關係；`roles`、`users` 表不變。
- `user_roles`、`role_permissions`、`resource_grants` 在 §分階段 的最後一步刪除。

### 4. 後端

```
core/authz/                         ← 通用、不認識任何業務型別
  authz.model.ts                    型別定義的 TS 形狀（defineType）＋ 模型驗證
  authz.registry.ts                 各 module 在 onModuleInit 註冊型別與結構邊供應者（conventions/07 §3.2）
  authz.engine.ts                   check / expand / explain
  authz.repository.ts               relation_tuples 的讀寫
  authz.cache.ts                    主體閉包快取，以 (tenantId, revision) 為鍵
modules/permission/                 產生 tenant 型別（依權限目錄）；PermissionService 改成引擎的薄殼
modules/role/、modules/user/        角色的權限、使用者的角色 → 寫 tuple
modules/group/（新）                群組 CRUD、成員
modules/file/                       註冊 fileFolder、file 型別與結構邊供應者；FileAccessContext 改用引擎
modules/resource-grant/             刪除（解析併入引擎；等級變成模型裡的計算關係）
```

**對外介面不變**：

| 介面 | 變化 |
| --- | --- |
| `@RequirePermissions('role:update')`、`@RequireAnyPermission` | 無；guard 呼叫 `authz.check('tenant:self', 'role:update', user)` |
| `PermissionService.getPermissionSet()` | 回傳形狀不變；內容由主體閉包算出 |
| `GET /auth/profile` 的權限鍵陣列、前端 `can()` | 無 |
| 檔案、資料夾的 `capabilities` | 無；由 `can_*` 關係算出 |
| `GET/PUT /roles/:id/permissions`、`PUT /users/:id/roles`、資料夾授權 API | 請求與回應不變；底層改寫 tuple |

**反提權一般化**（取代 `assertGrantable`、`assertRolesAssignable`、`missingActions`）：
寫入 `物件#關係@主體` 時，這條邊會讓主體多出的能力，操作者必須全部都有。

| 寫入的邊 | 多出的能力 | 操作者要有 |
| --- | --- | --- |
| `tenant:self#<key>@role:r#holder` | `<key>` | `<key>`（＋ `role:grantPermission`） |
| `role:r#holder@user:u`（或 `@group:g#member`） | 角色 r 的所有權限鍵；r 是 super-admin 時 **一律拒絕**（05-rbac §4.1 照舊） | 全部（＋ `user:assignRole`） |
| `fileFolder:F#editor@…` | `editor` 蘊含的 `can_*` | 在 F 上都有（＋ `can_share`） |
| `group:g#member@user:u` | 群組 g 持有的角色的權限鍵 | 見開放問題 4 |

每種關係在模型裡宣告「誰能寫這條邊」（`grantedBy: 'can_share'` 之類），引擎統一檢查，錯誤仍是 `403 AUTHZ_ESCALATION`（`details.missing`）。

**稽核**：沿用各領域的 action（`role.grantPermission`、`fileFolder.grant`…），`changes` 記錄 tuple 的 before／after；
另加 `group.*`、`group.member.add`／`remove`。

### 5. 解析與效能

兩個方向各做一件事：

1. **主體閉包** `S(u)`：從 `user:u` 沿「是成員」「持有」往外走，得到他屬於的所有使用者集合
   （`user:u`、`user:*`、`group:美術#member`、`group:角色設計#member`、`role:editor#holder`…）。
   一句遞迴 CTE，深度上限 8、寫入時擋循環；結果以 `(tenantId, revision, userId)` 快取。
2. **物件側展開**：從目標物件的關係定義往回展開（計算關係、`X from Y`、交集），遇到直接邊就問「主體在不在 `S(u)`」。

- **全域權限**：`tenant:self` 上的關係只有一層，閉包算出來之後直接得到 `Set<PermissionKey>`——與現在的 `PermissionSet` 一樣，guard 仍是 O(1)。
- **資料夾**：沿用「整棵結構一次載入 ＋ 記憶化」（現在的 `resolveHierarchyLevels`），只是一般化成「對任意 `X from Y` 關係做記憶化展開」；
  結構邊由 file module 的供應者從 `file_folders` 提供，不另存一份（D3）。
- **快取失效**：`relation_tuples` 的任何寫入都讓 `authz_revision` +1（trigger，同一交易），提交後以 `pg_notify` 廣播；
  各程序收到就丟掉該租戶的閉包快取，TTL 60 秒仍是安全網。
  **05-rbac §5.1 的失效清單整張消失**，刪角色的「先查再刪」陷阱也跟著消失（失效不需要事先算出受影響的人）。
  代價是粒度變粗：一次授權變更讓整個租戶的閉包重算一次（每人一句 CTE，按需、lazy），見開放問題 5。
- **推播的 room**：revision 變動時，對該租戶已連線的使用者重算權限集合、比對舊的 room 後換 room；不再需要事件帶「受影響的使用者」。

### 6. 說明（explain）

`authz.explain(物件, 關係, 使用者)` 回傳走到的路徑（或「沒有路徑」與最接近的缺口）：

```
user:alice
  → group:角色設計#member
  → group:美術#member
  → fileFolder:素材#editor
  → fileFolder:角色（inherits_from 素材）#editor
  → can_delete
```

- `GET /users/:id/effective-permissions`：全域權限鍵，每個鍵附來源（哪個角色、經由哪個群組）。使用者詳情頁顯示「有效權限」分頁。
- `GET /authz/explain?object=fileFolder:<id>&relation=can_delete&user=<id>`：共用對話框的「為什麼」。
- 拒絕的稽核 `authz.denied` 的 `metadata` 不帶路徑（沒有路徑可帶），但前端的 403 頁可以連到說明頁。

### 7. 前端

- `core/permission` 不變（仍是 `can(key)`）。
- 新 feature `features/group/`：群組列表、成員、群組持有的角色。
- 使用者詳情頁：「所屬群組」「有效權限（含來源）」。
- 資料夾共用對話框：對象選擇器列出群組；每一列的「為什麼」。
- 角色詳情頁：持有者分成「直接」與「經由群組」。

### 8. 權限

| 權限鍵 | 說明 |
| --- | --- |
| `group:read` / `group:create` / `group:update` / `group:delete` | 群組管理；成員管理算 `group:update` |
| `authz:explain` | 查看任何人的有效權限與說明路徑（稽核人員、管理員）；查自己不需要權限 |

## 設計決定（提案階段的傾向，寫 ADR 時定案）

**D1 — 自己在 Postgres 上實作，不部署 OpenFGA／SpiceDB。**
每個租戶一個 database（ADR-0020），外部服務要嘛每租戶一個 store、要嘛自己再做一次隔離；
更關鍵的是 **稽核在交易內、權限寫入與業務寫入同一個交易**（CLAUDE.md 後端規則 6）——外部服務會變成雙寫。
模型刻意只用 OpenFGA 支援的子集（直接、計算、`X from Y`、交集、萬用字元、過期），
`relation_tuples` 的形狀就是它的 tuple，將來要換只需要匯出（07 §10.2 的承諾延續）。

**D2 — 權限鍵是租戶節點上的關係，不是獨立的 `permission` 節點。**
這是 OpenFGA 常見的「organization」寫法，全域檢查只有一層；資源的 `can_*` 以 `file:read from tenant` 接上全域權限，
取代 07 §3.2 的 `全域有權限鍵 ∨ 等級蘊含` 手寫判斷。

**D3 — 結構邊（`parent`、`owner`）由資源自己的表提供，不存進 `relation_tuples`。**
`file_folders.parent_id` 已經是結構的事實來源；複製一份到 tuple 表，每次移動都要雙寫、還要確保一致。
引擎允許型別註冊「結構邊供應者」（從自己的表批次取邊）。代價：匯出到 OpenFGA 時要把結構邊一起產生。
`inherits_from` 也是從 `parent_id` ＋ `inherit_grants` 推出來的，不存。

**D4 — 只有 allow：支援交集，不支援排除。**
交集只用在「擁有者 ∧ 能在上層建立」這類 **收窄的組合**，不會出現「有 A 但沒有 B」的否定規則，
ADR-0006「不要讓權限變成推理題」的精神不變；explain 讓剩下的推理變成可以查。

**D6 — 同一資源的動作有包含關係：`delete ⇒ update ⇒ read`，`create ⇒ 編輯自己建立的 ⇒ read`（規則 A）。**
見 §2.1。沒有擁有者概念的資源，`create ⇒ update`。包含寫在模型裡，所有判斷點（guard、資源 `can_*`、反提權、profile）自動一致；儲存只存明確授予的鍵。

**D5 — 快取以租戶 revision 失效，不再逐事件列清單。**
見 §5。正確性從「每個事件都記得失效」變成「每個寫入都經過同一張表」，由 trigger 保證。

## 分階段

| 階段 | 內容 | 可回退 |
| --- | --- | --- |
| **G0** | ADR-0024；`core/authz` 引擎 ＋ 模型驗證 ＋ 單元測試（純記憶體 tuple，照 07 的每一條規則寫案例） | 不動任何既有程式 |
| **G1** | `relation_tuples`；migration 從三張舊表回填；舊表仍是事實來源，**以 DB trigger 在同一交易雙寫**（service 不必改，也不會漏）；`authz_revision` 延到 G3；**影子比對**：開發與測試環境每次檢查兩套都跑，不一致就報錯 | 刪新表即可 |
| **G2** | 讀取改走引擎，並啟用包含關係（§2.1；自訂角色多出的鍵由 migration 列出並寫稽核）：`PermissionService`、`FileAccessService`、推播 room；刪 `resource-grant.resolver.ts` 的解析；快取仍逐事件失效（寫入還經過舊表，revision 失效隨 G3 的寫入切換一起做） | 切回舊讀取路徑 |
| **G3** | 寫入只寫 tuple；刪 `user_roles`、`role_permissions`、`resource_grants` 與雙寫 | 需要反向回填，視為不可回退 |
| **G4** | 群組（巢狀、持有角色）、`user:*`、explain API 與前端頁面；刪除 `user-groups.md` | — |
| **G5** | 隨專案功能：`project` 型別，`fileFolder` 的 `inherits_from` 可以指向專案 | — |

G1～G3 對外沒有任何行為變化，既有的權限測試（頁面三個權限案例、E2E 的「移除權限後下一次請求即 403」）全部要原封不動通過。

## 開放問題

進入「規劃中」之前，每一條都要有結論（寫在該條下方，不要刪掉問題）。

1. **這一版要不要真的換掉 `user_roles`／`role_permissions`？** 另一個選擇是只把 **資源授權與群組** 放進圖、全域 RBAC 維持兩張表
   （引擎把它們當作結構邊供應者讀進來）。改動小很多，但會留下兩種寫入路徑，也拿不到「群組持有角色」的統一失效。

   **結論**（2026-09-30）：全部換，依 G1～G3 以雙寫＋影子比對逐步切換。`feat/permission-graph` 做到 G2，G3（寫入切換、刪舊表）另開 branch。
2. **`pg_notify` 的連線成本**：LISTEN 要一條常駐連線；每租戶一條在租戶數多時不划算。改成平台 DB 上一個頻道、payload 帶租戶代碼？
   （與 [`multi-instance.md`](./multi-instance.md) 一起決定。）

   **結論**：延到 G3（寫入改經 tuple 之後才有單一的失效點）；G2 之前沿用逐事件失效。
3. **角色繼承角色**（`role:admin#holder` 包含 `role:editor#holder`）在圖上只是一種邊，要不要開放？
   ADR-0006 以「複製角色」取代繼承的理由（結果是明確清單）在有 explain 之後還成不成立？

   **結論**：延到 G4；這一版模型不定義 role → role 的邊。
4. **群組成員的反提權**：把人加進持有 `admin` 的群組，等於指派 `admin`。要比照 `assertRolesAssignable` 檢查群組持有的角色嗎？
   群組上的資料夾授權要不要一起檢查（現在指派角色時不檢查角色的資料夾授權）？

   **結論**：延到 G4（群組）。
5. **revision 的粒度**：一個資料夾授權的變更也讓整個租戶的全域權限閉包失效。要不要分成兩個 revision（`tenant`／角色／群組一組，資源授權一組）？

   **結論**：延到 G3，與問題 2 一起。
6. **explain 的揭露範圍**：路徑會經過使用者可能看不到的群組、資料夾名稱。沒有 `authz:explain` 的人查自己時，看不到的節點要遮成「某個群組」嗎？

   **結論**：延到 G4；這一版的引擎有 `explain()`，但不開放 API。
7. **外部 IdP 的群組對應**（[`04-sso.md`](../architecture/04-sso.md) §11）對應到群組之後，群組成員是否標記為「同步來源」、不允許手動編輯？

   **結論**：延到 G4。
8. **平台管理者**要不要一起進圖（`platform_admins.role` 目前是固定對照，10 個權限鍵）？傾向不要。

   **結論**：不要。
9. **`contributor` 等級怎麼處理**（§2.1）：它能在資料夾裡上傳（create），卻不能編輯別人的東西（只能改刪自己上傳的）。三個選項：
   - A. 把「自己上傳的」視為它的 edit 範圍：包含規則改成「`create` ⇒ 至少能編輯自己建立的」，`contributor` 保留原本語意（投件箱、共用上傳區仍可做）；
   - B. 嚴格套用：`contributor` 也能改名、移動別人的檔案，只差不能刪除；
   - C. 拿掉 `contributor`，剩 `viewer` / `editor` / `manager`；共用資料夾（`everyone = editor`，07 §12）不受影響，但現有的 `contributor` 授權要升成 `editor` 或降成 `viewer`。
   傾向 A：它仍然是「有 edit 才有 create」，只是 edit 的範圍是自己的東西。

   **結論：採用 A**（2026-09-30）。一般化成 `create ⇒ 編輯自己建立的 ⇒ read`；沒有擁有者概念的資源退化成 `create ⇒ update`。
   見 §2.1、D6。
10. **包含表的邊界**：`user:resetPassword` 要不要包含 `user:update`？跨資源的包含（`user:assignRole ⇒ role:read`）要不要開放，還是只允許同資源內？

    **結論**（2026-09-30）：`user:resetPassword` 是 `user:update` 的子能力（`update ⇒ resetPassword`，反之不成立）；
    跨資源開放，但只能是「依賴」且只能指向 read（`user:assignRole ┈▶ role:read`）。整份目錄的依賴樹與不變條件見 §2.2。

## 歸檔去向

完成後預計寫成：

- `docs/adr/0024-relationship-based-access-control.md`（取代 ADR-0006 的「延伸路徑」一節、ADR-0015 的解析部分；ADR-0005 的快取段落改寫）
- `docs/rbac/01-domain-model.md`（重寫：圖的組成、模型、不變條件）
- `docs/rbac/07-resource-grants.md`（等級改成模型裡的關係；§3 解析、§10 延伸改寫）
- `docs/rbac/08-groups.md`（新）
- `docs/architecture/backend/05-rbac.md` §4、§5（引擎、revision 快取）
- `docs/rbac/02-permission-catalog.md`（`group:*`、`authz:explain`；新增「子能力」「依賴」欄與依賴樹）
