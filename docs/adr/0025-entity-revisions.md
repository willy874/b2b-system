# ADR-0025 — 版本歷史、樂觀鎖與還原：`version` 欄 ＋ 整份快照 ＋ 保留關聯的軟刪除

- 狀態：**採用**（2026-09-30 全部實作並合併：R1～R5 於 a3066d1，R1b、R4b 於下一次部署（d958900）；見文末「實作紀錄」）
- 日期：2026-09-30
- 相關：規格 [`../architecture/backend/03-api-conventions.md`](../architecture/backend/03-api-conventions.md) §11（樂觀鎖）、
  [`../architecture/backend/13-trash.md`](../architecture/backend/13-trash.md)（回收桶與還原）、[`../architecture/backend/14-revisions.md`](../architecture/backend/14-revisions.md)（版本歷史）、
  前端 [`../architecture/frontend/13-trash.md`](../architecture/frontend/13-trash.md)、[`../architecture/frontend/14-revisions.md`](../architecture/frontend/14-revisions.md)；
    [ADR-0024](./0024-relationship-based-access-control.md)（關係圖；刪除角色時持有者邊的處理）、
  [ADR-0009](./0009-table-batch-operations.md)（批次操作逐筆回報失敗）、[ADR-0016](./0016-background-jobs.md)（背景工作）；
  規格 [`../architecture/backend/02-database.md`](../architecture/backend/02-database.md) §1、§5.1、
  [`../architecture/backend/06-audit-log.md`](../architecture/backend/06-audit-log.md)、
  [`../architecture/backend/09-file.md`](../architecture/backend/09-file.md) §6.2、§9、
  [`../architecture/backend/12-settings.md`](../architecture/backend/12-settings.md)；
  同時回答 [`../features/tags-comments.md`](../features/tags-comments.md) 開放問題 2

## 背景

編輯器實體一定會被要求「兩個人同時改不要互相蓋掉」「還原到上一版」「救回誤刪的東西」。這三件事的模式要在第一個編輯器功能之前定，
否則每個功能各做一套（原本的提案已在歸檔時刪除，需求寫進上列規格）。影響決定的程式現況（2026-09-30 確認）：

| 現況 | 位置 |
| --- | --- |
| 樂觀鎖只有 `files.version`，而且是 **選填**（不帶就後寫者勝）；交易內 UPDATE 沒命中時拋的 `FILE_VERSION_CONFLICT` 不帶 `details.current` | `modules/file/dto/update-file.dto.ts`、`file.service.ts` `update()` |
| `expectedRoleIds` 也是選填；`PATCH /users/:id`、`PATCH /roles/:id` 沒有防覆寫 | `modules/user/dto/update-user.dto.ts` |
| 前端的「批次啟用／停用」逐筆呼叫 `PATCH /users/:id`，不帶任何版本 | `apps/backstage/src/features/user/batch.ts` |
| 刪除角色：軟刪除角色，**硬刪除** 持有者邊（`RETURNING` 取得持有者只用來推播）；權限鍵邊保留 | `modules/role/role.repository.ts` `softDelete()` |
| 讀「使用者持有哪些角色」的查詢都已排除已刪除的角色：使用者列表與詳情（`HELD_ROLE`）、`listRoles`、`hasRoleSlug`、`countActiveUsersByRoleSlug`、`findPermissionKeysByUserExcludingRole`、關係圖的主體閉包 CTE | `modules/user/user.repository.ts`、`modules/permission/permission.repository.ts`、`core/authz/authz.repository.ts` |
| 以「某個角色」為起點的持有者查詢（`countUsers`、`listUsers`、`userCountOf`、`findUserIdsByRole`、`userHasRole`）不看角色是否刪除——呼叫端都先確認角色存在 | `role.repository.ts`、`permission.repository.ts` |
| `replaceRoles`（`PUT /users/:id/roles`）先刪掉這個人 **所有** 持有者邊再插入 | `user.repository.ts` |
| 刪除使用者：軟刪除 ＋ `token_version + 1`、撤銷 refresh token 與未用的 auth token、解除外部身分連結；持有者邊保留 | `modules/user/user.service.ts` `remove()` |
| `users.email`、`users.username`、`roles.name`、`roles.slug` 都是 partial unique（`WHERE deleted_at IS NULL`）；**email 不能改**（`UpdateUserRequest` 沒有 email） | `db/schema/users.ts`、`roles.ts` |
| 刪除檔案在 **交易後立刻刪物件**；`file.maintenance` 把「只有已刪除紀錄」的物件當孤兒刪掉 | `file.service.ts` `remove()`、`09-file.md` §9 第 3 類 |
| `file_folders.owner_id` 是 `ON DELETE RESTRICT`，`files.folder_id` 也是 | `db/schema/file-folders.ts`、`files.ts` |
| `modules/`、`core/` 手寫的 `isNull(x.deletedAt)`／`isActiveRole()` 約 86 處，分布在 10 個 repository | — |
| `audit_logs.resource_type` 與 `relation_tuples.object_type` 都是 text；只有舊的 `resource_grants` 用 Postgres enum `resource_type`（G3b 刪除） | `db/schema/*.ts` |

## 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **快照存整份、不存差異**（提案開放問題 1）。`revisions` 表（每個租戶 DB 一張，欄位見 `14-revisions.md` §2）是 **選擇性加入**：擁有者模組以白名單函式 `toRevision(row)` 產生快照（只含可編輯的欄位，不含 id、時間戳、`deleted_at`、`version`、雜湊與 token 之類的機密），在 **同一個業務交易內** 經 `RevisionWriter.record(tx, …)` 寫入。每一版存的是 **寫入之後** 的狀態（建立時就是第 1 版），最新一版等於目前的內容。還原到某一版＝把那版的快照當成一次新的更新（`version + 1`），歷史不改寫。單版快照上限 1 MiB：超過時業務寫入照常成功，那一版 `snapshot = null` 並記 warn log，列表標示「過大未保存」。保留「最新 N 版」∪「N 天內」，兩者之外的由 `revision.prune`（`scope: 'tenant'`，每天）刪除；N 與天數是系統設定 | 整份快照讓還原與差異檢視都不必重播，`JsonDiff` 直接比兩版；目前沒有會超過上限的實體。業務寫入不能因為版本歷史失敗。巨大的編輯器資料（關卡）之後可以改成「差異 ＋ 定期整份」，那是加入時的個別決定，不在這一版 |
| D2 | **刪除角色時保留持有者邊**（提案開放問題 2）：`softDelete` 不再刪 `role:<id>#holder@user:*`，持有者改用刪除前的查詢取得（仍只用來推播）。還原角色＝清 `deleted_at` ＋ `permissionsChanged()`，原本的持有者自動回來。必要的配套：① `replaceRoles` 只刪 **未刪除角色** 的持有者邊，否則改一次某人的角色就會把休眠的邊一起清掉；② 以角色為起點的查詢維持「呼叫端先確認角色存在」，並加註解；③ 永久刪除角色時刪掉它作為物件與主體的所有邊（持有者、權限鍵、資料夾授權） | 使用者端的讀取與關係圖的閉包 **已經** 排除已刪除的角色（背景的表），權限鍵邊也早就是這樣保留的；持有者邊比照辦理，還原不需要任何重建邏輯。快照後重播要處理「期間被刪除的使用者」「已改過角色的人」，而且結果也不會比保留的邊更正確 |
| D3 | **樂觀鎖的形狀**：`version integer not null default 1`；更新 DTO 帶 `version`；`UPDATE … SET version = version + 1 WHERE id = $id AND version = $v AND deleted_at IS NULL`。讀到時就不同、或 UPDATE 沒命中而列仍存在，都回 `409 <RESOURCE>_VERSION_CONFLICT`，**兩條路徑都帶** `details.current`（沒命中時重讀一次；`files` 一併補上）。列已被刪除回 `404 <RESOURCE>_NOT_FOUND`。只有實體自己欄位的寫入會遞增 `version`；關聯的寫入（角色的使用者、角色的權限鍵）沿用「預期的集合」（`expectedRoleIds`）或增減語意，不遞增。**這一輪不用 `ETag`／`If-Match`**（提案開放問題 3）；「列表的 304／ETag」留在 `hardening-followups`，將來做時以同一個欄位產生 `ETag: W/"<version>"`，不必改資料模型 | 把 `files` 已經驗證過的做法寫成慣例；`updated_at` 經 JSON 來回會失去精度（`09-file.md` §6.2）。標頭要讓 OpenAPI 產生器、SDK、每個 mutation hook 都處理，而請求本體裡的欄位現有的 DTO 流程就支援 |
| D4 | **`version` 最終必填，分兩步到位**：第一步（R1）新增欄位與選填的 `version`，前端的表單開始帶；下一次部署改成必填。批次操作也要帶：列表的 DTO 從 R1 起帶 `version`，批次以列表那一列的版本送出，衝突以 ADR-0009 的逐筆失敗回報。`files` 的選填 `version`、`expectedRoleIds` 在同一步改成必填 | 滾動部署期間舊版前端不會送 `version`，一次改成必填會讓它的每個儲存都失敗（`02-database.md` §5.1 的「破壞性變更拆兩次」同一個道理）。選填會永遠留下「忘了帶就後寫者勝」的洞；腳本要後寫者勝就先讀一次版本 |
| D5 | **還原時參照已不在**（提案開放問題 4）：<br>• **結構上的上層**（沒有它就不知道放哪）→ 拒絕，`409 <RESOURCE>_RESTORE_CONFLICT`，`details: { reason: 'parentDeleted', parentType, parentId }`，前端提示先還原上層。<br>• **關聯**（多對多、之後可以補）→ 略過：指向已刪除物件的邊本來就被讀取忽略（D2），物件之後被還原時關聯一起回來。<br>• **唯一值衝突** → 沿用既有的 `_DUPLICATE` 錯誤碼（`USER_EMAIL_DUPLICATE`、`ROLE_NAME_DUPLICATE`、`FILE_FOLDER_NAME_CONFLICT`…），`details.conflictingId` 帶佔用者。<br>一次操作連帶刪除的列（遞迴刪除資料夾）帶同一個 `deletion_id uuid`，還原根節點時只還原同一批，之前個別刪掉的子項維持刪除 | 「還原到預設位置」會讓東西出現在使用者沒預期、權限也可能不同的地方（資料夾授權是繼承的）；拒絕並說明原因最不意外。關聯略過與 D2 一致，不必另外定義。唯一值衝突與新增時是同一件事，前端已有對應訊息 |
| D6 | **使用者還原**（提案開放問題 5）：email 或 username 已被新帳號使用時回 `409 USER_EMAIL_DUPLICATE`／`USER_USERNAME_DUPLICATE`（`details.conflictingUserId`）。email 目前不能修改，所以管理者的路徑是先刪除（或保留）新帳號，二擇一。還原成功時：清 `deleted_at`，`status` 維持刪除前的值；refresh token、外部身分連結不回復（要重新登入、重新連結）；個人資料夾由既有的 `ensurePersonalFolders` 補建；持有者邊中 **仍存在的角色** 生效，還原前以 `assertRolesAssignable` 檢查這些角色（不能藉還原取得自己給不了的角色），之後 `permissionsChanged()` | 同一個 email 同時對應兩個未刪除帳號會破壞唯一性與登入；自動改名會產生沒人認得的帳號。反提權的檢查與指派角色相同 |
| D7 | **`resource_type` 用 text ＋ 程式常數，不用 Postgres enum**，`revisions`、回收桶、`tags-comments` 的表都一樣（也回答其開放問題 2）。常數集中在 `core/resource/resource-types.ts`（`RESOURCE_TYPE`，值為 camelCase：`user`、`role`、`file`、`fileFolder`…），與 `audit_logs.resource_type`、`relation_tuples.object_type` 同一組字串；OpenAPI 端以這份常數產生 `z.enum`，SDK 仍有型別。`02-database.md` §1「列舉用 Postgres enum」加一條例外：跨模組的資源識別不適用 | 資源類型是跨模組、會持續增加的識別空間，不是單一表的封閉狀態；enum 每加一種就要 `ALTER TYPE` 的 migration，而且不能在交易內新增後立即使用。既有的兩個多型欄位都已是 text，換到的是一致；資料庫層的保護由寫入端的常數型別取代。常數放 `core/` 只是資料，與 ADR-0022 D1 的 flag 目錄同一個理由 |
| D8 | **共用 `notDeleted(table)` 條件**（`db/soft-delete.ts`），`isActiveRole()` 改成它的別名；所有 repository 改用它。以原始碼掃描測試強制（與 `layer-dependencies.spec.ts` 同一種 🔒 做法）：`modules/`、`core/` 內出現 `isNull(<x>.deletedAt)` 或手寫的 `deleted_at IS NULL` 就失敗（SQL 樣板內的條件加註解白名單）。**不做** 預設排除（查詢自動加條件） | oxlint 沒有自訂語法規則；掃描測試已是本 repo 強制分層的方法。Drizzle 沒有 default scope，自己包一層會讓「故意要查已刪除的」查詢（回收桶、唯一值衝突、還原）變得隱晦 |
| D9 | **回收桶註冊表**：通用模組 `modules/trash` 提供 `TrashRegistry`，擁有者模組在 `onModuleInit` 註冊 `TrashHandler`（`type`、`permission`、`listDeleted(query)`、`purge(ids, tx)`、`purgeOrder`），與審批的 `registerHandler` 同一個模式，`trash` 不 import 業務模組。`GET /trash?type=` 一次只列一種類型（不跨類型合併分頁）；**還原端點由擁有者模組自己提供**：`POST /<resource>/:id/restore`（權限宣告、`route-audit`、錯誤碼都留在擁有者的 controller）。這一輪 **不提供** 手動「永久刪除」按鈕，永久刪除只由排程（D11） | 每種資源的連帶處理都不同（D5、D6），放在擁有者模組才不會讓通用模組知道業務規則。不提供手動永久刪除，先少一個不可逆的操作；需要時再加 |
| D10 | **權限跟著資源，不新增權限鍵**：看某類型的回收桶與還原＝`<resource>:delete`（能刪就能復原）；看版本列表與差異＝`<resource>:read`；還原到某一版＝`<resource>:update`（加上該資源本來的反提權檢查，例如角色還原到舊的權限鍵集合要過 `assertGrantable`）。稽核：還原 `<resource>.restore`、永久刪除 `<resource>.purge`（排程執行，actor 為 null，`metadata` 帶保留天數）、還原到某一版記 `<resource>.update` 並在 `metadata.revertedFrom` 帶版本號。版本快照與稽核分開保存：稽核仍只存變更的欄位，權限與保留期限各自獨立 | 不會出現「能刪不能救」或「能還原卻不能刪」的權限組合；稽核的用途（誰做了什麼）與版本的用途（回到哪個狀態）不同，綁在一起兩邊的保留期限都會被對方拖住 |
| D11 | **到期永久刪除**：背景工作 `trash.purge`（`scope: 'tenant'`，每天）依 `purgeOrder`（檔案 → 資料夾 → 使用者 → 角色）逐類處理 `deleted_at < now - trash.retentionDays` 的列，每批一個交易；系統設定 `trash.retentionDays`（`defineSetting`，預設 30，1～365）。外鍵的 `RESTRICT`（`file_folders.owner_id`、`files.folder_id`）靠順序滿足；還擁有未清除資料夾的使用者本輪略過、下一輪再處理。**`file.maintenance` 要以保留期限為準**：刪除檔案不再於交易後立刻刪物件，孤兒的判定改成「查不到任何紀錄（含已刪除）」，物件由 `trash.purge` 在交易後刪除 | 目前檔案的物件在刪除當下就消失，檔案還原在這個前提下不可能；刪物件改在永久刪除時做，才有「在保留期限內可救」可言 |
| D12 | **第一批套用**：`PATCH /users/:id`、`PATCH /roles/:id` 的樂觀鎖；使用者還原（含回收桶與永久刪除）。角色還原（D2）緊接在後，檔案還原要先改物件的保留（D11）。`revisions` 表與版本 UI 最後做，第一個加入的實體在那一步決定（候選：角色的名稱、說明與權限鍵） | 樂觀鎖與還原是現有頁面已經卡住的缺口（`hardening-followups`）；版本歷史要等有編輯器實體才有實際的使用者 |

## 分階段

每一步都要與前一版程式相容（`02-database.md` §5.1）：

| 階段 | 內容 | 相容性 |
| --- | --- | --- |
| R1 樂觀鎖 | `users.version`、`roles.version`（加欄位有預設值）；DTO 的 `version` 選填；前端表單帶 `version`、處理 409；`files` 衝突路徑補 `details.current` | 純加法。舊版程序不遞增 `version`，只會讓新版多看到一次「沒有衝突」，不會誤判 |
| R1b 必填 | `version`（users、roles、files）與 `expectedRoleIds` 改必填；批次帶列的版本 | R1 的前端部署之後才做；此時線上沒有不帶 `version` 的前端 |
| R2 回收桶與使用者還原 | `notDeleted` 與掃描測試；`modules/trash`、`TrashRegistry`；`POST /users/:id/restore`；回收桶頁面（使用者）；`trash.purge` ＋ `trash.retentionDays` | 純加法。永久刪除只對 R2 之後刪除的列有意義——之前刪除的使用者同樣可以還原 |
| R3 角色還原 | `softDelete` 保留持有者邊；`replaceRoles` 只刪未刪除角色的邊；`POST /roles/:id/restore`；角色的回收桶與永久刪除 | 滾動部署期間舊版仍會在刪除角色時刪邊，新版不依賴「刪除的角色一定沒有邊」，兩者並存無誤。**R3 之前刪除的角色已經沒有持有者邊**，還原後沒有持有者（回應與稽核標示 `holdersRestored: 0`） |
| R4 檔案還原 | `files`、`file_folders` 加 `deletion_id`；刪除改為不立即刪物件；`file.maintenance` 的孤兒判定改變；`POST /files/:id/restore`、`/file-folders/:id/restore` | 先部署「`file.maintenance` 不刪已刪除紀錄的物件」，下一次部署才停止刪除時立即刪物件，否則滾動期間新版保留的物件會被舊版的維護工作刪掉 |
| R5 版本歷史 | `revisions`、`RevisionWriter`、`revision.prune`、版本列表與 `JsonDiff` 檢視；第一個加入的實體 | 純加法 |

R2、R3 與 `permission-graph` G3b 互不依賴；G3b 刪的是舊表與雙寫 trigger，不影響 `relation_tuples` 上的持有者邊。

## 不做

- `ETag`／`If-Match`、列表的 304（D3）。
- 差異式快照、分支與合併、多人即時共同編輯（CRDT）。
- 平台 DB 的表（租戶、平台管理者）的還原；租戶有自己的生命週期（`05-tenancy.md`）。
- 回收桶的手動永久刪除、跨類型的回收桶總表（D9）。
- 還原到「預設位置」（D5）。

## 代價

| 代價 | 緩解 |
| --- | --- |
| 持有者邊在角色刪除後仍佔空間，且每個讀持有者邊的新查詢都要記得排除已刪除的角色 | 永久刪除時一起清掉；使用者端的查詢已集中在 `HELD_ROLE`／`isActiveRole()`（D8 之後是 `notDeleted(roles)`），新查詢照抄即可；以角色為起點的查詢加註解說明前提 |
| `version` 必填後，批次操作在列表資料過時時會逐筆衝突 | 批次本來就逐筆回報；衝突的列重新整理後再做一次 |
| 整份快照在頻繁存檔的大型實體上很佔空間 | 上限 1 MiB ＋ 保留期限；超過的實體改用差異策略時另寫 ADR |
| 檔案的物件要保留到永久刪除，儲存用量比現在多一個保留期限 | `trash.retentionDays` 可調小；用量指標見 `observability` 提案 |
| 還原被唯一值擋下時，管理者只能刪掉新帳號（email 不能改） | 錯誤帶 `conflictingUserId`，前端直接連到該帳號；之後若開放改 email，這條路徑自然變多 |
| 約 86 處的 `isNull(x.deletedAt)` 一次改寫 | 機械式替換，掃描測試保證不會漏；行為不變 |

## 評估過的方案

| 方案 | 不採用的理由 |
| --- | --- |
| 快照存差異（D1 的替代） | 還原與檢視某一版都要從最近的完整版重播；目前沒有需要它的實體 |
| 直接拿稽核的 `changes` 當版本歷史 | 只有變更的欄位、刪除只存少數欄位；權限（`auditLog:read`）與保留期限（熱表 90 天）都是給稽核的 |
| 刪除角色前把持有者寫進快照、還原時補回（D2 的替代） | 要處理期間被刪除、改過角色的使用者；補回時要重跑反提權與推播；保留的邊在讀取端本來就被忽略，不必多一份資料 |
| `ETag`／`If-Match`（D3 的替代） | 標頭要讓 SDK 與每個 mutation 處理；304 的收益在列表，與樂觀鎖是兩件事，將來仍可用同一個 `version` 產生 |
| `version` 永久選填（沿用 `files`） | 忘了帶就靜默後寫者勝，這正是要防的情況 |
| 還原時參照不在就放到預設位置（D5 的替代） | 位置與繼承的權限都會變，使用者不會預期；拒絕 ＋ 提示先還原上層更可預測 |
| 還原使用者時自動改掉衝突的 email | 產生沒人認得的帳號，且 email 是登入與外部身分連結的依據 |
| `resource_type` 用 Postgres enum（D7 的替代） | 見 D7 的理由；舊的 `resource_grants` 是唯一用 enum 的多型欄位，G3b 刪除 |
| repository 的預設排除（D8 的替代） | 見 D8 的理由 |
| 通用的 `POST /trash/:type/:id/restore`（D9 的替代） | 權限宣告與錯誤碼會集中到通用模組，而還原規則每種資源都不同 |

## 實作紀錄（R1～R5、R1b、R4b）

決定不改寫；以下是實作時與上文不同、或上文沒寫到的地方（程式碼註解與根目錄 `CLAUDE.md` 的「與文件不同的實作決定」表有同樣的紀錄）。

| 階段 | 與上文的差異或補充 |
| --- | --- |
| R1 | D4 寫「列表的 DTO 從 R1 起帶 `version`，批次以列表那一列的版本送出」，分階段表卻把「批次帶列的版本」列在 R1b：以 D4 為準，批次啟用／停用在 R1 就帶列的版本（分階段表 R1b 列的「批次帶列的版本」因此在 R1 已完成），R1b 只做「改必填」 |
| R2 | `notDeleted()`／`isDeleted()` 放在 `db/schema/soft-delete.ts`，不是 D8 寫的 `db/soft-delete.ts`（`isActiveRole()` 在 `db/schema/` 要用它，`db/schema/` 只依賴同層）。`TrashHandler` 不是 D9 的 `purge(ids, tx)`，而是 `findExpired(cutoff, afterId, limit)` ＋ 逐列 `purge(item, tx)`（每列一個 savepoint）＋ `afterPurge(ids)`：一列因外鍵刪不掉只略過它自己。使用者還原的唯一值衝突用 `details.conflictingUserId`（D5 寫 `conflictingId`）；角色是 `conflictingRoleId`、資料夾是 `conflictingId` |
| R3 | 刪除與還原角色都不寫 `relation_tuples`，但會改變權限的解析結果，所以加了 migration 0012：`roles.deleted_at` 改變時 `authz_revision` +1（否則其他程序會把廣播當成舊的而略過） |
| R4 | 分成兩次部署：R4a（`deletion_id`、維護排程不刪已刪除紀錄的物件、還原端點、回收桶與永久刪除）已實作；R4b（刪除檔案不再立刻刪物件）在 R4a 的維護排程全部上線之後的下一次部署（`13-trash.md` §7.5，見下方 R4b 列）。R4a 期間刪除 **單一檔案** 的提示不附「復原」（物件已經刪了，還原只會得到 `objectMissing`），R4b 才打開 |
| R5 | 第一個加入的實體是角色（D12 的候選）：快照 `{ name, description, permissionKeys }`。**版本號是每個資源自己的流水號**，不是實體的 `version`：權限鍵是關聯的寫入、不遞增 `roles.version`（D3），卻要產生新的一版；`RevisionService.record(tx, …)` 在交易內以 `max + 1` 產生、不收版本號，呼叫端先鎖住實體列（`14-revisions.md` §3.1）。**`RevisionWriter` 就是 `modules/revision` 的 `RevisionService`**（通用模組，與 `modules/trash` 同一種）。既有角色的基準版本由 migration 0014 以 SQL 寫第 1 版（actor null），新租戶由 seed 寫；不採用「第一次寫入時補一版寫入前的狀態」。**還原到某一版** 的路由是 D10 的 `role:update`，但權限鍵會改變時 service 另要 `role:grantPermission`（改權限的端點要它，否則能藉還原拿掉角色的鍵）；目錄裡已不存在的權限鍵略過（`metadata.skippedPermissions`）。還原的請求帶 **角色的** `version`（R5 時與 R1 相同是選填，R1b 起必填）。保留設定 `revision.keepVersions`（預設 50）、`revision.keepDays`（預設 90）。另外補上 R4a 的遺漏：`GET /trash?type=file|fileFolder` 在租戶停用 `file` feature 時回 `404 FEATURE_DISABLED`（`TrashHandler.feature`，`13-trash.md` §3） |
| R1b | `version` 在 `PATCH /users/:id`、`PATCH /roles/:id`、`PATCH /files/:id`、`POST /roles/:id/revisions/:version/revert` 改必填，`PUT /users/:id/roles` 的 `expectedRoleIds` 也是；不帶回 `400 VALIDATION_FAILED`。「沒帶就後寫者勝」的路徑（service 的 `version !== undefined` 判斷、repository 的選填 `expectedVersion`）一併刪除；使用者的 repository 仍保留選填的 `expectedVersion`，因為解鎖、個人資料等不收 `version` 的寫入也經過它。前端的呼叫端在 R1 已全部帶版本；批次啟用／停用在列表沒有提供版本時讓那一筆失敗，不自己讀最新的版本（那等於後寫者勝） |
| R4b | `FileService.remove()` 不再刪物件，留到 `trash.purge`；前端刪除檔案的提示附「復原」、確認文字改成「移到回收桶」。R4a 的 `CAN_UNDO_FILE_DELETE` 開關直接刪除（部署後恆為 true，留著只是死碼），不是改成 `true`。系統沒有依紀錄計算儲存用量或配額的地方，保留的物件不影響任何計算（`13-trash.md` §7.5） |
