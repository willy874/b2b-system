# 身分與存取 07 — 群組

> 決策見 [`01-model.md`](01-model.md) §9.3 D10～D16；關係圖本身見 [`01-model.md`](./01-model.md) §6.4。

群組是 **純分組**：授權給群組、群組持有角色，人員異動時只改群組的成員。群組可以巢狀（成員可以是另一個群組）。
它沒有自己的權限語意——成員取得的能力全部來自群組持有的角色與群組在資源上的授權。

---

## 1. 在關係圖上

```
group:<g>#member@user:<u>                 使用者是群組的成員
group:<g>#member@group:<h>#member         巢狀：h 的成員都是 g 的成員
role:<r>#holder@group:<g>#member          群組持有角色：g 的成員都持有 r
fileFolder:<f>#<等級>@group:<g>#member     資料夾授權給群組
```

- `group` 是 `core/authz` 的 **核心型別**（與 `role` 同屬使用者集合），不是由模組註冊：主體閉包的遞迴 CTE 要知道哪些關係是成員關係、
  已刪除的節點看哪張表（[`backend/05-rbac.md`](../backend/05-rbac.md) §4.2）。
- 主體閉包沿 `group#member` 與 `role#holder` 往上走：使用者 → 所屬群組 → 上層群組 → 這些群組持有的角色。全域權限、資料夾授權都由閉包解析，
  不需要群組專屬的判斷。
- 以角色為中心的業務規則也把經由群組持有的人算成持有者（`PermissionService.findUserIdsHoldingRole`、操作者的主體閉包）：
  自我鎖定（[`backend/05-rbac.md`](../backend/05-rbac.md) §8.4）、刪除角色的 `ROLE_IN_USE`（[`04-api.md`](./04-api.md) §2.4）、
  角色變更的推播（[`backend/08-realtime.md`](../backend/08-realtime.md) §6.1）。「是不是 super-admin」仍只看直接持有（D12）。
- 成員與持有的角色只存在 `relation_tuples`（沒有 `group_members` 表）；`groups` 表只有名稱、說明、樂觀鎖的 `version` 與軟刪除
  （[`backend/02-database.md`](../backend/02-database.md) §2.14）。
- 邊的形狀由 `db/schema/relation-tuples.ts` 的 `groupMemberTuple`、`groupRoleTuple` 產生，每一種形狀由測試對完整的模型驗證過
  （`src/__tests__/relation-tuples-model.spec.ts`）。

### 1.1 巢狀的限制

| 規則 | 理由 | 錯誤 |
| --- | --- | --- |
| 不能形成循環（把群組加進自己，或加進它底下的群組） | 循環的成員關係沒有意義 | `409 GROUP_MEMBERSHIP_CYCLE`（`details.groupId`） |
| 一條「群組在群組裡」的鏈最多 6 個群組（`GROUP_MAX_NESTING_DEPTH`） | 主體閉包的深度上限是 8（使用者 → 群組 × N → 角色），超過的部分解析時走不到，權限會靜靜地消失 | `409 GROUP_NESTING_TOO_DEEP`（`details.max`） |

成員的寫入以交易層級的 advisory lock（`group_membership`）排隊：兩個相反方向的「把 A 加進 B」「把 B 加進 A」不能同時通過檢查。

---

## 2. 授權規則

### 2.1 反提權（[`01-model.md`](01-model.md) §9.3 D11～D13）

寫入一條邊時，主體因此取得的能力，操作者必須全部都有（通用規則見 [`backend/05-rbac.md`](../backend/05-rbac.md) §4.1）：

| 操作 | 主體取得的能力 | 檢查 |
| --- | --- | --- |
| 加成員（使用者或群組）到 G | `group:G#member` 往上閉包在租戶上的能力：G **與它所有上層群組** 持有的角色的權限鍵 | `PermissionService.assertCanGrant`，在交易內、成員的鎖之後 |
| 讓 G 持有角色 r | r 在租戶上的能力 | `assertRolesAssignable`（同指派角色給使用者） |
| 還原 G | 同加成員：G 的成員重新取得 G 與上層群組的角色 | 同加成員，另外檢查結構（§1.1） |
| 還原使用者、把停用的使用者改回 active | 他直接所屬的群組（與上層群組）的角色重新生效 | 對他所屬的每個群組同加成員（[`backend/05-rbac.md`](../backend/05-rbac.md) §4.1） |

- **D12：群組不能持有 super-admin**，super-admin 一律直接指派給使用者（`403 GROUP_SUPER_ADMIN_FORBIDDEN`，即使操作者是 super-admin）。
  所以「是不是 super-admin」（`hasRoleSlug`、`assertCanManage`、I8 的計數）仍只看直接持有的角色。
- **D13：只比對全域權限鍵**，不比對群組在資料夾上的授權——那些授權在授予給群組時，已由持有 `can_share` 的人檢查過一次。
- 移除成員、讓群組不再持有角色不檢查反提權（拿掉能力不是提權）。

### 2.2 不能改自己（I9 的延伸）

| 情境 | 錯誤 |
| --- | --- |
| 把自己加進或移出群組 | `403 AUTHZ_SELF_MODIFY` |
| 把自己所屬（直接或間接）的群組加進或移出群組 | `403 AUTHZ_SELF_MODIFY` |
| 改自己所屬群組持有的角色 | `403 AUTHZ_SELF_MODIFY` |

「自己所屬的群組」取自操作者的主體閉包。另外，只有 super-admin 能改 super-admin 的群組成員資格（比照 `UserService.assertCanManage`，`403 AUTHZ_ESCALATION`）。

### 2.3 權限鍵

`group:read`／`group:create`／`group:update`（含成員管理）／`group:delete`／`group:assignRole`，依賴樹與預設角色見
[`02-permission-catalog.md`](./02-permission-catalog.md) §2.10、§9。`group:update` 本身不列為受反提權限制的鍵：
加成員時檢查的是那個群組帶來的能力，所以「能編輯群組」不會等於「能指派任何角色」。

---

## 3. API

| Method | Path | 權限 | 說明 |
| --- | --- | --- | --- |
| GET | `/groups` | `group:read` | 列表：`keyword`、排序（`name`、`memberCount`、`roleCount`、`createdAt`）。`?userId=`：那個人所在的群組，每一列帶 `membership`（`direct`／`nested`）；`?roleId=`：持有這個角色的群組 |
| POST | `/groups` | `group:create` | 名稱不分大小寫唯一（`409 GROUP_NAME_DUPLICATE`） |
| GET | `/groups/:id` | `group:read` | `memberCount` 是直接成員數（巢狀群組算一個） |
| PATCH | `/groups/:id` | `group:update` | 名稱、說明；必帶 `version`（`409 GROUP_VERSION_CONFLICT`） |
| DELETE | `/groups/:id` | `group:delete` | 軟刪除（§4） |
| POST | `/groups/:id/restore` | `group:delete` | 還原；名稱被佔用時 `409 GROUP_NAME_DUPLICATE`（`details.conflictingGroupId`）；沒有被刪除 `409 GROUP_NOT_DELETED` |
| GET | `/groups/:id/members` | `group:read` ＋ `user:read` | 直接成員（使用者在前） |
| PATCH | `/groups/:id/members` | `group:update` | 差異語意 `{ add, remove }`，成員是 `{ type: 'user' \| 'group', id }` |
| GET | `/groups/:id/roles` | `group:read` ＋ `role:read` | 持有的角色 |
| PATCH | `/groups/:id/roles` | `group:assignRole` | 差異語意 `{ add, remove }` |

不存在或已刪除的群組（還原以外的端點）回 `404 GROUP_NOT_FOUND`。

整批：群組（名稱、說明、持有的角色）與直接成員可以匯出（`group:export`）與匯入（[`../backend/22-data-transfer.md`](../backend/22-data-transfer.md) §12.2）。
匯入走同一個 `GroupService`（交易內的版本），反提權、不能改自己、循環與層數的規則相同；成員只能加入，移除在畫面上做。

資料夾授權的對象多一種 `group`（`PUT /file-folders/:id/grants` 的 `subjectType`、`GET /file-folders/:id/grant-subjects?subjectType=group`；
[`06-resource-grants.md`](./06-resource-grants.md) §6.2）。

---

## 4. 生命週期、失效與推播

- **刪除**：軟刪除；成員邊、上層群組的成員邊、持有角色的邊、以它為對象的資料夾授權都 **保留**（休眠），主體閉包略過已刪除的群組。
  **還原** 時一起回來。到期由 `GroupTrashHandler`（`purgeOrder` 50）永久刪除群組與以它為物件或主體的邊
  （[`backend/13-trash.md`](../backend/13-trash.md) §6.3）。
- `groups.deleted_at` 改變由 trigger 讓 `authz_revision` +1（migration 0017），與角色相同。
- 會改變誰有什麼權限的寫入（成員、持有的角色、刪除、還原）在交易後呼叫 `permissionsChanged(affected)`：整個租戶失效並廣播
  （[`backend/05-rbac.md`](../backend/05-rbac.md) §5.1）。`affected` 是群組（含巢狀）底下所有未刪除的使用者，
  寫入前後取聯集，只用來補建個人資料夾與推播。
- 推播以 `ChangeSource.GROUP` 宣告，受眾是 `group:read` 的人與 `affected` 的 user room。前端收到群組的任何變更都重抓自己的 profile：
  前端不知道自己（間接）在哪些群組裡。
- 稽核：`group.create`／`update`／`delete`／`restore`、`group.member.add`／`group.member.remove`（`before`／`after` 是成員清單）、
  `group.assignRole`（`before`／`after` 是角色 id）。
- 既有租戶的系統角色由 migration 0018 補上群組的權限鍵（seed 只在角色新建立時寫入權限）。

---

## 5. 前端

| 位置 | 內容 |
| --- | --- |
| `features/group/` | `/group` 列表、`/group/create` 建立對話框、`/group/$groupId` 詳情（基本資料、持有的角色、成員）；頁面權限 `GROUP`、`GROUP_CREATE` |
| 詳情的角色 | 可搜尋的多選下拉（需要 `group:assignRole` ＋ `role:read`），不列 super-admin（D12）；儲存送差異（`useGroupRoleDraft`），差異對第一次修改時的角色計算；編輯途中別人改過時提示「已被他人修改」並可改用最新的角色 |
| 詳情的成員 | 加使用者（伺服器端搜尋）或巢狀群組（排除自己；其他循環由後端擋）；每位成員可移除，移除前先確認（成員是群組時說明其中的人也一起失去角色） |
| 使用者詳情 | 「所屬群組」（`group:read`）：直接所屬的在前，經由巢狀群組的另外標示 |
| 角色詳情 | 持有者分「直接持有」（`user:read`）與「經由群組」（`group:read`） |
| 資料夾共用對話框 | 對象種類多一種「群組」 |
| 回收桶 | 「群組」分頁（`group:delete`），還原按鈕 |

---

## 6. 不在這一版

| 項目 | 去向 |
| --- | --- |
| 「為什麼能／不能」的說明（explain API、有效權限頁） | 已做（G4b）：[`08-explain.md`](./08-explain.md) |
| 角色繼承角色 | 不開放（D10） |
| 外部 IdP 的群組對應、SCIM | 另開提案（D15） |
| 群組擁有者自己管成員（下放） | 不做（D16）；要做時先重新評估 D13 |

---

## 7. 測試

| 測試 | 涵蓋 |
| --- | --- |
| `apps/api/src/modules/group/__tests__/group.service.spec.ts` | 每條規則與每個錯誤碼：D11 詢問 `group:G#member`、自己、super-admin 目標、循環、層數、D12 |
| `apps/api/test/groups.spec.ts` | 真 DB：巢狀解析、反向查詢、刪除／還原與 revision、反提權、`?userId=`／`?roleId=`、授權給群組的資料夾、回收桶、平台關掉 `group`（§8） |
| `apps/api/src/core/authz/__tests__/authz.revision.spec.ts` | `tenant.featuresChanged` 失效整個租戶的權限快取並廣播（§8） |
| `apps/api/src/core/authz/__tests__/authz.checker.spec.ts` | 判斷器：閉包裡的群組、閉包沒涵蓋時沿 `group#member` 展開、能力的推導 |
| `apps/api/src/__tests__/relation-tuples-model.spec.ts` | 每一種邊的形狀符合模型 |
| `apps/backstage/src/features/group/**/__tests__` | 列表三個權限案例與刪除、詳情的成員與角色、`useGroupRoleDraft` |
| backstage 的角色詳情、使用者詳情、`AudiencePicker` | 租戶沒有啟用 `group` 時不顯示群組的欄位、不查群組（§8） |

---

## 8. 租戶的開關（`group`）

群組是平台管理者可以對每個租戶開關的 feature（[`05-tenancy.md`](../05-tenancy.md) §5.1；id `group`）。新租戶預設啟用；
平台 migration 0020 把它加進預設值，並讓既有租戶全部啟用（升版不改變行為）。

與其他 feature 不同，關掉的不只是管理頁：**群組帶來的授權也一起暫停**。

| 停用時 | 做法 |
| --- | --- |
| `/groups` 回 `404 FEATURE_DISABLED` | `GroupController` 標 `@RequireFeature('group')`；還原端點另有 `trash`（兩者都要啟用） |
| 成員不再經由群組取得任何東西 | `AuthzService` 依 `requireTenant().features` 決定 `MembershipScope`，`AuthzRepository` 的成員展開（`membershipStep`）只走 `role#holder`、不走 `group#member`。主體閉包裡沒有群組，所以群組持有的角色、群組在資料夾上的授權、`user:*` 以外經由群組的路徑全部不成立；反向解析（角色的持有者、公告受眾、`findActiveUserIdsWithPermission`）與說明（`closurePaths`、有效權限的來源）用同一個條件，結果一致 |
| 不能新增群組的資料夾授權 | `FileFolderGrantService` 對 `subjectType: 'group'` 的新增與候選搜尋回 `404 FEATURE_DISABLED`；既有的群組授權照樣列出、可以移除 |
| 公告 | 以群組指定的受眾解析成 0 人；觸發點 `group.memberAdded` 標 `feature: 'group'`，不列出也不觸發 |
| 回收桶 | `GroupTrashHandler.feature = 'group'`：`GET /trash?type=group` 回 404；到期的群組照樣永久刪除 |
| backstage | `features/group` 是可啟用的 feature（`FEATURE_CATALOG` 的 `group`，最上層 route `beforeLoad: requireFeature('group')`）；角色詳情的「經由群組」、使用者詳情的「所屬群組」、公告受眾的群組欄、資料夾授權的「群組」對象以 `useIsFeatureReady('group')` 隱藏 |

**照舊**：群組、成員邊、持有角色的邊、資料夾授權都保留（關係圖沒有任何寫入、`authz_revision` 不變）；重新打開後立即恢復。

**快取**：開關不寫關係圖，revision 不變，所以 `AuthzRevision` 另外訂閱本機的 `tenant.featuresChanged`：失效那個租戶的權限快取、
在它的脈絡裡發 `permissions.changed`（推播換 room、前端重抓 profile），再以同一個頻道廣播 `{ tenant, features: true }` 給其他程序
（對外 API 不收領域事件的轉送，但收這個頻道）。其他程序的 `TenantDirectory` 經自己的廣播失效；兩則廣播的先後不保證，
最壞情況是某個程序以舊的 feature 清單重算並快取，最多晚 `PERMISSION_CACHE_TTL` 秒。

**平台的確認框** 列出目前的影響（`TenantFeatureImpacts`）：未刪除的群組數、直接加入群組的使用者數、群組持有的角色指派數，
並警告只靠群組取得管理權限的人會失去那些權限。

### 8.1 為什麼關掉時暫停授權

評估過兩種語意：

| 方案 | 結果 |
| --- | --- |
| 授權照常、只是不能管理（與 `systemSetting` 關掉時「已覆寫的值照樣生效」一致） | 關開關不會讓任何人突然失去權限；但租戶看不到群組，卻有人因群組擁有權限，說明頁的來源也指向看不到的東西 |
| **暫停群組授權**（採用） | 「沒有群組」就是真的沒有群組：權限、說明與管理畫面一致。代價是只靠群組取得管理權限的人會被鎖在外面，確認框列出影響並明確警告；需要時由平台重新打開 |

暫停放在成員展開這一個地方，而不是過濾群組的 tuple：所有正向、反向解析與說明都經過它，不會有某條路徑漏掉。

