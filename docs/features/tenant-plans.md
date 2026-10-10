# 方案範本（Plan）

- 優先度：P1
- 狀態：提案
- 依賴：平台層開關與 feature 參數（[`05-tenancy.md`](../architecture/05-tenancy.md) §5.1–§5.3、§12、§13）；feature flag 與 MFA 方式的兩級覆寫（§5.2、§11、[`backend/21-mfa.md`](../architecture/backend/21-mfa.md) §5 的 `resolveToggle`）；
  租戶登記的快取與跨程序廣播（`TenantDirectory`、[`01-system.md`](../architecture/01-system.md) §4.4 的 `BroadcastService`）；平台的權限目錄（[`iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md) §8）
- 相關：[`tenant-lifecycle.md`](./tenant-lifecycle.md)（試用期與到期：試用很可能是「指定一個試用方案 ＋ 到期日」）；[`platform-dashboard.md`](./platform-dashboard.md)（總覽可以依方案分組）；
  [`platform-dual-approval.md`](./platform-dual-approval.md)（改方案影響多個租戶，可能列為要覆核的危險操作）；租戶用量 [`05-tenancy.md`](../architecture/05-tenancy.md) §5.4（判斷降配額時誰已經超過）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

平台管理者現在 **逐一** 為每個租戶設定四組值，全部存在平台 DB 的 `tenants`（`apps/api/src/db/platform/schema/tenants.ts`），由 `PATCH /platform/tenants/:id` 寫入（`modules/tenant/platform-tenant.service.ts` 的 `update`）：

| 欄位 | 現在的語意 | 出處 |
| --- | --- | --- |
| `features` | **完整清單**（`text[]`，預設全部 15 個），不是覆寫 | §5.1、`core/tenant/tenant-features.ts` 的 `TENANT_FEATURES` |
| `flags` | 覆寫表 `{ [key]: boolean }`，沒列出 = 跟著全平台（`feature_flag_overrides`）與 `defaultEnabled` | §5.2、`core/feature-flags/feature-flags.ts` 的 `resolveToggle` |
| `feature_params` | 覆寫表，沒列出 = 程式的 `defaultValue`（`rateLimit.authPerMinute` 另退回環境變數 `AUTH_TENANT_RATE_LIMIT`） | §5.3、`core/tenant/tenant-feature-params.ts` |
| `mfa_methods` | 覆寫表，規則同 `flags`（全平台層在 `mfa_method_overrides`） | [`backend/21-mfa.md`](../architecture/backend/21-mfa.md) §5 |

租戶一多，實際維運會卡在：

| 情境 | 現在的做法 | 問題 |
| --- | --- | --- |
| 新租戶開通「標準版」：關掉 4 個 feature、容量 10 GB、Webhook 5 個網址 | 建立後在詳情頁逐項關、逐個參數開對話框 | 每次十幾個步驟，漏一項沒有人發現；同一級的租戶設定逐漸飄移 |
| 「進階版」的容量從 10 GB 調到 20 GB | 逐一打開每個進階版租戶改 `file.storageQuotaMb` | 要先自己找出哪些租戶是進階版——系統裡沒有這個概念 |
| 某個租戶談了特例（多給一個 feature） | 直接改它的值 | 之後看不出哪些值是特例、哪些是「這一級本來就這樣」 |
| 之後要計費、試用到期自動降級（[`tenant-lifecycle.md`](./tenant-lifecycle.md)） | 沒有可依據的資料 | 計費需要「這個租戶在某段期間是哪一級」，現在只有散落的值與 `tenant.update` 稽核 |

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| 平台 DB 的方案：一組 `features` ＋ feature 參數 ＋ `flags`（＋ MFA 方式，開放問題 3）；租戶指定一個方案，只存與方案不同的覆寫 | 計費、價格、發票、付款（資料模型留接口，§9） |
| 生效值的解析：平台預設 → 方案 → 租戶覆寫；全平台的緊急關閉仍蓋過一切（§3） | 租戶管理者在 backstage 自己換方案或看到方案名稱 |
| 既有租戶的資料遷移：`features` 由完整清單改成覆寫的語意（§4） | 方案的排程生效（「下個月 1 號起」）；試用到期的自動降級由 [`tenant-lifecycle.md`](./tenant-lifecycle.md) 處理 |
| 改方案時，套用的租戶一起生效：快取失效、廣播、推播（§5） | 方案之間的繼承（「進階版 = 標準版 ＋ 3 個 feature」） |
| 改方案前的影響預覽：哪些租戶會失去 feature、哪些已經超過新的配額（§6） | 自動清掉超過新配額的資料 |
| 方案的樂觀鎖、版本與平台稽核；租戶的方案指派紀錄（§7） | 依方案的用量報表（[`platform-dashboard.md`](./platform-dashboard.md) 視需要再加） |
| apps/platform 的方案管理頁；租戶詳情標示每個值來自預設、方案或覆寫（§10） | |
| 平台權限 `plan:read`／`plan:create`／`plan:update`／`plan:delete`（§8） | |

## 使用者故事

**作為平台管理者，我希望建立租戶時選一個方案，以便一次套好 feature 與配額，不必逐項設定。**

- **Given** 已有「標準版」方案（關掉 `gallery`、`approvalChain`，`file.storageQuotaMb = 10240`）
- **When** 我建立新租戶時選「標準版」
- **Then** 佈建完成後租戶的生效值就是方案的值；租戶的覆寫是空的；詳情頁每一項都標示「來自方案」

**作為平台管理者，我希望調整方案時所有套用的租戶一起生效，並先看到誰會受影響。**

- **Given** 「進階版」套用在 12 個租戶，其中 2 個覆寫了 `file.storageQuotaMb`
- **When** 我把進階版的容量從 20 GB 改成 5 GB，按儲存前先看影響
- **Then** 預覽列出 10 個會跟著改的租戶、2 個因為有覆寫而不受影響、其中 3 個已用量超過 5 GB（之後只擋新的上傳，不刪資料）；確認後寫一筆平台稽核，10 個租戶在幾秒內（最晚 `TENANT_CACHE_TTL`）套用

**作為平台管理者，我希望在租戶詳情一眼看出哪些是特例，以便談續約時知道給過什麼。**

- **Given** 某個標準版租戶另外開了 `webhook.maxUrls = 20`
- **When** 我打開它的「啟用的功能」
- **Then** 那一項標「覆寫（方案：5）」，可以一鍵「回到方案的值」；其他項目標「方案」

**作為平台管理者，我希望刪除一個沒人用的方案時被擋下誤刪，以便不會讓租戶失去依據。**

- **Given** 「舊版標準版」仍套用在 1 個租戶
- **When** 我刪除它
- **Then** 回 `409 PLAN_IN_USE` 並列出那個租戶；先把租戶換到別的方案後才能刪

## 初步構想

### 1. 資料模型（平台 DB）

新表 `tenant_plans`：

| 欄位 | 型別 | 說明 |
| --- | --- | --- |
| `id` | uuid | |
| `code` | citext | 穩定的識別（計費、試用、CLI 以它對照），未刪除的之間唯一（partial unique index） |
| `name`、`description` | text | 顯示用 |
| `features` | `text[]` | 方案啟用的 feature（**完整清單**，值域 `TENANT_FEATURES`，讀取時以 `toTenantFeatures` 濾掉不認得的） |
| `flags` | jsonb `{ [key]: boolean }` | 方案層的 flag 覆寫（開放問題 2） |
| `feature_params` | jsonb `{ [key]: number \| string }` | 方案層的參數，沒列出 = 程式預設；讀取時以 `toTenantFeatureParamOverrides` 驗證 |
| `mfa_methods` | jsonb `{ [id]: boolean }` | 開放問題 3 |
| `status` | `active` ｜ `retired` | `retired` 不能再指派給租戶，已套用的照舊 |
| `version` | integer | 樂觀鎖（`PLAN_VERSION_CONFLICT`） |
| `created_by`、`updated_by`、`created_at`、`updated_at`、`deleted_at` | | 軟刪除；有租戶套用時不能刪 |

`tenants` 的改動：

- 新增 `plan_id uuid NULL REFERENCES tenant_plans(id)`；`NULL` = 沒有方案（開放問題 1）。
- `features text[]` 改成覆寫表 `feature_overrides jsonb { [id]: boolean }`（與 `flags`、`mfa_methods` 同形）——現在四個欄位只有它是完整清單，方案化之後不改就無法表達「跟著方案」（§4）。
- `flags`、`feature_params`、`mfa_methods` 欄位不變，語意由「蓋過預設」變成「蓋過方案」。

方案指派的紀錄 `tenant_plan_assignments`（`tenant_id`、`plan_id`、`plan_version`、`started_at`、`ended_at`、`assigned_by`、`reason`）：每次換方案收掉上一列、開新的一列。給之後的計費與試用（§9）用；是否這一版就做見開放問題 5。

### 2. 生效值的解析

```
features   = plan_id ? plan.features : 平台預設（TENANT_FEATURES 全部）
             再套 feature_overrides：true 加入、false 移除；依 TENANT_FEATURES 的順序
flags      = 全平台 off → 關（緊急開關，蓋過方案與租戶）
             租戶 flags 有值 → 用它
             方案 flags 有值 → 用它
             全平台 on → 開
             defaultEnabled
mfaMethods = 同 flags（全平台層是 mfa_method_overrides）
params     = 租戶 feature_params ?? 方案 feature_params ?? defaultValue
             （rateLimit.authPerMinute 的最後一層是 AUTH_TENANT_RATE_LIMIT，與現在相同）
```

- `resolveToggle(defaultEnabled, global, tenant)` 擴成多一個 `plan` 參數（或依序取第一個有值的層），feature flag 與 MFA 共用，規則仍只有一份。
- **合併在 `TenantDirectory` 載入時完成**：`TenantRecord`／`TenantContext` 的 `features` 是生效值，`flags`、`featureParams`、`mfaMethods` 是「方案 ＋ 租戶」合併後的覆寫表。
  業務模組（`tenantFeatureParam()`、`FeatureFlagService.isEnabled()`、`FeatureGuard`、`core/jobs/job-queue.ts` 的並行上限）不必知道方案存在。
  注意 `common/guards/rate-limit.guard.ts` 以 `key in tenant.featureParams` 判斷要不要退回環境變數：方案有值時必須出現在合併後的表裡。
- 腳本不經 `TenantDirectory`：`db/client.ts` 的 `ScriptTenant`（`db:archive-audit-logs` 讀 `featureParams`）要一併 join 方案，否則腳本與排程算出不同的保留天數。

### 3. 方案與全平台層的先後

全平台 `off` 永遠最優先（事故時的緊急開關不能被方案擋住）；全平台 `on`（全面開放）排在方案 **之後**：方案明確寫了 `false` 的 flag，全面開放不會打開它。
這讓「這一級不含某個試行功能」能被表達；代價是全面開放後仍有方案關著，`removeBy` 前要先清掉方案的值（開放問題 2）。

### 4. 既有租戶的遷移

一支平台 migration（編號實作時決定）：

1. 建 `tenant_plans`、`tenant_plan_assignments`，`tenants` 加 `plan_id`（全部 `NULL`）。
2. `features` → `feature_overrides`：以「平台預設 = 全部」為基準算差集，**只寫被關掉的** `{ id: false }`。預設全開的租戶得到 `{}`。
3. 刪除 `tenants.features`（同一次部署；與 §12.3 刪除 `allow_external_idp` 相同做法）。
4. `flags`、`feature_params`、`mfa_methods` 不動：沒有方案時它們本來就是「蓋過預設」，語意不變。

上線後所有租戶的生效值與現在 **完全相同**；平台管理者之後再建立方案、逐一把租戶指派過去。指派時提供「依目前生效值換算覆寫」：與方案相同的值不存，不同的才存成覆寫，
所以指派本身不改變生效值，除非管理者勾選「清除覆寫、完全照方案」。

新增 feature 的規則跟著改：§5.1「新增一個可啟用的 feature 要決定既有租戶要不要啟用」變成「決定每個方案要不要加」，沒有方案的租戶跟著平台預設（開放問題 4）。

### 5. 快取與跨程序同步

- 方案不另開快取：`TenantDirectory` 載入租戶時 join 方案。改方案後呼叫 `TenantDirectory.invalidate()`（整份重載，並經頻道 `tenant_directory` 通知其他程序；漏掉時最多晚 `TENANT_CACHE_TTL` 秒）。
- 改方案的 `features`、`flags`（與 MFA 方式）真的改變時，對每個套用且 `active`、而且沒有被覆寫完全蓋掉的租戶各發一次 `TENANT_FEATURES_CHANGED`——與全平台 flag 切換相同（`modules/feature-flag/platform-feature-flag.service.ts`）；
  `modules/realtime` 推 `resource.changed`（`tenantFeature`），前端重新取得 profile；`core/authz/authz.revision.ts` 也因此失效權限的 feature 對照（§15.2 D1）。只改參數不推播（§13.2 D4）。
- 一次影響上百個租戶時事件逐一發佈；數量大時是否改成一則「方案已變更」的廣播，見開放問題 7。

### 6. 改方案造成功能或配額降低

儲存前以 `POST /platform/plans/:id/impact`（帶草稿）預覽，只計算 **沒有覆寫該項** 的租戶：

| 降低的項目 | 生效後的行為（現況） | 預覽要列出的 |
| --- | --- | --- |
| 移除 feature | 依 §5.1 的表：端點 404、資料保留；`group` 暫停群組授權、`identityProvider` 影響登入 | 受影響的租戶數；各租戶的 `TenantFeatureImpacts`（§12.5，逐一 `Tenancy.runForMaintenance`，有上限） |
| `file.storageQuotaMb` 調低 | 已用量超過時只擋新的上傳（`modules/file/file.service.ts`），不刪檔 | 依 `tenant_usage_daily` 最近一次快照，列出已超過、超過 80% 的租戶 |
| `auditLog.retentionDays` 調低 | **下一次 `auditLog.archive` 以 DROP 分區永久刪除**較舊的稽核 | 一律標成危險，確認框要輸入方案代碼；是否加寬限期見開放問題 6 |
| `auditLog.hotRetentionDays` 調低 | 下一次封存搬到冷表，仍查得到 | 只提示 |
| `identityProvider.maxProviders`、`webhook.maxUrls` 調低 | 既有的保留，只擋新增或變多（§13.3 D10、D11） | 已超過的租戶數（要進租戶數，或只標「可能」） |
| `job.maxConcurrency`、`rateLimit.*`、`dataTransfer.*`、`gallery.maxItemSizeMb` | 下一個工作或請求立即套用 | 只提示 |
| 關掉 MFA 方式 | 只有這種因子又沒有備用碼的人登入時 `AUTH_MFA_UNAVAILABLE` | 沿用 `GET /platform/mfa-methods/:id/impact?tenantId=` 的計數 |

同樣的預覽也用在「把租戶換到另一個方案」（`POST /platform/tenants/:id/plan/impact`）。

### 7. 版本、稽核與樂觀鎖

- `PATCH /platform/plans/:id` 必帶 `version`；`RevisionService`（[`backend/14-revisions.md`](../architecture/backend/14-revisions.md)）只在租戶 DB，平台的版本歷史要自己做（開放問題 5）。
- 平台稽核（`platform_audit_logs`，與寫入同一個交易）：`plan.create`、`plan.update`（`before`／`after` 帶有變的欄位、受影響的租戶數；移除 feature 或調低保留天數時 `metadata.severity: 'high'`，比照 `cdn.update`）、`plan.delete`；
  租戶的指派併進 `tenant.update`（`before`／`after` 多帶 `planId` 與 `featureOverrides`）。
- 現在的 `tenants` 沒有 `version` 欄、`PATCH /platform/tenants/:id` 也不帶 `version`；改方案與改租戶覆寫同時發生時要不要順便補上，列在開放問題 8。

### 8. 權限（平台的目錄）

| 權限鍵 | 顯示名稱 | 說明 | `super-admin` | `operator` | `auditor` |
| --- | --- | --- | :-: | :-: | :-: |
| `plan:read` | 檢視方案 | 方案清單、內容、套用的租戶數、影響預覽 | ✅ | ✅ | ✅ |
| `plan:create` | 建立方案 | 新增方案（可從現有方案或某個租戶的生效值複製） | ✅ | | |
| `plan:update` | 編輯方案 | 改內容、停用（`retired`）；一次影響所有套用的租戶 | ✅ | | |
| `plan:delete` | 刪除方案 | 只能刪沒有租戶套用的方案 | ✅ | | |

把租戶指派到方案、改租戶的覆寫沿用 `tenant:update`（`operator` 也有）；指派時另要 `plan:read`。`operator` 能不能改方案見開放問題 9。
同步 `apps/api/src/db/seeds/platform-permissions.ts`、[`iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md) §8.1／§8.2、apps/platform 兩個語系檔的 `permission.plan.*`。

### 9. 與計費、試用的介接

- 計費需要「某段期間是哪個方案的哪一版」：`tenant_plan_assignments` 的 `started_at`／`ended_at` ＋ `plan_version`，配上方案版本的快照即可回推；`code` 讓外部計費系統對照。
- 試用（[`tenant-lifecycle.md`](./tenant-lifecycle.md)）可以表達成「指派試用方案、到期時換回指定的方案」：`tenant_plan_assignments` 預留 `ends_at`（排定結束）與 `next_plan_id` 欄，由生命週期的背景工作執行換方案；這一版只建欄位、不排程。
- 價格、幣別、計費週期不放進 `tenant_plans`，計費功能自己的表以 `plan_id` 參照。

### 10. apps/platform

- **新 feature `features/plan`**（route `/plan`、`/plan/$id`；側欄放在「租戶」旁；頁面權限 `plan:read`）：清單（代碼、名稱、狀態、套用的租戶數）；詳情分頁「內容」（feature 清單與每列下的參數、flags、MFA 方式，與租戶詳情相同的元件）與「套用的租戶」（連到租戶詳情）。
  元件要與 `features/tenant/pages/TenantDetail/components` 的 `TenantFeatures`、`TenantFeatureParamDialog`、`TenantFlags`、`TenantMfaMethods` 共用：
  feature 之間不能互相 import（[`frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md)），要搬到 app 的 `core/` 或改成以值的來源為參數的共用元件。
- **租戶詳情**：概覽顯示方案（可換方案、看影響）；「啟用的功能」「試行開關」「多重驗證」每一項標示來源 `預設`／`方案`／`覆寫`，覆寫的那一項顯示方案的值並提供「回到方案的值」。
  API 的 `PlatformTenant.featureParams[].overridden` 改成 `source: 'default' | 'plan' | 'tenant'` 並多帶 `planValue`；`features` 同樣每項帶來源。
- **建立租戶**：表單多一個方案下拉（`active` 的方案；可不選）。
- **租戶清單**：多一欄方案、可依方案篩選。
- apps/platform 的「試行開關」頁的「覆寫成開／關的租戶數」要分出「經由方案」與「租戶覆寫」兩種。

### 11. API

| 方法 | 路徑 | 權限 | 說明 |
| --- | --- | --- | --- |
| GET | `/platform/plans` | `plan:read` | 清單 ＋ 套用的租戶數 |
| POST | `/platform/plans` | `plan:create` | `fromPlanId` 或 `fromTenantId` 可選，複製其生效值 |
| GET | `/platform/plans/:id` | `plan:read` | 內容（目錄上每個參數一項，含預設值）、`version` |
| PATCH | `/platform/plans/:id` | `plan:update` | `features` 完整清單、`flags`／`mfaMethods` 完整表、`featureParams` 只列要改的（`null` 回預設）、`status`；必帶 `version` |
| POST | `/platform/plans/:id/impact` | `plan:read` | 帶草稿，回 §6 的預覽 |
| DELETE | `/platform/plans/:id` | `plan:delete` | 有租戶套用回 `409 PLAN_IN_USE` |
| PATCH | `/platform/tenants/:id` | `tenant:update` | 多 `planId`、`featureOverrides`（取代 `features`）、`clearOverrides` |

錯誤碼（`packages/error-codes` ＋ `web-core` 的 `ERROR_MESSAGE_KEY` 與語系檔）：`PLAN_NOT_FOUND`、`PLAN_CODE_TAKEN`、`PLAN_IN_USE`、`PLAN_RETIRED`、`PLAN_VERSION_CONFLICT`。租戶網域上一律 `404 PLATFORM_ONLY`。

### 12. 會動到的既有模組

| 位置 | 改動 |
| --- | --- |
| `apps/api/src/db/platform/schema/tenants.ts`、新的 `tenant-plans.ts` | `tenant_plans`、`tenant_plan_assignments`、`tenants.plan_id`、`features` → `feature_overrides` |
| `apps/api/src/core/tenant`（`tenant-directory.service.ts`、`tenant.repository.ts`、`tenant-features.ts`、`tenant-feature-params.ts`） | 載入時 join 方案並合併；`TenantRecord` 的欄位語意 |
| `apps/api/src/core/feature-flags/feature-flags.ts` | `resolveToggle` 多一層方案 |
| `apps/api/src/db/client.ts` | `ScriptTenant` 合併方案 |
| `apps/api/src/modules/tenant`（`platform-tenant.service.ts`、`dto/platform-tenant.dto.ts`） | 指派方案、覆寫的新形狀、來源標示、影響預覽 |
| `apps/api/src/modules/plan`（新） | controller、service、repository、影響預覽 |
| `apps/api/src/modules/feature-flag`、`modules/mfa`（`platform-mfa-method.service.ts`） | 覆寫租戶數分出方案；全平台切換的推播對象不變 |
| `apps/platform/src/features/tenant`、`features/plan`（新）、`features/feature-flag` | §10 |
| 文件 | [`05-tenancy.md`](../architecture/05-tenancy.md) §5.1–§5.3 改寫成三層、新增設計決策章；[`backend/21-mfa.md`](../architecture/backend/21-mfa.md) §5；權限目錄 |

## 開放問題

1. **沒有方案（`plan_id IS NULL`）要不要允許？** 允許：遷移最簡單、單一租戶的部署不必建方案，但會有兩種租戶。不允許：遷移時建一個「預設」方案並全部指派，之後只有一種語意，但單租戶部署也要面對方案的概念。傾向允許，`NULL` 等於「平台預設這個隱含的方案」。
2. **flags 要不要放進方案？** flag 是暫時的（有 `removeBy`），方案是長期的；放進去能表達「進階版先試行」，但移除 flag 前要先清方案裡的值，否則全面開放後仍被方案關著（§3）。傾向放，但 `removeBy` 的單元測試一併檢查方案裡的殘留；另一個選項是方案不含 flags，試行只在租戶層。
3. **MFA 方式要不要放進方案？** MFA 方式比較像安全設定而非商業組合，而且租戶自己還有 MFA 政策（[`backend/21-mfa.md`](../architecture/backend/21-mfa.md) §6）。傾向放（例如「簡訊驗證只給進階版」是常見的商業切法），規則與 flags 相同。
4. **feature 的「平台預設」層要不要可設定？** 現在新租戶的預設是 DB 欄位的預設值（全開），方案化後變成「沒有方案 = `TENANT_FEATURES` 全部」。新增一個 feature 時，沒有方案的租戶會自動得到它，與 §5.1「要另外決定既有租戶要不要啟用」不同。選項：`TENANT_FEATURES` 每項加 `defaultEnabled`；或要求所有租戶都有方案（回到問題 1）。
5. **方案的版本歷史存到哪？** 選項：只靠平台稽核的 `before`／`after`；或 `tenant_plan_versions` 存每一版的完整快照，`tenant_plan_assignments.plan_version` 指向它（計費要回推某一天的內容時用得到）。也要決定 `tenant_plan_assignments` 是否這一版就做。傾向兩者都做，表很小。
6. **降低保留天數或配額時要不要寬限？** `auditLog.retentionDays` 調低會在下一次封存永久刪除資料。選項：只靠確認框；或寫入時記 `effective_at`，保留天數類的降低延後 N 天生效。容量降低是否要通知租戶管理者（站內通知），還是只通知平台。
7. **改方案的推播量**：一個方案套用上千個租戶時，逐一發 `TENANT_FEATURES_CHANGED` 會打出上千則事件與 `DomainEventRelay` 轉送。是否改成每批發送，或讓前端依 profile 的 `ETag` 自行偵測。
8. **`tenants` 要不要補樂觀鎖？** 現在兩個平台管理者同時改同一個租戶，後寫的覆蓋先寫的；加了方案之後「改方案」與「改租戶覆寫」更容易交錯。補上要改 `PATCH /platform/tenants/:id` 的契約與 apps/platform 的所有對話框。
9. **`operator` 能不能編輯方案？** 改方案一次影響很多租戶，傾向只給 `super-admin`，或列入 [`platform-dual-approval.md`](./platform-dual-approval.md) 的覆核；`operator` 仍能用 `tenant:update` 指派方案與覆寫。
10. **租戶覆寫要不要有上限或理由欄？** 例如覆寫必填理由（談約內容的編號），讓之後查「為什麼這個租戶多給」不必翻稽核。

## 設計決策

（待開放問題有結論後填寫）

## 歸檔去向

完成後預計寫成：

- [`docs/architecture/05-tenancy.md`](../architecture/05-tenancy.md)：§5.1–§5.3 改寫成「平台預設 → 方案 → 租戶覆寫」三層，新增「方案」一節與設計決策章
- [`docs/architecture/backend/21-mfa.md`](../architecture/backend/21-mfa.md) §5：MFA 方式的方案層（若問題 3 決定放進方案）
- [`docs/architecture/iam/02-permission-catalog.md`](../architecture/iam/02-permission-catalog.md) §8：`plan:*`
- [`apps/platform/README.md`](../../apps/platform/README.md) 的頁面清單：方案管理頁
