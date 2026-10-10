# 批次操作擴充

- 優先度：P1
- 狀態：提案
- 依賴：全域批次佇列（[`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §6.2、§13：`web-core/batch`、`registerBatchOperation`、`RichTable` 的 `batch`）；
  標籤的指派端點（[`backend/18-tag.md`](../architecture/backend/18-tag.md) §7 D7）；反提權（[`backend/05-rbac.md`](../architecture/backend/05-rbac.md) §4.1）；回收桶的類型註冊表（[`frontend/13-trash.md`](../architecture/frontend/13-trash.md)）
- 相關：[`platform-job-management.md`](./platform-job-management.md)（平台端的取消與批次；它把租戶後台的批次列為不做、開放問題 5，分工見 §4）；
  反轉「後端批次端點 → 前端逐筆佇列」（[`roadmap.md`](./roadmap.md) §2.1）；圖片庫的批次貼標籤（[`frontend/24-gallery.md`](../architecture/frontend/24-gallery.md) D24）是先例

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

批次已經有一套機制：前端的全域佇列逐筆呼叫 **既有的單筆端點**，後端不提供批次端點（[`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §13.2 D1；
原本的 `POST /users/batch-*` 等已全部移除，§13.5）。但接上這套機制的動作還很少，常見的大量操作只能一筆一筆做（以下路徑相對 `apps/backstage/src/features/`）：

| 情境 | 現在的做法 | 問題 |
| --- | --- | --- |
| 新進一批人，要貼上「約聘」標籤、指派同一個角色 | `user/batch.ts:13-18` 只有啟用、停用、解鎖、刪除；逐人打開詳情改 | 標籤與角色沒有批次動作 |
| 檔案管理器框選 30 個檔案要貼同一個標籤 | `file/pages/FileManager/components/FileSelectionBar.tsx:104` 的「貼標籤」只在 `count === 1` 時出現 | 只能一個一個選、一個一個貼；圖片庫已經可以批次貼（`gallery/batch.ts` 的 `gallery.tag`） |
| 誤刪了一批使用者或檔案，要從回收桶救回 | `trash/pages/TrashList/page.tsx:95-99` 每列一個擁有者登記的 `RestoreAction` | 只能逐列按還原 |
| 外部郵件服務停了一陣子，租戶的寄信工作停在失敗 | `/job` 逐筆按重試（`apps/api/src/modules/job/job.controller.ts:43` 的 `POST /jobs/:id/retry`） | 沒有批次重試；誤觸發的工作也沒有取消（租戶端沒有取消的端點，`JobQueue` 只包了 `retry()`） |
| 把一個部門的 12 個人加進群組或另一個部門 | `group/pages/GroupDetail/components/GroupMemberSection.tsx` 與 `organization/pages/Organization/components/OrgUnitMemberSection.tsx` 的 `AddMemberRow` 一次選一位 | 後端的 `PATCH /groups/:id/members`、`PATCH /org-units/:id/members` 本來就收陣列（`add` 上限 100、200），前端只送一筆；選單也不排除自己與現有成員，選到自己才在送出後 `403 AUTHZ_SELF_MODIFY` |

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 使用者列表：批次貼標籤、批次指派（加上）角色（§1） | 批次「移除角色」「取代全部角色」（影響面不易從確認框看清楚，同 [`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §13.6 對角色強制刪除的考量） |
| 檔案管理器：選多個檔案、資料夾時貼標籤（§2） | 新增任何後端批次端點（[`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §13.2 D1、[`roadmap.md`](./roadmap.md) §2.1 的反轉） |
| 回收桶：每個類型可勾選後批次還原（§3） | 回收桶的批次永久刪除（現在也沒有單筆的永久刪除，由 `trash.purge` 到期清除） |
| 背景工作：批次重試失敗、取消等待中（含單筆取消）（§4） | 租戶端的暫停、依條件的批次（平台端，[`platform-job-management.md`](./platform-job-management.md)）；取消執行中的工作 |
| 群組、部門一次加多位成員，選單排除自己與現有成員（§5） | 進行中的多關審批請求的批次決定：[`backend/20-approval.md`](../architecture/backend/20-approval.md) §9.16 明寫「進行中的多關請求不能快速／批次審核」（單關的批次核准／駁回已有）。這條在 §10.2 沒有編號；要做得先在該規格補一條決策修訂 §9.16 |

## 使用者故事

**作為租戶管理者，我希望勾選一批使用者後一次貼標籤、指派角色，以便新進人員一次設定好。**

- **Given** 我持有 `user:update` 與 `user:assignRole`，列表篩選出 25 位新進人員，其中一位是我自己、一位持有我不能指派的角色
- **When** 我勾選全部，按「指派角色」並選擇「業務專員」
- **Then** 我自己那一列標示不適用並略過；佇列逐筆處理，持有我不能指派角色的那一位以 `AUTHZ_ESCALATION` 列在結果對話框，其餘 23 位成功

**作為群組管理者，我希望一次加入多位成員，以便不必重複搜尋十幾次。**

- **Given** 群組已有 5 位成員
- **When** 我在加入成員的選單多選 12 位使用者
- **Then** 選單不列出我自己與現有的 5 位；送出一次請求，12 位同時加入（任一位違反反提權時整筆失敗並說明是誰）

**作為租戶管理者，我希望在回收桶勾選多筆後一次還原，以便快速救回誤刪的資料。**

- **Given** 「使用者」分頁有 40 筆被誤刪的人，其中 1 筆的 email 已被新帳號使用
- **When** 我勾選全部並按「還原」
- **Then** 39 筆還原；衝突的那一筆以 `USER_EMAIL_DUPLICATE` 列在結果對話框並保留勾選

## 初步構想

### 1. 使用者：貼標籤、指派角色

- `user/batch.ts` 加 `user.tag`、`user.assignRole`；項目 id 是「使用者 × 標籤／角色」的配對（同圖片庫的 `pairedItemId`，把它從 `gallery/batch.ts` 搬到 `web-core/batch` 給兩個 feature 共用）。
- **標籤**：`PUT /tags/assignments/user/:id` 是整批取代、沒有版本（[`backend/18-tag.md`](../architecture/backend/18-tag.md) D7）。照 `gallery.tag` 的做法每筆先讀那個人目前的標籤再加上這一個；已經有就算成功。
- **角色**：`PUT /users/:id/roles` 是整批取代，帶 `expectedRoleIds`（`user.service.ts:478` `replaceRolesInTx`）。每筆讀最新角色 → 加上 → 送出，衝突（`USER_ROLES_CONFLICT`）記為失敗。
  `assertRolesAssignable` 比對的是送出的 **全部** `roleIds`，所以對方已持有操作者不能指派的角色時也會失敗——是否改用差異式的單筆端點見開放問題 1。
- **權限與反提權沿用單筆**：路由的 `user:update`（標籤，D5）、`user:assignRole`；反提權（[`backend/05-rbac.md`](../architecture/backend/05-rbac.md) §4.1）、不能改自己、最後一位 super-admin 都由單筆端點擋，前端的 `isEligible` 只預先排除自己與沒有權限的情況。
- `useUserBatchActions` 加兩個動作；挑標籤、角色的對話框放 `user/components/`。

### 2. 檔案管理器：多選貼標籤

- `FileSelectionBar` 的貼標籤去掉 `count === 1`，選多個時開「加上標籤」對話框（只加不減），確認後經佇列逐筆；選一個時維持現在的取代式對話框。
- `file/batch.ts` 加 `file.tag`，檔案與資料夾各一種 `resourceType`；能不能貼跟著「能改名」（D5），系統資料夾回 `FILE_FOLDER_SYSTEM_PROTECTED` 記為失敗。

### 3. 回收桶：批次還原

- `core/trash` 的 `TrashTypeRegistration` 加選填的 `restoreOperation`（批次操作 id）；擁有者（`user`、`role`、`group`、`organization`、`file`、`gallery`）在 `batch.ts` 登記以 `POST /<resource>/:id/restore` 為單筆的操作。
- `TrashTypeList` 改用 `RichTable` 的 `batch`；有登記 `restoreOperation` 的類型才出現勾選欄。只有 backstage 有回收桶，留在 app 的 `core/`。
- 衝突（`USER_EMAIL_DUPLICATE` 等唯一值衝突、還原會讓對方取得操作者給不了的角色）照單筆的錯誤逐筆列出；檔案的子項目與資料夾的還原順序見開放問題 3。

### 4. 背景工作：批次重試、取消等待中

- **重試**：`job/batch.ts` 的 `job.retry` 逐筆呼叫既有的 `POST /jobs/:id/retry`（`job:retry`）；只送 `failed` 的列。
- **取消**：租戶端沒有單筆的取消，補一支 `POST /jobs/:id/cancel`（新權限鍵 `job:cancel`），只接受 `created`／`retry`，其餘 `409 JOB_NOT_CANCELLABLE`；批次一樣逐筆呼叫它。
- **與平台提案的分工**：`JobQueue.cancel()`、`register()` 的 `onCancelled`（擁有者把匯出等紀錄改成「已取消」）與錯誤碼由兩份共用，先做的那份負責實作；
  `packages/web-core/src/job` 的 `JobTable` 傳遞 `batch`、`JobRowActions` 的單筆取消兩個 app 共用。平台的依條件批次、暫停、取消執行中的工作只在 [`platform-job-management.md`](./platform-job-management.md)。
- 匯入匯出已有自己的 `POST /data-transfers/:id/cancel`，背景工作頁的取消與它的關係見開放問題 4。

### 5. 群組、部門一次加多位成員

- 不需要後端改動：`AddMemberRow` 的選單改 `Select` 的 `multiple`，一次送出 `add: [...]`（群組 ≤ 100、部門 ≤ 200）。這是一次請求，不經佇列。
- 選單排除操作者自己與現有成員：群組的「群組」選項另排除操作者所屬的群組（後端 `assertNotSelfMembership` 也會擋）；現有成員的來源見開放問題 5。

### 6. 會動到的既有檔案

| 位置 | 改動 |
| --- | --- |
| `user/batch.ts`、`user/pages/UserList/useUserBatchActions.ts` | §1 |
| `file/batch.ts`、`file/pages/FileManager/components/FileSelectionBar.tsx`、`page.tsx` | §2 |
| `core/trash/registry.ts`、`trash/pages/TrashList/page.tsx`、六個擁有者的 `trash.ts`／`batch.ts` | §3 |
| `job/batch.ts`（新）、`packages/web-core/src/job/JobTable.tsx`、`JobRowActions.tsx` | §4 |
| `apps/api/src/modules/job/job.controller.ts`、`job.service.ts`、`apps/api/src/core/jobs/job-queue.ts` | 單筆取消；權限鍵 `job:cancel` 依 CLAUDE.md 同步目錄、seed、`permission.ts`、語系 |
| `packages/error-codes`、`web-core` 的 `ERROR_MESSAGE_KEY` | `JOB_NOT_CANCELLABLE`（與平台提案共用） |
| `group/.../GroupMemberSection.tsx`、`organization/.../OrgUnitMemberSection.tsx` | §5 |
| `gallery/batch.ts` → `packages/web-core/src/batch` | 配對 id 的工具 |

## 開放問題

1. **批次指派角色用哪個單筆端點？** (a) 沿用 `PUT /users/:id/roles`，每筆讀最新再加上；(b) 新增差異式的單筆端點 `PATCH /users/:id/roles { add, remove }`，只對新增的角色做反提權。
   傾向 (b)：(a) 會因為對方已有的、與這次無關的角色而失敗，也要多一次讀取；(b) 仍是單筆端點，不違反「不加批次端點」。標籤同理是否加 `PATCH /tags/assignments/...`？傾向先沿用 `gallery.tag` 的讀後取代。
2. **配對 id 的每筆是「人 × 標籤」還是「人」？** 一次選多個標籤時，前者筆數相乘、後者每人一次請求。傾向每人一筆（標籤一次加上多個）。
3. **回收桶的還原順序**：同時勾選資料夾與它底下個別刪除的檔案，先還原檔案會得到 `parentDeleted`。(a) 照列表順序、失敗就列出；(b) 依類型提供排序（資料夾先）。傾向 (a)，結果對話框說明重試即可。
4. **背景工作頁取消匯出類的工作**：(a) 一律走 `POST /jobs/:id/cancel` ＋ `onCancelled`；(b) 有自己取消端點的工作在背景工作頁不給取消，引導到擁有者的頁面。傾向 (a)，與平台提案一致。
5. **排除現有成員的來源**：成員列表是分頁的。(a) 只排除目前載入的成員，其餘由後端冪等處理（已是成員算成功？要確認現況）；(b) 使用者列表加 `excludeGroupId`／`excludeOrgUnitId` 篩選。傾向先確認後端對「已是成員」的行為再決定。
6. **`job:cancel` 的預設角色**：與 `job:retry` 相同（`admin`）還是另外切？

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

完成後預計寫成：

- `docs/architecture/frontend/07-ui-system.md` §6.2：新的批次操作與配對 id 的工具
- `docs/architecture/frontend/13-trash.md`：`restoreOperation` 與批次還原
- `docs/architecture/backend/10-jobs.md` §6：租戶端的單筆取消；`docs/architecture/iam/02-permission-catalog.md`：`job:cancel`
- `docs/architecture/frontend/12-file-manager.md`、`docs/architecture/backend/18-tag.md`：多選貼標籤
- `docs/architecture/iam/07-groups.md`、`docs/architecture/backend/23-organization.md`：多選加成員
