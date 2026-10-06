# 18 — 標籤

資源的分類與依分類篩選。決定與理由見 §7；多型關聯的命名見 [`backend/14-revisions.md`](14-revisions.md) §9.2 D7。

```
擁有者模組（file、user）
  ├─ onModuleInit：tags.registerScope({ scope, feature?, canBrowse })
  │                tags.registerResource({ resourceType, scope, resolveEditable, afterTagsChanged })
  ├─ 組回應：tags.tagsOf(resourceType, ids) → 每個 DTO 的 `tags`
  ├─ 列表篩選：repository 的 hasAnyTag(resourceType, idColumn, tagIds)
  └─ 永久刪除：TrashHandler.purge 內 tags.removeAllFor(resourceType, ids, tx)

PUT /tags/assignments/:resourceType/:resourceId
  └─ TagService.replaceFor → resolver.resolveEditable（擁有者判斷權限）→ 交易內取代 ＋ 稽核 → resolver.afterTagsChanged（擁有者推播）
```

---

## 1. 標籤組與資源類型

| 標籤組 | 資源類型 | 讀定義（`canBrowse`） | 貼與移除（`resolveEditable`） | feature | 登記者 |
| --- | --- | --- | --- | --- | --- |
| `file` | `file`、`fileFolder` | `file:access` 或 `file:read` | 檔案：已完成上傳、看得到、能改名（`FileService.assertTaggable`）；資料夾：讀得到、能改名，系統資料夾不行（`FileFolderService.assertTaggable`） | `file` | `FileTagResource` |
| `user` | `user`（不含服務帳號） | `user:read` | `user:update` | — | `UserTagResource` |

- 標籤組名稱存在 `tags.scope`，已發布後不改名。所屬 feature 沒啟用時，該組的端點回 `404 FEATURE_DISABLED`；資料保留。
- 看不到或不存在的目標由擁有者回自己的 404（`FILE_NOT_FOUND`、`FILE_FOLDER_NOT_FOUND`、`USER_NOT_FOUND`），不能改回 `403 AUTHZ_FORBIDDEN`。

### 1.1 加入一種可貼標籤的資源

1. 擁有者模組 `imports` 加 `TagModule`；新增 `<name>-tag.resource.ts`（`OnModuleInit`），登記資源類型（需要新的標籤組時一併 `registerScope`）。
2. DTO 加 `tags: z.array(TagSummarySchema)`，組回應時以 `tagsOf()` 一次批次取得（列表不要逐筆查）。
3. 列表 DTO 加 `tagId: TagIdsFilterSchema`，repository 加 `hasAnyTag(...)` 條件。
4. `TrashHandler.purge` 在同一個交易內呼叫 `removeAllFor()`。
5. 前端：`apis/tag/types.ts` 的 `TagScope`／`TaggableResourceType`、標籤管理頁的分頁（`features/tag/constants.ts`）、資源頁以 `TagChips`／`TagAssignDialog` 顯示與編輯。

---

## 2. 資料表（租戶 DB，migration `0026_tags`）

| 表 | 欄位 | 約束與索引 |
| --- | --- | --- |
| `tags` | `id`、`scope`、`name`、`color`、`version`、`created_by`／`updated_by`（→ `users` `SET NULL`）、時間 | `unique(scope, lower(name))`（`tags_scope_name_unique`）；`color` 限 `neutral`、`brand`、`success`、`warning`、`danger` |
| `resource_tags` | `tag_id`（→ `tags` CASCADE）、`resource_type`、`resource_id`、`created_by`、`created_at` | PK `(tag_id, resource_type, resource_id)`；索引 `(resource_type, resource_id)` |

- `resource_tags` 沒有指向資源的外鍵（多型）。資源軟刪除時保留指派，還原後跟著回來；永久刪除時由擁有者清掉。
- 刪除標籤是硬刪除，指派 CASCADE；沒有 `deleted_at`，不經 `notDeleted()`。
- `hasAnyTag()` 放在 `db/schema/tags.ts`：單表的計數查詢裡 Drizzle 會把外層的 id 欄位輸出成不帶表名的 `"id"`，`resource_tags` 沒有同名欄位所以會解析到外層——不要在 `resource_tags` 加名為 `id` 的欄位。

---

## 3. API

| 方法 | 路徑 | 權限 | 說明 |
| --- | --- | --- | --- |
| GET | `/tags?scope=` | 登入 ＋ 進得了標籤組 | 一個標籤組的全部標籤（依名稱排序，最多 200 個，不分頁） |
| POST | `/tags` | `tag:create` | `{ scope, name, color? }`；同組同名 409、到上限 409 |
| PATCH | `/tags/:id` | `tag:update` | `{ name?, color?, version }`；標籤組不能改 |
| DELETE | `/tags/:id` | `tag:delete` | 硬刪除，指派一併刪除 |
| PUT | `/tags/assignments/:resourceType/:resourceId` | 登入 ＋ 擁有者的判斷 | `{ tagIds }`（最多 20 個，空陣列＝全部移除）整批取代；回 `{ tags }` |

擁有者的回應帶 `tags: [{ id, name, color }]`（依名稱排序）：`StoredFile`、`FileFolder`、`User`。
篩選：`GET /files?tagId=…&tagId=…`、`GET /users?tagId=…`（任一符合）。資料夾清單是一次全部取回，前端自己篩。

稽核：`tag.create`、`tag.update`（名稱、顏色的差異）、`tag.delete`（`metadata.assignedResources`）、
`tag.assign`（`resource_type`／`resource_id` 是目標，`changes` 是前後的標籤名稱、`metadata.added`／`removed` 是 id；沒有改變時不寫）。

### 3.1 錯誤碼

| 錯誤碼 | HTTP | 何時 |
| --- | --- | --- |
| `TAG_NOT_FOUND` | 404 | 標籤不存在；指派時標籤不屬於那個資源類型的標籤組（`details.tagIds`） |
| `TAG_VERSION_CONFLICT` | 409 | `version` 不是目前的版本（`details.current`） |
| `TAG_NAME_DUPLICATE` | 409 | 同組已有同名（不分大小寫） |
| `TAG_SCOPE_NOT_FOUND` | 404 | 標籤組或資源類型沒有登記 |
| `TAG_LIMIT_REACHED` | 409 | 一組超過 200 個、或一個資源超過 20 個（`details.max`） |

---

## 4. 推播

| 時機 | payload | 受眾 |
| --- | --- | --- |
| 建立、改名、改色、刪除標籤 | `{ resource: 'tag', kind, id }` | `file:access`、`file:read`、`user:read` 的 perm room |
| 貼與移除 | 擁有者推自己的資源：`file update`（`refs.fileFolder`）、`fileFolder update`、`user update` | 那個資源本來的受眾 |

前端依賴圖：`file`、`fileFolder`、`user` 衍生自 `tag` 的 `update`／`delete`（嵌入了名稱與顏色）；`tag` 的 collection 是 `TAG_LIST_QUERY_KEY`。

---

## 5. 前端

| 位置 | 內容 |
| --- | --- |
| `features/tag`（`/tag`，Page Key `TAG`，`tag:create`／`update`／`delete` 任一） | 標籤管理：每個標籤組一個分頁（`?scope=`；`file` 組跟著 feature `file`），建立／編輯（名稱、顏色、預覽）、刪除 |
| `core/components/Tag` | `TagChips`（`data-testid="tag-chip"`、`data-value=<id>`，可 `max` 收成 `+N`）、`TagAssignDialog`（多選、整批取代、錯誤顯示在對話框；只在開啟的那一刻以目前的標籤為起點，開啟中別人改了標籤只提示、不覆寫選擇） |
| 檔案管理器 | 列表模式寬度 ≥ 1080 px 時多一欄標籤；LightBox 的資訊欄；選取列「標籤」（單選、能改名）；工具列的標籤篩選（`?tag=`，檔案由後端篩、資料夾在前端篩） |
| 使用者 | 列表的標籤欄（可在偏好頁隱藏）與篩選面板的標籤（`?tagId=`）；詳情的標籤區塊（`user:update` 才能編輯） |

---

## 6. 測試

| 對象 | 檔案 |
| --- | --- |
| 定義（同組同名、不同組可同名、不認得的組、顏色、讀定義要進得了組、樂觀鎖）；使用者（貼、列表與詳情帶標籤、篩選、稽核、只能讀的人不能貼、別組的標籤、不認得的資源類型）；檔案與資料夾（貼、篩選、資料夾清單帶標籤、member 不能貼、系統資料夾不行）；刪除標籤 CASCADE 與稽核；軟刪除保留、永久刪除清掉 | `test/tags.spec.ts` |
| 登記、讀定義的閘門、feature、上限、同名、樂觀鎖、刪除的稽核；指派（擁有者判斷、稽核、推播、沒有改變不寫、別組的標籤）、`tagsOf` | `src/modules/tag/__tests__/tag.service.spec.ts` |
| 端點的授權宣告 | `test/route-audit.spec.ts` |
| 前端：`TagChips`、`TagAssignDialog`；標籤管理頁的權限三案例、分頁與 feature、建立、刪除；使用者列表的標籤欄與篩選、詳情的標籤區塊；檔案的選取能力、列表欄位 | `core/components/Tag/Tag.test.tsx`、`features/tag/**/__tests__`、`features/user/**/__tests__`、`features/file/**/__tests__` |

---

## 7. 設計決策：標籤

> 原 ADR-0032，2026-10-02 決定；標籤組依資源類型分開、第一批接上檔案、資料夾、使用者是同日確認的產品決定。

### 7.1 背景

每一種資源（檔案、資料夾、使用者；之後的業務資源）都需要分類與依分類篩選。若每個功能各做一套，資料表、管理頁與篩選 UI 都會重複。
提案把標籤、留言、關注放在一起；這份只決定 **標籤**，留言與關注仍留在提案 [`../../features/comments-watches.md`](../../features/comments-watches.md)。
相關：[`backend/14-revisions.md`](14-revisions.md) §9.2 D7（多型關聯用 `resource_type` text ＋ 程式常數）、[`rbac/01-domain-model.md`](../../rbac/01-domain-model.md) §9（資料夾的存取判斷）、
[`13-trash.md`](./13-trash.md)（永久刪除時的清理）。

2026-10-02 確認的產品決定：

- 標籤的定義 **依資源類型分開**，不是全租戶一組。
- 第一批接上 **檔案、資料夾、使用者**。

### 7.2 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **標籤組（scope）**：每個標籤屬於一個標籤組，一個標籤組涵蓋一或多種資源類型。第一批兩組：`file`（檔案與資料夾）、`user`（使用者）。<br>標籤組與資源類型由擁有者模組在 `onModuleInit` 向 `TagService` 登記，`modules/tag` 不 import 業務模組 | 「依資源類型分開」的本意是不同領域的分類不混在一起；但檔案與資料夾在同一個檔案管理器裡，同一個「合約」標籤要能同時貼在兩者，拆成兩組只會讓人建兩次 |
| D2 | **資料表**（租戶 DB）：<br>• `tags`：`scope`、`name`、`color`、`version`、建立者／修改者與時間；`unique(scope, lower(name))`<br>• `resource_tags`：`tag_id`（→ `tags` CASCADE）、`resource_type`、`resource_id`、建立者與時間；PK `(tag_id, resource_type, resource_id)`、索引 `(resource_type, resource_id)`。沒有指向資源的外鍵（多型，[`backend/14-revisions.md`](14-revisions.md) §9.2 D7） | 指派是關聯而不是實體，沒有 `version`；定義表小，整組讀出來不分頁 |
| D3 | **顏色存 Design Token 的名稱**：`neutral`、`brand`、`success`、`warning`、`danger`（與 `Chip` 的 tone 相同），不存色碼 | 前端規則 6；主題與深色模式自動跟著走 |
| D4 | **刪除標籤是硬刪除**，指派一併刪除；不進回收桶。稽核記下名稱與組 | 標籤是設定，不是業務資料；還原一個標籤卻找不回當時的指派沒有意義 |
| D5 | **權限**：<br>• 管理定義：`tag:create`、`tag:update`、`tag:delete`（所有標籤組共用；`create`／`delete` 包含 `update`）<br>• 讀定義：不需要權限鍵，但要「進得了」那個標籤組（擁有者提供的閘門：`file` 組是 `file:access` 或 `file:read`，`user` 組是 `user:read`）<br>• 貼與移除：跟著 **目標的編輯權限**，由擁有者判斷（檔案、資料夾：能改名；使用者：`user:update`）<br>預設角色：`admin` 持有三個鍵 | 「能看目標就能看它的標籤、能改目標就能改它的標籤」是提案的原則；管理定義會影響所有人看到的分類，只給管理者 |
| D6 | **讀取嵌在擁有者的回應裡**：檔案、資料夾、使用者的 DTO 多一個 `tags: [{ id, name, color }]`，由擁有者在組回應時以 `TagService.tagsOf(resourceType, ids)` 一次批次取得。<br>**篩選**：檔案列表與使用者列表接受 `tagIds`（任一符合），擁有者的 repository 以 `db/schema` 的 `hasAnyTag()` 條件組查詢 | 列表本來就由擁有者以可見性過濾，標籤跟著它就不會洩漏看不到的資源；不需要一支「列出某資源的標籤」的通用端點與它的可見性判斷 |
| D7 | **指派的端點是通用的**：`PUT /tags/assignments/:resourceType/:resourceId { tagIds }`（整批取代，最多 20 個）。`TagService` 依資源類型找擁有者登記的 resolver：檢查能不能編輯、取得稽核用的名稱、交易提交後由擁有者發自己的推播。標籤必須屬於那個資源類型的標籤組 | 前端不必為每種資源各做一支端點；權限判斷留在擁有者 |
| D8 | **稽核**：`tag.create`、`tag.update`、`tag.delete`；指派寫 `tag.assign`（`resourceType`／`resourceId` 是目標、`changes` 是前後的標籤名稱），與指派在同一個交易 | |
| D9 | **永久刪除時清理**：擁有者的 `TrashHandler.purge` 在同一個交易內呼叫 `TagService.removeAllFor(resourceType, ids, tx)`。軟刪除保留指派，還原後標籤跟著回來 | 與留言、關注之後的做法一致（提案） |
| D10 | **推播**：定義的變更推 `tag`（給進得了任一標籤組的人：`file:access`、`file:read`、`user:read`）；指派由擁有者推自己的資源（`file`／`fileFolder`／`user` update），前端依賴圖讓列表重抓 | 指派的受眾等於目標的受眾，只有擁有者知道 |
| D11 | **上限**：一個標籤組 200 個標籤、一個資源 20 個、名稱 1～50 字 | 管理頁不分頁、篩選選單一次列完 |
| D12 | **不是可關閉的 feature**：標籤是通用能力。標籤組跟著擁有者的 feature：`file` 組在租戶關掉 `file` 時不列出、端點回 `404 FEATURE_DISABLED` | |

不做（這一版）：

- 留言、關注（仍在提案）。
- 標籤階層、依標籤授權、依標籤組分開的管理權限、「全部符合」的篩選、使用次數統計（計數會透露看不到的資源數量）。

### 7.3 評估過的方案

- **全租戶共用一組**：管理最簡單，但 2026-10-02 確認要依資源類型分開（使用者的「部門」與檔案的「合約」不該出現在同一張清單）。
- **每個資源類型各自一組，檔案與資料夾也分開**：同一個檔案管理器裡的分類要建兩次，篩選時也得分兩邊選。
- **讀取用通用端點**（`GET /tags/assignments/:type/:id`）：需要通用的可見性判斷（`canView` 批次介面），而列表本來就由擁有者過濾；嵌進回應少一次請求。
- **軟刪除標籤並進回收桶**：見 D4。

### 7.4 實作紀錄

| 項目 | 補充 |
| --- | --- |
| D5 | 讀定義不需要權限鍵，但每個標籤組有擁有者提供的閘門（`canBrowse`）；檔案組是 `file:access` 或 `file:read`，使用者組是 `user:read` |
| D5 | 系統資料夾（共用、私人、個人）不能改名，所以也不能貼標籤（`FILE_FOLDER_SYSTEM_PROTECTED`） |
| D6 | 篩選的參數名稱是 `tagId`（可重複），與使用者列表既有的 `roleId` 一致；資料夾清單一次全部取回，標籤篩選在前端做 |
| D10 | 指派後的推播由擁有者的 `afterTagsChanged` 發：檔案 `file update`（帶所在資料夾）、資料夾 `fileFolder update`、使用者 `user update` |
| 前端 | 標籤管理是常駐的 feature（`/tag`），檔案組的分頁跟著 feature `file`；共用的 `TagChips`、`TagAssignDialog` 放 `core/components/Tag`，資料由各 feature 傳入 |
