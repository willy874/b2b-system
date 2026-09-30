# Feature Flag

- 優先度：P3
- 狀態：提案
- 依賴：系統設定（已完成，[`backend/12-settings.md`](../architecture/backend/12-settings.md)）
- 相關：[`frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §3.1

> 使用方式見 [`README.md`](./README.md)。功能完成後刪除本檔，內容重寫成正式文件歸檔。

## 背景

編輯器功能會分批上線。沒有 flag 時，只能用 branch 擋住未完成的功能，合併週期會拉長；也沒辦法先對單一租戶開放。

現況：

- **系統設定**：定義在程式碼（`defineSetting`），租戶 DB 的 `system_settings` 只存覆寫值，**只支援純量**、**只有租戶一層**
  （沒有依角色、依使用者的值），快取 30 秒，改了之後推播 `resource.changed`。
- **前端**：`plugins/app/feature-flags.ts` 有一個 `featureFlagPlugin` 的空殼，`main.tsx` 傳 `{}`，沒有人讀。
- **生命週期**：所有註冊（頁面權限、選單、頂列工具）都在 plugin 的 **同步** 階段，這時還沒有 `/auth/profile`，所以不知道目前使用者是誰
  （[`frontend/02-plugin-system.md`](../architecture/frontend/02-plugin-system.md) §3.1）。「依 flag 決定要不要註冊」做不到，只能在 **讀取時** 判斷，和頁面權限檢查一樣。
- **`/auth/profile`** 回 `{ user, roles, permissions }`，沒有 flag。

## 範圍

| 做 | 不做（這一版） |
| --- | --- |
| flag 定義在程式碼（名稱、說明、預設值、擁有者、預計移除日期） | A/B 實驗與統計 |
| 開關分兩層：平台對每個租戶（apps/auth）、租戶內依角色（backstage） | 百分比漸進釋出 |
| 後端 decorator 擋路由（關閉時回 404） | 依單一使用者開放 |
| `/auth/profile` 帶目前使用者生效的 flag | |
| 前端：頁面、選單、頂列工具的註冊照舊，渲染時依 flag 隱藏；路由 guard 依 flag 回 404 | |

## 初步構想

- **為什麼有兩層**：「還沒做完的功能先給一個租戶試」是平台的決定，要在平台 DB（apps/auth 的租戶詳情頁）；
  「租戶內先給某些角色用」是租戶的決定，放租戶 DB。
- 定義：`defineFeatureFlag({ key, description, default, owner, removeBy })`，放在擁有者模組，和 `defineSetting` 同一種註冊方式。
- 儲存：
  - 平台：`tenant_feature_flags`（`tenant_id`、`key`、`enabled`）
  - 租戶：`feature_flag_roles`（`key`、`role_id`），或在系統設定上擴充陣列型別
- 判斷：`FeatureFlagService.isEnabled(key, actor)` = 程式預設 → 平台對租戶的覆寫 → 租戶的角色限制；結果依租戶快取，變更時失效並推播。
- 後端：`@RequireFeature('key')` 和 `@RequirePermissions` 並列；關閉時回 404，不是 403（不暴露功能存在）。
  路由稽核（`common/route-audit.ts`）不受影響，授權宣告仍然必填。
- 前端：`/auth/profile` 加 `features: string[]`；`useFeature(key)` 與路由 guard 讀它。`featureFlagPlugin` 的空殼換成真正的實作或移除。
- 清理：`removeBy` 過期的 flag 在 CI 以 lint 或測試報錯，避免永久殘留。

## 開放問題

1. flag 與權限的界線要寫成規則：權限是「誰可以做」且永久存在；flag 是「這個功能上線了沒」且一定會被移除。
   依角色開放的 flag 會和權限很像，要不要乾脆不做租戶層，只做平台對租戶？
2. flag 移除的流程：到期後誰負責移除程式碼與資料列？
3. 前端在 profile 載入前（登入前的頁面）要不要看得到 flag？apps/auth 的登入頁目前讀的是公開系統設定。

## 歸檔去向

- `docs/architecture/backend/12-settings.md`（與系統設定同章）、`docs/architecture/frontend/02-plugin-system.md`
- 平台層的開關：`docs/architecture/05-tenancy.md`
