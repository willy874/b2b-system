# Feature Flag（暫時的上線開關）

- 優先度：P3
- 狀態：實作中（branch `feat/feature-flags`；設計見 [ADR-0022](../adr/0022-feature-flags.md)）
- 依賴：可啟用的 feature（已完成，[ADR-0021](../adr/0021-runtime-feature-activation.md)、[`frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §7）
- 相關：[`../architecture/05-tenancy.md`](../architecture/05-tenancy.md) §5.1（平台層開關）、[`multi-instance.md`](./multi-instance.md)（快取失效的延遲）

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

「平台管理者為每個租戶開關模組」已經由 ADR-0021 做完（`tenants.features`、`@RequireFeature` ＋ `FeatureGuard`、
`/auth/profile` 的 `features`、前端執行期 `install`／`uninstall`）。它刻意只處理 **長期存在的模組**。

還沒有的是 **暫時的上線開關**：新功能先合進 `main`、先給一兩個租戶試、穩定後全面開放、出事時不部署就能關掉，
最後把開關連同舊的程式碼路徑一起刪除。兩者的差異與設計取捨見 [ADR-0022](../adr/0022-feature-flags.md) 的「背景」。

另外 `plugins/app/feature-flags.ts` 的 `featureFlagPlugin` 是沒人用的空殼（以 `attrs` 傳靜態值，ADR-0021 D3 已不允許），這次一併移除。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| flag 目錄集中在 `core/feature-flags/feature-flags.ts`：`key`、說明、預設值、擁有者、`removeBy` | 租戶內依角色、依單一使用者開放（由權限表達） |
| 兩級覆寫（平台 DB）：租戶層 `tenants.flags`、全平台層 `feature_flag_overrides`（含緊急關閉） | 百分比漸進釋出、A/B 實驗 |
| 後端 `@RequireFlag('<key>')`（併入 `FeatureGuard`，404）與 `FeatureFlagService.isEnabled()` | apps/auth 自己的頁面、登入前的頁面讀 flag |
| `/auth/profile` 帶 `flags`（生效為開的 key），所有租戶都帶，常駐 feature 也能用 | 外部 flag 服務 |
| apps/auth：全平台的 flag 列表頁、租戶詳情頁的覆寫區 | |
| backstage：`useFlag(key)`；`FEATURE_CATALOG` 的項目可以要求 flag | |
| `removeBy` 過期時測試失敗 | |
| 移除 `featureFlagPlugin` | |

## 生效值

```
全平台 off        → 關（緊急開關，蓋過租戶層）
租戶層有值        → 用租戶層
全平台 on         → 開
都沒有            → defaultEnabled
```

| 全平台 | 租戶層 | 結果 | 情境 |
| --- | --- | --- | --- |
| — | — | `defaultEnabled` | 剛合進 `main`，預設關 |
| — | `true` | 開 | 只給試用租戶 |
| `on` | — | 開 | 全面開放 |
| `on` | `false` | 關 | 全面開放，但某個租戶先不要 |
| `off` | `true` | 關 | 緊急關閉，連試用租戶也關 |

## 資料與 API

### 平台 DB

| 表／欄位 | 內容 |
| --- | --- |
| `tenants.flags` | `jsonb not null default '{}'`；`{ [key]: boolean }`，沒列出＝不覆寫。讀取時濾掉不認得的 key |
| `feature_flag_overrides` | `key text pk`、`state text check in ('on','off')`、`updated_by uuid`、`updated_at`；沒有列＝不覆寫 |

### 端點（apps/auth，平台權限）

| 方法 | 路徑 | 權限 | 說明 |
| --- | --- | --- | --- |
| GET | `/platform/feature-flags` | `featureFlag:read` | 目錄（說明、預設值、擁有者、`removeBy`）、全平台狀態、覆寫為開／關的租戶數 |
| PUT | `/platform/feature-flags/:key` | `featureFlag:update` | `{ state: 'default' \| 'on' \| 'off' }`；平台稽核 `featureFlag.update`；之後對每個 `active` 租戶發佈 `TENANT_FEATURES_CHANGED` |
| PATCH | `/platform/tenants/:id` | `tenant:update` | 新增 `flags`：**完整的覆寫表**（取代而非增減）；不認得的 key 回 `VALIDATION_FAILED`；稽核沿用 `tenant.update` |
| GET | `/platform/tenants/:id` | `tenant:read` | 回應加 `flags` |

平台權限：`featureFlag:read` 給 super-admin、operator、auditor；`featureFlag:update` 給 super-admin、operator（緊急關閉要讓值班的人做得到）。

### 端點（backstage）

| 方法 | 路徑 | 變更 |
| --- | --- | --- |
| GET | `/auth/profile` | 加 `flags: FeatureFlagKey[]` |

## 實作清單

依 [`../../CLAUDE.md`](../../CLAUDE.md)「新增一個功能的順序」，在 `feat/feature-flags` 上：

1. **目錄與型別**：`core/feature-flags/feature-flags.ts`（`FEATURE_FLAGS`、`FeatureFlagKey`、`toFeatureFlags()` 過濾）；目錄為空時 schema 只接受空物件。
2. **平台 DB migration**：`tenants.flags`、`feature_flag_overrides`。
3. **讀取**：`TenantContext.flags`（`TenantDirectory` 一起載入）；`FeatureFlagService`（全平台覆寫的快取、`isEnabled` 同步判斷）。
4. **guard**：`@RequireFlag` 的 decorator；`FeatureGuard` 同時認得兩種 metadata；`route-audit` 擋平台端點標 `@RequireFlag`。
5. **平台端點**：`modules/tenant` 的 `flags`；新的 `modules/feature-flag`（或放 `modules/tenant`）提供列表與全平台切換；平台權限 seed 與 `docs/rbac/02-permission-catalog.md` §8。
6. **profile**：`ProfileSchema` 加 `flags`；`pnpm openapi:generate && pnpm sdk:generate`。
7. **backstage**：`core/feature` 的 store 加 `flags`、`useFlag`；`FEATURE_CATALOG` 的 `requires: { feature?, flag? }`；刪除 `featureFlagPlugin`。
8. **apps/auth**：`features/feature-flag/`（列表頁、切換確認對話框，`off` 要二次確認）；`features/tenant` 詳情頁的覆寫區；兩個語系檔。
9. **文件**：`05-tenancy.md` §5.1、`frontend/02-plugin-system.md` §7、`backend/05-rbac.md`（guard 順序）、ADR-0022 改「採用」。

## 必測清單

- [ ] 生效值：上表五種情境（`FeatureFlagService` 單元測試，table-driven）
- [ ] `FeatureGuard`：flag 關閉 → 404 `FEATURE_DISABLED`，且不寫 `authz.denied`；未登入 → 401；`@RequireFeature` 與 `@RequireFlag` 並存時兩者都要成立
- [ ] `PATCH /platform/tenants/:id` 的 `flags`：取代語意、不認得的 key 回 `VALIDATION_FAILED`、稽核帶 `before`／`after`、推播到該租戶
- [ ] `PUT /platform/feature-flags/:key`：三種 state、稽核、推播到每個 `active` 租戶、`auditor` 被拒
- [ ] `/auth/profile` 的 `flags` 只含生效為開的 key
- [ ] DB 殘留不認得的 key 不會出現在 context、profile、列表
- [ ] `removeBy` 到期的測試：以假的「今天」驗證會失敗
- [ ] backstage：`useFlag` 隨 profile 更新；`requires.flag` 的 feature 在 flag 關閉時卸載並導回首頁
- [ ] apps/auth：列表頁與租戶覆寫區的三個權限案例（有權限／無權限／未水合）

## 開放問題

1. 平台層的覆寫存哪裡？
   **結論**：租戶層放 `tenants.flags jsonb`，與 `features` 同一列、同一次載入；另加全平台層的 `feature_flag_overrides`（見問題 2）。ADR-0022 D2。
2. 要不要一個全平台的覆寫？
   **結論**：要。三種狀態（預設／`on`／`off`），`off` 是緊急開關、蓋過租戶層。ADR-0022 D2、D3。
3. flag 可不可以擋常駐 feature 裡的東西？
   **結論**：可以。`/auth/profile` 對所有租戶都帶 `flags`（只列生效為開的 key）。ADR-0022 D6。
4. `featureFlagPlugin` 直接刪除，還是改成 `useFlag` 的 re-export？
   **結論**：直接刪除；`useFlag` 放在 `core/feature`。ADR-0022 D10。

## 歸檔去向

- ADR-0022 改「採用」
- `docs/architecture/05-tenancy.md` §5.1（平台層開關）、`docs/architecture/frontend/02-plugin-system.md` §7
- `docs/rbac/02-permission-catalog.md` §8（`featureFlag:*`）
- `docs/conventions/`：flag 的命名、`removeBy` 與移除流程
