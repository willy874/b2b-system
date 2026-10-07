# 自訂欄位

- 優先度：P2
- 狀態：提案
- 依賴：—
- 相關：[`backend/18-tag.md`](../architecture/backend/18-tag.md) §1.1（同一種「擁有者登記資源類型」的做法）、[`import-export.md`](./import-export.md)（匯入匯出要帶自訂欄位）、
  [`backend/14-revisions.md`](../architecture/backend/14-revisions.md)（版本差異要含自訂欄位）、[`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md)（RichTable 的欄位與篩選）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

通用型後台的每個租戶想記錄的東西不同：A 公司的使用者要「員工編號」「成本中心」，B 公司要「分店」。之後的業務實體（客戶、訂單、案件）更是如此。
現在每多一個欄位都要改 schema、DTO、前端表單，而且會對所有租戶生效。

標籤已經示範了「通用模組不認識業務、擁有者登記資源類型」的做法（[`backend/18-tag.md`](../architecture/backend/18-tag.md)）；自訂欄位可以照同一個形狀做，
讓租戶管理者在畫面上定義欄位，業務模組只需要登記一次。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 租戶管理者為某個資源類型定義欄位：名稱、型別、必填、預設值、排序 | 欄位之間的計算、條件顯示 |
| 型別：文字、長文字、整數、小數、日期、布林、單選、多選、使用者 | 關聯到任意資源、檔案附件、富文本 |
| 擁有者模組登記資源類型；DTO 帶 `customFields`；建立與更新時驗證 | 依欄位層級的讀寫權限 |
| RichTable 可顯示、排序、篩選自訂欄位 | 自訂欄位的全文搜尋 |
| 第一批：使用者 | |

## 使用者故事

**作為租戶管理者，我希望在使用者上加「員工編號」欄位，以便不必請開發者改系統。**

- **Given** 我有 `customField:manage`
- **When** 我在「自訂欄位」頁為「使用者」新增必填文字欄位「員工編號」
- **Then** 建立與編輯使用者的表單多一個必填欄位；使用者列表可以把它加成一欄並排序、篩選；其他租戶不受影響

## 初步構想

- 資料模型（租戶 DB）：
  - `custom_field_definitions`：`id`、`resource_type`、`key`（建立後不改，`unique(resource_type, key)`）、`label`、`type`、`options`（jsonb）、`required`、`ordinal`、`version`、`deleted_at`。
  - 值的儲存（見開放問題 1）：擁有者的表加 `custom_fields jsonb`，或另一張 EAV 表 `custom_field_values`。
- 後端：`modules/custom-field`，不 import 業務模組。擁有者在 `onModuleInit` 呼叫 `customFields.registerResource({ resourceType, feature? })`。
  - `customFields.schemaFor(resourceType)` 依定義產生 Zod schema，擁有者的 service 在建立／更新時驗證。
  - 列表篩選與排序：repository 的 helper（例 `customFieldFilter(resourceType, column, filter)`），與標籤的 `hasAnyTag` 同一個位置。
- 前端：`core/` 提供 `CustomFieldsForm`（依定義渲染）與 RichTable 欄位產生器；feature 的表單與列表以 props 嵌入。
- 權限：`customField:read`（讀定義，表單需要，可能併入登入即可讀）、`customField:manage`。
- 稽核：定義的建立、修改、刪除；值的變更併入擁有者自己的 `user.update` 稽核的 `changes`。
- 版本歷史：值隨擁有者的快照一起記錄。

## 開放問題

1. 值放擁有者表的 `jsonb` 欄（查詢與交易簡單、GIN 索引）還是 EAV 表（型別化欄位、排序容易）？前者每個擁有者都要加欄位與 migration。
2. 欄位刪除時值怎麼辦：軟刪除定義、值保留到回收桶期滿？還是改型別也禁止？
3. 必填欄位在 **已有資料** 時新增，舊資料怎麼辦（只在下一次編輯時強制？）
4. 對外 API（`/v1`）與 Webhook payload 要不要帶自訂欄位？
5. 數量上限要不要做成 feature 參數（例 `customField.maxPerResource`）？

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

- `docs/architecture/backend/NN-custom-field.md`（含設計決策）
- 前端：`docs/architecture/frontend/` 表單與 RichTable 的對應章節
