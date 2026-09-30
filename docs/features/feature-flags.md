# Feature Flag（暫時的上線開關）

- 優先度：P3
- 狀態：提案
- 依賴：可啟用的 feature（已完成，[ADR-0021](../adr/0021-runtime-feature-activation.md)、[`frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §7）
- 相關：[`../architecture/05-tenancy.md`](../architecture/05-tenancy.md) §5.1（平台層開關）、[`backend/12-settings.md`](../architecture/backend/12-settings.md)

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

「平台管理者為每個租戶開關模組」已經由 ADR-0021 做完：

| 已有 | 位置 |
| --- | --- |
| 可啟用 feature 的 id：`TENANT_FEATURES = ['file', 'auditLog', 'job']` | `apps/api/src/core/tenant/tenant-features.ts` |
| 平台 DB 的 `tenants.features`（`text[]`，預設全部），apps/auth 的租戶詳情頁開關 | [`05-tenancy.md`](../architecture/05-tenancy.md) §5.1 |
| `@RequireFeature('<id>')` ＋ `FeatureGuard`：未啟用回 `404 FEATURE_DISABLED`（JWT 之後、權限之前） | `common/decorators/require-feature.decorator.ts`、`common/guards/feature.guard.ts` |
| `/auth/profile` 回 `features`；變更時推播 `resource.changed`（`tenantFeature`） | ADR-0021 D8 |
| 前端執行期 `install` / `uninstall`、可訂閱可撤回的註冊表、`requireFeature` route guard、`useFeatureGate` | `core/feature/`、`app/features.ts` 的 `FEATURE_CATALOG` |

ADR-0021 刻意只處理 **長期存在的模組**（商業上的開通，不會被移除）。
還沒有的是 **暫時的上線開關**：編輯器的新功能要先合進 `main`、先給一兩個租戶試、穩定後全面開放，最後把開關連同舊的程式碼路徑一起刪掉。
這和 `features` 的差異：

| | 可啟用的 feature（ADR-0021） | Feature flag（本提案） |
| --- | --- | --- |
| 壽命 | 永久 | 暫時，一定會被移除 |
| 顆粒 | 整個 feature（plugin ＋ route ＋ controller） | 整個 feature，**或** feature 內的一個按鈕、一支端點、一段分支 |
| 新租戶的預設 | 全部啟用 | 關閉（直到全面開放） |
| 誰決定 | 平台（租戶買了什麼） | 平台（這個租戶是不是試用對象）；全面開放時改程式預設值 |

另外還有一個沒用到的空殼：`plugins/app/feature-flags.ts` 的 `featureFlagPlugin` 把靜態的 `featureFlags` 掛成 `attrs`，`main.tsx` 傳 `{}`，沒有人讀。
ADR-0021 D3 已經規定可啟用的 feature 不得依賴 `attrs`，這個空殼應該換掉或刪掉。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| flag 定義在程式碼：`key`、說明、預設值、擁有者、`removeBy`（預計移除日期） | 租戶內依角色開放（ADR-0021 已定：「部分人可用」由權限表達） |
| 平台層的覆寫：每個租戶可以把某個 flag 開或關（apps/auth 的租戶詳情頁，與 `features` 並列） | 依單一使用者開放 |
| 後端：`@RequireFlag('<key>')`（整支端點）與 `FeatureFlagService.isEnabled()`（分支內判斷） | A/B 實驗、百分比漸進釋出 |
| `/auth/profile` 帶 `flags`（目前租戶生效的 flag），變更時推播讓 profile 重新取得 | 登入前頁面（apps/auth 的登入互動）讀 flag |
| 前端：整個 feature 用 flag 擋時沿用 ADR-0021 的 `install` / `uninstall`；feature 內的局部 UI 用 `useFlag(key)` | |
| `removeBy` 過期時 CI 失敗 | |
| 移除 `featureFlagPlugin` 的空殼 | |

## 初步構想

### 定義與判斷（api）

```ts
// modules/<擁有者>/<擁有者>.flags.ts
export const LEVEL_EDITOR_V2 = defineFeatureFlag({
  key: 'levelEditor.v2',
  description: '新版關卡編輯器',
  defaultEnabled: false,
  owner: 'content',
  removeBy: '2026-12-31',
});
```

- `core/feature-flags/`：`defineFeatureFlag`、註冊表（模組在 `onModuleInit` 註冊，和 `defineSetting`、`defineJob` 同一種模式）、`FeatureFlagService`。
- 生效值 = 平台對這個租戶的覆寫 ?? 程式預設值。沒有租戶層、沒有角色層。
- 儲存：平台 DB。兩種做法見開放問題 1。讀取放進 `TenantContext`（和 `features` 一樣，進入租戶時一併載入），判斷不查 DB。
- `@RequireFlag('<key>')`：沿用 `FeatureGuard` 的位置與語意（JWT 之後、權限之前，關閉時回 `404 FEATURE_DISABLED`），
  可以直接擴充 `FeatureGuard` 同時認得兩種 metadata；授權宣告照樣必填，路由稽核不變。
- 平台管理者變更覆寫：沿用 `features` 的流程（[`05-tenancy.md`](../architecture/05-tenancy.md) §5.1）——同一個交易寫平台稽核
  （`tenant.update` 的 `before`／`after` 多帶 flag）、`TenantDirectory.invalidate()`，再發佈 `TENANT_FEATURES_CHANGED`，
  推播對該租戶的 `t:{tenantId}` room `resource.changed`（沿用 `tenantFeature` 來源），前端重新取得 profile。

### 前端（backstage）

- `core/feature` 的 store 多存一份 `flags`，由同一個 profile 水合（`useSyncFeatures` 一併處理）。
- **整個 feature 還在試用**：把它當成可啟用的 feature 放進 `FEATURE_CATALOG`，安裝條件改成「`features` 有它 **且** 對應的 flag 開啟」，
  其餘（`requireFeature`、`useFeatureGate`、卸載時導回首頁）全部沿用。
- **feature 內的局部 UI**：`useFlag(key)` 在渲染時判斷（訂閱 store，flag 變更時自動更新）。不影響註冊。
- flag 的 key 由 api 定義並經 OpenAPI 產進 `@b2b-system/api-sdk`（和 `TenantFeature` 同一個做法），前端不寫裸字串。

### 平台管理頁（apps/auth）

- 租戶詳情頁在「可啟用的 feature」旁加一區「試用中的功能」：列出所有 flag（說明、預設值、`removeBy`），每個可選「預設／開／關」。

### 移除

- 測試（或 lint）列出所有 `removeBy` 已過的 flag 就失敗，逼著在期限前處理。
- 移除步驟：程式預設改成 `true` → 所有租戶都跑新路徑一段時間 → 刪掉判斷、舊路徑、`defineFeatureFlag`；DB 殘留的覆寫以 `toTenantFeatures` 同一種方式在讀取時忽略，不必另外清。

## 開放問題

1. 平台層的覆寫存哪裡？
   - A：`tenants.flags jsonb`（`{ key: boolean }`），和 `features` 同一列，讀取時一起載入
   - B：`tenant_feature_flags`（`tenant_id`、`key`、`enabled`）表，查詢「哪些租戶開了某個 flag」比較方便
2. 要不要一個 **全平台** 的覆寫（不改程式、不重新部署就對所有租戶開放）？沒有的話，全面開放一定要部署一次。
3. flag 可不可以擋 **常駐** feature 裡的東西？可以的話，`/auth/profile` 對所有使用者都要帶 `flags`，而不只是有可啟用 feature 的租戶。
4. `featureFlagPlugin` 直接刪除，還是改成 `core/feature` 的 `useFlag` 的 re-export？

## 歸檔去向

- `docs/adr/NNNN-feature-flags.md`（或併入 ADR-0021 的延伸）
- `docs/architecture/frontend/02-plugin-system.md` §7、`docs/architecture/05-tenancy.md` §5.1
- `docs/conventions/`：flag 的命名、`removeBy` 與移除流程
