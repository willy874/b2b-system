# RBAC 07 — 資源授權（資料夾層級）

> 全域 RBAC（[`01-domain-model.md`](./01-domain-model.md)）回答「這個人能不能做 X」；
> 資源授權回答「這個人能不能對 **這個東西** 做 X」。第一個套用的資源是檔案管理器的資料夾。
> 決策理由見 [ADR-0015](../adr/0015-file-folder-access.md)。

---

## 1. 模型：RBAC 閘門 ＋ 資料夾 ACL（繼承）＋ 擁有者規則

三層疊起來，**全部只有 allow、取聯集**（沿用 [`01-domain-model.md`](./01-domain-model.md) §6.3，沒有 deny 規則）：

| 層 | 來源 | 範圍 | 回答 |
| --- | --- | --- | --- |
| ① 全域權限 | 角色 → `file:*` 權限鍵 | **所有** 資料夾（含私人資料夾） | 管理者、稽核人員：不受資料夾授權影響 |
| ② 資料夾授權 | `relation_tuples` 的邊：資料夾 × 對象（角色／使用者／所有人）× 等級 | 該資料夾與它的子孫（繼承） | 一般成員能在哪些資料夾做什麼 |
| ③ 擁有者規則 | `created_by` = 自己 | 自己建立的檔案與資料夾 | 能上傳的人，能改名、移動、刪除自己上傳的東西 |

另有一個 **閘門** 權限 `file:access`：可以進入檔案管理器，但能看到什麼、做什麼完全由 ② ③ 決定。
沒有 `file:access`、也沒有任何全域 `file:*` 的人，連檔案管理器的 API 都呼叫不了（guard 擋下）。

```
                     有 file:access 或任一全域 file:*？ ──否──▶ 403（guard）
                                    │是
                                    ▼
   能力(動作, 位置) = 全域有該權限鍵 ∨ 位置的有效等級蘊含該動作 ∨（擁有者規則）
```

> **私人資料夾不擋全域權限者。** 中斷繼承（§3.3）只切斷「從上層繼承下來的資料夾授權」，
> 持有全域 `file:read` 的人仍然看得到所有資料夾。

---

## 2. 等級

資料夾授權不是逐一勾選權限鍵，而是四個等級，每個等級蘊含一組 **檔案動作**：

| 等級 | `read` | `create` | `update` | `delete` | `share` | 用途 |
| --- | :---: | :---: | :---: | :---: | :---: | --- |
| `viewer` | ✓ | | | | | 看、預覽、下載 |
| `contributor` | ✓ | ✓ | ◐ | ◐ | | 上傳、建立子資料夾；◐ ＝ 只限自己建立的（擁有者規則，§4） |
| `editor` | ✓ | ✓ | ✓ | ✓ | | 管理內容：改名、移動、刪除任何人的檔案 |
| `manager` | ✓ | ✓ | ✓ | ✓ | ✓ | 另外能管理這個資料夾的授權 |

- 等級是 **全序**：`viewer < contributor < editor < manager`。同一個人從多個來源拿到等級時取最高者。
- 動作與全域權限鍵一一對應：`read` ↔ `file:read`、`create` ↔ `file:create`、`update` ↔ `file:update`、
  `delete` ↔ `file:delete`、`share` ↔ `file:share`。
  所以「權限鍵的字串格式不變」（[ADR-0006](../adr/0006-flat-permission-scope.md) 的承諾）仍然成立：
  等級只是「在某個範圍內持有哪些權限鍵」的簡寫。

### 2.1 在關係圖上（[ADR-0024](../adr/0024-relationship-based-access-control.md)）

等級、動作與擁有者規則都寫成模型裡的關係（`apps/api/src/modules/file/file.authz.ts`），由 `core/authz` 的判斷器解析：

```
fileFolder
  manager     = 直接授予 ∪ manager from inherits_from
  editor      = 直接授予 ∪ manager ∪ editor from inherits_from
  contributor = 直接授予 ∪ editor ∪ contributor from inherits_from
  viewer      = 直接授予 ∪ contributor ∪ viewer from inherits_from
  can_read / can_create / can_update / can_delete / can_share = 對應等級 ∪ tenant 上的 file:<動作>
  can_update_own = can_update ∪ can_create                       ← 規則 A：能在這裡建立 ⇒ 能編輯自己建立的
  can_rename = can_update from parent ∪ (owner ∩ can_update_own from parent)
  can_remove = can_delete from parent ∪ (owner ∩ can_update_own from parent)
fileRoot（根目錄）：can_* 只由 tenant 上的 file:<動作> 決定
```

- 授權是 `relation_tuples` 的邊 `fileFolder:F#<等級>@(role:r#holder | user:u | user:*)`，由 `modules/file/file-folder-grant.repository.ts` 讀寫；
  結構邊（`parent`、`inherits_from`、`owner`）由 `file_folders` 供應，不存。中斷繼承的資料夾沒有 `inherits_from` 邊。
- 「等級蘊含哪些動作」（反提權、`assignableLevels`）由模型的 **靜態蘊含** 算出（`impliedRelations`），不再寫死對照表。
- 全域的 `file:*` 已套用權限依賴樹（[`02-permission-catalog.md`](./02-permission-catalog.md) §9）：`file:delete ⇒ file:update ⇒ file:read ⇒ file:access`、
  `file:create ⇒ file:read`、`file:share ⇒ file:read`。所以只持有全域 `file:share` 的人也能授予 `viewer`（§6.1 的例子隨之改變）。

---

## 3. 有效等級的解析

### 3.1 定義

使用者 `u` 在資料夾 `F` 的 **有效等級** `level(u, F)`：

```
對象集合 S(u) = { u 本人 } ∪ { u 持有的角色（未刪除）}
從 F 開始往上走（F、F 的上層、…、根目錄底下的第一層）：
  收集這個資料夾上、對象屬於 S(u)、未過期的授權
  如果這個資料夾 inherit_grants = false：停止（不再往上）
level(u, F) = 收集到的授權中最高的等級；沒有就是「無」
```

- **根目錄沒有資料夾授權。** 根目錄只由全域權限決定；只有資料夾授權的人，從「被授權的資料夾」開始看（§5.2）。
- 授權的過期時間到了就不再計入，不需要排程清除（§6.3）。
- 角色被刪除（軟刪除）、使用者被刪除：他們的授權不再計入，也不出現在授權清單。
- 資料夾被刪除（軟刪除，移到回收桶）：它上面的授權邊不刪。刪除的資料夾不在結構裡，授權流不到任何地方；
  還原後隨之生效，永久刪除時才刪邊（[`../architecture/backend/13-trash.md`](../architecture/backend/13-trash.md) §7）。

### 3.2 能力

`has(u, 動作, 位置)`：`位置` 是資料夾或根目錄。

```
has(u, a, 根目錄) = u 有全域 file:a
has(u, a, F)      = u 有全域 file:a ∨ level(u, F) 蘊含 a
```

### 3.3 中斷繼承（私人資料夾）

資料夾的 `inherit_grants` 預設 `true`。設成 `false` 之後，上層的資料夾授權不再往下流到它與它的子孫：

- 設成 `false` 的當下，**把目前繼承到的授權複製成這個資料夾的直接授權**（同一個對象取較高的等級）。
  這是 SharePoint 的做法：中斷之後誰都沒有立刻失去存取權，再由管理者逐一移除。
- 恢復成 `true` 時，直接授權保留（與繼承到的取聯集）。
- 全域權限不受影響（§1）。

---

## 4. 對「項目」的操作：看它所在的位置

檔案與資料夾本身的操作（改名、移動、刪除），看的是它 **所在的位置**（檔案的資料夾、資料夾的上層），
不是它自己：就像 Google Drive，被分享一個資料夾的人不能刪掉那個資料夾本身。

| 操作 | 條件 |
| --- | --- |
| 看到檔案（`ready`）、下載、預覽 | `has(read, 檔案所在資料夾)` |
| 看到上傳中（`pending`）的檔案 | 只有上傳者本人（不變，[`09-file.md`](../architecture/backend/09-file.md) §4.1） |
| 上傳到 `F`、在 `F` 建立子資料夾 | `has(create, F)` |
| 檔案改名／刪除 | `has(update／delete, 所在資料夾)` ∨（**本人上傳** ∧ `has(create, 所在資料夾)`） |
| 資料夾 `D` 改名 | `has(update, D 的上層)` ∨（**本人建立** ∧ `has(create, D 的上層)`） |
| 移動檔案或資料夾到 `T` | 每一個項目都能「改名」（同上）∧ `has(create, T)` |
| 遞迴刪除資料夾 `D` | `has(delete, D 的上層)` ∨（本人建立 ∧ `has(create, D 的上層)` ∧ **子樹裡全部是本人建立的**）；另外子樹中每個中斷繼承的資料夾 `X` 都要 `has(delete, X)` |
| 還原刪除的檔案、資料夾 | 與刪除相同（能刪就能復原，[ADR-0025](../adr/0025-entity-revisions.md) D10）；資料夾以 **還原之後** 的結構判斷，交易內先還原、不能就 rollback（[`../architecture/backend/13-trash.md`](../architecture/backend/13-trash.md) §7.1） |
| 看授權清單、新增／變更／移除授權、中斷繼承 | `has(share, F)` |

**擁有者規則（C）的範圍**：只放寬「改名、移動、刪除」，不放寬「看得到」。
被移除授權之後，本人上傳的檔案也跟著看不到；要能操作自己的東西，前提是還能在那個位置上傳。

**遞迴刪除的兩個附加條件** 是為了不讓刪除繞過其他規則：

- 擁有者刪除自己的資料夾時，子樹裡若有別人放進去的東西，那些東西本人不能刪，所以整筆拒絕。
- 子樹裡有中斷繼承的資料夾時，對上層有刪除權不代表對它有刪除權。

---

## 5. 看得到什麼

### 5.1 資料夾清單（`GET /file-folders`）：沒有權限的資料夾也列出，標成「鎖住」

- 能進檔案管理器的人（`file:access` 或全域 `file:read`）看得到 **所有資料夾的名稱與結構**，包含中斷繼承的私人資料夾。
- 沒有 `read` 的資料夾是 **鎖住的**：`capabilities.canRead = false`，其他能力也都是 false。
  前端以鎖頭圖示與淡化樣式標出，進入後看得到子資料夾（才能走到裡面被授權的資料夾），但看不到檔案，
  改顯示「沒有存取權」與「申請存取」（§6.5）。
- 取捨：資料夾名稱對所有能進檔案管理器的人公開，換來「知道有這個資料夾、可以申請」。
  檔案（名稱、內容）仍只有 `read` 的人看得到。
- 別人的個人資料夾（§12）也一樣：列出、鎖住，可以申請存取。規則沒有例外。

### 5.2 檔案清單（`GET /files`）

| 參數 | 全域 `file:read` | 只有資料夾授權 |
| --- | --- | --- |
| `folderId=<F>` | `F` 的檔案 | `has(read, F)` 才列；鎖住的資料夾回 `403 AUTHZ_FORBIDDEN`；不存在回 `404 FILE_FOLDER_NOT_FOUND` |
| `folderId=root` | 根目錄的檔案 | 空清單（根目錄只由全域權限決定） |
| 不帶（全部、搜尋） | 全部 | 只含看得到的資料夾裡的檔案 |

`GET /files/:id` 看不到時回 `404 FILE_NOT_FOUND`，與 `pending` 相同（檔案不公開存在與否）。
對鎖住的資料夾做任何寫入（上傳、建立、改名、移動、刪除、管理授權）回 `403 AUTHZ_FORBIDDEN`。

---

## 6. 授權的管理

### 6.1 反提權

比照 `role:grantPermission`（[`04-api-spec.md`](./04-api-spec.md) §5）：

- 授予、變更、移除等級 `L` 的授權：操作者必須 `has(share, F)`，而且 **`L` 蘊含的每個動作操作者在 `F` 都有**
  （來源可以是全域權限鍵或資料夾等級）。違反回 `403 AUTHZ_ESCALATION`（`details.missing`）。
- 例：持有全域 `file:share` 的人（依賴樹帶來 `file:read`）可以授予 `viewer`，不能授予 `contributor` 以上。

### 6.2 對象

| 對象 | 階段 | 說明 |
| --- | --- | --- |
| `role` | P1 | 角色；持有者隨角色指派變動，授權自動跟著走 |
| `user` | P2 | 個別使用者 |
| `group` | G4（[ADR-0024](../adr/0024-relationship-based-access-control.md)） | 群組的成員，含巢狀群組的成員；人員異動只改群組成員。加成員時不檢查群組在資料夾上的授權（D13）——授予給群組時已由 `can_share` 的人檢查過 |
| `everyone` | 追加 | 所有能進檔案管理器的人（`subject_id` 固定是全零 uuid）；共用資料夾用它（§12） |

候選清單（`GET /file-folders/:id/grant-subjects`）只回傳 id、名稱：`has(share, F)` 的人不需要 `role:read` / `user:read`
也能挑選對象，但拿不到角色的權限、使用者或群組的其他資料。

### 6.3 過期（P2）

授權可以帶 `expiresAt`。過期的授權在解析時直接忽略，不需要排程清除；清單上仍顯示（標示「已過期」），由管理者移除或延長。
過期不推播：前端下一次重抓時就看不到了。

### 6.4 稽核

| action | resourceType | changes |
| --- | --- | --- |
| `fileFolder.grant` | `fileFolder` | `before` / `after`：`{ subjectType, subjectId, level, expiresAt }` |
| `fileFolder.revoke` | `fileFolder` | `before`：同上 |
| `fileFolder.inheritance` | `fileFolder` | `before` / `after`：`{ inheritGrants }`；中斷時 `after.copied` 列出複製的授權 |

資源層級的拒絕與 guard 的拒絕一樣寫 `authz.denied`（`metadata` 帶 `resourceType`、`resourceId`、`action`）。

---

### 6.5 申請存取（審批類型 `fileFolder.access`）

沒有權限（或權限不夠）的人可以對資料夾申請一個等級，由 **該資料夾的管理者** 或 **管理員** 核准。
沿用審批的狀態機（[`06-approval.md`](./06-approval.md) §7）：

| 步驟 | 誰 | 做法 |
| --- | --- | --- |
| 申請 | 能進檔案管理器的人 | `POST /file-folders/:id/access-requests`（`{ level, reason? }`）。已經有該等級 → `409 FILE_ACCESS_ALREADY_GRANTED`；同一個人對同一個資料夾同時只有一筆待審（重送不另建） |
| 看待審 | 在該資料夾 `share` 的人 | 共用對話框的「存取申請」；`GET /file-folders/:id/access-requests` |
| 核准／駁回 | 在該資料夾 `share` 的人 | `POST /file-folders/:id/access-requests/:requestId/approve`、`/reject`；或審批頁（`approval:review`） |
| 套用 | — | 核准 ＝ 審核者代為授予：對申請人（`subject_type = user`）寫入申請的等級；受反提權限制（§6.1），審核者在該資料夾要 `share` 且授予得起該等級 |

- 核准的授權與手動授予的一樣，出現在授權清單、寫 `fileFolder.grant` 稽核（`metadata.approvalId`）。
- 申請人自己的待審狀態出現在資料夾清單（`hasPendingAccessRequest`），前端顯示「已送出申請」。
- 四眼原則沿用審批：不能核准自己的申請。

---

## 7. `capabilities`：前端不自己算

後端在每個檔案、資料夾上回傳操作者對它的能力，前端只讀旗標（Google Drive API 的 `capabilities` 做法）：

| 物件 | 欄位 |
| --- | --- |
| `StoredFile.capabilities` | `canUpdate`、`canDelete` |
| `FileFolder.capabilities` | `canRead`（false = 鎖住，§5.1）、`canCreate`（在裡面上傳、建子資料夾）、`canUpdate`（改名、移動它）、`canDelete`、`canShare` |
| `FileFolderList.rootCapabilities` | `canCreate`（在根目錄上傳、建資料夾） |

理由：繼承、中斷繼承、擁有者規則都要知道整條上層鏈與授權表；在前端重算一次等於維護兩份規則。
旗標只是體驗，**後端每次寫入都重新檢查**。

`capabilities.canDelete` 是「能力」，不保證遞迴刪除一定成功：§4 的兩個附加條件要看整個子樹，只在刪除時檢查。

---

## 8. 資料模型

授權是 `relation_tuples`（[`../architecture/backend/02-database.md`](../architecture/backend/02-database.md) §2.10）上的邊，
讀寫集中在 `apps/api/src/modules/file/file-folder-grant.repository.ts`（`FileFolderGrantRepository`）：

```
fileFolder:<資料夾 id>#<等級>@<主體>
  等級    viewer | contributor | editor | manager
  主體    role:<id>#holder（角色）｜ user:<id>（使用者）｜ group:<id>#member（群組）｜ user:*（所有人，API 上的 everyone）
  expires_at            null = 不過期（P2）
  created_at / created_by   API 上的 grantedAt / grantedBy
  沒有外鍵（多型）；解析與清單都 join 未刪除的 roles / users / groups

file_folders.inherit_grants  boolean not null default true        ← P2
```

- **同一對象在同一資料夾只有一個等級，變更等級是覆寫**：`relation_tuples` 的唯一索引包含關係（等級），擋不住同一對象兩個等級，
  所以由 `FileFolderGrantRepository.set` 在同一個交易裡先刪掉這個對象在這個資料夾上的所有等級、再插入新的；
  授權的寫入一律經 `FileFolderTree.write` 序列化（backend 09 §11.1），並行的兩次授予不會各插一筆。
- 等級規則（`levelRank`、`maxLevel`、`missingActions`、`assignableLevels`、`inheritanceChain`）在 `modules/file/file-grant.levels.ts`。
- 等級與 API 上的對象型別（`GRANT_LEVELS`、`GRANT_SUBJECT_TYPES`、`EVERYONE_SUBJECT_ID`）也定義在 `file-grant.levels.ts`。
  G3 之前的舊表 `resource_grants`（與 enum `resource_type`、`grant_level`、`grant_subject_type`）已在 G3b 刪除（migration 0010）。

形狀就是 Zanzibar 的 `(object, relation, subject)` tuple，將來改用 OpenFGA / SpiceDB 時可以直接匯出（§10.2）。

資料夾被遞迴刪除時授權的邊 **不刪**：資料夾是軟刪除，邊跟著變成不可達；還原資料夾（未來功能）時授權一起回來。

---

## 9. 其他系統的配合

| 地方 | 做法 |
| --- | --- |
| 路由宣告 | 檔案相關路由改成 `@RequireAnyPermission('file:access', 'file:<動作>')`：guard 只當閘門，範圍由 service 判斷（[`05-rbac.md`](../architecture/backend/05-rbac.md) §1 原則 3 的例外） |
| 推播 | `file` / `fileFolder` 的受眾加上 `file:access` 的 room。Payload 只有 id（[`08-realtime.md`](../architecture/backend/08-realtime.md) §6.1），看不到的資料夾有變更時只會多重抓一次，不會外洩名稱。授權變更推 `fileFolder update`（id 是該資料夾） |
| 權限快取 | 資料夾授權 **不進** 權限快取：每個請求重新解析（一次取整棵資料夾結構 ＋ 相關授權）。授權變更不呼叫 `permissionsChanged`（`authz_revision` 仍 +1，其他程序的權限快取跟著失效一次）；資料夾結構本身有程序內快取，由結構的寫入在提交後失效（backend 09 §11.1） |
| 簽章網址 | 影像 API 與 presigned 下載網址發出後到期前都有效：撤銷授權的延遲上限是網址的 TTL（`FILE_URL_TTL`，預設 15 分鐘，env 最多只接受 1 小時）；列表的網址因簽章時間取整（backend 09 §7.1），實際剩餘效期介於 TTL/2 與 TTL 之間 |

---

## 10. 延伸

### 10.1 其他資源與「專案」（P3）

檔案之外的資源（未來的專案、關卡）沿用同一套：

- 關係圖（`core/authz`）是通用的；每種資源在模型裡宣告自己的型別（等級、動作、`from` 上層），並提供結構邊的供應者。
- 解析由關係圖的判斷器負責（舊的 `resolveHierarchyLevels` 與 `modules/resource-grant` 已在 G3a 刪除）。
- **專案會成為資料夾的上層**：資料夾掛在專案底下之後，資料夾的上層鏈延伸到專案節點，
  專案上的授權自然往下繼承到它的資料夾。屆時根目錄的角色由專案取代（每個專案一棵樹）。
  掛載方式與遷移步驟見 [ADR-0015](../adr/0015-file-folder-access.md) §延伸。

#### 新增一種資源的步驟

| # | 做什麼 | 在哪裡 |
| --- | --- | --- |
| 1 | 在模型裡宣告型別：等級、`can_*`、`X from <上層>`（沿用 `fileFolder` 的寫法） | 該資源的 `<resource>.authz.ts`，於 `onModuleInit` 註冊（`AuthzRegistry`） |
| 2 | 提供結構邊的供應者（上層、繼承、擁有者），從資源自己的表讀，不存進 `relation_tuples` | 同上 |
| 3 | 授權的讀寫：`<type>:<id>#<等級>@<主體>` 的 repository；「一個對象一個等級」由程式維持（§8） | 該資源的 module（參考 `file-folder-grant.repository.ts`） |
| 4 | 能力判斷交給判斷器（`AuthzService.checkerFor`）；型別宣告它的能力（`defineType(…, { capabilities })`），等級帶來的能力由 `capabilitiesOf` 算出，反提權用 `missingActions()` / `assignableLevels()`（[`../architecture/backend/05-rbac.md`](../architecture/backend/05-rbac.md) §4.1） | 該資源的 `XxxAccessService`；等級規則目前在 `modules/file/file-grant.levels.ts`，第二種資源出現時再抽出共用 |
| 5 | 授權管理 API、稽核（`<resource>.grant` / `.revoke`）、推播受眾 | 該資源的 module ＋ `realtime.audience.ts` |
| 6 | 權限目錄加閘門鍵（`<resource>:access`）與 `<resource>:share` | 權限變更的同步清單（CLAUDE.md） |

「誰能管理授權」「等級蘊含哪些動作」「上層是誰」都在資源自己的 module。上層鏈跨越多種資源時（資料夾 → 專案），
在模型裡以 `inherits_from` 指向另一種型別即可，判斷器會沿著走。

### 10.2 何時改用 Zanzibar 類服務

目前的 Postgres 實作在以下任一條件成立時改用 OpenFGA / SpiceDB（資料可直接匯出，§8）：

- 需要自建引擎表達不了的關係（排除、條件式權限，或跨資源關係的組合多到遞迴 CTE 撐不住）。群組巢狀已由自建的關係圖支援
  （[`08-groups.md`](./08-groups.md)，ADR-0024 G4a），不再是觸發條件；
- 單次請求載入整棵資料夾結構的成本不可接受（資料夾數上萬），且以樹版本號快取仍不夠；
- 多個服務需要共用同一份授權判斷。

---

## 12. 系統資料夾：共用資料夾、私人資料夾、個人資料夾

根目錄只由全域權限決定（§3.1），一般成員不能在根目錄建立任何東西。為了讓每個人一開始就有地方放東西，
系統建立並維護三種資料夾（`file_folders.kind`）：

```
/（根目錄：只有全域 file:create 能建立）
├── 共用資料夾      kind = shared        授權：所有人（everyone）= editor
└── 私人資料夾      kind = privateRoot   沒有授權（一般成員看得到、進得去，但鎖住）
    ├── Alice       kind = personal      owner = Alice，Alice = manager；不繼承上層
    └── Bob         kind = personal      owner = Bob，  Bob   = manager；不繼承上層
```

| 規則 | 內容 |
| --- | --- |
| 建立時機 | api 啟動時確保共用資料夾與私人資料夾存在（冪等）；並為每個 **能進檔案管理器** 的使用者（`file:access` 或 `file:read`，或 super-admin）補建個人資料夾 |
| 自動建立個人資料夾 | 權限改變時（`permissions.changed`：指派角色、角色權限變更、建立帶角色的使用者、核准註冊）檢查受影響的使用者，取得檔案管理器權限而還沒有個人資料夾的就建立 |
| 個人資料夾 | 名稱是顯示名稱（`/`、`\`、控制字元換成空白；同名時依序加上 email、再加編號，最後退回 user id，一定能建立）；一批建立時每人一個 savepoint，一人失敗不影響其他人；`owner_id` 是本人；本人是 `manager`、不繼承上層：只有本人（與全域權限者）讀得到，本人可以自己分享；別人看得到它但鎖住（§5.1） |
| 保護 | 三種系統資料夾不能改名、移動、刪除（`403 FILE_FOLDER_SYSTEM_PROTECTED`）；也不能把它們移進別處 |
| 預設位置 | 前端進入檔案管理器、網址沒有指定資料夾時，開在自己的個人資料夾（`FileFolderList.personalFolderId`），管理員也一樣；之後點「所有檔案」仍可回到根目錄 |
| 使用者被刪除 | 個人資料夾 **是空的**（沒有子資料夾、沒有檔案，含上傳中的）就自動軟刪除（稽核 `fileFolder.delete`，`metadata.reason = owner-deleted`）；有東西的保留，由管理者整理。api 啟動時也會補做服務停機期間刪除的使用者 |

---

## 11. 分階段

| 階段 | 內容 |
| --- | --- |
| **P1** | `file:access` / `file:share`、`resource_grants`（對象只有角色）、繼承、擁有者規則、`capabilities`、推播受眾、授權管理 API 與前端「共用」對話框 |
| **P2** | 授權給個別使用者、中斷繼承（私人資料夾）、授權過期 |
| **追加** | 沒有權限的資料夾也列出（鎖住）＋ 申請存取（§5.1、§6.5）；系統資料夾與 `everyone` 對象（§12） |
| **P3** | 通用解析函式與 `modules/resource-grant` 的掛載契約；OpenFGA 遷移判準（§10.2）。專案本身還不存在，掛上去的那一步隨專案功能一起做。G3a（ADR-0024）起解析改由關係圖負責、`modules/resource-grant` 已刪除，新的掛載步驟見 §10.1 |

三個階段都已實作（2026-09-29）。
