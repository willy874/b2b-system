# 權限圖（Relationship-based Access Control）：G4 以後

- 優先度：P0
- 狀態：實作中（G0～G3b 已上 main 並歸檔）；**G4a 實作中**（branch `feat/permission-graph-g4a`：群組、反提權一般化；決策見 ADR-0024 D10～D16）；G4b（explain）規劃中；G5 專案待做
- 依賴：—
- 相關：[ADR-0024](../adr/0024-relationship-based-access-control.md)（本功能的決策）、
  [`rbac/01-domain-model.md`](../rbac/01-domain-model.md) §6.4（圖的組成與模型）、
  [`rbac/02-permission-catalog.md`](../rbac/02-permission-catalog.md) §9（權限依賴樹）、
  [`rbac/07-resource-grants.md`](../rbac/07-resource-grants.md) §2.1（資料夾在圖上）、
  [`backend/05-rbac.md`](../architecture/backend/05-rbac.md) §4.2（引擎）、§5（revision 失效）；
  已吸收原本獨立的「使用者群組」提案（G4）；[`backend/13-trash.md`](../architecture/backend/13-trash.md) §6（刪除角色的還原、休眠的持有者邊）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 已上線的部分（G0～G3b，2026-09-30）

權限的三套機制（全域 RBAC、資料夾授權、擁有者規則）已收斂成同一張關係圖，現在的樣子寫在正式文件裡：

| 內容 | 正式文件 |
| --- | --- |
| 為什麼、切換策略、D1～D9 | [ADR-0024](../adr/0024-relationship-based-access-control.md) |
| 圖的組成、核心型別、概念對照、不進圖的規則 | [`rbac/01-domain-model.md`](../rbac/01-domain-model.md) §6.4 |
| 權限之間的包含（子能力／依賴）、不變條件、對預設角色的影響 | [`rbac/02-permission-catalog.md`](../rbac/02-permission-catalog.md) §9 |
| 資料夾的等級與 `can_*`、規則 A（`contributor`） | [`rbac/07-resource-grants.md`](../rbac/07-resource-grants.md) §2.1 |
| `relation_tuples`、`authz_revision` | [`backend/02-database.md`](../architecture/backend/02-database.md) §2.10、§2.11 |
| `core/authz` 引擎、revision ＋ 平台 DB 廣播的失效 | [`backend/05-rbac.md`](../architecture/backend/05-rbac.md) §4.2、§5 |
| 角色權限的技能樹 | `apps/backstage/src/features/role/components/PermissionSkillTree.tsx` |

這份提案只剩下還沒做的部分。

## 背景

G3b 之後還有三件事沒做：

1. **群組**：角色帶權限，拿來當分組會讓角色數量爆炸（「美術組-A 專案」「美術組-B 專案」…）；逐個使用者授權則難以維護。
   群組是「純分組」：授權給群組、群組持有角色，人員異動只改成員。巢狀群組是 07 §10.2 寫下的「改用 Zanzibar 類服務」觸發條件，現在引擎已經有了。
2. **沒辦法回答「他為什麼能做 X」**：路徑會經過群組、角色、資料夾繼承。引擎已有 `explain()`，但沒有 API 與畫面。
3. **反提權還是三套手寫的檢查**（`assertGrantable`、`assertRolesAssignable`、資料夾等級的 `missingActions`）：
   加了群組之後會變成第四套（把人加進持有 `admin` 的群組等於指派 `admin`）。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 群組（含巢狀、群組持有角色），吸收原本的「使用者群組」提案 | 另外部署 OpenFGA／SpiceDB（ADR-0024 D1） |
| 反提權一般化：模型宣告「誰能寫這條邊」，引擎統一檢查 | deny／排除（D4） |
| 「為什麼能／不能」的說明 API 與使用者詳情頁的「有效權限」 | 過期以外的條件式權限（ABAC、時段、IP） |
| G5：專案成為資料夾的上層 | 通用的 ListObjects（「列出我能讀的所有東西」） |
| | 平台管理者進圖（固定對照，範圍小） |
| | 角色繼承角色（見開放問題 3） |

## 使用者故事

**作為租戶管理者，我希望把「美術組」加進某個角色、再把組員加進美術組，以便人員異動時只要改群組成員。**

- **Given** 群組「美術組」持有角色 `editor`，Alice 是美術組成員
- **When** Alice 呼叫需要 `file:update` 的端點
- **Then** 放行；把 Alice 移出美術組之後的下一個請求回 `403 AUTHZ_FORBIDDEN`

**作為租戶管理者，我希望看到「Alice 為什麼能刪除這個資料夾」，以便決定要拔掉哪一條授權。**

- **Given** Alice 經由「美術組 → 專案 X 的 editor → 資料夾繼承」拿到刪除權
- **When** 在資料夾的共用對話框點 Alice 的「為什麼」
- **Then** 顯示完整路徑，且每一段都可以點到對應的管理頁

**作為開發者，我希望新增「關卡」這種資源時只要宣告它的關係，以便不用再寫一套解析與快取。**（G5 起）

## 初步構想

### 1. G3b：刪舊表 ✅

已完成（migration 0010），紀錄在 ADR-0024「實作紀錄（G3b）」。

### 2. 群組在模型上（G4）

```
type group
  relations
    define member: [user, user:*, group#member]          # 巢狀群組；主體閉包的遞迴深度上限 8，寫入時擋循環

type role
  relations
    define holder: [user, group#member]                   # 群組可以持有角色（現在只有 user）；super-admin 除外（D12）

type fileFolder
  relations
    define manager: [user, user:*, role#holder, group#member] or …   # 等級的直接主體多一種：群組
```

- **資料**：成員就是 `group:G#member@user:u`（或 `@group:H#member`）的邊，不另開 `group_members`；`groups` 表只存名稱、說明、`deleted_at`。
- **主體閉包**：`AuthzRepository.subjectClosures` 的遞迴 CTE 目前只沿 `role#holder` 走，加上 `group#member`；已刪除的群組比照角色排除。
- **模組**：`modules/group/`（群組 CRUD、成員）；在 `onModuleInit` 註冊 `group` 型別。
- **失效**：成員或群組持有的角色變了，照樣是 `permissionsChanged()`，整個租戶失效（D8），不必算出受影響的人。
- **稽核**：`group.create`／`update`／`delete`、`group.member.add`／`remove`、`group.assignRole`。

依賴樹新增（[`rbac/02-permission-catalog.md`](../rbac/02-permission-catalog.md) §9 的不變條件照舊）：

```
group
  group:delete ─┐
  group:create ─┴─▶ group:update ──▶ group:read
                    group:update ┈┈▶ user:read   （挑成員要看得到使用者）
  group:assignRole ──▶ group:read             （群組持有角色；受反提權限制，只能是根）
                   ┈┈▶ role:read
authz
  authz:explain ┈▶ user:read、role:read、group:read   （路徑會經過這三種節點）
```

### 3. 反提權一般化（G4）

取代 `assertGrantable`、`assertRolesAssignable`、`missingActions`。
規則：寫入 `物件#關係@主體` 這條邊時，它會讓主體多出一些能力，操作者必須全部都有。

| 寫入的邊 | 多出的能力 | 操作者要有 |
| --- | --- | --- |
| `tenant:self#<key>@role:r#holder` | `<key>` | `<key>`（＋ `role:grantPermission`） |
| `role:r#holder@user:u`（或 `@group:g#member`） | 角色 r 的所有權限鍵；r 是 super-admin 時：指派給使用者只有 super-admin 能做（05-rbac §4.1 照舊），指派給群組 **一律拒絕**（D12） | 全部（＋ `user:assignRole`／`group:assignRole`） |
| `fileFolder:F#editor@…` | `editor` 蘊含的 `can_*` | 在 F 上都有（＋ `can_share`） |
| `group:g#member@user:u`（或 `@group:h#member`） | g 與它所有上層群組持有的角色的權限鍵；不含群組的資料夾授權（D13） | 全部（＋ `group:update`）；不能加自己或自己所屬的群組（D11） |

每種關係在模型裡宣告「誰能寫這條邊」（`grantedBy: 'can_share'` 之類），引擎統一檢查，錯誤仍是 `403 AUTHZ_ESCALATION`（`details.missing`）。
同一步加上寫入時的模型驗證：「這個型別能不能有這個關係、主體型別對不對」（現在由 `db/schema/relation-tuples.ts` 的建構函式保證形狀）。

### 4. 說明（explain，G4）

引擎的 `AuthzChecker.explain()` 已回傳走到的路徑；要做的是 API 與畫面：

```
user:alice
  → group:角色設計#member
  → group:美術#member
  → fileFolder:素材#editor
  → fileFolder:角色（inherits_from 素材）#editor
  → can_delete
```

- `GET /users/:id/effective-permissions`：全域權限鍵，每個鍵附來源（哪個角色、經由哪個群組、明確或由依賴樹帶出）。使用者詳情頁顯示「有效權限」分頁。
- `GET /authz/explain?object=fileFolder:<id>&relation=can_delete&user=<id>`：共用對話框的「為什麼」。沒有路徑時回「沒有路徑」與最接近的缺口。
- 拒絕的稽核 `authz.denied` 的 `metadata` 不帶路徑（沒有路徑可帶），但前端的 403 頁可以連到說明頁。

### 5. 前端（G4）

- `core/permission` 不變（仍是 `can(key)`）。
- 新 feature `features/group/`：群組列表、成員、群組持有的角色。
- 使用者詳情頁：「所屬群組」「有效權限（含來源）」。
- 資料夾共用對話框：對象選擇器列出群組；每一列的「為什麼」。
- 角色詳情頁：持有者分成「直接」與「經由群組」。

### 6. 權限（G4）

| 權限鍵 | 說明 |
| --- | --- |
| `group:read` / `group:create` / `group:update` / `group:delete` | 群組管理；成員管理算 `group:update` |
| `group:assignRole` | 讓群組持有角色（受反提權限制） |
| `authz:explain` | 查看任何人的有效權限與說明路徑（稽核人員、管理員）；查自己不需要權限 |

### 7. 專案（G5）

隨專案功能：`project` 型別，`fileFolder` 的 `inherits_from` 可以指向專案；專案成員（`project:P#member`）自動成為底下資料夾與關卡的某個等級。
模型上只是多一個型別與一條 `inherits_from` 的邊，判斷器會沿著走（07 §10.1）。

## 分階段

| 階段 | 內容 | 可回退 |
| --- | --- | --- |
| **G0～G2** ✅ | 引擎、`relation_tuples` 與雙寫、讀取改走引擎、權限依賴樹（2026-09-30，32427b4） | — |
| **G3a** ✅ | 寫入只寫 tuple、`authz_revision` ＋ 平台 DB 廣播失效、刪影子比對與 `modules/resource-grant`（2026-09-30，96ae80a） | 舊表還在，但回退要反向回填 |
| **G3b** ✅ | §1：刪同步 trigger、三張舊表、它們的 schema 定義（2026-09-30，migration 0010） | 不可回退 |
| **G4** | §2～§6：群組（巢狀、持有角色）、反提權一般化、explain API 與前端頁面 | — |
| **G5** | §7：`project` 型別 | — |

## 開放問題

已結案的問題（切換策略、廣播頻道、revision 粒度、平台管理者不進圖、`contributor` 採規則 A、包含表的邊界）的結論寫在
ADR-0024 D1～D9、`rbac/01-domain-model.md` §6.4 與 `rbac/02-permission-catalog.md` §9。以下是還沒結論的（編號沿用原本的，其他文件以編號引用）：

> 以下各題已於 2026-10-01 結論，決策寫在 [ADR-0024](../adr/0024-relationship-based-access-control.md) D10～D16。
> 選項表保留下來，review 時看得到當初的取捨。

3. **角色繼承角色**（`role:admin#holder` 包含 `role:editor#holder`）在圖上只是一種邊，要不要開放？
   ADR-0006 以「複製角色」取代繼承的理由（結果是明確清單）在有 explain 之後還成不成立？

   | 選項 | 做法 | 好處 | 代價 |
   | --- | --- | --- | --- |
   | **A. 不開放** | 維持「複製角色」（`POST /roles/:id/duplicate`） | 角色的權限永遠是明確清單；反提權、自我鎖定（`assertNoSelfLockout`）、I8 都只看一個角色；技能樹不變 | 基底角色加鍵時，複製出來的角色要手動跟上 |
   | B. 開放 | `role:R#holder` 可以是另一個角色 holder 的主體；`subjectClosures` 本來就沿 `role#holder` 遞迴，引擎幾乎不用改 | 基底角色的變更自動傳下去 | 反提權、自我鎖定、I8 的計數都要展開閉包；改一個角色的影響範圍要跨角色計算（explain 回答「為什麼」，但不回答「改這個會影響誰」）；要擋循環與 super-admin 參與繼承；角色詳情頁要分「自己的鍵」與「繼承的鍵」 |
   | C. A ＋ 來源提示 | 複製時記下來源角色；來源角色的鍵變了，在複製品的詳情頁提示差異 | 保留明確清單，也解決「忘了跟上」 | 多一個欄位與一個提示；不是繼承，不會自動套用 |

   **結論**：A，不開放（ADR-0024 D10）。G4 的群組已經涵蓋「分組」這個需求，角色繼承剩下的好處只是少維護幾個角色；ADR-0006 理由 3 仍然成立。
   C 可以之後有需要時再加，不影響模型。ADR-0006「延伸路徑」的「角色階層」一列已註明否決。
4. **群組成員的反提權**：把人加進持有 `admin` 的群組，等於指派 `admin`。要比照 `assertRolesAssignable` 檢查群組持有的角色嗎？
   群組上的資料夾授權要不要一起檢查（現在指派角色時不檢查角色的資料夾授權）？

   **(a) 全域權限鍵**

   | 選項 | 做法 | 評估 |
   | --- | --- | --- |
   | **A. 比照指派角色** | 加成員（`group:G#member@user:u` 或 `@group:H#member`）時，G **以及 G 的所有上層群組** 持有的角色都要通過 `assertRolesAssignable`；其中有 super-admin 就只有 super-admin 能加 | 與 §3 一般化的規則一致：寫入一條邊時，檢查它讓主體多出的能力。巢狀時要往上展開 |
   | B. 不檢查，靠 `group:update` 把關 | 只要有 `group:update` 就能加人 | `group:update` 會變成繞過 `user:assignRole` 反提權的後門，**不建議** |

   A 的附帶規則：
   - 操作者不能把自己加進群組、也不能把自己所屬的群組加進另一個群組（I9 的延伸：等於改自己的角色）。
   - 移除成員不檢查反提權（拿掉能力不是提權）；但目標是 super-admin 時只有 super-admin 能操作（比照 `UserService.assertCanManage`）。
   - 從回收桶還原群組時，群組持有的角色會隨保留的邊重新生效，要先以問題 4 (a) 的規則檢查（比照 `UserService.restore`）。
   - **「是不是 super-admin」要改成看主體閉包**：現在的 `hasRoleSlug`、`includesSuperAdminRole`、I8 的計數都只看直接持有的角色，
     群組持有 super-admin 之後會漏算。→ **結論：禁止群組持有 super-admin**（super-admin 一律直接指派；ADR-0024 D12），這幾處就不用改。

   **(b) 資料夾授權**

   | 選項 | 做法 | 評估 |
   | --- | --- | --- |
   | A. 一併檢查 | 加成員時，G 在每個資料夾上的等級，操作者在那個資料夾都要有 | 要掃出 G 的所有資料夾授權並逐一判斷，成本隨資料夾數成長；錯誤的 `details.missing` 還會透露操作者看不到的資料夾 |
   | **B. 不檢查** | 與現在「指派角色時不檢查角色的資料夾授權」一致 | 資料夾授權在「授予給群組」時，已經由持有 `can_share` 的人檢查過一次 |

   **結論**：(a) 選 A（ADR-0024 D11）、(b) 選 B（D13），並寫成一條規則：**反提權檢查的是「授予給一個主體」的能力；把人放進一個主體（角色、群組）時，只檢查那個主體帶的全域權限鍵。**
   這條規則要寫進 `rbac/08-groups.md`；§3 表格的第四列已依此填上。將來若下放群組管理（問題 11），(b) 要重新評估。
6. **explain 的揭露範圍**：路徑會經過使用者可能看不到的群組、資料夾名稱。沒有 `authz:explain` 的人查自己時，看不到的節點要遮成「某個群組」嗎？

   | 選項 | 做法 | 評估 |
   | --- | --- | --- |
   | A. 不遮 | 查自己時顯示完整路徑 | 巢狀群組的上層（使用者只知道自己在「角色設計」，不知道它在「美術」裡）與繼承鏈上的資料夾名稱會外洩 |
   | **B. 逐節點遮蔽** | 路徑上的每個節點，操作者沒有讀取權（`group:read`、`role:read`、資料夾的 `can_read`）時，只回型別（「某個群組」），不回 id 與名稱；段數與關係照樣顯示 | 使用者知道「經過幾層、是什麼型別」，可以拿去問管理員；每個節點多一次判斷，但路徑很短 |
   | C. 只給第一段 | 查自己時只回「經由哪個角色／群組」，不回完整路徑 | 最簡單，但資料夾繼承的情況幾乎沒有資訊 |

   **結論**：B（ADR-0024 D14）。例外：使用者 **直接所屬** 的群組、直接持有的角色一律顯示（本來就該知道自己在哪些群組）。
   實作要注意：`AuthzChecker.explain()` 的路徑從主體閉包裡的主體開始（例：`role:r#holder`），
   閉包是怎麼來的（`user → group → group → role`）目前沒有記錄。`subjectClosures` 的遞迴 CTE 要多帶一個路徑陣列欄，explain 才能串出完整路徑。
7. **外部 IdP 的群組對應**（[`04-sso.md`](../architecture/04-sso.md) §11）對應到群組之後，群組成員是否標記為「同步來源」、不允許手動編輯？

   現況：外部 IdP 登入只做帳號連結與 `auto_create`（建立 **沒有任何角色** 的帳號），不讀群組 claim。

   | 選項 | 做法 | 評估 |
   | --- | --- | --- |
   | A. 同步群組 | 群組標記來源（`source = idp:<連線 id>`、`external_key`）；每次登入以群組 claim 覆寫成員；同步來源的群組 **不能手動改成員**，只能改它持有的角色與授權 | 語意清楚，但只在登入時更新：在 IdP 被移出群組的人，要等下次登入才會失去權限（完整的做法是 SCIM） |
   | B. 對應規則 | 另一張對應表「IdP 群組 → 本地群組」；登入時只增減「由對應加入」的成員，手動加入的不動 | 可以混用，但要能區分成員邊的來源（`relation_tuples` 加欄，或另存一張表），UI 也要標示 |
   | **C. G4 不做** | G4 的群組只有手動成員；IdP 對應另開提案，與 SCIM 一起評估 | 控制範圍；G4 的 `groups` 表不必預留欄位，之後以 migration 加上 |

   **結論**：C（ADR-0024 D15）。目前沒有客戶需求指明要用哪一家 IdP 的群組 claim（Azure AD 的群組 claim 是 object id、有數量上限，各家差異大），
   現在設計的欄位多半會猜錯。另開提案時，預設走 A（整個群組由 IdP 管理），因為 B 的「混合來源」會讓 explain 與稽核更難讀。
11. **群組的管理要不要下放**：群組擁有者能不能自己管成員，而不必持有 `group:update`？在圖上就是 `group` 型別多一個 `owner` 關係；
    但群組持有角色時，擁有者加人等於指派角色，要和問題 4 的反提權一起看。

    | 選項 | 做法 | 評估 |
    | --- | --- | --- |
    | **A. 不下放** | 只有 `group:update` 能管成員 | 最簡單；群組數量少時足夠 |
    | B. `owner` 關係 ＋ 反提權 | `group:G#owner@user:u`；owner 可以管成員，但加人仍套用問題 4 (a) 的檢查 | 持有 `admin` 角色的群組，owner 若不是 admin 就加不了人，全域權限鍵是安全的；但依問題 4 (b)，**owner 可以把群組的資料夾授權擴散給任何人**，等於把 `can_share` 下放給 owner |
    | C. 只下放「不持有角色」的群組 | 同 B，但群組持有任何角色時，owner 不能管成員 | 適合「專案小組」這種只拿來做資料夾授權的群組；規則多一條，UI 要說明為什麼有時不能改 |

    **結論**：G4 選 A（ADR-0024 D16）。反提權一般化之後，B 或 C 只是模型多一個關係、`grantedBy` 多一種寫法，可以之後再加；
    屆時要先決定問題 4 (b) 的資料夾授權是否仍然不檢查（B 會讓它變成實際的擴權路徑）。G5 的專案成員管理大概會是第一個需要下放的地方，到時再一起評估。

## 歸檔去向

G4 完成後：

- `docs/rbac/08-groups.md`（新）：群組的模型、成員、群組持有角色、反提權
- `docs/rbac/01-domain-model.md` §6.4：`group` 型別；反提權改成模型宣告
- `docs/rbac/02-permission-catalog.md`：`group:*`、`authz:explain` 與依賴樹
- `docs/architecture/backend/05-rbac.md` §4：explain API、反提權一般化
- ADR-0024：G3b、G4 的實作紀錄；全部完成後刪除本檔
