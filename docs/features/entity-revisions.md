# 版本歷史、樂觀鎖與還原

- 優先度：P0
- 狀態：進行中（R1 樂觀鎖、R2 回收桶與使用者還原已實作：[`backend/13-trash.md`](../architecture/backend/13-trash.md)、[`frontend/13-trash.md`](../architecture/frontend/13-trash.md)；R1b、R3～R5 未做）
- 依賴：—（[`permission-graph.md`](./permission-graph.md) G3a 已上線，開放問題 2 可以用 tuple 回答）
- 相關：[`hardening-followups.md`](./hardening-followups.md)（刪除使用者後復原、`PATCH` 的版本控制）、[`tags-comments.md`](./tags-comments.md)（多型關聯的命名）、
  [`backend/02-database.md`](../architecture/backend/02-database.md) §1、[`backend/06-audit-log.md`](../architecture/backend/06-audit-log.md)、
  [ADR-0025](../adr/0025-entity-revisions.md)（已採用：開放問題的建議結論與分階段）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

遊戲內容編輯器幾乎一定會被要求「還原到上一版」「救回誤刪的東西」「兩個人同時改不要互相蓋掉」。
**這三件事的模式要在第一個編輯器功能開工前定好**，否則每個功能各做一套。所以優先度是 P0。

現在已經有的零件：

| 零件 | 現況 | 不足 |
| --- | --- | --- |
| 軟刪除 | 慣例已定（[`backend/02-database.md`](../architecture/backend/02-database.md) §1）：`deleted_at` ＋ 唯一索引帶 `WHERE deleted_at IS NULL`。租戶 DB 的 `users`、`roles`、`files`、`file_folders`、`identity_providers`，平台 DB 的 `tenants`、`platform_admins` 都已經是 | 沒有還原 API、回收桶、到期永久刪除；每個 repository 手寫 `isNull(x.deletedAt)`，沒有共用的預設排除 |
| 樂觀鎖 | 三種各自的做法：`files.version`（`PATCH /files/:id` 帶 `version`，衝突回 `FILE_VERSION_CONFLICT`）、`PUT /users/:id/roles` 的 `expectedRoleIds`（`USER_ROLES_CONFLICT`）、租戶狀態的條件式 UPDATE | 沒有通用規則；`PATCH /users/:id`、`PATCH /roles/:id` 沒有防覆寫；沒有 `If-Match`／ETag |
| 稽核 | `changes` 只存 **有變的欄位**（`audit.diff.ts`）；刪除只存幾個欄位的 `before`；熱表 90 天後封存到冷表；權限 `auditLog:read` | 拿來還原不夠：不是完整快照，而且權限、保留期限都是給稽核用的 |
| 差異檢視 | `components/JsonDiff`（稽核詳情在用） | — |

刪除時的連帶變更讓「還原」比想像中難：

- **刪除角色**：軟刪除角色，但 **硬刪除它的持有者邊**（`relation_tuples` 的 `role:<id>#holder@user:*`，`role.repository.ts` 的 `softDelete`），權限鍵的邊留著。
  還原角色回不來「誰原本有這個角色」。
- **刪除使用者**：軟刪除、`token_version` 加一、撤銷 refresh token 與未使用的 auth token、**解除外部身分連結**（因為軟刪除不觸發 cascade）。
  持有角色的邊留著。還原後外部 IdP 連結要重新建立。
- **刪除資料夾**：同一個交易內軟刪除所有子孫；物件儲存的檔案之後由 `file.maintenance` 清除。還原要在物件被清之前。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 通用的樂觀鎖規則：`version integer` 欄 ＋ 更新 DTO 帶 `version`、條件式 UPDATE、409 帶目前版本（把 `files` 的做法寫成慣例） | `If-Match`／ETag（見開放問題 3） |
| 版本快照：選擇性加入的 `revisions` 表（每個租戶 DB 一張）＋ repository helper | 分支與合併 |
| 還原：`POST /<resource>/:id/restore`，每種資源自己定義還原時的連帶處理 | 多人即時共同編輯（CRDT） |
| 回收桶頁面（依資源類型列出已刪除的項目）＋ 到期永久刪除的排程工作 | 平台 DB 的表（租戶、平台管理者）的還原 |
| 共用的 `notDeleted(table)` 條件與 lint 規則，取代手寫 `isNull` | |
| 前端的版本列表與差異檢視（沿用 `JsonDiff`） | |
| 第一批套用：`PATCH /users/:id`、`PATCH /roles/:id` 的樂觀鎖；使用者還原 | |

## 初步構想

### 樂觀鎖（所有可編輯的實體）

- 欄位 `version integer not null default 1`；每次更新 `SET version = version + 1 WHERE id = $id AND version = $v`。
- DTO 帶 `version`（**必填**；`files` 目前是選填，缺少時後寫者贏，一併收緊要另外評估相容性）。
- 衝突回 409 `<RESOURCE>_VERSION_CONFLICT`，`details.current` 帶目前版本；前端顯示「已被別人修改」並提供重新載入。
- 不用 `updated_at` 比對：微秒精度在 JSON 來回之後對不上（[`backend/09-file.md`](../architecture/backend/09-file.md) §6.2 已記錄）。
- 關聯型的寫入（角色的使用者、角色的權限）沿用 `expectedRoleIds` 這種「預期的集合」做法，不硬塞 `version`。

### 版本快照（選擇性加入）

```
revisions（租戶 DB）
  id            uuid pk
  resource_type text        與 audit_logs 同一組命名（resource_type ＋ resource_id）
  resource_id   uuid
  version       integer     對應實體的 version
  snapshot      jsonb       整份（見開放問題 1）
  actor_id      uuid
  created_at    timestamptz
  unique (resource_type, resource_id, version)
```

- repository 在 **同一個業務交易內** 寫入快照（和稽核同一條規則）；沒有加入的表不受影響。
- `resource_type` 用 text ＋ 程式裡的常數，不用 Postgres enum（舊的 `resource_grants` 用 enum，新增類型要 `ALTER TYPE`；資源授權改成 `relation_tuples` 之後型別也是 text，版本快照的類型會比較多）。
- 保留：每個實體最多 N 版或 N 天，排程工作清理（`scope: 'tenant'`）。
- 權限：看版本 = 看得到實體；還原某一版 = 能更新實體。不另外開權限鍵。

### 還原與回收桶

- 還原由擁有者模組實作（和審批 handler 一樣，在 `onModuleInit` 註冊到回收桶的註冊表），因為連帶處理每種資源都不同：
  - 使用者：清 `deleted_at`，外部身分不回復（要重新連結），refresh token 不回復（要重新登入）。
  - 角色：需要先決定刪除時要不要保留持有者的邊（開放問題 2）。
  - 資料夾與檔案：物件還在時才能還原；`file.maintenance` 的清除要以回收桶的保留期限為準。
- 回收桶：`GET /trash?type=` 由各模組提供自己的已刪除清單；權限跟著資源（例如使用者的回收桶需要 `user:delete`）。
- 永久刪除：`trash.purge` 排程工作（`scope: 'tenant'`），超過保留期限的列真正刪除；保留期限用系統設定。
- 還原與永久刪除都寫稽核（`<resource>.restore`、`<resource>.purge`）。

## 開放問題

1. 快照存整份還是存差異？編輯器的資料可能很大。整份比較簡單、還原不必重播；差異省空間但要定期存完整版。
   **結論**：存整份，由擁有者模組的白名單產生、同交易寫入；單版上限 1 MiB、保留「最新 N 版 ∪ N 天內」；大型實體之後個別改用差異。見 [ADR-0025](../adr/0025-entity-revisions.md) D1
2. 刪除角色時持有者的邊（`role:<id>#holder@user:<u>`）要改成保留，還是刪除前把持有者寫進快照、還原時補回？
   權限圖 G3a 之後，解析已經略過已刪除的角色（權限鍵的邊本來就保留），失效也以整個租戶為單位、不必事先查人；
   保留的話要確認其他讀持有者邊的查詢（使用者列表、持有者計數）都排除已刪除的角色。
   **結論**：保留。使用者端的讀取與關係圖閉包已排除已刪除的角色；`replaceRoles` 要改成只刪未刪除角色的邊；永久刪除時清邊。見 [ADR-0025](../adr/0025-entity-revisions.md) D2
3. 樂觀鎖要不要走 HTTP 標準的 `ETag`／`If-Match`？好處是快取與 304 一起解決（[`hardening-followups.md`](./hardening-followups.md) 的「列表的 304／ETag」），
   壞處是 SDK 產生與前端都要處理標頭。
   **結論**：這一輪不用；`version` 放在請求本體，衝突 409 帶 `details.current`，最終必填（分兩步）；304／ETag 留在 `hardening-followups`，將來以同一欄產生。見 [ADR-0025](../adr/0025-entity-revisions.md) D3、D4
4. 還原時參照的東西已經不在（檔案的資料夾被刪、使用者的角色被刪），一律拒絕，還是還原到預設位置？
   **結論**：結構上的上層不在 → 拒絕（`<RESOURCE>_RESTORE_CONFLICT`）；關聯（角色）不在 → 略過；唯一值衝突沿用 `_DUPLICATE`。見 [ADR-0025](../adr/0025-entity-revisions.md) D5
5. 使用者軟刪除後 email 可以被新帳號使用（partial index）。這時還原舊帳號要怎麼處理？
   **結論**：拒絕，`409 USER_EMAIL_DUPLICATE`（帶佔用的帳號）；email 目前不能改，管理者要先刪除新帳號。見 [ADR-0025](../adr/0025-entity-revisions.md) D6

## 歸檔去向

- `docs/adr/NNNN-entity-revisions.md`
- `docs/architecture/backend/02-database.md` §1（慣例）、`docs/conventions/03-backend.md`
- 回收桶頁面：`docs/architecture/frontend/` 對應章節
