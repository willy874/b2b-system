# 列表的篩選與導覽補齊

- 優先度：P1
- 狀態：提案
- 依賴：[`../issues/list-search-hooks-duplicated.md`](../issues/list-search-hooks-duplicated.md)（每個列表各寫一份 `use<X>SearchFilter`；先收斂成共用的寫法，再把篩選加上去，不然每加一個篩選就多抄一次）；
  網址狀態的慣例（[`frontend/04-routing.md`](../architecture/frontend/04-routing.md) §3：`validateSearch`、`.catch()`、`stripSearchParams`、`sortSearchSchema`）；
  `RichTable` 的 `FilterBar`／`ActiveFilters`（[`frontend/07-ui-system.md`](../architecture/frontend/07-ui-system.md) §6.1）；route id（`@b2b-system/web-core/route-link`，[`frontend/15-notification.md`](../architecture/frontend/15-notification.md) §3）
- 相關：[`platform-job-management.md`](./platform-job-management.md)（`GET /platform/jobs` 也要加 `createdFrom`／`createdTo`，見 §5 的分工）；
  [`backend/06-audit-log.md`](../architecture/backend/06-audit-log.md) §7、[`backend/17-webhook.md`](../architecture/backend/17-webhook.md) §6、[`backend/20-approval.md`](../architecture/backend/20-approval.md) §8、§11.2、[`backend/23-organization.md`](../architecture/backend/23-organization.md) §8、[`06-external-api.md`](../architecture/06-external-api.md) §5

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

列表頁的篩選、分頁、排序應該都在網址（[`frontend/04-routing.md`](../architecture/frontend/04-routing.md) §3），但多數列表只開放了後端能力的一部分，有些篩選放在元件的 state，分享出去或按上一頁就不見。以下路徑相對 `apps/backstage/src/features/`，後端在 `apps/api/src/modules/`：

| 情境 | 現在的做法 | 問題 |
| --- | --- | --- |
| 找出持有某個角色、或「停用＋鎖定」的使用者 | 後端 `user/dto/list-user.dto.ts:8-9` 的 `status`、`roleId` 都可重複；前端 `user/routes/model.ts:18` 的 `status` 是單選，`user/pages/UserList/page.tsx:58` 包成一個元素的陣列，沒有 `roleId` | 只能逐一狀態查；要從角色詳情看持有者以外的入口 |
| 找出持有某個角色的群組 | `group/dto/list-group.dto.ts:10` 有 `roleId`；`group/routes/model.ts` 沒有 | 前端用不到 |
| 查某人做過什麼、某筆資料被誰改過 | `audit-log/dto/list-audit-log.dto.ts:13,16` 有 `actorId`、`resourceId`；`audit-log/routes/model.ts` 沒有。操作者欄只是文字（`packages/web-core/src/audit-log/AuditLogTable.tsx:65-68`）；`audit-log` 沒有 `routeLinks.ts`，沒有任何 feature 連進稽核；展開的列是 `useState`（`audit-log/pages/AuditLogList/page.tsx:40`） | 只能手抄 id 改網址；展開的那筆無法分享 |
| 只看自己失敗的匯入 | `data-transfer/dto/data-transfer.dto.ts:72-75` 有 `direction`、`type`、`status[]`，`apis/data-transfer/get-transfer-list/query.ts:14-16` 的 query key 也預留了；頁面只送 `offset`／`limit`（`data-transfer/pages/DataTransferList/page.tsx:56`） | 紀錄一多就翻不到 |
| 在回收桶找某一筆 | `trash/dto/trash.dto.ts:16` 有 `keyword`；頁面只送 `type`／`offset`／`limit`（`trash/pages/TrashList/page.tsx:67-68`）；到期欄是絕對時間（`TrashList/adapter.ts:24`） | 只能翻頁找；看不出「還剩幾天」 |
| 查 Webhook 某種事件、某段時間的投遞 | 結果與網址篩選是 `useState`（`webhook/pages/WebhookDetail/components/WebhookDeliverySection.tsx:60-62`）；後端只有 `targetId`、`succeeded`（`webhook/dto/webhook.dto.ts:174-182`） | 重新整理就不見；**後端沒有**事件類型、時間的篩選 |
| 找出停用或很久沒用的服務帳號 | `service-account/dto/service-account.dto.ts:26-28` 只有 `keyword`；列表沒有最後使用時間（`api_tokens.last_used_at` 有，但沒有彙整到帳號） | **後端沒有**狀態篩選與最後使用時間 |
| 從佇列卡片看失敗的工作 | `packages/web-core/src/job/JobQueueSummary.tsx:28-32` 的失敗數是 `Chip`，不能點；`job/dto` 的 `ListJobSchema` 只有 `name[]`、`state[]` | 要切分頁再手選；**後端沒有**時間區間；知道 id 也只能翻 |
| 申請人看「我的申請」 | `approval/pages/MyApprovalList/adapter.ts:38-47` 只帶分頁；仍顯示申請人欄（永遠是自己）；`keyword` 只比申請人名稱（`approval/approval.repository.ts:212-214`） | 不能依狀態、類型找自己的申請；關鍵字在這個分頁沒有意義 |
| 在大的組織圖找部門 | 清單的部門樹可搜尋（`OrgUnitTreePanel.tsx:38-46`），組織圖（`OrgChartPanel.tsx`、`TreeEditor`）沒有搜尋與定位；詳情的「刪除」不看有沒有下層（`OrgUnitDetailPanel.tsx:111-120`），按了才 `409 ORG_UNIT_HAS_CHILDREN` | 只能拖曳找；白按一次刪除 |
| 排序 | 18 個 `routes/model.ts` 有 6 個有 `sort`（user、group、role、service-account、approval、gallery）——正是後端有 `SortSchema` 的租戶列表全部；其餘列表 **後端不支援排序** | 「排序進網址」其實是「後端補排序」 |

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 使用者：`roleId`（多選）、`status` 改多選（§1） | 稽核的其他排序（固定 `occurred_at DESC`，[`06-audit-log.md`](../architecture/backend/06-audit-log.md) §7：索引都以它結尾） |
| 群組：`roleId`（§1） | 檔案管理器的排序進網址（刻意是個人偏好，[`frontend/12-file-manager.md`](../architecture/frontend/12-file-manager.md) §4） |
| 稽核：`actorId`、`resourceId`、展開的列進網址、操作者可點、資源詳情的「查看稽核紀錄」（§2） | apps/platform 的稽核改用 `actorId`（平台用 `actorEmail`；只換 web-core 元件的介面，平台照舊） |
| 匯入匯出：`direction`、`type`、`status`（§1） | 匯入預覽的列篩選（在前端做，[`frontend/21-data-transfer.md`](../architecture/frontend/21-data-transfer.md) §3、§4） |
| 回收桶：`keyword`、到期顯示「N 天後」（§1） | 跨類型的回收桶搜尋（一次一種類型，[`backend/14-revisions.md`](../architecture/backend/14-revisions.md) §9.2 D9） |
| Webhook 投遞：篩選進網址；後端加事件類型、時間（§3） | 投遞超過 30 天的查詢（保留期，[`17-webhook.md`](../architecture/backend/17-webhook.md) §9.2 D16） |
| 服務帳號：後端加狀態篩選與最後使用時間（§4） | 依 token 的逐筆使用紀錄（只有節流後的 `last_used_at`，[`06-external-api.md`](../architecture/06-external-api.md) §5） |
| 背景工作：失敗數可點、建立時間區間、依 id 開啟（§5） | 平台端的批次與時間篩選（[`platform-job-management.md`](./platform-job-management.md)） |
| 我的申請：狀態、類型篩選與欄位；關鍵字比對的範圍（§6） | 審批的全文搜尋（`payload`） |
| 組織圖：搜尋與定位；有下層時預先停用刪除（§7） | 組織圖的同層排序（[`23-organization.md`](../architecture/backend/23-organization.md) §8.1 不做） |
| 後端已有排序以外的列表補排序（§8，開放問題 6） | 通知、背景工作的排序 |

## 使用者故事

**作為租戶管理者，我希望從一筆資料的詳情直接看它的稽核紀錄，以便查出是誰在何時改了它。**

- **Given** 角色「業務助理」的權限被改過，我有 `role:read` 與 `auditLog:read`
- **When** 在角色詳情按「查看稽核紀錄」
- **Then** 進入 `/audit-log?resourceType=role&resourceId=<id>`，只列這個角色的紀錄（最近 90 天）；點某一列的操作者，篩選換成那個人做過的所有事；網址可以直接貼給同事

**作為維運人員，我希望從佇列卡片一鍵看到某種工作的失敗紀錄，以便不必切分頁再自己選條件。**

- **Given** 「佇列概況」裡 `dataTransfer.export` 的卡片顯示「失敗 3」
- **When** 點「失敗 3」
- **Then** 切到列表，網址是 `/job?name=dataTransfer.export&state=failed`，正好那 3 筆

**作為申請人，我希望在「我的申請」只看被駁回的，以便決定哪些要重新送出。**

- **Given** 我送過 40 筆申請
- **When** 在「我的申請」選狀態「已駁回」
- **Then** 只列被駁回的；欄位顯示審核者與結果時間而不是申請人；重新整理後條件還在

## 初步構想

**共同做法**：每個列表在 `routes/model.ts` 加欄位（`.catch(undefined)`、多選用既有的「重複 key 成陣列」寫法，同 `user/routes/model.ts:22-26` 的 `tagId`），預設值放進 `DEFAULT_*_SEARCH`；篩選表單用依賴的 issue 收斂後的共用 hook。只有 backstage 用的放 feature；`AuditLogTable`、`JobQueueSummary` 已在 web-core（兩個前端共用），改它們的介面（[`frontend/17-shared-packages.md`](../architecture/frontend/17-shared-packages.md) §2）。

### 1. 只動前端的篩選

| 列表 | 網址參數 | 備註 |
| --- | --- | --- |
| 使用者 | `status[]`、`roleId[]` | 角色選項用角色列表的 infinite query；沒有 `role:read` 不顯示這個欄位 |
| 群組 | `roleId` | 同上；後端是單值 |
| 匯入匯出 | `direction`、`type`、`status[]` | `type` 的選項來自資源登記（`GET /data-transfers/resources`） |
| 回收桶 | `keyword`（換分頁時清掉） | `purgeAt` 用 `web-shared/date` 的 `formatRelativeTime` 顯示「N 天後」，滑過顯示絕對時間；7 天內用警告色 |

### 2. 稽核

- `audit-log/routes/model.ts` 加 `actorId`（uuid）、`resourceId`、`expanded`（展開的那筆 id，`replace` 導覽，不留瀏覽紀錄）。
- `AuditLogTable` 加 `renderActor?(row)`：backstage 渲染成改篩選的連結（`actorId` 為 null 的系統操作仍是文字）；平台不傳，照舊。
- 新增 `audit-log/routeLinks.ts`：`auditLog.resource`（search `resourceType`、`resourceId`）、`auditLog.actor`（search `actorId`）。
  各詳情頁（使用者、角色、群組、服務帳號、Webhook、部門、公告）以 `<RouteLink to="auditLog.resource">` 放「查看稽核紀錄」；
  沒登記（feature 未啟用）或沒有 `auditLog:read` 時不顯示。`resourceType` 由各 feature 帶，與後端寫稽核時的值一致。
- 套用中的 `actorId` 在 `ActiveFilters` 要顯示人名而不是 uuid：取 `GET /users/:id`（看不到時顯示 email 或「已刪除的使用者」）。

### 3. Webhook 投遞紀錄（後端要補）

- `ListWebhookDeliverySchema` 加 `eventType`（可重複）、`from`／`to`；`webhook_deliveries` 沒有事件類型，要 join `webhook_events`。現有索引 `(subscription_id, created_at desc, id)` 支撐時間範圍。
- 詳情是對話框路由（`/webhook/$webhookId`），篩選放進它的 search：`deliveryTarget`、`deliveryResult`、`deliveryEvent[]`、`deliveryFrom`／`deliveryTo`、`deliveryOffset`（加前綴，避免與列表的 `offset`、`status` 撞名）。

### 4. 服務帳號（後端要補）

- `ListServiceAccountSchema` 加 `status`（`active`／`inactive`）；回應加 `lastUsedAt`＝該帳號未撤銷 token 的 `max(last_used_at)`，`SortSchema` 加 `lastUsedAt`（null 排最後）。
- 前端加狀態篩選、「最後使用」欄（相對時間）。

### 5. 背景工作

- `JobQueueSummary` 加 `onSelectFailed?(name)`；有傳時失敗數是按鈕，backstage 導到 `?view=list&name=<name>&state=failed`。
- **後端要補**：`ListJobSchema` 加 `createdFrom`／`createdTo`（`JobStore` 的查詢條件）。[`platform-job-management.md`](./platform-job-management.md) §2 也要在 `GET /platform/jobs` 加同名參數：
  `ListPlatformJobSchema` 繼承 `ListJobSchema`，**由先做的那一份加在 `ListJobSchema` 與 `JobStore`**，另一份只接前端；兩份提案的參數名稱保持一致。
- 依 id 開啟：網址 `?job=<id>` 時以 `GET /jobs/:id` 取那一筆並展開（不在目前頁也看得到），與稽核的 `expanded` 同一種做法。

### 6. 我的申請

- `MyApprovalSearchQuerySchema` 加 `status[]`、`type[]`（只在 `tab=mine` 生效）；`toMyApprovalListParams` 帶上。
- 欄位：「我的申請」拿掉申請人欄，改成「目前關卡／審核者」與「結果時間」（`reviewedAt`）。
- 後端 `listWhere` 的 `keyword`：`scope=mine` 時比對什麼見開放問題 4；`20-approval.md` §8 的參數表同步改。

### 7. 組織圖

- `TreeEditor`（`packages/ui`）加 `focusNodeId`：變更時把那個節點捲到畫面中央並強調（沿用 `highlightedNodeIds`）；不帶業務名詞。
- `OrgChartPanel` 的工具列加搜尋框：比對名稱、代碼（與部門樹同一個 `toOrgUnitTreeVM` 的比對規則），Enter 依序跳到下一個符合的節點；定位的節點寫進既有的 `?unitId=`。
- 詳情的「刪除」：部門樹已在前端，有下層時按鈕停用並以 tooltip 說明「先移走或刪除 N 個下層部門」（組織圖的編輯模式照舊可以一起刪，§8.1）。

### 8. 會動到的既有檔案

| 位置 | 改動 |
| --- | --- |
| `apps/backstage/src/features/{user,group,audit-log,data-transfer,trash,webhook,service-account,job,approval}/routes/model.ts` | 新的網址參數 |
| 上列 feature 的列表頁與篩選 hook、`audit-log/routeLinks.ts`（新）、各詳情頁 | 篩選欄位、連結 |
| `organization/pages/Organization/components/{OrgChartPanel,OrgUnitDetailPanel}.tsx` | 搜尋、定位、停用刪除 |
| `packages/web-core/src/audit-log/AuditLogTable.tsx`、`packages/web-core/src/job/JobQueueSummary.tsx` | `renderActor`、`onSelectFailed` |
| `packages/ui/src/components/TreeEditor/` | `focusNodeId` |
| `apps/api/src/modules/{webhook,service-account,job,approval}/` | §3～§6 的後端參數；重產 openapi 與 SDK |
| backstage 兩個語系檔 | 篩選欄位、「查看稽核紀錄」、「N 天後」 |

## 開放問題

1. **「查看稽核紀錄」只比 `resourceId` 夠嗎？** 改使用者的角色記在 `user`、改角色的持有者可能記在 `role`；MFA 的變更是 `mfaMethod`。(a) 只比主資源（簡單，可能漏）；(b) `resourceType` 改可重複，詳情頁帶一組；(c) 後端加 `relatedId`（掃 `metadata`，要索引）。傾向 (a)，再看實際漏多少。
2. **稽核的時間範圍**：沒帶 `from`／`to` 時是最近 90 天（`resolveAuditLogRange`）；從詳情進來要不要自動放寬到上限，還是照預設並提示「只顯示最近 90 天」？傾向後者。
3. **Webhook 投遞的篩選放哪？** (a) 對話框路由的 search（加前綴）；(b) 投遞紀錄改成獨立的頁面路由 `/webhook/$webhookId/deliveries`。傾向 (a)，改動小；若篩選再變多就 (b)。
4. **「我的申請」的關鍵字比對什麼？** (a) 拿掉關鍵字；(b) 比對 `subject_key`、`reason`；(c) 依類型由擁有者登記可搜尋的欄位。傾向 (b)，`subject_key` 要看索引。
5. **服務帳號的 `lastUsedAt`** 每次列表都以子查詢取 `max`，還是在 `users` 反正規化一欄（token 使用時一併節流寫入）？傾向子查詢：服務帳號數量小，`api_tokens` 依帳號有索引。
6. **補排序要做哪些列表？** 候選：Webhook（名稱、最後投遞）、公告（建立時間、下次發送）、回收桶（刪除時間、到期）、匯入匯出（建立時間）、服務帳號（最後使用）。每個都要後端 `SortSchema`、索引與 `(sort, id)` 的穩定排序。傾向只做回收桶與服務帳號，其餘等有需求。
7. **背景工作的時間區間由誰先做？** 本提案（P1）大概率先做，平台提案改成只接前端；若平台提案先進入實作，反過來。需在兩份提案都寫明。

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

完成後預計寫成：

- `docs/architecture/frontend/04-routing.md` §3：多選、對話框路由的篩選前綴、展開列進網址的慣例
- `docs/architecture/backend/06-audit-log.md` §7、`docs/architecture/frontend/07-ui-system.md`（`AuditLogTable` 的 `renderActor`）
- `docs/architecture/backend/17-webhook.md` §6、`docs/architecture/06-external-api.md`（服務帳號的列表）、`docs/architecture/backend/10-jobs.md` §6、`docs/architecture/backend/20-approval.md` §8、§11.2、`docs/architecture/backend/23-organization.md` §8
