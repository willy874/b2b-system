# 18 — 標籤

資源的分類與依分類篩選。決定與理由見 [ADR-0032](../../adr/0032-tags.md)；多型關聯的命名見 [ADR-0025](../../adr/0025-entity-revisions.md) D7。

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
| `core/components/Tag` | `TagChips`（`data-testid="tag-chip"`、`data-value=<id>`，可 `max` 收成 `+N`）、`TagAssignDialog`（多選、整批取代、錯誤顯示在對話框） |
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
