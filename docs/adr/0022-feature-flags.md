# ADR-0022 — Feature flag：程式裡的目錄 ＋ 平台層的兩級覆寫，沿用 ADR-0021 的啟用機制

- 狀態：**採用**（實作中，branch `feat/feature-flags`）
- 日期：2026-09-30
- 相關：延伸 [ADR-0021](./0021-runtime-feature-activation.md)（可啟用的 feature）；[ADR-0020](./0020-physical-tenant-isolation.md) D22（平台層開關）；
  [ADR-0005](./0005-permission-resolved-server-side.md)（由伺服器判定）；[ADR-0007](./0007-openapi-generated-api-sdk.md)（id 經 OpenAPI 產進 SDK）；
  提案 [`../features/feature-flags.md`](../features/feature-flags.md)

## 背景

ADR-0021 讓平台管理者為每個租戶開關 **長期存在的模組**（`tenants.features`）。編輯器之後會有另一種需求：
**暫時的上線開關**——新功能先合進 `main`、只對試用的租戶開、穩定後全面開放、最後連同開關與舊的程式碼路徑一起刪除；
上線後出問題時要能不部署就關掉。

兩者的差異：

| | 可啟用的 feature（ADR-0021） | Feature flag（本 ADR） |
| --- | --- | --- |
| 壽命 | 永久 | 暫時，一定會被移除（`removeBy`） |
| 顆粒 | 整個 feature（plugin ＋ route ＋ controller） | 整個 feature，或 feature 內的一支端點、一個按鈕、一段分支 |
| 適用 | 只有 `TENANT_FEATURES` 列出的 feature | 任何地方，含常駐 feature（user、role、system…） |
| 新租戶的預設 | 全部啟用 | 程式預設值（通常是關） |
| 全平台一起切換 | 不需要 | 需要（全面開放、緊急關閉） |

現況可沿用的零件：`FeatureGuard`（JWT 之後、權限之前，未啟用回 `404 FEATURE_DISABLED`）、`TenantContext.features`、
`PATCH /platform/tenants/:id` 的平台層開關與稽核、`TENANT_FEATURES_CHANGED` → `resource.changed`（`tenantFeature`）→ 前端重抓 profile、
前端 `core/feature` 的 store、`FeatureActivator`、`requireFeature`、`useFeatureGate`。
另有一個沒人用的 `featureFlagPlugin`（`plugins/app/feature-flags.ts`，以 `attrs` 傳靜態值；ADR-0021 D3 已不允許這種做法）。

## 決定

| # | 決定 | 理由 |
| --- | --- | --- |
| D1 | **flag 的目錄集中在 `core/feature-flags/feature-flags.ts`**：`FEATURE_FLAGS = [{ key, description, defaultEnabled, owner, removeBy }] as const`，型別 `FeatureFlagKey` 由它推導。key 用 `<模組>.<名稱>`（camelCase，例 `levelEditor.v2`）。**不** 讓各模組在 `onModuleInit` 註冊 | key 要在編譯期已知：DTO 驗證、OpenAPI 的 enum、前端的型別、apps/auth 的列表都靠它；與 `TENANT_FEATURES` 同一種做法。目錄只是資料，`core/` 放它不違反「`core/` 不 import `modules/`」 |
| D2 | **兩級覆寫都在平台 DB**：租戶層是 `tenants.flags jsonb not null default '{}'`（`{ [key]: boolean }`，沒列出＝不覆寫）；全平台層是 `feature_flag_overrides`（`key` pk、`state`：`on` ｜ `off`、`updated_by`、`updated_at`，沒有列＝不覆寫） | 決定「誰先試」與「全面開放／緊急關閉」都是平台的事（ADR-0021 D8 同一個理由）；租戶層和 `features` 同一列，進入租戶時一起讀出，判斷不多查 DB |
| D3 | **生效值的優先順序**：全平台 `off` → 一律關（緊急開關，蓋過租戶層）；否則租戶層有值 → 用它；否則全平台 `on` → 開；否則 `defaultEnabled` | 緊急關閉必須壓過所有例外，才能保證「按下去就全部停」；全面開放時仍保留「某個租戶先不要」的例外 |
| D4 | **讀取**：`TenantContext` 加 `flags`（已過濾不認得的 key），與 `features` 由 `TenantDirectory` 一起載入與失效；全平台覆寫由 `FeatureFlagService` 在啟動時載入、快取 `TENANT_CACHE_TTL` 秒、變更時本機立即失效。`FeatureFlagService.isEnabled(key)` 是同步的，租戶脈絡內外（背景工作、平台端點）都能呼叫；沒有租戶脈絡時只看全平台層與預設值 | 判斷會出現在 guard 與業務分支裡，不能每次查 DB；多執行個體最多晚 `TENANT_CACHE_TTL` 秒，與租戶登記相同（[`multi-instance.md`](../features/multi-instance.md)） |
| D5 | **後端**：`@RequireFlag('<key>')` 可標在 class 或 handler，由既有的 `FeatureGuard` 一併判斷（同一個位置、同一個 `404 FEATURE_DISABLED`）；與 `@RequireFeature` 可以並存，兩者都要成立。業務分支內用 `FeatureFlagService.isEnabled()`。授權宣告照舊必填，`route-audit` 不變 | 「這個功能存不存在」只需要一個 guard、一種回應；關閉時回 404 不暴露功能存在（ADR-0021 D11） |
| D6 | **`/auth/profile` 加 `flags: FeatureFlagKey[]`**：只列出生效為開的 key。所有租戶都帶（flag 可以用在常駐 feature） | 前端只需要知道「開了哪些」；清單很短 |
| D7 | **變更與推播沿用 `features` 的路徑**：租戶層由 `PATCH /platform/tenants/:id` 的 `flags`（**完整的覆寫表**，取代而非增減；不認得的 key 回 `VALIDATION_FAILED`）寫入，稽核 `tenant.update` 的 `before`／`after` 帶 `flags`，之後 `TenantDirectory.invalidate()` 並發佈 `TENANT_FEATURES_CHANGED`。全平台層由 `PUT /platform/feature-flags/:key`（`{ state: 'default' \| 'on' \| 'off' }`）寫入，平台稽核 `featureFlag.update`，之後對 **每個 `active` 租戶** 發佈 `TENANT_FEATURES_CHANGED` | 前端已經會因為 `tenantFeature` 重抓 profile，不必新增事件、來源或前端邏輯 |
| D8 | **平台權限**：租戶層沿用 `tenant:update`；全平台層新增 `featureFlag:read`（super-admin、operator、auditor）與 `featureFlag:update`（super-admin、operator）。`GET /platform/feature-flags` 回目錄、全平台狀態、各有幾個租戶覆寫為開／關 | 緊急關閉要讓值班的 operator 也做得到；租戶層是租戶設定的一部分 |
| D9 | **前端**：`core/feature` 的 store 多存 `flags`，與 `features` 由同一個 profile 水合；`useFlag(key)` 在渲染時判斷（訂閱 store）。整個 feature 試行時登記進 `FEATURE_CATALOG`：安裝條件由「id 在 `features` 裡」改成每個項目宣告 `requires: { feature?: TenantFeature; flag?: FeatureFlagKey }`，**全部成立** 才安裝（現有項目只宣告 `feature`；之後會成為常駐的新 feature 只宣告 `flag`，flag 移除時改回 `main.tsx` 的 `.use()`）。`requireFeature`／`useFeatureGate`／卸載前導回首頁都以 catalog 的 id 判斷，不必改 | 整個 feature 的試行直接套用 ADR-0021 的 install／uninstall；局部 UI 不需要動註冊 |
| D10 | **移除 `featureFlagPlugin`**：刪除 `plugins/app/feature-flags.ts`、`main.tsx` 的 `.use()`、`AppPluginProperties.featureFlags` 的宣告 | 靜態 `attrs` 的做法已被 ADR-0021 D3 否定，留著會被誤用 |
| D11 | **到期檢查**：api 的單元測試逐一檢查 `FEATURE_FLAGS`，`removeBy` 早於今天就失敗，訊息列出 flag 與擁有者。要延期就改 `removeBy`（留下 commit 紀錄） | 沒有強制，暫時的開關會變成永久的；延期是一個看得見的決定 |
| D12 | **移除流程**：① 全平台設 `on`（或把 `defaultEnabled` 改成 `true` 並部署）觀察一段時間 → ② 刪掉 `@RequireFlag`／`isEnabled` 的判斷與舊路徑 → ③ 從 `FEATURE_FLAGS` 刪除；DB 殘留的租戶覆寫在讀取時被濾掉，`feature_flag_overrides` 的殘列由同一個 PR 的資料 migration 刪除 | 程式先不再依賴 flag，資料才清；讀取端的過濾讓順序錯了也不會壞 |

## 不做

- 租戶內依角色、依單一使用者開放：ADR-0021 已定「部分人可用」由權限表達。
- 百分比漸進釋出、A/B 實驗。
- apps/auth 自己的頁面用 flag（平台管理者的功能直接部署）；登入前的頁面讀 flag。

## 代價

| 代價 | 緩解 |
| --- | --- |
| 目錄集中在 `core/`，新增 flag 要改一個共用檔案 | 只加一列；衝突容易解。換到的是編譯期已知的 key |
| 全平台變更要對每個租戶推播 | 只在平台管理者按下時發生；事件本身只帶 `tenantId` |
| `FEATURE_FLAGS` 為空時，`z.enum` 需要至少一個值 | schema 以目錄動態產生：空目錄時 `flags` 只接受空物件、`FeatureFlagKey` 為 `never` |
| 到期檢查會讓與 flag 無關的 PR 失敗 | 這就是目的；延期只要改一行 |

## 替代方案

| 方案 | 不採用的理由 |
| --- | --- |
| 把 flag 當成一種系統設定（租戶 DB 的 `system_settings`） | 決定權在租戶管理者，不是平台；沒有全平台層；設定只支援純量且不帶 `removeBy` |
| 另開 `tenant_feature_flags` 表 | 多一次查詢與另一條失效路徑；「哪些租戶開了某個 flag」的查詢只在平台列表頁用，jsonb 也查得到 |
| 各模組 `defineFeatureFlag` 並在 `onModuleInit` 註冊 | key 到執行期才知道，DTO、OpenAPI、前端型別都拿不到 |
| 外部服務（LaunchDarkly、Unleash） | 多一個元件與一份資料；需求只有「租戶 × 開關」兩級 |
